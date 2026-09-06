use super::coordinator::{Stage, TranscriptionCoordinator};
use super::press_release::{
    ContinueOrAbort, PostStageAction, PressEnterAction, PressExitGuard, PressReleaseMachine,
    ReleaseAction,
};
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

/// Poisoning-recovery lock for `RecordingCoordinator::press_release`. Same
/// one-liner as `crate::audio::sync::lock_or_recover` and
/// `press_release::lock_or_recover` — that module is private to `audio`
/// and widening its visibility is outside this step's file scope.
fn lock_press_release(
    machine: &std::sync::Mutex<PressReleaseMachine>,
) -> std::sync::MutexGuard<'_, PressReleaseMachine> {
    match machine.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
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

/// Why `stop_recording` is being called. `SilenceTimeout` and
/// `MaxDuration` are constructed by Layer 2's not-yet-landed recording
/// guard — defined now, alongside the reasons already constructed
/// (`Release`, `TogglePress`, `Cancel`, and `ReleasePending` as of this
/// step), so `stop_recording`'s API is stable across that step and its
/// caller doesn't need to touch this enum again. Remove the `allow` once
/// that step constructs them too.
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
    /// Single source of truth for press/release ordering (plan §3 Layer
    /// 0(a)) — see `press_release` module docs for the full design and
    /// disclosed deviations from the plan's literal two-primitive sketch.
    /// Replaces the old `pending_press: Arc<Mutex<Option<(u64,
    /// CancellationToken)>>>` debounce-phase-only cancellation slot
    /// entirely — that mechanism covered only the hold-timer sleep,
    /// leaving a seam with the post-debounce window that is exactly where
    /// the historical bug (plan §1.1) lived.
    press_release: Arc<std::sync::Mutex<PressReleaseMachine>>,
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
            press_release: Arc::new(std::sync::Mutex::new(PressReleaseMachine::new())),
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

        // ---- Layer 0(a): single-flight admission, as early as possible
        // ---- (T4a r1 review finding 2: admitting right after the
        // ---- breadcrumb — before the stage read, config load, and
        // ---- press_action match below — leaves no synchronous work of
        // ---- our own before admission. The remaining pre-admission
        // ---- window is purely the scheduler gap between this task being
        // ---- spawned and its first poll; see press_release module docs,
        // ---- deviation 4).
        let (press_id, wake_token) =
            match lock_press_release(&self.press_release).press_enter() {
                PressEnterAction::Proceed(id, token) => (id, token),
                PressEnterAction::IgnorePress => {
                    crate::diagnostics::breadcrumbs::sites::press_ignored_in_flight();
                    tracing::debug!(
                        "on_hotkey_pressed: another press is already in flight, ignoring \
                         (plan §1.4 single-flight start)"
                    );
                    return;
                }
            };
        // Safety net (plan §3 Layer 0(a) step 6): guarantees `press_id` is
        // cleared from the machine on every exit path below, even one a
        // future edit adds without remembering to call a checkpoint.
        let mut press_exit = PressExitGuard::new(Arc::clone(&self.press_release), press_id);

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
                // Admission above is unconditional now (T4a r1 review
                // finding 2), so this branch briefly held `in_flight` —
                // release it before falling through to the shared stop
                // path, NOT `on_hotkey_released()` (which returns
                // immediately in toggle mode, see its own toggle guard,
                // and would never reach `recorder.stop()` — plan §1.4:
                // toggle-mode recordings could never be stopped).
                press_exit.early_return();
                self.stop_recording(StopReason::TogglePress).await;
                return;
            }
            PressAction::Ignore => {
                tracing::debug!("Ignoring hotkey press - stage: {:?}", stage);
                press_exit.early_return();
                return;
            }
            PressAction::Start => {}
        }

        // ---- Debounce: short presses are key-combination modifiers ----
        // Read the user-configured hold threshold (default 300 ms) and
        // race it against `wake_token`: a release arriving while this
        // press is in flight cancels the token
        // (`PressReleaseMachine::release_arrived`), waking this sleep
        // within µs instead of occupying `in_flight` for the rest of
        // `hold_ms` (T4a r1 review finding 1 — an earlier revision used a
        // plain, uncancellable sleep here, which silently dropped a
        // legitimate follow-on press admitted in that window;
        // `hotkey/mod.rs`'s press/release alternation filter guarantees
        // such a follow-on press always means this one's key was already
        // released, never a real single-flight conflict). Either branch
        // of the `select!` falls through to the SAME, unchanged
        // `post_debounce` checkpoint below — the token is only a
        // wake-up, never a second decision point.
        //
        // skip_debounce: when true (e.g. pointer/touch overlay tap),
        // the debounce is skipped entirely — a tap on the cell is
        // explicit intent and must start recording immediately.
        if !skip_debounce {
            let config_for_hold = load_config_from_app(&self.app);
            let hold_ms = config_for_hold.hotkey_hold_ms as u64;
            if hold_ms > 0 {
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_millis(hold_ms)) => {}
                    _ = wake_token.cancelled() => {}
                }
            }
        } // end skip_debounce guard

        // Checkpoint (i): did a release already arrive (plan §3 Layer 0(a))?
        if matches!(press_exit.post_debounce(), ContinueOrAbort::NeverStart) {
            tracing::info!(
                "on_hotkey_pressed: released before/during debounce (id={press_id}) - \
                 treated as key combo or already released, never starting"
            );
            return;
        }

        tracing::info!("on_hotkey_pressed: checking mic permission");
        // `blocks_start()`, not `is_granted()` (T4b landed after this step
        // was drafted, in the parallel batch): only an explicit `Denied`
        // should refuse to start. `Unknown` must fall through to
        // `recorder.start()` — cpal has its own accurate, synchronous
        // failure path for a genuine denial, and refusing on `Unknown`
        // reintroduces exactly the gap T4b's `blocks_start()` exists to
        // close (permissions/checker.rs doc comment, T2-round review
        // finding M8).
        if create_permission_checker()
            .check(Permission::Microphone)
            .blocks_start()
        {
            self.emit_error(
                "Microphone permission required. Please grant access in System Settings.",
            );
            press_exit.early_return();
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
        // .. await_stage(Recording) .. overlay/poller spawn — T3 r2 review
        // finding N3 extends this to cover the overlay section too, see
        // below) so this can never race a concurrent `stop_recording` —
        // plan §3 Layer 1. `AudioRecorder::start()` (T2) already refuses on
        // its own while a stop is mid-flight; this lock closes the last
        // few-instructions TOCTOU window a lone atomic flag can't (T2
        // review, scrutiny b), by ensuring no `stop_recording` call is
        // *itself* in flight while we're here at all.
        let _start_guard = self.stop_lock.lock().await;

        // Checkpoint (ii): plan §3 Layer 0(a) — the checkpoint that closes
        // the actual observed bug: a release arriving during the (possibly
        // multi-second) permission check just above.
        if matches!(press_exit.pre_start(), ContinueOrAbort::NeverStart) {
            tracing::info!(
                "on_hotkey_pressed: release arrived during permission check (id={press_id}) - \
                 never starting the recorder"
            );
            crate::diagnostics::breadcrumbs::sites::release_pending_applied();
            drop(_start_guard);
            return;
        }

        if let Err(e) = self.recorder.start(&device) {
            if matches!(e, AudioError::StopInProgress) {
                // A stop is (or just was) in flight. Not a user-facing
                // error — the hotkey press simply lost a race; the user
                // can press again once the in-flight stop completes.
                tracing::debug!(
                    "on_hotkey_pressed: recorder.start refused, a stop is in flight: {e}"
                );
                press_exit.early_return();
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
            // sleep for no reason (T3 r1 review, finding 2). Stage can
            // never be Recording here (coordinator.on_press() hasn't been
            // called yet), so unlike stop_recording's UserError arm
            // (T3 r2 review N1) there is no coordinator.cancel() to run
            // before dropping the guard — it would always be a no-op.
            drop(_start_guard);
            press_exit.early_return();
            self.handle_error(&e.to_string(), ErrorContext::Hotkey, false)
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
        let reached_recording = self.await_stage(Stage::Recording).await;
        tracing::info!(
            "on_hotkey_pressed: stage now {:?}",
            self.coordinator.current_stage()
        );
        tracing::info!("on_hotkey_pressed: mirror_state");
        self.mirror_state().await;

        if !reached_recording {
            // C1 orphan (plan §1.4 / T3 r1 review carry-forward C1): the
            // coordinator's own internal 30ms press-debounce
            // (`coordinator::DEBOUNCE`) dropped our Press after
            // `recorder.start()` already returned Ok — is_recording()==true
            // but stage never became Recording. `stop_decision` would say
            // Skip here (stage != Recording), so stop_recording is a
            // no-op; stop the orphaned recorder directly, under the
            // stop_lock we're already holding.
            tracing::warn!(
                "on_hotkey_pressed: stage did not reach Recording after recorder.start() Ok \
                 (id={press_id}) - coordinator's internal press-debounce likely dropped the \
                 Press; stopping the orphaned recorder directly"
            );
            press_exit.stage_timeout();
            let recorder = Arc::clone(&self.recorder);
            let _ = tokio::task::spawn_blocking(move || recorder.stop()).await;
            crate::diagnostics::breadcrumbs::sites::press_start_orphan_recovered();
            drop(_start_guard);
            return;
        }

        // Checkpoint (iii): plan §3 Layer 0(a) residual window — a release
        // that arrived between recorder.start() returning Ok and the
        // stage actually becoming Recording.
        if matches!(press_exit.post_stage_recording(), PostStageAction::StopReleasePending) {
            tracing::info!(
                "on_hotkey_pressed: release arrived just before stage became Recording \
                 (id={press_id}) - stopping immediately"
            );
            crate::diagnostics::breadcrumbs::sites::release_pending_applied();
            // stop_recording takes stop_lock itself — must drop this
            // guard first to avoid deadlocking on our own lock.
            drop(_start_guard);
            self.stop_recording(StopReason::ReleasePending).await;
            return;
        }

        // T3 r2 review finding N3: overlay.show() + poller spawn run
        // INSIDE the stop_lock-held critical section (guard dropped only
        // at the very end of this function) — previously the guard was
        // dropped here, and a release that acquired stop_lock in that gap
        // would finalize the recording, after which this code would still
        // show "Recording" and spawn a poller for a now-dead recorder.
        // Safe: the poller task never takes stop_lock, and stop_recording
        // only takes polling_cancel/overlay while it already holds
        // stop_lock, so holding it here too cannot invert any lock order
        // (verified in T3 r1 review scrutiny (a)/(b)).
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
        drop(_start_guard);
    }

    pub async fn on_hotkey_released(&self) {
        crate::diagnostics::breadcrumbs::sites::hotkey_released();
        // Toggle mode (#3): a release does nothing on its own — the
        // user has to press again to stop. Releases never touch
        // `press_release` in toggle mode either — that machine only
        // matters for hold-mode's press/release ordering.
        let mode_config = load_config_from_app(&self.app);
        if mode_config.hotkey_mode == "toggle" {
            tracing::debug!("on_hotkey_released: toggle mode — ignoring release");
            return;
        }

        // Plan §3 Layer 0(a): tell the ordering machine a release happened.
        // If a press is currently in flight, it owns responding to this
        // (via its own next checkpoint) — return without touching
        // `stop_recording` at all, there's nothing stage-visible to stop
        // yet. Otherwise this is either a genuinely spurious release or
        // the normal release of an already-fully-started recording;
        // proceed exactly as if this machine didn't exist.
        let action = lock_press_release(&self.press_release).release_arrived();
        match action {
            ReleaseAction::ArmReleasePending => {
                crate::diagnostics::breadcrumbs::sites::release_pending_armed();
                tracing::debug!(
                    "on_hotkey_released: a press is in flight — armed release_pending, \
                     it will self-abort at its next checkpoint"
                );
                return;
            }
            ReleaseAction::ProceedRelease => {}
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
            // recorder.stop() (there is nothing to stop). The user spoke
            // and nothing will be transcribed, so this is NOT silent (T3 r2
            // review scrutiny (b)): an Error beep + `emit_error` tell them
            // now, same as a real failure would. It deliberately skips
            // handle_error's state_cache=Error banner and 2s sleep — the
            // next press must start a fresh recording immediately, not sit
            // behind a cooldown for a failure the user didn't cause.
            tracing::warn!(
                "stop_recording({:?}): coordinator says Recording but recorder is not \
                 recording — recovering to Idle. Abnormal: recording thread died after \
                 start() (stream build/play failure, panic, device unplugged), or a \
                 bypassing raw stop_recording command stopped the recorder.",
                reason
            );
            crate::diagnostics::breadcrumbs::sites::recording_stop_recover();
            let recover_config = load_config_from_app(&self.app);
            let _ = crate::audio_feedback::play(
                crate::audio_feedback::SoundType::Error,
                recover_config.audio_feedback,
                &crate::audio_feedback::RodioPlayer,
            );
            self.emit_error("Recording was interrupted (audio device stopped)");
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
                        // T3 r2 review findings N1/N2: do the
                        // coordinator-cancel and overlay-hide that used to
                        // happen inside/after handle_error's 2s sleep WHILE
                        // STILL HOLDING stop_lock. Stage is guaranteed
                        // Recording here (stop_decision only reaches
                        // Finalize/Discard, and thus this arm, when
                        // stage==Recording), so coordinator.cancel() is
                        // guaranteed to apply. Without this, a press racing
                        // the 2s sleep could start recording #2 only to have
                        // *its* stage cancelled by this stale error's
                        // handle_error call, and *its* live overlay hidden
                        // by this call — both reached via the guard being
                        // dropped before those side effects used to run.
                        self.coordinator.cancel();
                        self.await_stage(Stage::Idle).await;
                        self.overlay.lock().await.hide();
                        // recorder.stop() has already returned — nothing
                        // left to serialize against, and handle_error
                        // sleeps 2s; drop the lock first so a concurrent
                        // press/stop isn't queued behind that sleep for no
                        // reason (T3 r1 review, finding 2).
                        drop(_guard);
                        self.handle_error(&e.to_string(), ErrorContext::Hotkey, false)
                            .await;
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

    /// `cancel_coordinator`: whether this call should itself run
    /// `coordinator.cancel()`. Callers that have *already* cancelled (and
    /// awaited the resulting stage transition) while still holding
    /// `stop_lock` pass `false` (T3 r2 review findings N1/N2) so this
    /// doesn't cancel a second time — harmless in isolation
    /// (`coordinator.cancel()` is a no-op outside `Recording`), but doing
    /// it here, after the lock is dropped and after a 2s sleep, is
    /// precisely the window a concurrent press's *new* recording could be
    /// wrongly cancelled in. Callers where stage can never be `Recording`
    /// at all (e.g. `on_hotkey_pressed`'s start-error branch —
    /// `coordinator.on_press()` hasn't been called yet) also pass `false`:
    /// cancelling would always be a no-op there, so it's simply not done
    /// rather than done pointlessly.
    async fn handle_error(&self, error: &str, context: ErrorContext, cancel_coordinator: bool) {
        tracing::error!("{:?} error: {}", context, error);
        self.emit_error(error);

        // Set the cache to Error directly; Coordinator stays in its current
        // stage (Cancel will return it to Idle).
        {
            let mut cache = self.state_cache.lock().await;
            *cache = RecordingState::Error;
        }
        self.emit_state(RecordingState::Error);

        if cancel_coordinator {
            // Cancel coordinator so it returns to Idle from Recording.
            self.coordinator.cancel();
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Recover: sync cache to whatever stage we ended up in.
        self.mirror_state().await;
    }

    /// Wait briefly for the Coordinator worker to apply a transition.
    /// Uses a deterministic poll loop with a tight bound (max 100ms).
    /// Returns whether `expected` was actually reached in time — callers
    /// that need to distinguish a genuine transition from a timeout (e.g.
    /// the C1 orphan-recorder check in `on_hotkey_pressed`) inspect the
    /// return value; callers that don't care simply discard it, exactly as
    /// they did when this returned `()`.
    async fn await_stage(&self, expected: Stage) -> bool {
        for _ in 0..50 {
            if self.coordinator.current_stage() == expected {
                return true;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(2)).await;
        }
        tracing::warn!(
            "Coordinator stage did not reach {:?} (currently {:?})",
            expected,
            self.coordinator.current_stage()
        );
        false
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
