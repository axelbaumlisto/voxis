//! Single-flight session guard + the per-session state machine
//! (`Idle` -> `Recording` -> `Transcribing` -> `Idle`, Task 3b).
//!
//! Task 3's stub owned the session's `RecFile` directly and dropped
//! (deleted) it the moment `stop`/`cancel` was called — fine when
//! `stop()` did no real work between "the recorder finished" and "the
//! session is over". Task 3b's `pipeline.rs` needs the WAV file to still
//! exist for the (possibly long-running, abortable) transcription HTTP
//! call, so the `RecFile` now moves into the spawned pipeline task
//! itself (`pipeline::spawn`) instead of living here — this module only
//! tracks *that a* session is active, which stage it's in, and the
//! handles (`SessionHandles`) a caller needs to reach into that task
//! from a separate command invocation (`stop`/`cancel`/`hold_lease`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use tokio::sync::watch;
use tokio::task::AbortHandle;

use crate::error::PluginError;
use crate::lease::LeaseTracker;
use crate::models::{DictationResult, Mode, SessionId, State};

/// Where a session currently is in its own lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    Recording,
    Transcribing,
}

/// What `stop`/`cancel` send into the active session's Recording-phase
/// loop (`pipeline.rs`'s `select!`). `watch` rather than `mpsc`: only the
/// latest intent matters, and a stale/duplicate send once the loop has
/// already moved on into `Transcribing` is a harmless no-op (nothing is
/// reading the channel anymore) — which is exactly what makes a second
/// `stop()` call during `Transcribing` safe instead of an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlSignal {
    None,
    Stop,
    Cancel,
}

pub type Outcome = Result<DictationResult, PluginError>;

/// Everything a caller outside the spawned pipeline task needs to reach
/// into it. Constructed by `pipeline::spawn` and handed to `begin`, which
/// stores it *atomically with claiming the single-flight slot* — so a
/// session is never observably active without its handles (see `begin`'s
/// doc for why that closes the review-finding-F1 window entirely, rather
/// than patching around it with a deferred-signal queue).
pub struct SessionHandles {
    pub control_tx: watch::Sender<ControlSignal>,
    pub outcome_rx: watch::Receiver<Option<Outcome>>,
    /// Set by `pipeline::run_transcription` right before it spawns the
    /// abortable HTTP transcription task, cleared once that task
    /// completes — `do_cancel` reads this to abort the in-flight HTTP
    /// future directly when `cancel()` arrives during `Transcribing`
    /// (`[R2-Exec F4]`, "cancel during Transcribing").
    pub transcribe_abort: Arc<StdMutex<Option<AbortHandle>>>,
    /// `Some` only for `Mode::Hold` sessions (`lease.rs`: "Toggle mode
    /// has no lease").
    pub lease: Option<Arc<StdMutex<LeaseTracker>>>,
    /// Set unconditionally (regardless of stage) by `trigger_cancel`
    /// *before* sending `ControlSignal::Cancel`/aborting the transcribe
    /// task — fixes a TOCTOU review finding (F2): a plain
    /// `control_tx.send` can land on a channel nobody is reading anymore
    /// if the Recording-phase loop already finalized on its own tick a
    /// moment earlier (silence/max-duration/liveness), and a plain
    /// `transcribe_abort` `take()` can be `None` if `cancel()` arrives
    /// before `run_transcription` has gotten as far as spawning the HTTP
    /// task. `pipeline::decide`/`run_transcription` check this flag at
    /// their own decision points instead of relying solely on the
    /// signal/abort having actually landed in time.
    pub cancelled: Arc<AtomicBool>,
}

pub struct ActiveSession {
    pub id: SessionId,
    pub mode: Mode,
    pub stage: Stage,
    /// Always present for an active session: `begin` stores the handles
    /// under the same lock that reserves the slot, so there is no window
    /// where a session is active with no handles (review finding F1 —
    /// this used to be an `Option<SessionHandles>` attached in a second
    /// step after `begin`, which left a real window a concurrent
    /// `cancel()`/`stop()`/`cancel_all_hold()` could observe as
    /// handle-less; that window, and the `pending`/`stop_waiters`
    /// machinery built to survive it, are gone).
    pub handles: SessionHandles,
}

/// Holds at most one `ActiveSession` — single-flight across the whole
/// lifecycle (`Recording` AND `Transcribing`, unlike Task 3's stub,
/// which freed the slot the instant `stop()` was called).
#[derive(Default)]
pub struct SessionGuard {
    active: std::sync::Mutex<Option<ActiveSession>>,
}

impl SessionGuard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Claims the single active slot for a new session (stage
    /// `Recording`), storing its `handles` atomically with the
    /// reservation. Returns `AlreadyRecording` if one is already claimed
    /// — in ANY stage, `Recording` or `Transcribing` (Task 3b's
    /// state-machine acceptance: single-flight now covers the whole
    /// lifecycle, not just `Recording`).
    ///
    /// Taking `handles` here (rather than a later `attach_handles` step)
    /// is what closes review finding F1: the moment `is_active`/
    /// `active_id` can observe the session, `request_stop`/
    /// `request_cancel`/`cancel_all_hold` can already reach its control
    /// channel and cancel flag — there is no handle-less window for a
    /// stop/cancel arriving during `commands::do_start`'s
    /// `spawn_blocking(capture.start)` (which now runs *after* this) to
    /// fall into.
    pub fn begin(&self, mode: Mode, handles: SessionHandles) -> Result<SessionId, PluginError> {
        let mut guard = self.active.lock().unwrap();
        if guard.is_some() {
            return Err(PluginError::AlreadyRecording);
        }
        let id = SessionId::new();
        *guard = Some(ActiveSession { id: id.clone(), mode, stage: Stage::Recording, handles });
        Ok(id)
    }

    /// Marks `id`'s session cancelled and performs the stage-appropriate
    /// immediate action, all under one lock acquisition -- no window
    /// between "check the stage" and "act on it" for the stage to change
    /// underneath the caller. Returns `false` if `id` isn't the active
    /// session. Shared by `commands::do_cancel` and `cancel_all_hold` so
    /// the two can't drift (review findings F1/F2).
    pub fn request_cancel(&self, id: &SessionId) -> bool {
        let mut guard = self.active.lock().unwrap();
        match guard.as_mut() {
            Some(active) if &active.id == id => {
                Self::trigger_cancel(active);
                true
            }
            _ => false,
        }
    }

    /// Sends `Stop` into `id`'s Recording-phase loop and returns a clone
    /// of its outcome receiver — `Some(rx)` whether the session is still
    /// `Recording` (the loop's `select!` observes the signal on its next
    /// poll) or already `Transcribing` (the loop has exited; the send is
    /// a harmless no-op into a channel nothing reads, and the caller
    /// still gets a valid receiver for whatever `finalize` is producing).
    /// This is what makes a second/late `stop()` "no-op, not error".
    /// Returns `None` only if `id` isn't the active session (the
    /// `UnknownSession` contract `commands::do_stop` maps it to).
    pub fn request_stop(&self, id: &SessionId) -> Option<watch::Receiver<Option<Outcome>>> {
        let mut guard = self.active.lock().unwrap();
        match guard.as_mut() {
            Some(active) if &active.id == id => {
                Self::trigger_stop(active);
                Some(active.handles.outcome_rx.clone())
            }
            _ => None,
        }
    }

    /// Cancels the active session only if it's `Mode::Hold` -- used by the
    /// Tauri hooks (`on_page_load`/webview-destroyed/app-exit, `lib.rs`'s
    /// `build()`) that guard against a dead/reloaded webview leaving a
    /// Hold session's mic open (`[R1-Safety S4]`, plan decision 5:
    /// "Tauri-hooks on_page_load/web-content-process-terminated ->
    /// cancel_all(Hold)"). Fire-and-forget: hook callbacks have no async
    /// context to await the outcome in -- the session's own pipeline task
    /// still runs finalize/cleanup to completion regardless. Toggle-mode
    /// sessions are untouched (plan: Toggle mode needs no lease -- same
    /// reasoning extends to this hook).
    pub fn cancel_all_hold(&self) {
        let mut guard = self.active.lock().unwrap();
        if let Some(active) = guard.as_mut() {
            if active.mode == Mode::Hold {
                Self::trigger_cancel(active);
            }
        }
    }

    /// Sets `SessionHandles::cancelled` unconditionally (TOCTOU fix --
    /// see that field's doc comment), then does the immediate
    /// best-effort part for whichever stage the session is in right now:
    /// signal the Recording-phase loop, or abort the in-flight
    /// transcription task directly. Both `pipeline::decide` and
    /// `run_transcription` independently re-check the flag at their own
    /// decision points, so a signal/abort that misses its window here
    /// (the loop already finalized on its own tick; the abort handle
    /// isn't stored yet) still can't result in a real transcription
    /// being reported for a cancelled session.
    fn trigger_cancel(active: &mut ActiveSession) {
        let handles = &active.handles;
        handles.cancelled.store(true, Ordering::SeqCst);
        match active.stage {
            Stage::Recording => {
                let _ = handles.control_tx.send(ControlSignal::Cancel);
            }
            Stage::Transcribing => {
                if let Some(handle) = handles.transcribe_abort.lock().unwrap().take() {
                    handle.abort();
                }
            }
        }
    }

    /// Sends `Stop` into the Recording-phase control channel (a harmless
    /// no-op if the loop already moved on into `Transcribing`, see
    /// `ControlSignal`'s doc).
    fn trigger_stop(active: &mut ActiveSession) {
        let _ = active.handles.control_tx.send(ControlSignal::Stop);
    }

    /// Moves `id` from `Recording` to `Transcribing` — called by
    /// `pipeline::finalize` right before it decides to actually call the
    /// transcription client.
    pub fn mark_transcribing(&self, id: &SessionId) {
        let mut guard = self.active.lock().unwrap();
        if let Some(active) = guard.as_mut() {
            if &active.id == id {
                active.stage = Stage::Transcribing;
            }
        }
    }

    /// True if `id` is the currently active session, in any stage.
    pub fn is_active(&self, id: &SessionId) -> bool {
        self.active.lock().unwrap().as_ref().is_some_and(|active| &active.id == id)
    }

    pub fn has_active(&self) -> bool {
        self.active.lock().unwrap().is_some()
    }

    /// The currently active session's id, if any -- `[ADO-9a]`: the Live
    /// Activity Lock Screen/Dynamic Island Stop button has no session id
    /// of its own to call `request_stop`/`request_cancel` with (unlike
    /// every other caller of those two methods, which already holds an id
    /// handed back by `start()`); single-flight (at most one
    /// `ActiveSession` ever, this struct's own top-level doc comment)
    /// makes "the active session" unambiguous, so this is a plain,
    /// read-only mirror of `has_active()`/`is_active(id)` with no new
    /// invariant to maintain.
    pub fn active_id(&self) -> Option<SessionId> {
        self.active.lock().unwrap().as_ref().map(|active| active.id.clone())
    }

    /// Plugin-wide `state()` (Idle/Recording/Transcribing) — there is at
    /// most one session, so its stage (or the absence of one) IS the
    /// plugin's state.
    pub fn state(&self) -> State {
        match self.active.lock().unwrap().as_ref().map(|a| a.stage) {
            None => State::Idle,
            Some(Stage::Recording) => State::Recording,
            Some(Stage::Transcribing) => State::Transcribing,
        }
    }

    pub fn stage_of(&self, id: &SessionId) -> Option<Stage> {
        self.active.lock().unwrap().as_ref().filter(|a| &a.id == id).map(|a| a.stage)
    }

    /// Frees the active slot's bookkeeping for `id` (does NOT touch any
    /// file — the `RecFile` lives inside the pipeline task now, dropped
    /// there). Called exactly once per session, by `pipeline::finish` at
    /// the very end of its work, whatever the outcome.
    pub fn end(&self, id: &SessionId) -> Result<(), PluginError> {
        let mut guard = self.active.lock().unwrap();
        match guard.as_ref() {
            Some(active) if &active.id == id => {
                guard.take();
                Ok(())
            }
            _ => Err(PluginError::UnknownSession { session_id: id.to_string() }),
        }
    }

    /// The shared abort-handle cell for `id`'s (possibly not-yet-started)
    /// transcription task — `do_cancel` uses this to abort directly when
    /// `id` is already `Transcribing`. `None` when `id` isn't the active
    /// session; `do_cancel`'s caller already treats "no abort cell yet"
    /// (the handle not stored until the HTTP task is spawned) as just
    /// another shape of "nothing to abort yet", not an error.
    pub fn transcribe_abort_cell(&self, id: &SessionId) -> Option<Arc<StdMutex<Option<AbortHandle>>>> {
        self.active.lock().unwrap().as_ref().filter(|a| &a.id == id).map(|a| a.handles.transcribe_abort.clone())
    }

    /// `id`'s lease tracker, if it has one (`Mode::Hold` only). `None`
    /// for Toggle sessions (no lease) and for an unknown `id`.
    pub fn lease_tracker(&self, id: &SessionId) -> Option<Arc<StdMutex<LeaseTracker>>> {
        self.active.lock().unwrap().as_ref().filter(|a| &a.id == id).and_then(|a| a.handles.lease.clone())
    }

    /// A clone of `id`'s outcome receiver without sending any signal
    /// (used by `do_cancel`'s `Transcribing` branch, which aborts the
    /// HTTP future directly rather than sending `Stop`). Returns `None`
    /// when `id` isn't the active session (e.g. it finalised between
    /// `request_cancel` and this call) — `do_cancel` treats that as
    /// "already done, nothing left to await".
    pub fn outcome_receiver(&self, id: &SessionId) -> Option<watch::Receiver<Option<Outcome>>> {
        self.active.lock().unwrap().as_ref().filter(|a| &a.id == id).map(|a| a.handles.outcome_rx.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handles() -> (SessionHandles, watch::Sender<Option<Outcome>>) {
        let (control_tx, _control_rx) = watch::channel(ControlSignal::None);
        let (outcome_tx, outcome_rx) = watch::channel(None);
        (
            SessionHandles {
                control_tx,
                outcome_rx,
                transcribe_abort: Arc::new(StdMutex::new(None)),
                lease: None,
                cancelled: Arc::new(AtomicBool::new(false)),
            },
            outcome_tx,
        )
    }

    #[test]
    fn begin_claims_the_slot_in_recording_stage() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold, handles().0).unwrap();
        assert!(guard.is_active(&id));
        assert!(guard.has_active());
        assert_eq!(guard.stage_of(&id), Some(Stage::Recording));
        assert_eq!(guard.state(), State::Recording);
    }

    #[test]
    fn active_id_mirrors_has_active() {
        let guard = SessionGuard::new();
        assert_eq!(guard.active_id(), None);

        let id = guard.begin(Mode::Hold, handles().0).unwrap();
        assert_eq!(guard.active_id(), Some(id.clone()));

        guard.end(&id).unwrap();
        assert_eq!(guard.active_id(), None);
    }

    #[test]
    fn second_begin_while_active_is_already_recording_even_during_transcribing() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold, handles().0).unwrap();
        guard.mark_transcribing(&id);

        let second = guard.begin(Mode::Toggle, handles().0);

        assert!(matches!(second, Err(PluginError::AlreadyRecording)), "single-flight must cover Transcribing too");
    }

    #[test]
    fn mark_transcribing_updates_stage_and_plugin_state() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold, handles().0).unwrap();
        guard.mark_transcribing(&id);
        assert_eq!(guard.stage_of(&id), Some(Stage::Transcribing));
        assert_eq!(guard.state(), State::Transcribing);
    }

    #[test]
    fn end_frees_the_slot() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold, handles().0).unwrap();
        guard.end(&id).unwrap();
        assert!(!guard.has_active());
        assert_eq!(guard.state(), State::Idle);
    }

    #[test]
    fn end_with_wrong_id_is_unknown_session_and_does_not_free_the_slot() {
        let guard = SessionGuard::new();
        let real_id = guard.begin(Mode::Hold, handles().0).unwrap();
        let result = guard.end(&SessionId::new());
        assert!(matches!(result, Err(PluginError::UnknownSession { .. })));
        assert!(guard.is_active(&real_id));
    }

    #[test]
    fn request_stop_reaches_the_control_channel_and_returns_the_outcome_receiver() {
        let guard = SessionGuard::new();
        let (session_handles, _outcome_tx) = handles();
        let mut control_rx = session_handles.control_tx.subscribe();
        let id = guard.begin(Mode::Hold, session_handles).unwrap();

        let _rx = guard.request_stop(&id).unwrap();

        assert!(control_rx.has_changed().unwrap());
        assert_eq!(*control_rx.borrow_and_update(), ControlSignal::Stop);
    }

    #[test]
    fn request_stop_on_unknown_id_returns_none() {
        let guard = SessionGuard::new();
        assert!(guard.request_stop(&SessionId::new()).is_none());
    }

    #[test]
    fn request_stop_after_the_recording_phase_moved_on_is_still_ok_not_error() {
        // Simulates a late/duplicate stop() call reaching a session
        // that's already Transcribing: request_stop must still return the
        // outcome receiver (the send into a channel nothing reads anymore
        // is a harmless no-op) instead of an error — "stop during
        // Transcribing = no-op".
        let guard = SessionGuard::new();
        let (session_handles, outcome_tx) = handles();
        let id = guard.begin(Mode::Hold, session_handles).unwrap();
        guard.mark_transcribing(&id);
        outcome_tx.send(Some(Ok(DictationResult {
            session_id: id.clone(),
            text: "hi".into(),
            language: None,
            duration_ms: 10,
            guard_outcome: crate::models::GuardOutcome::Finalized,
        }))).unwrap();

        let mut rx = guard.request_stop(&id).unwrap();
        assert_eq!(rx.borrow_and_update().as_ref().unwrap().as_ref().unwrap().text, "hi");
    }

    #[test]
    fn request_cancel_sets_the_flag_and_signals_the_recording_phase() {
        let guard = SessionGuard::new();
        let (session_handles, _outcome_tx) = handles();
        let mut control_rx = session_handles.control_tx.subscribe();
        let cancelled = session_handles.cancelled.clone();
        let id = guard.begin(Mode::Hold, session_handles).unwrap();

        assert!(guard.request_cancel(&id));

        assert!(cancelled.load(Ordering::SeqCst));
        assert_eq!(*control_rx.borrow_and_update(), ControlSignal::Cancel);
    }

    #[test]
    fn request_cancel_on_unknown_id_returns_false() {
        let guard = SessionGuard::new();
        assert!(!guard.request_cancel(&SessionId::new()));
    }

    #[test]
    fn cancel_all_hold_ignores_toggle_sessions() {
        let guard = SessionGuard::new();
        let (session_handles, _outcome_tx) = handles();
        let cancelled = session_handles.cancelled.clone();
        guard.begin(Mode::Toggle, session_handles).unwrap();

        guard.cancel_all_hold();

        assert!(!cancelled.load(Ordering::SeqCst), "Toggle-mode sessions must be untouched by cancel_all_hold");
    }

    #[test]
    fn cancel_all_hold_cancels_a_hold_session() {
        let guard = SessionGuard::new();
        let (session_handles, _outcome_tx) = handles();
        let mut control_rx = session_handles.control_tx.subscribe();
        let cancelled = session_handles.cancelled.clone();
        guard.begin(Mode::Hold, session_handles).unwrap();

        guard.cancel_all_hold();

        assert!(cancelled.load(Ordering::SeqCst));
        assert_eq!(*control_rx.borrow_and_update(), ControlSignal::Cancel);
    }

    #[test]
    fn request_cancel_while_transcribing_aborts_directly_instead_of_signalling() {
        let guard = SessionGuard::new();
        let (session_handles, _outcome_tx) = handles();
        let mut control_rx = session_handles.control_tx.subscribe();
        control_rx.borrow_and_update(); // clear the initial "changed" from channel creation
        let id = guard.begin(Mode::Hold, session_handles).unwrap();
        guard.mark_transcribing(&id);

        assert!(guard.request_cancel(&id));

        assert!(!control_rx.has_changed().unwrap_or(false), "Transcribing must abort directly, not go through the control signal");
    }

    #[test]
    fn lease_tracker_absent_for_toggle_mode() {
        let guard = SessionGuard::new();
        let (session_handles, _tx) = handles();
        let id = guard.begin(Mode::Toggle, session_handles).unwrap();
        assert!(guard.lease_tracker(&id).is_none());
    }
}
