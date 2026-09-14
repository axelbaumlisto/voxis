//! The eleven Tauri commands the plugin registers (`build.rs`'s
//! `COMMANDS`, `lib.rs`'s `generate_handler!`). Each is a thin
//! `#[tauri::command]` wrapper around a `do_*` function that takes
//! `&PluginState` directly — the `do_*` functions are what
//! `#[cfg(test)]` below exercises, with no Tauri runtime involved
//! (`tauri::State` only shows up in the wrapper, never in the logic).
//!
//! Task 3 scope: `start`/`stop`/`cancel` really run the single-flight
//! guard, the consent gate, and `RecFile` cleanup; the "pipeline" between
//! them is a stub — no guard timers, no transcription. Task 3b
//! (`pipeline.rs`) replaces `do_stop`'s body with the real thing.
//! `get_profile`/`apply_profile`/`import_profile_from_desktop`/
//! `import_profile_from_qr` are wired (present in `COMMANDS` and the
//! invoke handler, so permissions/ACL and any host capability file are
//! ready for Task 2/6/7) but return `PluginError::NotImplemented` — those
//! tasks own the real implementation.

use tauri::State as TauriState;

use crate::capture::RecFile;
use crate::error::PluginError;
use crate::models::{DictationResult, GuardOutcome, HotkeySpec, ImportSummary, KeySourceDto, Mode, SessionId};
use crate::PluginState;

/// The desktop cap-samples backstop every `start()` call passes to the
/// capture backend (`[R1-Arch S2]`, "self-cap"): `voxis_core::guard`'s
/// existing `native_cap_samples`/`DEFAULT_MAX_RECORDING_MS`, at the same
/// 16 kHz mono rate every capture backend writes at
/// (`voxis_core::audio_wav::TRANSCRIPTION_SAMPLE_RATE`). Task 3b's
/// pipeline is expected to pass a session/profile-specific value instead
/// (Hold mode's 120s cap in particular, `[R1-Safety T4]`) — this default
/// only needs to be *a* sane, nonzero cap for the stub pipeline's
/// single-flight/consent/cleanup tests.
fn default_cap_samples() -> usize {
    voxis_core::guard::native_cap_samples(
        voxis_core::config::DEFAULT_MAX_RECORDING_MS,
        voxis_core::audio_wav::TRANSCRIPTION_SAMPLE_RATE,
    )
}

pub(crate) fn do_start(state: &PluginState, mode: Mode) -> Result<SessionId, PluginError> {
    if !state.consent.is_consented(&state.host_id, &state.provider_host)? {
        return Err(PluginError::ConsentRequired { provider_host: state.provider_host.clone() });
    }

    let path = state.rec_dir.new_session_path();
    let file = RecFile::create(path.clone())
        .map_err(|e| PluginError::Capture { message: format!("creating rec file: {e}") })?;
    let id = state.sessions.begin(mode, file)?;

    if let Err(capture_err) = state.capture.start(&path, default_cap_samples()) {
        // Roll back the reservation so a capture-backend failure doesn't
        // permanently wedge the single-flight guard; `end` also drops
        // (deletes) the `RecFile` we just created.
        let _ = state.sessions.end(&id);
        return Err(capture_err.into());
    }

    Ok(id)
}

pub(crate) fn do_stop(state: &PluginState, id: &SessionId) -> Result<DictationResult, PluginError> {
    let active = state.sessions.end(id)?;
    let stats = state.capture.stop();
    // The `RecFile` (and therefore the WAV on disk) is deleted when
    // `active` drops at the end of this function, regardless of whether
    // `capture.stop()` succeeded — matches `[R1-Safety S5]`'s "deleted on
    // every outcome", not just the happy path.
    let stats = stats?;
    Ok(DictationResult {
        // Task 3 pipeline stub: no transcription client wired yet.
        text: String::new(),
        language: None,
        duration_ms: stats.duration_ms.max(active.elapsed_ms()),
        guard_outcome: GuardOutcome::Finalized,
    })
}

pub(crate) fn do_cancel(state: &PluginState, id: &SessionId) -> Result<(), PluginError> {
    let _active = state.sessions.end(id)?;
    // Best-effort: a capture backend that's already dead/ignoring stop
    // must not block `cancel` from freeing the session slot and deleting
    // the file (which happens via `_active`'s drop either way).
    let _ = state.capture.stop();
    Ok(())
}

pub(crate) fn do_state(state: &PluginState) -> crate::models::State {
    if state.sessions.has_active() {
        crate::models::State::Recording
    } else {
        crate::models::State::Idle
    }
}

pub(crate) fn do_set_consent(state: &PluginState, consented: bool) -> Result<(), PluginError> {
    state.consent.set_consent(&state.host_id, &state.provider_host, consented)?;
    Ok(())
}

pub(crate) fn do_hold_lease(state: &PluginState, id: &SessionId) -> Result<(), PluginError> {
    // Task 3 stub: just validates the session is still the active one.
    // Task 3b's `lease.rs` adds the actual 1 Hz heartbeat/3-miss
    // `LeaseLost` watcher (`[R1-Safety S4]`).
    if state.sessions.is_active(id) {
        Ok(())
    } else {
        Err(PluginError::UnknownSession { session_id: id.to_string() })
    }
}

#[tauri::command]
pub fn start(state: TauriState<'_, PluginState>, mode: Mode) -> Result<SessionId, PluginError> {
    do_start(&state, mode)
}

#[tauri::command]
pub fn stop(state: TauriState<'_, PluginState>, id: SessionId) -> Result<DictationResult, PluginError> {
    do_stop(&state, &id)
}

#[tauri::command]
pub fn cancel(state: TauriState<'_, PluginState>, id: SessionId) -> Result<(), PluginError> {
    do_cancel(&state, &id)
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

#[tauri::command]
pub fn set_hotkey(_state: TauriState<'_, PluginState>, spec: HotkeySpec) -> Result<(), PluginError> {
    // Task 3 stub: stores nothing yet (no desktop/iOS backend to
    // (re)register against — that's Task 4/8). Present so the command
    // surface, permissions, and `HotkeySpec` wire format are all fixed
    // now; a later task is expected to add a `Mutex<HotkeySpec>`-style
    // field to `PluginState` once there's a real listener to update.
    let _ = spec;
    Ok(())
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
    use crate::secrets::InMemorySecretStore;
    use crate::session::SessionGuard;
    use std::sync::Arc;

    fn test_state(tmp: &tempfile::TempDir) -> PluginState {
        let (state, _mock) = test_state_with_mock(tmp);
        state
    }

    fn test_state_with_mock(tmp: &tempfile::TempDir) -> (PluginState, Arc<MockCapture>) {
        let mock = Arc::new(MockCapture::new());
        let capture: Arc<dyn crate::capture::AudioCapture> = mock.clone();
        let state = PluginState {
            sessions: SessionGuard::new(),
            consent: ConsentStore::new(tmp.path().join("consent.json")),
            secrets: Arc::new(InMemorySecretStore::new()),
            rec_dir: crate::capture::RecDir::new(tmp.path().to_path_buf()),
            capture,
            host_id: "test-host".to_string(),
            provider_host: "api.groq.com".to_string(),
        };
        (state, mock)
    }

    #[test]
    fn start_is_refused_without_consent() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = do_start(&state, Mode::Hold);

        assert!(matches!(result, Err(PluginError::ConsentRequired { .. })));
        assert!(!state.sessions.has_active(), "a refused start must not claim the session slot");
    }

    #[test]
    fn start_succeeds_after_consent_and_creates_a_rec_file() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();

        let id = do_start(&state, Mode::Hold).unwrap();

        assert!(state.sessions.is_active(&id));
        let mut entries = std::fs::read_dir(state.rec_dir.path()).unwrap();
        assert!(entries.next().is_some(), "start() must create a rec file for the session");
    }

    #[test]
    fn start_rolls_back_session_slot_when_capture_backend_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock) = test_state_with_mock(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();

        // Make the capture backend itself fail on the very `start()` call
        // `do_start` is about to make, without ever going through the
        // session guard — `MockCapture`'s own "already running" check is
        // enough to exercise `do_start`'s `capture_err` rollback branch
        // (claim the slot -> capture.start() fails -> free the slot again
        // and delete the `RecFile` that was already created).
        mock.start(&tmp.path().join("out-of-band.wav"), 1).unwrap();

        let result = do_start(&state, Mode::Hold);

        assert!(matches!(result, Err(PluginError::Capture { .. })));
        assert!(!state.sessions.has_active(), "a capture-backend start failure must roll back the session slot");
        assert_eq!(
            std::fs::read_dir(state.rec_dir.path()).unwrap().count(),
            0,
            "the RecFile created before the capture-backend failure must be deleted, not orphaned"
        );
    }

    #[test]
    fn second_start_while_active_is_already_recording() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        do_start(&state, Mode::Hold).unwrap();

        let second = do_start(&state, Mode::Toggle);

        assert!(matches!(second, Err(PluginError::AlreadyRecording)));
    }

    #[test]
    fn stop_returns_finalized_stub_result_and_deletes_the_file() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        let id = do_start(&state, Mode::Hold).unwrap();
        let rec_path_count_before = std::fs::read_dir(state.rec_dir.path()).unwrap().count();
        assert_eq!(rec_path_count_before, 1);

        let result = do_stop(&state, &id).unwrap();

        assert_eq!(result.text, "");
        assert_eq!(result.guard_outcome, GuardOutcome::Finalized);
        assert!(!state.sessions.has_active());
        assert_eq!(std::fs::read_dir(state.rec_dir.path()).unwrap().count(), 0, "stop() must delete the rec file");
    }

    #[test]
    fn stop_with_unknown_session_id_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = do_stop(&state, &SessionId::new());

        assert!(matches!(result, Err(PluginError::UnknownSession { .. })));
    }

    #[test]
    fn cancel_frees_the_slot_and_deletes_the_file_even_if_capture_stop_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock) = test_state_with_mock(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        let id = do_start(&state, Mode::Hold).unwrap();

        // Force capture.stop() to fail — cancel must still free the slot
        // and delete the file (best-effort capture stop).
        mock.set_ignore_stop(true);

        do_cancel(&state, &id).unwrap();

        assert!(!state.sessions.has_active());
        assert_eq!(std::fs::read_dir(state.rec_dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn state_is_idle_then_recording_then_idle() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        assert_eq!(do_state(&state), crate::models::State::Idle);

        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        let id = do_start(&state, Mode::Hold).unwrap();
        assert_eq!(do_state(&state), crate::models::State::Recording);

        do_stop(&state, &id).unwrap();
        assert_eq!(do_state(&state), crate::models::State::Idle);
    }

    #[test]
    fn hold_lease_on_active_session_is_ok_on_unknown_is_error() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        let id = do_start(&state, Mode::Hold).unwrap();

        assert!(do_hold_lease(&state, &id).is_ok());
        assert!(matches!(do_hold_lease(&state, &SessionId::new()), Err(PluginError::UnknownSession { .. })));
    }

    #[test]
    fn set_consent_persists_through_do_start_gate() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        do_set_consent(&state, true).unwrap();

        assert!(do_start(&state, Mode::Hold).is_ok());
    }
}
