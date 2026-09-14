//! Single-flight session guard: `start` may only succeed while no other
//! session is active, mirroring desktop Voxis's `PressReleaseMachine`
//! staying in a single `Stage::Recording` at a time. Owns the active
//! session's `RecFile` (so it's dropped — file deleted — the moment the
//! session ends, on every outcome) and enough bookkeeping for the Task 3
//! pipeline stub to build a `DictationResult`; Task 3b's real pipeline
//! (guard timers, lease, transcription) plugs into the same guard.

use std::time::Instant;

use crate::capture::RecFile;
use crate::error::PluginError;
use crate::models::{Mode, SessionId};

/// Bookkeeping for the one session `SessionGuard` currently allows to be
/// active.
pub struct ActiveSession {
    pub id: SessionId,
    pub mode: Mode,
    pub file: RecFile,
    started_at: Instant,
}

impl ActiveSession {
    pub fn elapsed_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }
}

/// Holds at most one `ActiveSession`. `Mutex` rather than `RwLock`:
/// `begin`/`end` are always exclusive, and reads (`current`,
/// `require_active`) are cheap enough that a plain mutex adds no
/// measurable contention for a single-session-at-a-time plugin.
#[derive(Default)]
pub struct SessionGuard {
    active: std::sync::Mutex<Option<ActiveSession>>,
}

impl SessionGuard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Claims the single active slot with a freshly-created `RecFile`, or
    /// returns `AlreadyRecording` if one is already claimed. `file` is
    /// created by the caller (needs `RecDir`) before calling this so a
    /// failed claim doesn't leave an orphan file lying around.
    pub fn begin(&self, mode: Mode, file: RecFile) -> Result<SessionId, PluginError> {
        let mut guard = self.active.lock().unwrap();
        if guard.is_some() {
            return Err(PluginError::AlreadyRecording);
        }
        let id = SessionId::new();
        *guard = Some(ActiveSession { id: id.clone(), mode, file, started_at: Instant::now() });
        Ok(id)
    }

    /// Ends the active session if `id` matches it, returning the (now
    /// detached) `ActiveSession` so the caller can read its `RecFile`
    /// path / elapsed time before it drops (deleting the file). Returns
    /// `UnknownSession` for a stale/mismatched id without touching the
    /// active slot — lets a caller safely retry `stop`/`cancel` with the
    /// id it was actually given.
    pub fn end(&self, id: &SessionId) -> Result<ActiveSession, PluginError> {
        let mut guard = self.active.lock().unwrap();
        match guard.as_ref() {
            Some(active) if &active.id == id => Ok(guard.take().unwrap()),
            _ => Err(PluginError::UnknownSession { session_id: id.to_string() }),
        }
    }

    /// True if `id` is the currently active session (used by `hold_lease`,
    /// which doesn't want to consume/end the session just to validate the
    /// id).
    pub fn is_active(&self, id: &SessionId) -> bool {
        self.active.lock().unwrap().as_ref().is_some_and(|active| &active.id == id)
    }

    pub fn has_active(&self) -> bool {
        self.active.lock().unwrap().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn rec_file(dir: &tempfile::TempDir, name: &str) -> RecFile {
        RecFile::create(dir.path().join(name)).unwrap()
    }

    #[test]
    fn begin_claims_the_slot() {
        let guard = SessionGuard::new();
        let dir = tempdir().unwrap();
        let id = guard.begin(Mode::Hold, rec_file(&dir, "a.wav")).unwrap();
        assert!(guard.is_active(&id));
        assert!(guard.has_active());
    }

    #[test]
    fn second_begin_while_active_is_already_recording() {
        let guard = SessionGuard::new();
        let dir = tempdir().unwrap();
        guard.begin(Mode::Hold, rec_file(&dir, "a.wav")).unwrap();

        let second = guard.begin(Mode::Toggle, rec_file(&dir, "b.wav"));

        assert!(matches!(second, Err(PluginError::AlreadyRecording)));
    }

    #[test]
    fn end_with_matching_id_frees_the_slot_and_deletes_the_file() {
        let guard = SessionGuard::new();
        let dir = tempdir().unwrap();
        let path = dir.path().join("a.wav");
        let id = guard.begin(Mode::Hold, RecFile::create(path.clone()).unwrap()).unwrap();
        assert!(path.exists());

        let ended = guard.end(&id).unwrap();
        drop(ended);

        assert!(!guard.has_active());
        assert!(!path.exists(), "ending a session must delete its RecFile");
    }

    #[test]
    fn end_with_wrong_id_is_unknown_session_and_does_not_free_the_slot() {
        let guard = SessionGuard::new();
        let dir = tempdir().unwrap();
        let real_id = guard.begin(Mode::Hold, rec_file(&dir, "a.wav")).unwrap();
        let stale_id = SessionId::new();

        let result = guard.end(&stale_id);

        assert!(matches!(result, Err(PluginError::UnknownSession { .. })));
        assert!(guard.is_active(&real_id), "the real session must still be active");
    }

    #[test]
    fn after_end_a_new_session_can_begin() {
        let guard = SessionGuard::new();
        let dir = tempdir().unwrap();
        let first = guard.begin(Mode::Hold, rec_file(&dir, "a.wav")).unwrap();
        guard.end(&first).unwrap();

        let second = guard.begin(Mode::Toggle, rec_file(&dir, "b.wav"));

        assert!(second.is_ok());
    }
}
