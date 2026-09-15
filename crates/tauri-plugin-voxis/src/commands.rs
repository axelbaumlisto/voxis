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
//! `import_profile_from_desktop`/`import_profile_from_qr` are wired
//! (present in `COMMANDS` and the invoke handler, so permissions/ACL and
//! any host capability file are ready for Task 2/6/7) but return
//! `PluginError::NotImplemented` \u2014 those tasks own the real
//! implementation.

use tauri::State as TauriState;

use crate::capture::RecFile;
use crate::error::PluginError;
use crate::models::{DictationResult, HotkeySpec, ImportSummary, KeySourceDto, Mode, SessionId};
use crate::pipeline;
use crate::session::ControlSignal;
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

    if let Err(capture_err) = state.capture.start(&path, cap_samples) {
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

/// Sends `Stop` to `id`'s pipeline task and awaits the eventual outcome.
/// Safe to call more than once for the same id: if the session has
/// already moved past `Recording` (into `Transcribing`, or finished
/// entirely), the signal is a harmless no-op and this just waits on (or
/// immediately reads) the same result \u2014 "stop during Transcribing =
/// no-op, not error".
pub(crate) async fn do_stop(state: &PluginState, id: &SessionId) -> Result<DictationResult, PluginError> {
    let mut outcome_rx = state.sessions.signal(id, ControlSignal::Stop)?;
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
pub fn get_profile(_state: TauriState<'_, PluginState>) -> Result<serde_json::Value, PluginError> {
    Err(PluginError::NotImplemented { what: "get_profile (Task 2/6)".to_string() })
}

#[tauri::command]
pub fn apply_profile(
    _state: TauriState<'_, PluginState>,
    _bytes: Vec<u8>,
    _key_source: KeySourceDto,
) -> Result<ImportSummary, PluginError> {
    Err(PluginError::NotImplemented { what: "apply_profile (Task 2)".to_string() })
}

#[tauri::command]
pub fn import_profile_from_desktop(
    _state: TauriState<'_, PluginState>,
) -> Result<ImportSummary, PluginError> {
    Err(PluginError::NotImplemented { what: "import_profile_from_desktop (Task 6)".to_string() })
}

#[tauri::command]
pub fn import_profile_from_qr(
    _state: TauriState<'_, PluginState>,
    _payload: String,
) -> Result<ImportSummary, PluginError> {
    Err(PluginError::NotImplemented { what: "import_profile_from_qr (Task 7)".to_string() })
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
