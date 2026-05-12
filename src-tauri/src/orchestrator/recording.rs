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
/// Returns `None` if the resource is missing (e.g. unbundled dev build).
fn resolve_silero_model_path(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let candidate = resource_dir.join("resources/silero_vad_v4.onnx");
    if candidate.exists() {
        return Some(candidate);
    }
    // Dev mode fallback: project resources/ directory next to Cargo.toml
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("silero_vad_v4.onnx");
    if dev_path.exists() {
        return Some(dev_path);
    }
    None
}

/// Install VAD on the recorder according to config.
/// Side-effect only: failures are logged and gracefully degrade to no VAD.
fn install_vad(recorder: &AudioRecorder, app: &AppHandle, vad_config: &VadConfig) {
    let model_path = if vad_config.backend == "silero" {
        resolve_silero_model_path(app)
    } else {
        None
    };
    let vad = build_vad(vad_config, model_path.as_deref());
    recorder.set_vad(vad);
}

pub struct RecordingCoordinator {
    app: AppHandle,
    recorder: Arc<AudioRecorder>,
    state: Arc<Mutex<RecordingState>>,
    queue: Arc<TranscriptionQueue>,
    overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
    polling_cancel: Arc<Mutex<Option<CancellationToken>>>,
}

impl RecordingCoordinator {
    pub fn new(
        app: AppHandle,
        recorder: Arc<AudioRecorder>,
        state: Arc<Mutex<RecordingState>>,
        queue: Arc<TranscriptionQueue>,
        overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
        polling_cancel: Arc<Mutex<Option<CancellationToken>>>,
    ) -> Self {
        Self {
            app,
            recorder,
            state,
            queue,
            overlay,
            polling_cancel,
        }
    }

    pub async fn on_hotkey_pressed(&self) {
        let mut state = self.state.lock().await;
        if !matches!(*state, RecordingState::Idle | RecordingState::Transcribing) {
            tracing::debug!(
                "Ignoring hotkey press - cannot record (state: {:?})",
                *state
            );
            return;
        }
        if !create_permission_checker()
            .check(Permission::Microphone)
            .is_granted()
        {
            self.emit_error(
                "Microphone permission required. Please grant access in System Settings.",
            );
            return;
        }

        let config = load_config_from_app(&self.app);
        let device = if config.audio_device == "default" {
            "default".to_string()
        } else {
            config.audio_device.clone()
        };
        install_vad(&self.recorder, &self.app, &config.vad);
        if let Err(e) = self.recorder.start(&device) {
            self.handle_error(&mut state, &e.to_string(), ErrorContext::Hotkey)
                .await;
            return;
        }

        *state = RecordingState::Recording;
        self.emit_state(RecordingState::Recording);
        if config.overlay.enabled {
            self.overlay.lock().await.show(OverlayState::Recording);
            let token = CancellationToken::new();
            let mut cancel_guard = self.polling_cancel.lock().await;
            if let Some(old_token) = cancel_guard.take() {
                old_token.cancel();
            }
            *cancel_guard = Some(token.clone());
            drop(cancel_guard);
            audio_level::start_audio_level_polling(
                Arc::clone(&self.recorder),
                Arc::clone(&self.overlay),
                token,
            );
        }
    }

    pub async fn on_hotkey_released(&self) {
        if let Some(token) = self.polling_cancel.lock().await.take() {
            token.cancel();
        }

        let mut state = self.state.lock().await;
        if *state != RecordingState::Recording {
            tracing::debug!(
                "Ignoring hotkey release - not recording (state: {:?})",
                *state
            );
            return;
        }

        let audio_data = match self.recorder.stop() {
            Ok(data) => data,
            Err(e) => {
                self.handle_error(&mut state, &e.to_string(), ErrorContext::Hotkey)
                    .await;
                self.overlay.lock().await.hide();
                return;
            }
        };

        let queue_size = self.queue.push(audio_data).await;
        *state = RecordingState::Transcribing;
        self.emit_state(RecordingState::Transcribing);

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
        *self.state.lock().await
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

    async fn handle_error(&self, state: &mut RecordingState, error: &str, context: ErrorContext) {
        tracing::error!("{:?} error: {}", context, error);
        self.emit_error(error);
        *state = RecordingState::Error;
        self.emit_state(RecordingState::Error);
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        *state = RecordingState::Idle;
        self.emit_state(RecordingState::Idle);
    }
}
