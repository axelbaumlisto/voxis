//! The eleven Tauri commands the plugin registers (`build.rs`'s
//! `COMMANDS`, `lib.rs`'s `generate_handler!`). Each is a thin
//! `#[tauri::command]` wrapper around a `do_*` function that takes
//! `&PluginState` directly \u2014 the `do_*` functions are what
//! `#[cfg(test)]` below exercises, with no Tauri runtime involved
//! (`tauri::State` only shows up in the wrapper, never in the logic).
//!
//! Task 3b: `start`/`stop`/`cancel` are `async fn` (`[ADO-2/3 minors]`,
//! "for 3b": async commands for the network path) \u2014 `stop`/`cancel`
//! await the session's pipeline task (`pipeline.rs`) rather than
//! returning a stub immediately, and neither function holds any lock
//! across an `.await` (`SessionGuard`'s internal `std::sync::Mutex` is
//! only ever locked for the duration of a single, non-blocking method
//! call \u2014 `begin`/`signal`/`end`/etc. \u2014 never held across a `.await`
//! point in this file). `get_profile`/`apply_profile`/
//! `import_profile_from_desktop`/`import_profile_from_qr` (Task 6/7)
//! delegate to `profile_source.rs`: the first three are synchronous
//! (local storage only); `import_profile_from_qr` is `async` (it makes
//! an HTTP call to the desktop's LAN profile-share server, Task 7).

use tauri::State as TauriState;

use crate::capture::RecFile;
use crate::error::PluginError;
use crate::models::{DictationResult, HotkeySpec, ImportSummary, KeySourceDto, Mode, SessionId};
use crate::pipeline;
use crate::profile_source;
use crate::session::StopRequest;
use crate::PluginState;

pub(crate) async fn do_start(state: &PluginState, mode: Mode) -> Result<SessionId, PluginError> {
    if !state.consent.is_consented(&state.host_id, &state.provider_host)? {
        return Err(PluginError::ConsentRequired { provider_host: state.provider_host.clone() });
    }

    let id = state.sessions.begin(mode)?;

    let path = state.rec_dir.new_session_path();
    let file = match RecFile::create(path.clone()) {
        Ok(f) => f,
        Err(e) => {
            let _ = state.sessions.end(&id);
            return Err(PluginError::Capture { message: format!("creating rec file: {e}") });
        }
    };

    let deps = state.pipeline_deps();
    let cap_samples =
        voxis_core::guard::native_cap_samples(deps.app_config.max_recording_ms, voxis_core::audio_wav::TRANSCRIPTION_SAMPLE_RATE);

    // `[ADO-8]`: on mobile this dispatches to `run_mobile_plugin` (an IPC
    // round-trip to the Swift/Kotlin side); on desktop `CpalCapture::start`
    // itself returns quickly, but no `AudioCapture::start` implementation
    // is contractually guaranteed non-blocking. Never run it inline on
    // the async command's own tokio worker thread -- `spawn_blocking`
    // moves it to the blocking-pool, keeping the runtime free to make
    // progress on unrelated tasks (other commands, other sessions' guard
    // polling) for however long it takes.
    let capture = state.capture.clone();
    let start_path = path.clone();
    let start_result = tokio::task::spawn_blocking(move || capture.start(&start_path, cap_samples))
        .await
        .unwrap_or_else(|join_err| Err(crate::capture::CaptureError::Backend(format!("capture.start() task panicked: {join_err}"))));

    if let Err(capture_err) = start_result {
        // Roll back the reservation so a capture-backend failure doesn't
        // permanently wedge the single-flight guard; dropping `file`
        // deletes the just-created rec file.
        drop(file);
        let _ = state.sessions.end(&id);
        return Err(capture_err.into());
    }

    let handles = pipeline::spawn(id.clone(), mode, file, deps, state.sessions.clone());
    state.sessions.attach_handles(&id, handles);

    Ok(id)
}

pub(crate) async fn do_stop(state: &PluginState, id: &SessionId) -> Result<DictationResult, PluginError> {
    let mut outcome_rx = match state.sessions.request_stop(id) {
        None => return Err(PluginError::UnknownSession { session_id: id.to_string() }),
        Some(StopRequest::Now(rx)) => rx,
        // The `Stop` landed in `do_start`'s `spawn_blocking(capture.start)`
        // window (review finding F-NEW): `attach_handles` applies it and
        // resolves this receiver under the same lock, before the pipeline
        // can finalise -- no polling, no `UnknownSession` for a stop that
        // was honoured. The oneshot is dropped unresolved only when the
        // session is rolled back before handles ever attach (capture
        // failure), which IS an unknown session by then.
        Some(StopRequest::Pending(rx)) => match rx.await {
            Ok(rx) => rx,
            Err(_) => return Err(PluginError::UnknownSession { session_id: id.to_string() }),
        },
    };
    await_outcome(&mut outcome_rx).await
}

/// Cancels `id`: marks it cancelled and performs the stage-appropriate
/// immediate action (`session::SessionGuard::request_cancel` -- signal
/// the Recording-phase loop, or abort the in-flight HTTP future directly
/// if already `Transcribing`), all under one lock acquisition shared
/// with `cancel_all_hold` so the two can't drift and there is no window
/// for the stage to change between "check" and "act" (review findings
/// F1/F2). Returns once the pipeline has fully finished (file deleted,
/// slot freed) -- not just once the abort/signal was issued -- so
/// callers can rely on the cleanup being visible immediately after this
/// resolves.
///
/// **Documented exception** (hardening-sweep review finding F1): if
/// `id`'s session is still inside `do_start`'s `spawn_blocking(capture.
/// start)` window (`session::ActiveSession::handles` is `None`),
/// `request_cancel` records the request (`cancel_requested`) and
/// returns `true`, but `outcome_receiver(id)` has nothing to hand back
/// yet -- there is no pipeline task, no `outcome_tx`, nothing to await.
/// This function returns `Ok(())` immediately in that case rather than
/// spin-waiting for handles to attach: the cancellation itself is not
/// lost (`attach_handles` applies `cancel_requested` the moment the
/// pipeline task exists, see that function's doc), only this call's
/// "cleanup already visible" guarantee is relaxed for this one narrow,
/// short-lived window -- a caller that needs to observe the freed slot
/// can simply poll `state()`/`is_active` if it matters for that caller.
pub(crate) async fn do_cancel(state: &PluginState, id: &SessionId) -> Result<(), PluginError> {
    if !state.sessions.request_cancel(id) {
        return Err(PluginError::UnknownSession { session_id: id.to_string() });
    }
    if let Some(mut outcome_rx) = state.sessions.outcome_receiver(id) {
        let _ = await_outcome(&mut outcome_rx).await;
    }
    Ok(())
}

async fn await_outcome(
    rx: &mut tokio::sync::watch::Receiver<Option<Result<DictationResult, PluginError>>>,
) -> Result<DictationResult, PluginError> {
    loop {
        if let Some(outcome) = rx.borrow().clone() {
            return outcome;
        }
        // If the sender was ever dropped without publishing (should not
        // happen \u2014 `pipeline::finalize` always sends before returning),
        // fail closed rather than hanging forever.
        if rx.changed().await.is_err() {
            return Err(PluginError::Capture { message: "pipeline task ended without publishing an outcome".to_string() });
        }
    }
}

pub(crate) fn do_state(state: &PluginState) -> crate::models::State {
    state.sessions.state()
}

pub(crate) fn do_set_consent(state: &PluginState, consented: bool) -> Result<(), PluginError> {
    state.consent.set_consent(&state.host_id, &state.provider_host, consented)?;
    Ok(())
}

pub(crate) fn do_hold_lease(state: &PluginState, id: &SessionId) -> Result<(), PluginError> {
    if !state.sessions.is_active(id) {
        return Err(PluginError::UnknownSession { session_id: id.to_string() });
    }
    // Toggle-mode sessions have no lease tracker (lease.rs: "Toggle mode
    // has no lease") \u2014 a heartbeat for one is accepted and simply has
    // nothing to update.
    if let Some(tracker) = state.sessions.lease_tracker(id) {
        tracker.lock().unwrap().heartbeat(tokio::time::Instant::now());
    }
    Ok(())
}

#[tauri::command]
pub async fn start(state: TauriState<'_, PluginState>, mode: Mode) -> Result<SessionId, PluginError> {
    do_start(&state, mode).await
}

#[tauri::command]
pub async fn stop(state: TauriState<'_, PluginState>, id: SessionId) -> Result<DictationResult, PluginError> {
    do_stop(&state, &id).await
}

#[tauri::command]
pub async fn cancel(state: TauriState<'_, PluginState>, id: SessionId) -> Result<(), PluginError> {
    do_cancel(&state, &id).await
}

#[tauri::command]
pub fn state(state: TauriState<'_, PluginState>) -> crate::models::State {
    do_state(&state)
}

#[tauri::command]
pub fn get_profile(state: TauriState<'_, PluginState>) -> Result<serde_json::Value, PluginError> {
    let profile = profile_source::current_profile(&state)?;
    serde_json::to_value(&profile)
        .map_err(|e| PluginError::Profile { message: format!("serializing profile: {e}") })
}

#[tauri::command]
pub fn apply_profile(
    state: TauriState<'_, PluginState>,
    bytes: Vec<u8>,
    key_source: KeySourceDto,
) -> Result<ImportSummary, PluginError> {
    profile_source::apply_profile_bytes(&state, &bytes, key_source)
}

#[tauri::command]
pub fn import_profile_from_desktop(
    state: TauriState<'_, PluginState>,
) -> Result<ImportSummary, PluginError> {
    profile_source::import_from_desktop(&state)
}

#[tauri::command]
pub async fn import_profile_from_qr(
    state: TauriState<'_, PluginState>,
    payload: String,
    code: String,
) -> Result<ImportSummary, PluginError> {
    profile_source::import_from_qr(&state, &payload, code).await
}

pub(crate) fn do_set_hotkey(state: &PluginState, spec: &HotkeySpec) -> Result<(), PluginError> {
    // `state.hotkey` is `None` on platforms/builds with no OS-level
    // hotkey backend (iOS, or a desktop build without the `desktop`
    // feature) -- same no-op the pre-Task-4 stub was, now delegating to
    // `hotkey_desktop::RdevHotkey` (Task 4) when present.
    match &state.hotkey {
        Some(hotkey) => hotkey.set_hotkey(spec),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn set_hotkey(state: TauriState<'_, PluginState>, spec: HotkeySpec) -> Result<(), PluginError> {
    do_set_hotkey(&state, &spec)
}

#[tauri::command]
pub fn set_consent(state: TauriState<'_, PluginState>, consented: bool) -> Result<(), PluginError> {
    do_set_consent(&state, consented)
}

#[tauri::command]
pub fn hold_lease(state: TauriState<'_, PluginState>, id: SessionId) -> Result<(), PluginError> {
    do_hold_lease(&state, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::{AudioCapture, MockCapture};
    use crate::consent::ConsentStore;
    use crate::events::RecordingSink;
    use crate::models::GuardOutcome;
    use crate::secrets::{InMemorySecretStore, SecretStore};
    use crate::PipelineConfig;
    use std::sync::Arc;
    use voxis_core::profile::Secret;

    fn test_state(tmp: &tempfile::TempDir) -> PluginState {
        let (state, _mock) = test_state_with_mock(tmp);
        state
    }

    fn test_state_with_mock(tmp: &tempfile::TempDir) -> (PluginState, Arc<MockCapture>) {
        let mock = Arc::new(MockCapture::new());
        let capture: Arc<dyn crate::capture::AudioCapture> = mock.clone();
        let secrets = Arc::new(InMemorySecretStore::new());
        secrets.set(pipeline::API_KEY_SECRET_NAME, &Secret::new("test-key")).unwrap();
        // Deterministic in these tests unless a test overrides it: no
        // silence-timeout auto-stop mid-test. `min_recording_ms` is left
        // at its (nonzero) default — these tests never tick any capture
        // samples, so `duration_ms` stays 0 and every `stop()` takes the
        // too-short/Discard branch instead of ever attempting a real HTTP
        // call to the (unreachable-in-tests) default Groq endpoint.
        let app_config =
            voxis_core::config::AppConfig { silence_timeout_ms: 0, ..voxis_core::config::AppConfig::default() };
        let state = PluginState {
            sessions: Arc::new(crate::session::SessionGuard::new()),
            consent: ConsentStore::new(tmp.path().join("consent.json")),
            secrets,
            rec_dir: crate::capture::RecDir::new(tmp.path().to_path_buf()),
            capture,
            events: Arc::new(RecordingSink::new()),
            pipeline_config: std::sync::Mutex::new(PipelineConfig { app_config, dictionary: Vec::new() }),
            hotkey: None,
            host_id: "test-host".to_string(),
            provider_host: "api.groq.com".to_string(),
            profile_dir: tmp.path().join("voxis-plugin"),
        };
        (state, mock)
    }

    #[tokio::test]
    async fn start_is_refused_without_consent() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = do_start(&state, Mode::Hold).await;

        assert!(matches!(result, Err(PluginError::ConsentRequired { .. })));
        assert!(!state.sessions.has_active(), "a refused start must not claim the session slot");
    }

    /// `[ADO-8]` regression: `do_start` must run `AudioCapture::start`
    /// off the tokio worker thread (`spawn_blocking`), not inline on the
    /// async task's own thread -- a synchronous, possibly-slow backend
    /// call (mobile's `run_mobile_plugin` IPC round-trip, or any future
    /// backend that blocks opening a device) must not stall the whole
    /// single-worker runtime for its duration. Deterministic (no sleeps/
    /// timing): records the thread id `AudioCapture::start` actually runs
    /// on and compares it against the runtime's one async worker thread.
    #[tokio::test(flavor = "multi_thread", worker_threads = 1)]
    async fn do_start_runs_capture_start_off_the_async_worker_thread() {
        struct ThreadRecordingCapture {
            inner: Arc<MockCapture>,
            thread_id: std::sync::Mutex<Option<std::thread::ThreadId>>,
        }
        impl AudioCapture for ThreadRecordingCapture {
            fn start(&self, path: &std::path::Path, cap_samples: usize) -> Result<(), crate::capture::CaptureError> {
                *self.thread_id.lock().unwrap() = Some(std::thread::current().id());
                self.inner.start(path, cap_samples)
            }
            fn stop(&self) -> Result<crate::capture::CaptureStats, crate::capture::CaptureError> {
                self.inner.stop()
            }
            fn level_rx(&self) -> tokio::sync::watch::Receiver<Option<crate::capture::LevelSample>> {
                self.inner.level_rx()
            }
        }

        let async_worker_thread_id = tokio::spawn(async { std::thread::current().id() }).await.unwrap();

        let tmp = tempfile::tempdir().unwrap();
        let (mut state, _mock) = test_state_with_mock(&tmp);
        let recorder = Arc::new(ThreadRecordingCapture { inner: Arc::new(MockCapture::new()), thread_id: std::sync::Mutex::new(None) });
        state.capture = recorder.clone();
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();

        do_start(&state, Mode::Hold).await.unwrap();

        let capture_thread_id = recorder.thread_id.lock().unwrap().unwrap();
        assert_ne!(
            capture_thread_id, async_worker_thread_id,
            "AudioCapture::start() must run on a spawn_blocking thread, not the single async worker thread"
        );
    }

    #[tokio::test]
    async fn start_succeeds_after_consent_and_creates_a_rec_file() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();

        let id = do_start(&state, Mode::Hold).await.unwrap();

        assert!(state.sessions.is_active(&id));
        let mut entries = std::fs::read_dir(state.rec_dir.path()).unwrap();
        assert!(entries.next().is_some(), "start() must create a rec file for the session");
    }

    #[tokio::test]
    async fn start_rolls_back_session_slot_when_capture_backend_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock) = test_state_with_mock(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();

        // Make the capture backend itself fail on the very `start()` call
        // `do_start` is about to make, without ever going through the
        // session guard \u2014 `MockCapture`'s own "already running" check is
        // enough to exercise `do_start`'s `capture_err` rollback branch.
        mock.start(&tmp.path().join("out-of-band.wav"), 1).unwrap();

        let result = do_start(&state, Mode::Hold).await;

        assert!(matches!(result, Err(PluginError::Capture { .. })));
        assert!(!state.sessions.has_active(), "a capture-backend start failure must roll back the session slot");
        assert_eq!(
            std::fs::read_dir(state.rec_dir.path()).unwrap().count(),
            0,
            "the RecFile created before the capture-backend failure must be deleted, not orphaned"
        );
    }

    #[tokio::test]
    async fn second_start_while_active_is_already_recording() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        do_start(&state, Mode::Hold).await.unwrap();

        let second = do_start(&state, Mode::Toggle).await;

        assert!(matches!(second, Err(PluginError::AlreadyRecording)));
    }

    #[tokio::test]
    async fn stop_returns_finalized_result_and_deletes_the_file_for_a_too_short_recording() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        let id = do_start(&state, Mode::Hold).await.unwrap();
        let rec_path_count_before = std::fs::read_dir(state.rec_dir.path()).unwrap().count();
        assert_eq!(rec_path_count_before, 1);

        let result = do_stop(&state, &id).await.unwrap();

        assert_eq!(result.text, "");
        assert_eq!(result.guard_outcome, GuardOutcome::Finalized);
        assert!(!state.sessions.has_active());
        assert_eq!(std::fs::read_dir(state.rec_dir.path()).unwrap().count(), 0, "stop() must delete the rec file");
    }

    #[tokio::test]
    async fn stop_with_unknown_session_id_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = do_stop(&state, &SessionId::new()).await;

        assert!(matches!(result, Err(PluginError::UnknownSession { .. })));
    }

    #[tokio::test]
    async fn cancel_frees_the_slot_and_deletes_the_file_even_if_capture_stop_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock) = test_state_with_mock(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        let id = do_start(&state, Mode::Hold).await.unwrap();

        // Force capture.stop() to fail \u2014 cancel must still free the slot
        // and delete the file (best-effort capture stop).
        mock.set_ignore_stop(true);

        do_cancel(&state, &id).await.unwrap();

        assert!(!state.sessions.has_active());
        assert_eq!(std::fs::read_dir(state.rec_dir.path()).unwrap().count(), 0);
    }

    /// A capture backend whose `start()` blocks on a real channel until
    /// released — the F1 regression double: pins down the exact window
    /// `commands::do_start` opens between `sessions.begin(mode)` and
    /// `sessions.attach_handles`, same channel-handshake pattern as
    /// `pipeline.rs`'s round-2-review `BlockingStopCapture`/
    /// `BlockingSecretStore` (a real OS thread blocks inside a
    /// synchronous trait method; the "ready"/"release" handshake is a
    /// non-blocking `tokio::sync::oneshot::Sender::send` paired with a
    /// blocking `std::sync::mpsc::Receiver::recv()` — requires the
    /// multi-thread test runtime).
    struct BlockingStartCapture {
        inner: Arc<MockCapture>,
        ready_tx: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
        release_rx: std::sync::Mutex<Option<std::sync::mpsc::Receiver<()>>>,
    }

    impl AudioCapture for BlockingStartCapture {
        fn start(&self, path: &std::path::Path, cap_samples: usize) -> Result<(), crate::capture::CaptureError> {
            if let Some(tx) = self.ready_tx.lock().unwrap().take() {
                let _ = tx.send(());
            }
            if let Some(rx) = self.release_rx.lock().unwrap().take() {
                let _ = rx.recv();
            }
            self.inner.start(path, cap_samples)
        }
        fn stop(&self) -> Result<crate::capture::CaptureStats, crate::capture::CaptureError> {
            self.inner.stop()
        }
        fn level_rx(&self) -> tokio::sync::watch::Receiver<Option<crate::capture::LevelSample>> {
            self.inner.level_rx()
        }
    }

    fn blocking_start_state(
        tmp: &tempfile::TempDir,
    ) -> (Arc<PluginState>, Arc<MockCapture>, tokio::sync::oneshot::Receiver<()>, std::sync::mpsc::Sender<()>) {
        let mock = Arc::new(MockCapture::new());
        let (mut state, _) = test_state_with_mock(tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let capture: Arc<dyn AudioCapture> = Arc::new(BlockingStartCapture {
            inner: mock.clone(),
            ready_tx: std::sync::Mutex::new(Some(ready_tx)),
            release_rx: std::sync::Mutex::new(Some(release_rx)),
        });
        state.capture = capture;
        (Arc::new(state), mock, ready_rx, release_tx)
    }

    /// F1 (a): `cancel()` arrives while `do_start` is parked inside
    /// `spawn_blocking(capture.start)` — i.e. `sessions.begin(mode)` has
    /// already claimed the slot but `attach_handles` hasn't run yet
    /// (`session::ActiveSession::handles` is still `None`). Before the
    /// fix this silently no-op'd (`trigger_cancel` returned early,
    /// `do_cancel` returned `Ok` immediately) and the session proceeded
    /// as if nothing happened — mic left open, a real regression of
    /// `[R1-Safety S4]`. After the fix, `attach_handles` applies the
    /// pending `cancel_requested` the instant handles exist: no
    /// transcription HTTP call, state ends at `Idle`, the slot is freed,
    /// and the capture backend is actually stopped.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_arriving_while_capture_start_is_blocked_still_cancels_the_session() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock, ready_rx, release_tx) = blocking_start_state(&tmp);

        let start_state = state.clone();
        let start_task = tokio::spawn(async move { do_start(&start_state, Mode::Hold).await });

        ready_rx.await.unwrap();
        let id = state.sessions.active_id().expect("begin() must have claimed the slot before capture.start() blocks");
        assert!(state.sessions.is_active(&id), "handles are not attached yet, but is_active must still see the reserved slot");

        let cancel_result = do_cancel(&state, &id).await;
        assert!(cancel_result.is_ok(), "cancel() arriving in this window must still be accepted, not UnknownSession");

        release_tx.send(()).unwrap();
        let start_result = start_task.await.unwrap();
        assert!(start_result.is_ok(), "do_start itself still succeeds once capture.start() unblocks");

        // The pipeline task now runs concurrently on the other worker
        // thread; give it a bounded number of yields to observe the
        // already-pending cancel signal and finalize.
        for _ in 0..500 {
            if !state.sessions.has_active() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        }

        assert!(!state.sessions.has_active(), "the session must end (cancelled), not stay wedged as active");
        assert!(!mock.is_running(), "the capture backend must actually be stopped, not left open");
        assert_eq!(
            std::fs::read_dir(state.rec_dir.path()).unwrap().count(),
            0,
            "the rec file must be deleted, same as any other cancelled session"
        );
    }

    /// F1 (b): same window as (a), but the safety-net path
    /// (`cancel_all_hold`, what the webview-destroyed/app-exit hooks call
    /// for `[R1-Safety S4]`) instead of an explicit `cancel()` command.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_all_hold_arriving_while_capture_start_is_blocked_still_cancels_the_hold_session() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock, ready_rx, release_tx) = blocking_start_state(&tmp);

        let start_state = state.clone();
        let start_task = tokio::spawn(async move { do_start(&start_state, Mode::Hold).await });

        ready_rx.await.unwrap();
        let id = state.sessions.active_id().expect("begin() must have claimed the slot before capture.start() blocks");

        // Simulate the webview-destroyed/app-exit hook firing in this window.
        state.sessions.cancel_all_hold();

        release_tx.send(()).unwrap();
        let start_result = start_task.await.unwrap();
        assert!(start_result.is_ok());

        for _ in 0..500 {
            if !state.sessions.has_active() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        }

        assert!(!state.sessions.has_active(), "cancel_all_hold arriving in this window must still cancel the Hold session, not leave the mic open");
        assert!(!mock.is_running());
        assert_eq!(std::fs::read_dir(state.rec_dir.path()).unwrap().count(), 0);
        let _ = id; // kept for clarity/debuggability, no further assertions needed on it
    }

    /// F1 (c): the same blocking-start harness with NO cancel arriving at
    /// all — the normal-path regression check for the `cancel_requested`
    /// change: a start with nothing racing it must be completely
    /// unaffected (no spurious cancellation, capture actually recording).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_with_no_cancel_in_the_blocking_window_is_unaffected() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock, ready_rx, release_tx) = blocking_start_state(&tmp);

        let start_state = state.clone();
        let start_task = tokio::spawn(async move { do_start(&start_state, Mode::Hold).await });

        ready_rx.await.unwrap();
        release_tx.send(()).unwrap();

        let id = start_task.await.unwrap().unwrap();

        assert!(state.sessions.is_active(&id));
        assert!(mock.is_running(), "an uncancelled start must leave the capture backend actually recording");

        do_cancel(&state, &id).await.unwrap();
    }

    /// F-NEW (a): `stop()` arriving while `do_start` is parked inside
    /// `spawn_blocking(capture.start)` \u2014 same window as F1's cancel
    /// tests above, but for `Stop`. Before the fix, `do_stop` called
    /// `session::SessionGuard::signal` directly, whose `.expect()`
    /// panics when `handles` is still `None` here \u2014 under the
    /// workspace's `panic = "abort"` release profile, that's a full app
    /// crash. After the fix (`request_stop`, mirroring F1's
    /// `request_cancel`), `do_stop` never calls `signal()` in this
    /// window: it records the pending `Stop`, which `attach_handles`
    /// applies the moment handles exist, and polls for the outcome
    /// receiver instead of assuming it already exists. No panic, and
    /// once `capture.start()` unblocks the session finalizes normally
    /// (a real result or a transcription error \u2014 never a crash).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn do_stop_arriving_while_capture_start_is_blocked_finalizes_normally_no_panic() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock, ready_rx, release_tx) = blocking_start_state(&tmp);

        let start_state = state.clone();
        let start_task = tokio::spawn(async move { do_start(&start_state, Mode::Hold).await });

        ready_rx.await.unwrap();
        let id = state.sessions.active_id().expect("begin() must have claimed the slot before capture.start() blocks");
        assert!(state.sessions.is_active(&id), "handles are not attached yet, but is_active must still see the reserved slot");

        let stop_state = state.clone();
        let stop_id = id.clone();
        let stop_task = tokio::spawn(async move { do_stop(&stop_state, &stop_id).await });
        // Give do_stop a chance to actually start polling inside
        // wait_for_outcome_receiver before releasing capture.start() --
        // not load-bearing for correctness, just makes the test actually
        // exercise the race instead of getting lucky with scheduling.
        tokio::task::yield_now().await;

        release_tx.send(()).unwrap();
        let start_result = start_task.await.unwrap();
        assert!(start_result.is_ok(), "do_start itself still succeeds once capture.start() unblocks");
        // Let the pipeline finalise COMPLETELY (slot freed) before the stop
        // task gets scheduled again: with the old poll-for-handles design
        // this window produced `UnknownSession` for an honoured stop (CI
        // task 6882); `StopRequest::Pending` hands the receiver over inside
        // `attach_handles`' lock, so the outcome survives the slot being freed.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!state.sessions.is_active(&id), "test premise: the session already finalised and freed its slot");

        let stop_result = stop_task.await.unwrap();
        assert!(
            stop_result.is_ok() || matches!(stop_result, Err(PluginError::Transcription { .. })),
            "stop() must resolve with a real result or a Transcription error, not any other error and never a panic: {stop_result:?}"
        );

        assert!(!state.sessions.has_active(), "the session must end (finalized), not stay wedged as active");
        assert!(!mock.is_running(), "the capture backend must actually be stopped, not left open");
        assert_eq!(
            std::fs::read_dir(state.rec_dir.path()).unwrap().count(),
            0,
            "the rec file must be deleted, same as any other finalized session"
        );
    }

    /// F-NEW (b): the same window as (a), but driving it the way
    /// `lib.rs::handle_live_activity_stop_intent` (Task 9a, the iOS Live
    /// Activity/Dynamic Island Stop button) actually does: read
    /// `active_id()` fresh at the call site and pass that straight into
    /// `do_stop`, rather than reusing the id `do_start`'s own
    /// (still in-flight) task will eventually return \u2014 this is the
    /// concrete real-world trigger the review named: a Stop intent
    /// tapped in the small window right after starting a Hold recording.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn live_activity_style_stop_arriving_while_capture_start_is_blocked_finalizes_normally_no_panic() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock, ready_rx, release_tx) = blocking_start_state(&tmp);

        let start_state = state.clone();
        let start_task = tokio::spawn(async move { do_start(&start_state, Mode::Hold).await });

        ready_rx.await.unwrap();
        assert!(state.sessions.active_id().is_some(), "begin() must have claimed the slot before capture.start() blocks");

        let stop_state = state.clone();
        let stop_task = tokio::spawn(async move {
            let id = stop_state
                .sessions
                .active_id()
                .expect("the Live Activity Stop path reads active_id() fresh, exactly like lib.rs's handle_live_activity_stop_intent");
            do_stop(&stop_state, &id).await
        });
        tokio::task::yield_now().await;

        release_tx.send(()).unwrap();
        let start_result = start_task.await.unwrap();
        assert!(start_result.is_ok());

        let stop_result = stop_task.await.unwrap();
        assert!(
            stop_result.is_ok() || matches!(stop_result, Err(PluginError::Transcription { .. })),
            "stop() must resolve with a real result or a Transcription error, not any other error and never a panic: {stop_result:?}"
        );

        assert!(!state.sessions.has_active());
        assert!(!mock.is_running());
        assert_eq!(std::fs::read_dir(state.rec_dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn state_is_idle_then_recording_then_idle() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        assert_eq!(do_state(&state), crate::models::State::Idle);

        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        let id = do_start(&state, Mode::Hold).await.unwrap();
        assert_eq!(do_state(&state), crate::models::State::Recording);

        do_stop(&state, &id).await.unwrap();
        assert_eq!(do_state(&state), crate::models::State::Idle);
    }

    #[tokio::test]
    async fn hold_lease_on_active_session_is_ok_on_unknown_is_error() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        let id = do_start(&state, Mode::Hold).await.unwrap();

        assert!(do_hold_lease(&state, &id).is_ok());
        assert!(matches!(do_hold_lease(&state, &SessionId::new()), Err(PluginError::UnknownSession { .. })));

        do_stop(&state, &id).await.unwrap();
    }

    #[tokio::test]
    async fn set_consent_persists_through_do_start_gate() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        do_set_consent(&state, true).unwrap();

        assert!(do_start(&state, Mode::Hold).await.is_ok());
    }

    /// Consent refusal specifically for `Mode::Toggle` too \u2014 the gate is
    /// mode-independent (required test list: "consent refusal").
    #[tokio::test]
    async fn start_toggle_is_refused_without_consent() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = do_start(&state, Mode::Toggle).await;

        assert!(matches!(result, Err(PluginError::ConsentRequired { .. })));
    }

    /// `[R1-Safety S5]` end-to-end with the SIGKILL scenario: a rec file
    /// left behind because the whole `PluginState` (and therefore its
    /// `SessionGuard`/pipeline task) was dropped mid-recording without
    /// any graceful shutdown must be swept away by a fresh `RecDir` at
    /// next startup, same as `capture.rs`'s `sweep_deletes_orphan_files`
    /// but driven through `do_start` instead of writing the orphan file
    /// by hand.
    #[tokio::test]
    async fn sigkill_simulation_leaves_rec_dir_empty_after_fresh_init() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let state = test_state(&tmp);
            state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
            let _id = do_start(&state, Mode::Hold).await.unwrap();
            assert_eq!(std::fs::read_dir(state.rec_dir.path()).unwrap().count(), 1);
            // Simulate SIGKILL: state is dropped here with no stop()/cancel(),
            // so the RecFile's Drop never runs (it's still owned by the
            // never-finalized pipeline task, which is also just dropped).
        }

        let fresh_rec_dir = crate::capture::RecDir::new(tmp.path().to_path_buf());
        fresh_rec_dir.sweep().unwrap();

        assert_eq!(std::fs::read_dir(fresh_rec_dir.path()).unwrap().count(), 0, "rec/ must be empty after a fresh sweep following a simulated crash");
    }
}
