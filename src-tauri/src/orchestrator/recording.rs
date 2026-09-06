use super::coordinator::{Stage, TranscriptionCoordinator};
use super::{audio_level, load_config_from_app, ErrorContext, RecordingState, TranscriptionQueue};
use crate::audio::vad::build_vad;
use crate::audio::{AudioError, AudioRecorder};
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

/// Why `stop_recording` is being called. `ReleasePending`, `SilenceTimeout`
/// and `MaxDuration` are constructed by not-yet-landed steps (Layer 0's
/// press/release residual-window fix; Layer 2's recording guard) — defined
/// now, alongside the three reasons this step actually triggers, so
/// `stop_recording`'s API is stable across those steps and callers don't
/// need to touch this enum again. Remove the `allow` once those steps
/// construct them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum StopReason {
    /// Normal hotkey release.
    Release,
    /// Toggle-mode second press (was dead code — previously routed through
    /// `on_hotkey_released`'s toggle guard, which returns immediately in
    /// toggle mode and never reached `recorder.stop()`; plan §1.4).
    TogglePress,
    /// `Orchestrator::cancel()` — discard path, no `queue.push`.
    Cancel,
    /// Layer 0: the press-side residual-window check found a release that
    /// arrived after `await_stage(Recording)` but wasn't seen in time by
    /// the release task itself.
    ReleasePending,
    /// Layer 2 recording guard: continuous near-silence exceeded the
    /// configured timeout.
    SilenceTimeout,
    /// Layer 2/3: recording exceeded the configured (or absolute) maximum
    /// duration.
    MaxDuration,
}

/// Outcome of checking whether a `stop_recording` call should actually touch
/// the recorder, and if so, how.
///
/// SRP: pure decision, no side effects — `stop_recording` performs the
/// logging/recorder/queue/overlay side effects based on this value. Kept
/// free of any `AppHandle`/`Arc` dependency so it's unit-testable without a
/// running Tauri app (plan §4 harness option B).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StopDecision {
    /// Nothing to stop: the coordinator isn't in `Stage::Recording` at
    /// all. Silent — this is the loser of a real race (the winner holds
    /// `stop_lock` through its own stage transition, so a loser only ever
    /// observes `Processing`/`Idle`, never `Recording` with a dead
    /// recorder — see `Recover`), or a stray call with nothing to do.
    Skip,
    /// Abnormal: the coordinator still says `Stage::Recording` but
    /// `AudioRecorder::is_recording()` is already `false`. Under
    /// `stop_lock` this can NEVER be a benign race-loser (T3 r1 review,
    /// finding 1) — it means the recording thread died after `start()`
    /// returned `Ok` (stream build/play failure, a panic, device
    /// unplugged) or a bypassing raw `stop_recording` command stopped the
    /// recorder underneath the orchestrator. `stop_recording` must NOT
    /// call `recorder.stop()` (nothing to stop) and must still return the
    /// coordinator to `Idle` — leaving it pinned at `Recording` makes the
    /// hotkey dead until restart (`press_action` ignores/skips every
    /// subsequent press/toggle/cancel while stage is `Recording`).
    Recover,
    /// Stop the recorder but throw the audio away: no `queue.push`, no
    /// transcription. Used only by `StopReason::Cancel`.
    Discard,
    /// Stop the recorder and, unless the capture turns out to be
    /// too-short, queue it for transcription. Used by every reason other
    /// than `Cancel`.
    Finalize,
}

/// Decide what a `stop_recording(reason)` call should do, given the
/// coordinator's current stage and whether the recorder is actually
/// recording. Re-checked *inside* `stop_lock` by the caller, so this is the
/// single source of truth for "is there a live recording to stop" —
/// plan §3 Layer 1 tests 1-6 (+ T3 r1 review finding 1: `Recover`).
pub(crate) fn stop_decision(
    stage: Stage,
    is_recording: bool,
    reason: StopReason,
) -> StopDecision {
    if stage != Stage::Recording {
        return StopDecision::Skip;
    }
    if !is_recording {
        // Stage says Recording but the recorder disagrees — abnormal for
        // EVERY reason, not just some (T3 r1 review, finding 1).
        return StopDecision::Recover;
    }
    match reason {
        StopReason::Cancel => StopDecision::Discard,
        _ => StopDecision::Finalize,
    }
}

/// How `stop_recording` should react to an `Err` from `recorder.stop()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StopErrorAction {
    /// `AudioError::StopInProgress`: another caller's `stop()` won the
    /// single-flight CAS a moment earlier and is already handling this
    /// stop (or just finished). Not a user-facing error — no beep, no
    /// `handle_error`, no overlay change; see T2 review finding C3.
    SilentRaceLost,
    /// Any other error (device gone, WAV encode failure, ...) — the
    /// existing user-visible error path (beep + `handle_error` + hide
    /// overlay).
    UserError,
}

/// Map a `recorder.stop()` error to how `stop_recording` should react.
pub(crate) fn map_stop_error(e: &AudioError) -> StopErrorAction {
    match e {
        AudioError::StopInProgress => StopErrorAction::SilentRaceLost,
        _ => StopErrorAction::UserError,
    }
}

/// What a hotkey/tap press should do, given the current hotkey mode and
/// coordinator stage. Mirrors the two checks `on_hotkey_pressed` used to
/// perform inline (toggle-stops-recording branch, then the TALRI
/// Idle/Processing gate) as one pure, exhaustively-tested decision — plan
/// §4 test 3.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PressAction {
    /// Toggle mode, already `Recording`: this press stops the current
    /// take (routes to `stop_recording(StopReason::TogglePress)`) instead
    /// of starting a new one.
    StopToggle,
    /// `Idle` or `Processing` (TALRI: a new recording may start while the
    /// previous transcription is still running): proceed to debounce /
    /// permission-check / `recorder.start()`.
    Start,
    /// Any other combination (hold-mode press while already `Recording`):
    /// ignored.
    Ignore,
}

/// Decide what an incoming press should do.
pub(crate) fn press_action(is_toggle_mode: bool, stage: Stage) -> PressAction {
    if is_toggle_mode && stage == Stage::Recording {
        return PressAction::StopToggle;
    }
    if matches!(stage, Stage::Idle | Stage::Processing) {
        return PressAction::Start;
    }
    PressAction::Ignore
}

/// Phase 4.2: Coordinator is the single source of truth for recording state.
///
/// The legacy `Arc<Mutex<RecordingState>>` is kept only as a downstream cache
/// for the transcription pipeline (which still uses it to mark Idle/Error).
/// All gate checks and state transitions go through `TranscriptionCoordinator`,
/// which serializes events through its worker thread.
#[derive(Clone)]
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
    /// Token for the not-yet-landed recording guard (Layer 2). Always
    /// `None` until that step fills it; `stop_recording` already cancels it
    /// alongside `polling_cancel` (if present) so Layer 2 doesn't need to
    /// touch the stop path at all, only populate this slot.
    guard_cancel: Arc<Mutex<Option<CancellationToken>>>,
    /// Serializes every path that stops the recorder (`stop_recording`) and
    /// the recorder-starting section of `on_hotkey_pressed`, so at most one
    /// of {a start, a stop} touches `AudioRecorder`'s stream-state at a
    /// time — plan §3 Layer 1. The `stopping: AtomicBool` guard inside
    /// `AudioRecorder` (T2) already makes concurrent `stop()`/`start()`
    /// calls individually safe; this lock closes the last few-instructions
    /// TOCTOU window between them (T2 review finding, scrutiny b) and is
    /// the single signal `Command::Cancel`-ordering (see `stop_recording`)
    /// relies on.
    stop_lock: Arc<tokio::sync::Mutex<()>>,
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
            guard_cancel: Arc::new(Mutex::new(None)),
            stop_lock: Arc::new(tokio::sync::Mutex::new(())),
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

    pub async fn on_hotkey_pressed(&self, skip_debounce: bool) {
        crate::diagnostics::breadcrumbs::sites::hotkey_pressed();
        tracing::info!("on_hotkey_pressed: enter");
        let stage = self.coordinator.current_stage();
        tracing::info!("on_hotkey_pressed: current_stage={:?}", stage);

        // Toggle mode (#3): a press while already Recording stops the
        // current take instead of being ignored. Hold-mode (default)
        // keeps the legacy 'only Idle/Processing' guard. TALRI semantics:
        // allow press from Idle (start fresh) or Processing (queue a new
        // recording while previous transcription finishes). Both checks
        // are now one pure, unit-tested decision — see `press_action`.
        let early_config = load_config_from_app(&self.app);
        let is_toggle_mode = early_config.hotkey_mode == "toggle";
        match press_action(is_toggle_mode, stage) {
            PressAction::StopToggle => {
                tracing::info!("on_hotkey_pressed: toggle mode — stopping current recording");
                // Directly to the shared stop path — NOT `on_hotkey_released()`,
                // which returns immediately in toggle mode (see its own toggle
                // guard) and would never reach `recorder.stop()` (plan §1.4:
                // toggle-mode recordings could never be stopped).
                self.stop_recording(StopReason::TogglePress).await;
                return;
            }
            PressAction::Ignore => {
                tracing::debug!("Ignoring hotkey press - stage: {:?}", stage);
                return;
            }
            PressAction::Start => {}
        }

        // ---- Debounce: short presses are key-combination modifiers ----
        // Read the user-configured hold threshold (default 300 ms). Sleep
        // that long while listening for a cancellation from
        // `on_hotkey_released`. If the release fires first the user was
        // pressing AltGr/Ctrl as part of a shortcut — bail out silently.
        //
        // skip_debounce: when true (e.g. pointer/touch overlay tap),
        // the debounce is skipped entirely — a tap on the cell is
        // explicit intent and must start recording immediately.
        if !skip_debounce {
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
        } // end skip_debounce guard

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
        // Hold `stop_lock` across the whole start-critical section (start
        // .. await_stage(Recording)) so this can never race a concurrent
        // `stop_recording` — plan §3 Layer 1. `AudioRecorder::start()` (T2)
        // already refuses on its own while a stop is mid-flight; this lock
        // closes the last few-instructions TOCTOU window a lone atomic
        // flag can't (T2 review, scrutiny b), by ensuring no `stop_recording`
        // call is *itself* in flight while we're here at all.
        let _start_guard = self.stop_lock.lock().await;
        if let Err(e) = self.recorder.start(&device) {
            if matches!(e, AudioError::StopInProgress) {
                // A stop is (or just was) in flight. Not a user-facing
                // error — the hotkey press simply lost a race; the user
                // can press again once the in-flight stop completes.
                tracing::debug!(
                    "on_hotkey_pressed: recorder.start refused, a stop is in flight: {e}"
                );
                return;
            }
            tracing::error!("on_hotkey_pressed: recorder.start failed: {e}");
            // Audio feedback for the error path so the user gets
            // immediate auditory confirmation that something went
            // wrong (mic permission denied, device disconnected, ...).
            let _ = crate::audio_feedback::play(
                crate::audio_feedback::SoundType::Error,
                config.audio_feedback,
                &crate::audio_feedback::RodioPlayer,
            );
            // recorder.start() has already returned — nothing left to
            // serialize against, and handle_error sleeps 2s; drop the lock
            // first so a concurrent stop/press isn't queued behind that
            // sleep for no reason (T3 r1 review, finding 2).
            drop(_start_guard);
            self.handle_error(&e.to_string(), ErrorContext::Hotkey)
                .await;
            return;
        }
        crate::diagnostics::breadcrumbs::sites::recording_started();
        tracing::info!("on_hotkey_pressed: recorder started OK");
        // Audio feedback for successful recording start. Non-blocking
        // (RodioPlayer spawns its own short-lived audio thread).
        let _ = crate::audio_feedback::play(
            crate::audio_feedback::SoundType::Start,
            config.audio_feedback,
            &crate::audio_feedback::RodioPlayer,
        );

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
        drop(_start_guard);

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
        crate::diagnostics::breadcrumbs::sites::hotkey_released();
        // Toggle mode (#3): a release does nothing on its own — the
        // user has to press again to stop. Skip even the debounce-cancel
        // path so a short tap counts as a 'start' (handled when the
        // press itself completes).
        let mode_config = load_config_from_app(&self.app);
        if mode_config.hotkey_mode == "toggle" {
            tracing::debug!("on_hotkey_released: toggle mode — ignoring release");
            return;
        }

        // If a press is still inside its debounce window, cancel it: the
        // user lifted the key before the hold threshold so we never wanted
        // to start recording in the first place.
        if let Some((_id, token)) = self.pending_press.lock().await.take() {
            token.cancel();
            tracing::info!("on_hotkey_released: cancelled pending press (short hold)");
            return;
        }

        self.stop_recording(StopReason::Release).await;
    }

    /// The ONE path that stops the recorder — release, toggle-mode
    /// second-press, and `Orchestrator::cancel()` all funnel through here
    /// (plan §2 DRY, §3 Layer 1). Serialized against `on_hotkey_pressed`'s
    /// start-critical section by `stop_lock`.
    pub(crate) async fn stop_recording(&self, reason: StopReason) {
        let _guard = self.stop_lock.lock().await;

        // Re-check under the lock — single source of truth for "is there a
        // live recording to stop", plan §4 tests 1-6 (+ T3 r1 review finding 1).
        let stage = self.coordinator.current_stage();
        let is_recording = self.recorder.is_recording();
        let decision = stop_decision(stage, is_recording, reason);

        // Cancel any live polling/guard tokens up front, BEFORE branching
        // on the decision at all (T3 r1 review, D1 hardening: hoisted
        // above the Skip/Recover checks). A Skip/Recover cancels `None` in
        // the normal race-loser case (zero risk) and additionally cleans
        // up the orphan-recorder state noted in the review's
        // CARRY-FORWARD C1 (the coordinator's 30ms Press debounce can drop
        // a Press after `recorder.start()` already returned `Ok`, leaving
        // a poller animating an overlay nobody would otherwise stop).
        if let Some(token) = self.polling_cancel.lock().await.take() {
            token.cancel();
        }
        if let Some(token) = self.guard_cancel.lock().await.take() {
            token.cancel();
        }

        if matches!(decision, StopDecision::Skip) {
            tracing::debug!(
                "stop_recording({:?}): skip — stage={:?}, is_recording={}",
                reason,
                stage,
                is_recording
            );
            return;
        }

        if matches!(decision, StopDecision::Recover) {
            // Abnormal: coordinator says Recording, recorder disagrees.
            // Under stop_lock this is never a benign race-loser (T3 r1
            // review, finding 1) — recover to Idle without calling
            // recorder.stop() (there is nothing to stop). Minimum viable
            // per review: warn + breadcrumb are the only user-visible
            // trace (no Error beep / state_cache=Error banner) — the next
            // press starts a fresh recording immediately rather than
            // sitting behind handle_error's 2s sleep for a failure the
            // user didn't cause.
            tracing::warn!(
                "stop_recording({:?}): coordinator says Recording but recorder is not \
                 recording — recovering to Idle. Abnormal: recording thread died after \
                 start() (stream build/play failure, panic, device unplugged), or a \
                 bypassing raw stop_recording command stopped the recorder.",
                reason
            );
            crate::diagnostics::breadcrumbs::sites::recording_stop_recover();
            self.coordinator.cancel();
            self.await_stage(Stage::Idle).await;
            self.overlay.lock().await.hide();
            self.mirror_state().await;
            return;
        }

        // `recorder.stop()` can take MINUTES on a large stuck buffer (6m13s
        // observed, plan §1.4: pause + clone-under-mutex + downsample + VAD
        // + WAV encode are all O(buffer size)) — run it off the async
        // runtime so it can't stall other tokio tasks while `stop_lock` is
        // held (holding the lock across the `.await` IS the intended
        // serialization point, plan §3 Layer 1).
        let recorder = Arc::clone(&self.recorder);
        let stop_result = tokio::task::spawn_blocking(move || recorder.stop())
            .await
            .unwrap_or_else(|join_err| {
                Err(AudioError::ThreadError(format!(
                    "stop() task panicked: {join_err}"
                )))
            });

        // Read config once for the rest of this path (audio_feedback used
        // both in the error branch and the happy-path beeps).
        let release_config = load_config_from_app(&self.app);

        let audio_data = match stop_result {
            Ok(data) => data,
            Err(e) => {
                match map_stop_error(&e) {
                    StopErrorAction::SilentRaceLost => {
                        // Another stop_recording call's `recorder.stop()`
                        // already won the single-flight CAS a moment ago
                        // (or just finished) — not a user-facing error, see
                        // T2 review finding C3.
                        tracing::debug!(
                            "stop_recording({:?}): lost race, another stop already in flight/done: {e}",
                            reason
                        );
                        crate::diagnostics::breadcrumbs::sites::recording_stop_race_lost();
                    }
                    StopErrorAction::UserError => {
                        let _ = crate::audio_feedback::play(
                            crate::audio_feedback::SoundType::Error,
                            release_config.audio_feedback,
                            &crate::audio_feedback::RodioPlayer,
                        );
                        // recorder.stop() has already returned — nothing
                        // left to serialize against, and handle_error
                        // sleeps 2s; drop the lock first so a concurrent
                        // press/stop isn't queued behind that sleep for no
                        // reason (T3 r1 review, finding 2).
                        drop(_guard);
                        self.handle_error(&e.to_string(), ErrorContext::Hotkey)
                            .await;
                        self.overlay.lock().await.hide();
                    }
                }
                return;
            }
        };
        crate::diagnostics::breadcrumbs::sites::recording_stopped();
        match reason {
            StopReason::Release | StopReason::ReleasePending => {
                crate::diagnostics::breadcrumbs::sites::recording_stop_release()
            }
            StopReason::TogglePress => crate::diagnostics::breadcrumbs::sites::recording_stop_toggle(),
            StopReason::Cancel => crate::diagnostics::breadcrumbs::sites::recording_stop_cancel(),
            // Layer 2's guard (not yet landed) owns its own
            // `recording:auto_stopped_*` breadcrumbs for these two reasons.
            StopReason::SilenceTimeout | StopReason::MaxDuration => {}
        }

        if matches!(decision, StopDecision::Discard) {
            // Cancel path: throw the audio away, no queue.push. Stage is
            // still `Recording` here (never flipped before `recorder.stop()`
            // returned, plan §3 Layer 1 rationale) so `coordinator.cancel()`
            // is guaranteed to actually apply — see
            // `test_cancel_ordering_assumption_matches_coordinator_semantics`.
            self.coordinator.cancel();
            self.await_stage(Stage::Idle).await;
            self.overlay.lock().await.hide();
            self.mirror_state().await;
            return;
        }

        // Drop too-short captures (accidental click/tap on the overlay, or a
        // hold over silence that VAD trimmed to near-zero). Sending these to
        // the API yields a user-facing "Audio file is too short" error, so we
        // silently cancel back to Idle instead. Stage is still `Recording`
        // here for the same reason as the Discard path above.
        let min_ms = release_config.min_recording_ms;
        if let Some(dur_ms) = crate::audio::wav_duration_ms(&audio_data) {
            if dur_ms < min_ms {
                tracing::info!(
                    "stop_recording({:?}): dropping too-short recording ({dur_ms}ms < {min_ms}ms)",
                    reason
                );
                self.coordinator.cancel();
                self.await_stage(Stage::Idle).await;
                self.overlay.lock().await.hide();
                self.mirror_state().await;
                return;
            }
        }

        // Stop beep — short, mid-pitch, signals 'recording captured'.
        let _ = crate::audio_feedback::play(
            crate::audio_feedback::SoundType::Stop,
            release_config.audio_feedback,
            &crate::audio_feedback::RodioPlayer,
        );

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
        assert_eq!(
            stage_to_state(Stage::Processing),
            RecordingState::Transcribing
        );
    }

    #[test]
    fn test_stage_mapping_is_total() {
        // Compile-time guarantee + smoke test: every Stage maps to a state.
        for stage in [Stage::Idle, Stage::Recording, Stage::Processing] {
            let _ = stage_to_state(stage);
        }
    }
}

#[cfg(test)]
mod debounce_tests {
    // The hold threshold from `config/consts.rs`:
    // `pub const DEFAULT_HOTKEY_HOLD_MS: u32 = 300;`
    const DEFAULT_HOLD_MS: u64 = 300;

    /// Returns whether the debounce hold-sleep would be entered for the
    /// given parameters — mirrors the exact guard condition in
    /// `on_hotkey_pressed`.
    fn enters_debounce(skip_debounce: bool, hold_ms: u64) -> bool {
        !skip_debounce && hold_ms > 0
    }

    #[test]
    fn test_pointer_bypasses_debounce() {
        // Pointer/touch overlay tap: skip_debounce=true.
        // The debounce block must NOT be entered — a tap on the cell
        // is explicit intent and must start recording immediately.
        assert!(
            !enters_debounce(true, DEFAULT_HOLD_MS),
            "skip_debounce=true must bypass the hold timer entirely"
        );
        // Also holds for any hold_ms value — the skip_debounce guard
        // short-circuits before hold_ms is even read.
        assert!(!enters_debounce(true, 0));
        assert!(!enters_debounce(true, 1000));
    }

    #[test]
    fn test_keyboard_honors_debounce() {
        // Keyboard hotkey path: skip_debounce=false.
        // With the default hold_ms=300, the debounce block IS entered.
        // This is how AltGr/Ctrl-as-modifier protection works — a
        // short press (<300ms) gets cancelled by the release.
        assert!(
            enters_debounce(false, DEFAULT_HOLD_MS),
            "skip_debounce=false with hold_ms=300 must enter debounce"
        );
    }

    #[test]
    fn test_zero_hold_skips_debounce() {
        // When the user sets hold_ms=0, the debounce is skipped even
        // for the keyboard path — the inner `if hold_ms > 0` guard
        // prevents the sleep.
        assert!(!enters_debounce(false, 0));
    }
}

/// Plan §4 tests 1-6 (Layer 1: single-flight stop). Harness option B
/// (chosen by the plan): `RecordingCoordinator` needs a real `AppHandle`
/// and this crate has no `tauri/test` feature enabled, so the actual
/// decision logic `stop_recording`/`on_hotkey_pressed` run at runtime is
/// extracted into pure, device-free functions (`stop_decision`,
/// `map_stop_error`, `press_action`) exercised exhaustively here. The
/// async methods are thin shells over them (see their bodies above) —
/// there are two sources of truth ONLY for the underlying
/// `TranscriptionCoordinator` ordering assumption (t5), which is why that
/// test exercises the real coordinator directly rather than re-deriving
/// its semantics as a third pure function.
#[cfg(test)]
mod stop_decision_tests {
    use super::*;
    use crate::orchestrator::coordinator::DEBOUNCE;

    // ---- t1: stop_decision ----------------------------------------------

    #[test]
    fn test_stop_decision_recording_release_finalizes() {
        assert_eq!(
            stop_decision(Stage::Recording, true, StopReason::Release),
            StopDecision::Finalize
        );
    }

    #[test]
    fn test_stop_decision_recording_cancel_discards() {
        assert_eq!(
            stop_decision(Stage::Recording, true, StopReason::Cancel),
            StopDecision::Discard
        );
    }

    #[test]
    fn test_stop_decision_idle_always_skips() {
        for reason in [StopReason::Release, StopReason::Cancel, StopReason::TogglePress] {
            assert_eq!(
                stop_decision(Stage::Idle, true, reason),
                StopDecision::Skip,
                "reason={reason:?}"
            );
            // Also true regardless of what is_recording claims — stage is
            // the primary gate.
            assert_eq!(stop_decision(Stage::Idle, false, reason), StopDecision::Skip);
        }
    }

    #[test]
    fn test_stop_decision_processing_always_skips() {
        for reason in [StopReason::Release, StopReason::Cancel, StopReason::TogglePress] {
            assert_eq!(
                stop_decision(Stage::Processing, true, reason),
                StopDecision::Skip,
                "reason={reason:?}"
            );
        }
    }

    #[test]
    fn test_stop_decision_recording_but_not_actually_recording_recovers() {
        // Abnormal, NOT a benign race-loser (T3 r1 review, finding 1):
        // under `stop_lock`, the winner of any real race holds the lock
        // through its own stage transition (on_release/cancel +
        // await_stage), so a loser can only ever observe
        // Processing/Idle — never `Recording` with a dead recorder. This
        // combination exclusively means the recording thread died after
        // `start()` returned `Ok` (stream build/play failure, a panic,
        // device unplugged) or a bypassing raw `stop_recording` command
        // stopped the recorder underneath the orchestrator. Treating it as
        // a silent Skip (the original, regressed behaviour this test used
        // to pin) leaves the coordinator stuck at `Recording` forever —
        // every subsequent press/toggle/cancel is Ignored/Skipped, so the
        // hotkey goes dead until the app restarts. `Recover` fixes that by
        // still returning the coordinator to `Idle`, just without calling
        // `recorder.stop()` (there is nothing to stop).
        assert_eq!(
            stop_decision(Stage::Recording, false, StopReason::Release),
            StopDecision::Recover
        );
        assert_eq!(
            stop_decision(Stage::Recording, false, StopReason::Cancel),
            StopDecision::Recover
        );
        assert_eq!(
            stop_decision(Stage::Recording, false, StopReason::TogglePress),
            StopDecision::Recover
        );
    }

    #[test]
    fn test_cancel_ordering_assumption_recover_path_via_real_coordinator() {
        // Coordinator-level regression test for the Recover fix (T3 r1
        // review, finding 1): drive the REAL TranscriptionCoordinator into
        // Recording, then prove (a) stop_decision agrees the abnormal
        // is_recording=false state must Recover, not Skip, and (b) the
        // Recover branch's own recovery mechanism — coordinator.cancel()
        // from Stage::Recording — actually reaches Idle (the same
        // mechanism `stop_recording`'s Recover arm calls).
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_coord_stage(&coord, Stage::Recording, "after press");

        assert_eq!(
            stop_decision(coord.current_stage(), false, StopReason::Release),
            StopDecision::Recover,
            "stage Recording + is_recording=false must Recover, not Skip — \
             this is the exact combination that pinned the T3 r1 regression"
        );

        // What stop_recording's Recover arm actually does with the stage:
        coord.cancel();
        wait_for_coord_stage(&coord, Stage::Idle, "after Recover's coordinator.cancel()");
    }

    #[test]
    fn test_stop_decision_toggle_and_pending_reasons_finalize_like_release() {
        // TogglePress, ReleasePending, SilenceTimeout, MaxDuration all take
        // the same Finalize path as Release — only Cancel discards.
        for reason in [
            StopReason::TogglePress,
            StopReason::ReleasePending,
            StopReason::SilenceTimeout,
            StopReason::MaxDuration,
        ] {
            assert_eq!(
                stop_decision(Stage::Recording, true, reason),
                StopDecision::Finalize,
                "reason={reason:?}"
            );
        }
    }

    // ---- t4: Cancel never pushes to queue --------------------------------

    #[test]
    fn test_cancel_decision_is_discard_not_finalize() {
        // `stop_recording`'s Discard branch returns before `queue.push` is
        // ever reached (see its body) — pinning `Discard != Finalize` here
        // is what guarantees a cancelled recording's audio can never be
        // queued for transcription.
        let decision = stop_decision(Stage::Recording, true, StopReason::Cancel);
        assert_eq!(decision, StopDecision::Discard);
        assert_ne!(decision, StopDecision::Finalize);
    }

    // ---- t2: map_stop_error -----------------------------------------------

    #[test]
    fn test_map_stop_error_stop_in_progress_is_silent_race_lost() {
        assert_eq!(
            map_stop_error(&AudioError::StopInProgress),
            StopErrorAction::SilentRaceLost
        );
    }

    #[test]
    fn test_map_stop_error_not_recording_is_user_error() {
        assert_eq!(
            map_stop_error(&AudioError::NotRecording),
            StopErrorAction::UserError
        );
    }

    #[test]
    fn test_map_stop_error_other_variants_are_user_error() {
        assert_eq!(
            map_stop_error(&AudioError::StreamError("x".into())),
            StopErrorAction::UserError
        );
        assert_eq!(
            map_stop_error(&AudioError::ThreadError("y".into())),
            StopErrorAction::UserError
        );
    }

    // ---- t3: press_action (toggle-press routes to stop_recording) --------

    #[test]
    fn test_press_action_toggle_mode_recording_stops_toggle() {
        assert_eq!(
            press_action(true, Stage::Recording),
            PressAction::StopToggle
        );
    }

    #[test]
    fn test_press_action_toggle_mode_idle_or_processing_starts() {
        assert_eq!(press_action(true, Stage::Idle), PressAction::Start);
        assert_eq!(press_action(true, Stage::Processing), PressAction::Start);
    }

    #[test]
    fn test_press_action_hold_mode_idle_or_processing_starts() {
        assert_eq!(press_action(false, Stage::Idle), PressAction::Start);
        assert_eq!(press_action(false, Stage::Processing), PressAction::Start);
    }

    #[test]
    fn test_press_action_hold_mode_recording_is_ignored() {
        // Hold-mode press while already Recording: legacy 'ignored' guard
        // (a hold-mode user pressing again mid-recording does nothing —
        // only the matching release stops it).
        assert_eq!(press_action(false, Stage::Recording), PressAction::Ignore);
    }

    // ---- t5: regression guard — stage must still be Recording when
    // ---- coordinator.cancel() runs (too-short-drop / Discard paths) ------

    /// Poll `TranscriptionCoordinator::current_stage()` until it matches, or
    /// panic after 2s. Intentionally a small, local duplicate of
    /// `coordinator::tests::wait_for_stage` (private to that module, and
    /// `orchestrator/coordinator.rs` is out of this step's scope) — same
    /// polling shape, different module boundary.
    fn wait_for_coord_stage(
        coord: &TranscriptionCoordinator,
        expected: Stage,
        label: &str,
    ) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            let s = coord.current_stage();
            if s == expected {
                return;
            }
            if std::time::Instant::now() > deadline {
                panic!("timeout waiting for {expected:?} at '{label}', got {s:?}");
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }

    #[test]
    fn test_cancel_ordering_assumption_matches_coordinator_semantics() {
        // `stop_recording` deliberately does NOT flip the coordinator's
        // stage to `Processing` before calling `recorder.stop()` (plan §3
        // Layer 1): `Command::Cancel` is a no-op once the stage has already
        // moved to `Processing` (proven directly against the real
        // `TranscriptionCoordinator` — same invariant
        // `coordinator::tests::test_cancel_during_processing_ignored`
        // pins from that module's side). This test exercises the SAME
        // state machine from `recording.rs`'s side and ties it to
        // `stop_decision`'s output, so a future change to either side
        // can't silently desynchronize them.
        let coord = TranscriptionCoordinator::new();

        coord.on_press();
        wait_for_coord_stage(&coord, Stage::Recording, "after press");
        assert_eq!(
            stop_decision(coord.current_stage(), true, StopReason::Cancel),
            StopDecision::Discard,
            "stage is Recording: stop_recording's Discard branch will run \
             coordinator.cancel() while it can still apply"
        );
        coord.cancel();
        wait_for_coord_stage(&coord, Stage::Idle, "after cancel from Recording");

        // Now the forbidden order: flip to Processing FIRST, then try to
        // cancel. `stop_decision` already says Skip once stage isn't
        // Recording, so `stop_recording` would never even reach
        // `coordinator.cancel()` here — but this test additionally proves
        // that IF it did, the coordinator would ignore it anyway, matching
        // the plan's stated reason for not flipping stage first.
        //
        // Clear the coordinator's 30ms press-debounce window first (same
        // pattern as `coordinator::tests::test_debounce_rapid_presses`) —
        // otherwise this second `on_press()` lands too soon after the
        // first and is silently dropped, leaving the coordinator in Idle
        // instead of Recording.
        std::thread::sleep(DEBOUNCE + std::time::Duration::from_millis(10));
        coord.on_press();
        wait_for_coord_stage(&coord, Stage::Recording, "after 2nd press");
        coord.on_release();
        wait_for_coord_stage(&coord, Stage::Processing, "after release");
        assert_eq!(
            stop_decision(coord.current_stage(), true, StopReason::Cancel),
            StopDecision::Skip,
            "stage is already Processing: stop_recording must Skip, never call \
             coordinator.cancel() here"
        );
        coord.cancel();
        std::thread::sleep(std::time::Duration::from_millis(20));
        assert_eq!(
            coord.current_stage(),
            Stage::Processing,
            "cancel during Processing must be ignored (coordinator invariant \
             stop_recording's ordering relies on)"
        );

        // Clean up: let the pipeline finish so the coordinator thread
        // isn't left mid-cycle (harmless either way, but tidy).
        coord.notify_processing_finished();
        wait_for_coord_stage(&coord, Stage::Idle, "after finish");
    }
}
