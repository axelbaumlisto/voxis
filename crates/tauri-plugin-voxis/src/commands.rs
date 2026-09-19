//! The twelve Tauri commands the plugin registers (`build.rs`'s
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
use crate::PluginState;

pub(crate) async fn do_start(state: &PluginState, mode: Mode) -> Result<SessionId, PluginError> {
    // C0: a platform this build cannot record on refuses before anything
    // else — no consent prompt, no key check, no slot, no rec file. The
    // host shows "not available here"; nobody speaks into nothing.
    if let Some(message) = state.capture.unsupported_reason() {
        return Err(PluginError::UnsupportedPlatform { message });
    }
    let provider_host = profile_source::current_provider_host(state);
    if !state.consent.is_consented(&state.host_id, &provider_host)? {
        return Err(PluginError::ConsentRequired { provider_host });
    }
    // Fail fast, before the mic opens: a session without a key can only end
    // in a `Transcription { "no API key configured" }` after the user has
    // already spoken. Checked here (sync, cheap) rather than in the pipeline.
    match state.secrets.get(pipeline::API_KEY_SECRET_NAME) {
        Ok(Some(_)) => {}
        Ok(None) => return Err(PluginError::NoApiKey { message: "no transcription API key -- set a provider (Groq key or self-hosted URL) first".to_string() }),
        Err(e) => return Err(PluginError::NoApiKey { message: format!("reading the API key: {e}") }),
    }

    let path = state.rec_dir.new_session_path();
    let file = match RecFile::create(path.clone()) {
        Ok(f) => f,
        Err(e) => return Err(PluginError::Capture { message: format!("creating rec file: {e}") }),
    };

    let deps = state.pipeline_deps();
    let cap_samples =
        voxis_core::guard::native_cap_samples(deps.app_config.max_recording_ms, voxis_core::audio_wav::TRANSCRIPTION_SAMPLE_RATE);

    // Claim the slot and spawn the pipeline task (with its control/outcome
    // handles already attached, review finding F1) BEFORE starting the
    // capture backend. The task parks on `capture_ready` until we report
    // whether `capture.start` succeeded, so a stop/cancel arriving during
    // the (possibly blocking) start reaches a live session, never a
    // handle-less window. `spawn` returning `Err` (`AlreadyRecording`)
    // drops `file` (deleting the rec file) as it goes out of scope.
    let (capture_ready_tx, capture_ready_rx) = tokio::sync::oneshot::channel();
    let (id, mut outcome_rx) = pipeline::spawn(mode, file, deps, state.sessions.clone(), capture_ready_rx)?;

    // `[ADO-8]`: on mobile `capture.start` dispatches to
    // `run_mobile_plugin` (an IPC round-trip to the Swift/Kotlin side); on
    // desktop `CpalCapture::start` returns quickly, but no
    // `AudioCapture::start` implementation is contractually guaranteed
    // non-blocking. Never run it inline on the async command's own tokio
    // worker thread -- `spawn_blocking` moves it to the blocking-pool,
    // keeping the runtime free to make progress on unrelated tasks for
    // however long it takes.
    let capture = state.capture.clone();
    let start_path = path.clone();
    let start_result = tokio::task::spawn_blocking(move || capture.start(&start_path, cap_samples))
        .await
        .unwrap_or_else(|join_err| Err(crate::capture::CaptureError::Backend(format!("capture.start() task panicked: {join_err}"))));

    match start_result {
        Ok(()) => {
            let _ = capture_ready_tx.send(Ok(()));
            Ok(id)
        }
        Err(capture_err) => {
            // Report the failure to the parked pipeline task, which
            // finalises it as the capture error (slot freed, file deleted,
            // no HTTP, no `voxis://result`); await that outcome so the
            // freed slot / deleted file are visible before we return, and
            // surface the same error the task published.
            let _ = capture_ready_tx.send(Err(capture_err));
            match await_outcome(&mut outcome_rx).await {
                Ok(_) => Ok(id),
                Err(plugin_err) => Err(plugin_err),
            }
        }
    }
}

pub(crate) async fn do_stop(state: &PluginState, id: &SessionId) -> Result<DictationResult, PluginError> {
    // `request_stop` returns the outcome receiver whether the session is
    // still Recording (the loop observes `Stop` next poll) or already
    // Transcribing (harmless no-op send). Because the handles are attached
    // atomically at `begin` (review finding F1), a `Stop` arriving during
    // `do_start`'s `spawn_blocking(capture.start)` reaches a live session
    // and gets a real outcome -- never `UnknownSession` for an honoured
    // stop, even if the pipeline finalises and frees the slot before this
    // caller resumes (the `watch::Receiver` retains the published value).
    let mut outcome_rx = match state.sessions.request_stop(id) {
        None => return Err(PluginError::UnknownSession { session_id: id.to_string() }),
        Some(rx) => rx,
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
/// resolves. If the session finalised on its own between `request_cancel`
/// and `outcome_receiver` (slot already freed), there is nothing left to
/// await and this returns `Ok(())` immediately.
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
    let provider_host = profile_source::current_provider_host(state);
    state.consent.set_consent(&state.host_id, &provider_host, consented)?;
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

/// Manual provider entry (paste a Groq key / self-hosted URL) for a host
/// with no Voxis desktop to import a sealed profile from — see
/// `profile_source::set_provider` for the full semantics (key kept/
/// cleared/set through the `SecretStore`, http(s)-URL validation,
/// per-host consent reset, `AlreadyRecording` while a session is live).
/// The three params map to the camelCase wire keys `apiKey`/
/// `apiUrlOverride`/`model`, each nullable.
#[tauri::command]
pub fn set_provider(
    state: TauriState<'_, PluginState>,
    api_key: Option<String>,
    api_url_override: Option<String>,
    model: Option<String>,
) -> Result<ImportSummary, PluginError> {
    profile_source::set_provider(&state, api_key, api_url_override, model)
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

    /// A host with no key yet (fresh iPad, no Voxis desktop): `start()` is
    /// refused up front with `noApiKey`, the mic never opens, no slot is
    /// taken -- instead of a recording that ends in a Transcription error.
    #[tokio::test]
    async fn start_without_an_api_key_is_refused_before_the_mic_opens() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock) = test_state_with_mock(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        state.secrets.delete(pipeline::API_KEY_SECRET_NAME).unwrap();

        let err = do_start(&state, Mode::Toggle).await.unwrap_err();
        assert!(matches!(err, PluginError::NoApiKey { .. }), "got {err:?}");
        assert!(!state.sessions.has_active(), "no slot may be claimed");
        assert!(!mock.is_running(), "the mic must not open");
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

    /// A capture backend whose `start()` blocks (via a shared
    /// [`crate::capture::BlockingLatch`]) until the test releases it --
    /// pins down the window `commands::do_start` opens between
    /// `pipeline::spawn` (which claims the slot WITH handles attached) and
    /// `capture.start` completing, so a stop/cancel arriving there reaches
    /// a live, fully-wired session.
    struct BlockingStartCapture {
        inner: Arc<MockCapture>,
        latch: Arc<crate::capture::BlockingLatch>,
    }

    impl AudioCapture for BlockingStartCapture {
        fn start(&self, path: &std::path::Path, cap_samples: usize) -> Result<(), crate::capture::CaptureError> {
            self.latch.block();
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
        let (latch, ready_rx, release_tx) = crate::capture::BlockingLatch::new();
        let capture: Arc<dyn AudioCapture> = Arc::new(BlockingStartCapture { inner: mock.clone(), latch });
        state.capture = capture;
        (Arc::new(state), mock, ready_rx, release_tx)
    }

    /// A `cancel()` arriving while `do_start` is parked inside
    /// `spawn_blocking(capture.start)` -- the slot is claimed and its
    /// handles are attached (review finding F1: atomically, at `begin`),
    /// but `capture.start` hasn't returned yet. The cancel must be honoured
    /// (not `UnknownSession`), the session must end cancelled with no
    /// transcription, the slot freed, the file deleted, and the capture
    /// backend actually stopped -- the `[R1-Safety S4]` mic-safety
    /// guarantee. `do_cancel` awaits the outcome (which only arrives once
    /// `capture.start` unblocks and the pipeline finalizes), so it runs on
    /// its own task here.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_arriving_while_capture_start_is_blocked_still_cancels_the_session() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock, ready_rx, release_tx) = blocking_start_state(&tmp);

        let start_state = state.clone();
        let start_task = tokio::spawn(async move { do_start(&start_state, Mode::Hold).await });

        ready_rx.await.unwrap();
        let id = state.sessions.active_id().expect("begin() claims the slot (handles attached) before capture.start runs");
        assert!(state.sessions.is_active(&id));

        let cancel_state = state.clone();
        let cancel_id = id.clone();
        let cancel_task = tokio::spawn(async move { do_cancel(&cancel_state, &cancel_id).await });
        tokio::task::yield_now().await;

        release_tx.send(()).unwrap();
        assert!(start_task.await.unwrap().is_ok(), "do_start still succeeds once capture.start unblocks");
        assert!(cancel_task.await.unwrap().is_ok(), "cancel arriving in this window must be honoured, not UnknownSession");

        assert!(!state.sessions.has_active(), "the session must end cancelled, not stay wedged as active");
        assert!(!mock.is_running(), "the capture backend must actually be stopped, not left open");
        assert_eq!(std::fs::read_dir(state.rec_dir.path()).unwrap().count(), 0, "the rec file must be deleted");
    }

    /// `[R1-Safety S4]`: the webview dying (`on_page_load` / web-content-
    /// process-terminated hooks -> `cancel_all_hold`) while `do_start` is
    /// parked inside `spawn_blocking(capture.start)` -- fire-and-forget,
    /// no caller awaits an outcome, the Hold session must still end
    /// cancelled with the mic closed (review R_r1 minor 1: keep a dedicated
    /// pin for this path, not only for `do_cancel`).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_all_hold_arriving_while_capture_start_is_blocked_still_cancels_the_hold_session() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock, ready_rx, release_tx) = blocking_start_state(&tmp);

        let start_state = state.clone();
        let start_task = tokio::spawn(async move { do_start(&start_state, Mode::Hold).await });

        ready_rx.await.unwrap();
        assert!(state.sessions.has_active());
        state.sessions.cancel_all_hold();
        tokio::task::yield_now().await;

        release_tx.send(()).unwrap();
        let _ = start_task.await.unwrap();
        for _ in 0..200 {
            if !state.sessions.has_active() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert!(!state.sessions.has_active(), "the Hold session must end cancelled, not stay wedged as active");
        assert!(!mock.is_running(), "the capture backend must be stopped -- a dead webview must not leave the mic open");
        assert_eq!(std::fs::read_dir(state.rec_dir.path()).unwrap().count(), 0, "the rec file must be deleted");
    }

    /// A `stop()` arriving while `do_start` is parked inside
    /// `spawn_blocking(capture.start)` -- same window, for `Stop`. The
    /// stop caller must receive the real outcome (never `UnknownSession`
    /// for an honoured stop, the CI-6882 class), never a panic. Keeps the
    /// "50 ms: let the pipeline finalise and FREE the slot before the stop
    /// task resumes" twist: `request_stop` handed the outcome receiver over
    /// up front, so the outcome survives the freed slot (the
    /// `watch::Receiver` retains the published value).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stop_arriving_while_capture_start_is_blocked_gets_a_real_outcome_not_unknown_session() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock, ready_rx, release_tx) = blocking_start_state(&tmp);

        let start_state = state.clone();
        let start_task = tokio::spawn(async move { do_start(&start_state, Mode::Hold).await });

        ready_rx.await.unwrap();
        // Read active_id() fresh at the call site, exactly like
        // lib.rs::handle_live_activity_stop_intent (the iOS Live Activity
        // Stop button) does -- the concrete real-world trigger for this
        // window.
        let id = state.sessions.active_id().expect("begin() claims the slot (handles attached) before capture.start runs");
        assert!(state.sessions.is_active(&id));

        let stop_state = state.clone();
        let stop_id = id.clone();
        let stop_task = tokio::spawn(async move { do_stop(&stop_state, &stop_id).await });
        tokio::task::yield_now().await;

        release_tx.send(()).unwrap();
        assert!(start_task.await.unwrap().is_ok(), "do_start still succeeds once capture.start unblocks");

        // The twist: let the pipeline finalise COMPLETELY (slot freed)
        // before the stop task is scheduled again.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!state.sessions.is_active(&id), "test premise: the session already finalised and freed its slot");

        let stop_result = stop_task.await.unwrap();
        assert!(
            stop_result.is_ok() || matches!(stop_result, Err(PluginError::Transcription { .. })),
            "stop() must resolve with a real result or a Transcription error, never UnknownSession and never a panic: {stop_result:?}"
        );
        assert!(!state.sessions.has_active(), "the session must end (finalized), not stay wedged as active");
        assert!(!mock.is_running(), "the capture backend must actually be stopped, not left open");
        assert_eq!(std::fs::read_dir(state.rec_dir.path()).unwrap().count(), 0, "the rec file must be deleted");
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
