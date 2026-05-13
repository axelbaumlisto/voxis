use super::coordinator::{Stage, TranscriptionCoordinator};
use super::{audio_level, load_config_from_app, ErrorContext, RecordingState, TranscriptionQueue};
use crate::audio::vad::build_vad;
use crate::audio::AudioRecorder;
use crate::config::VadConfig;
use crate::overlay_native::{OverlayBackend, OverlayState};
use crate::permissions::{create_permission_checker, Permission, PermissionChecker};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// Resolve the bundled Silero VAD model path via Tauri's resource directory.
fn resolve_silero_model_path(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let candidate = resource_dir.join("resources/silero_vad_v4.onnx");
    if candidate.exists() {
        return Some(candidate);
    }
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("silero_vad_v4.onnx");
    if dev_path.exists() {
        return Some(dev_path);
    }
    None
}

fn install_vad(recorder: &AudioRecorder, app: &AppHandle, vad_config: &VadConfig) {
    let model_path = if vad_config.backend == "silero" {
        resolve_silero_model_path(app)
    } else {
        None
    };
    let vad = build_vad(vad_config, model_path.as_deref());
    recorder.set_vad(vad);
}

/// Map Coordinator Stage back to RecordingState for legacy event surface.
///
/// SRP: pure mapping, exposed `pub(crate)` so tests can verify the contract.
pub(crate) fn stage_to_state(stage: Stage) -> RecordingState {
    match stage {
        Stage::Idle => RecordingState::Idle,
        Stage::Recording => RecordingState::Recording,
        Stage::Processing => RecordingState::Transcribing,
    }
}

/// Phase 4.2: Coordinator is the single source of truth for recording state.
///
/// The legacy `Arc<Mutex<RecordingState>>` is kept only as a downstream cache
/// for the transcription pipeline (which still uses it to mark Idle/Error).
/// All gate checks and state transitions go through `TranscriptionCoordinator`,
/// which serializes events through its worker thread.
pub struct RecordingCoordinator {
    app: AppHandle,
    recorder: Arc<AudioRecorder>,
    /// Downstream cache used by dispatch/pipeline. Mirrors `coordinator` stage
    /// plus a transient `Error` state for the user-visible event surface.
    state_cache: Arc<Mutex<RecordingState>>,
    coordinator: Arc<TranscriptionCoordinator>,
    queue: Arc<TranscriptionQueue>,
    overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
    polling_cancel: Arc<Mutex<Option<CancellationToken>>>,
    /// Token that an in-flight `on_hotkey_pressed` is sleeping on while it
    /// waits for the debounce threshold. `on_hotkey_released` cancels this
    /// token so a short press (key used as modifier in a combination)
    /// never starts recording. Tagged with a monotonically increasing
    /// press id so a race — release of press N after press N+1 has begun —
    /// cannot accidentally cancel the wrong token.
    pending_press: Arc<Mutex<Option<(u64, CancellationToken)>>>,
    /// Counter for press ids — only used to disambiguate concurrent press
    /// cycles inside the debounce window.
    press_seq: Arc<std::sync::atomic::AtomicU64>,
}

impl RecordingCoordinator {
    pub fn new(
        app: AppHandle,
        recorder: Arc<AudioRecorder>,
        state_cache: Arc<Mutex<RecordingState>>,
        coordinator: Arc<TranscriptionCoordinator>,
        queue: Arc<TranscriptionQueue>,
        overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
        polling_cancel: Arc<Mutex<Option<CancellationToken>>>,
    ) -> Self {
        Self {
            app,
            recorder,
            state_cache,
            coordinator,
            queue,
            overlay,
            polling_cancel,
            pending_press: Arc::new(Mutex::new(None)),
            press_seq: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }

    /// Mirror coordinator's current Stage into the legacy state cache and
    /// emit `state-changed` for the frontend.
    async fn mirror_state(&self) -> RecordingState {
        let stage = self.coordinator.current_stage();
        let state = stage_to_state(stage);
        let mut cache = self.state_cache.lock().await;
        *cache = state;
        drop(cache);
        self.emit_state(state);
        state
    }

    pub async fn on_hotkey_pressed(&self) {
        tracing::info!("on_hotkey_pressed: enter");
        let stage = self.coordinator.current_stage();
        tracing::info!("on_hotkey_pressed: current_stage={:?}", stage);
        // TALRI semantics: allow press from Idle (start fresh) or Processing
        // (queue a new recording while previous transcription finishes).
        if !matches!(stage, Stage::Idle | Stage::Processing) {
            tracing::debug!("Ignoring hotkey press - stage: {:?}", stage);
            return;
        }

        // ---- Debounce: short presses are key-combination modifiers ----
        // Read the user-configured hold threshold (default 300 ms). Sleep
        // that long while listening for a cancellation from
        // `on_hotkey_released`. If the release fires first the user was
        // pressing AltGr/Ctrl as part of a shortcut — bail out silently.
        let config_for_hold = load_config_from_app(&self.app);
        let hold_ms = config_for_hold.hotkey_hold_ms as u64;
        if hold_ms > 0 {
            let press_id = self
                .press_seq
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                + 1;
            let token = CancellationToken::new();
            {
                let mut slot = self.pending_press.lock().await;
                if let Some((_, prev)) = slot.take() {
                    prev.cancel();
                }
                *slot = Some((press_id, token.clone()));
            }
            let cancelled = tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_millis(hold_ms)) => false,
                _ = token.cancelled() => true,
            };
            // Clear our slot iff it still carries OUR press id (a later
            // press could have replaced it while we slept).
            {
                let mut slot = self.pending_press.lock().await;
                if matches!(slot.as_ref(), Some((id, _)) if *id == press_id) {
                    *slot = None;
                }
            }
            if cancelled {
                tracing::info!(
                    "on_hotkey_pressed: short press (<{}ms) - treated as key combo, ignored",
                    hold_ms
                );
                return;
            }
        }

        tracing::info!("on_hotkey_pressed: checking mic permission");
        if !create_permission_checker()
            .check(Permission::Microphone)
            .is_granted()
        {
            self.emit_error(
                "Microphone permission required. Please grant access in System Settings.",
            );
            return;
        }

        tracing::info!("on_hotkey_pressed: loading config");
        let config = load_config_from_app(&self.app);
        let device = if config.audio_device == "default" {
            "default".to_string()
        } else {
            config.audio_device.clone()
        };
        tracing::info!("on_hotkey_pressed: installing vad");
        install_vad(&self.recorder, &self.app, &config.vad);
        tracing::info!("on_hotkey_pressed: starting recorder, device={device}");
        if let Err(e) = self.recorder.start(&device) {
            tracing::error!("on_hotkey_pressed: recorder.start failed: {e}");
            self.handle_error(&e.to_string(), ErrorContext::Hotkey).await;
            return;
        }
        tracing::info!("on_hotkey_pressed: recorder started OK");

        // Drive Coordinator + wait for the worker to apply the transition.
        self.coordinator.on_press();
        tracing::info!("on_hotkey_pressed: sent on_press, awaiting stage Recording");
        self.await_stage(Stage::Recording).await;
        tracing::info!(
            "on_hotkey_pressed: stage now {:?}",
            self.coordinator.current_stage()
        );
        tracing::info!("on_hotkey_pressed: mirror_state");
        self.mirror_state().await;

        if config.overlay.enabled {
            tracing::info!("on_hotkey_pressed: about to acquire overlay lock");
            let overlay_guard = self.overlay.lock().await;
            tracing::info!("on_hotkey_pressed: overlay lock acquired, calling show()");
            overlay_guard.show(OverlayState::Recording);
            tracing::info!("on_hotkey_pressed: show() returned, dropping overlay guard");
            drop(overlay_guard);
            tracing::info!("on_hotkey_pressed: overlay guard dropped, preparing polling");
            let token = CancellationToken::new();
            let mut cancel_guard = self.polling_cancel.lock().await;
            if let Some(old_token) = cancel_guard.take() {
                old_token.cancel();
            }
            *cancel_guard = Some(token.clone());
            drop(cancel_guard);
            tracing::info!("on_hotkey_pressed: spawning audio_level polling");
            audio_level::start_audio_level_polling(
                Arc::clone(&self.recorder),
                Arc::clone(&self.overlay),
                token,
            );
            tracing::info!("on_hotkey_pressed: polling spawned, returning");
        } else {
            tracing::info!("on_hotkey_pressed: overlay disabled, returning");
        }
    }

    pub async fn on_hotkey_released(&self) {
        // If a press is still inside its debounce window, cancel it: the
        // user lifted the key before the hold threshold so we never wanted
        // to start recording in the first place.
        if let Some((_id, token)) = self.pending_press.lock().await.take() {
            token.cancel();
            tracing::info!("on_hotkey_released: cancelled pending press (short hold)");
            return;
        }

        if let Some(token) = self.polling_cancel.lock().await.take() {
            token.cancel();
        }

        if self.coordinator.current_stage() != Stage::Recording {
            tracing::debug!("Ignoring hotkey release - not recording");
            return;
        }

        let audio_data = match self.recorder.stop() {
            Ok(data) => data,
            Err(e) => {
                self.handle_error(&e.to_string(), ErrorContext::Hotkey).await;
                self.overlay.lock().await.hide();
                return;
            }
        };

        let queue_size = self.queue.push(audio_data).await;
        self.coordinator.on_release();
        self.await_stage(Stage::Processing).await;
        self.mirror_state().await;

        let config = load_config_from_app(&self.app);
        if config.overlay.enabled {
            self.overlay.lock().await.show(if queue_size > 1 {
                OverlayState::Queued(queue_size)
            } else {
                OverlayState::Transcribing
            });
        }
    }

    pub async fn get_state(&self) -> RecordingState {
        // Read from the cache: it includes transient Error overlay set by
        // handle_error / pipeline / error.rs which Stage alone can't represent.
        let cached = *self.state_cache.lock().await;
        if matches!(cached, RecordingState::Error) {
            return cached;
        }
        stage_to_state(self.coordinator.current_stage())
    }

    pub fn shutdown(&self) {
        self.recorder.close();
    }

    fn emit_state(&self, state: RecordingState) {
        if let Err(e) = self.app.emit("state-changed", state) {
            tracing::error!("Failed to emit state-changed: {}", e);
        }
    }

    fn emit_error(&self, error: &str) {
        if let Err(e) = self.app.emit("error", error) {
            tracing::error!("Failed to emit error: {}", e);
        }
    }

    async fn handle_error(&self, error: &str, context: ErrorContext) {
        tracing::error!("{:?} error: {}", context, error);
        self.emit_error(error);

        // Set the cache to Error directly; Coordinator stays in its current
        // stage (Cancel will return it to Idle).
        {
            let mut cache = self.state_cache.lock().await;
            *cache = RecordingState::Error;
        }
        self.emit_state(RecordingState::Error);

        // Cancel coordinator so it returns to Idle from Recording.
        self.coordinator.cancel();

        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Recover: sync cache to whatever stage we ended up in.
        self.mirror_state().await;
    }

    /// Wait briefly for the Coordinator worker to apply a transition.
    /// Uses a deterministic poll loop with a tight bound (max 100ms).
    async fn await_stage(&self, expected: Stage) {
        for _ in 0..50 {
            if self.coordinator.current_stage() == expected {
                return;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(2)).await;
        }
        tracing::warn!(
            "Coordinator stage did not reach {:?} (currently {:?})",
            expected,
            self.coordinator.current_stage()
        );
    }
}



#[cfg(test)]
mod stage_mapping_tests {
    use super::*;

    #[test]
    fn test_stage_idle_maps_to_state_idle() {
        assert_eq!(stage_to_state(Stage::Idle), RecordingState::Idle);
    }

    #[test]
    fn test_stage_recording_maps_to_state_recording() {
        assert_eq!(stage_to_state(Stage::Recording), RecordingState::Recording);
    }

    #[test]
    fn test_stage_processing_maps_to_state_transcribing() {
        assert_eq!(stage_to_state(Stage::Processing), RecordingState::Transcribing);
    }

    #[test]
    fn test_stage_mapping_is_total() {
        // Compile-time guarantee + smoke test: every Stage maps to a state.
        for stage in [Stage::Idle, Stage::Recording, Stage::Processing] {
            let _ = stage_to_state(stage);
        }
    }
}
