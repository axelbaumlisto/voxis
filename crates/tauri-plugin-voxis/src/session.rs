//! Single-flight session guard + the per-session state machine
//! (`Idle` -> `Recording` -> `Transcribing` -> `Idle`, Task 3b).
//!
//! Task 3's stub owned the session's `RecFile` directly and dropped
//! (deleted) it the moment `stop`/`cancel` was called \u2014 fine when
//! `stop()` did no real work between "the recorder finished" and "the
//! session is over". Task 3b's `pipeline.rs` needs the WAV file to still
//! exist for the (possibly long-running, abortable) transcription HTTP
//! call, so the `RecFile` now moves into the spawned pipeline task
//! itself (`pipeline::spawn`) instead of living here \u2014 this module only
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
/// already moved on is a harmless no-op (see `SessionGuard::signal`'s
/// doc \u2014 this is exactly what makes a second `stop()` call during
/// `Transcribing` safe instead of an error).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlSignal {
    None,
    Stop,
    Cancel,
}

pub type Outcome = Result<DictationResult, PluginError>;

/// Everything a caller outside the spawned pipeline task needs to reach
/// into it. Constructed by `pipeline::spawn` and attached to the
/// session's bookkeeping (`SessionGuard::attach_handles`) right after
/// `begin()` reserves the slot \u2014 see that function's doc for why there
/// is no race between "session exists" and "handles attached".
pub struct SessionHandles {
    pub control_tx: watch::Sender<ControlSignal>,
    pub outcome_rx: watch::Receiver<Option<Outcome>>,
    /// Set by `pipeline::finalize` right before it spawns the abortable
    /// HTTP transcription task, cleared once that task completes \u2014
    /// `do_cancel` reads this to abort the in-flight HTTP future directly
    /// when `cancel()` arrives during `Transcribing`
    /// (`[R2-Exec F4]`, "cancel during Transcribing").
    pub transcribe_abort: Arc<StdMutex<Option<AbortHandle>>>,
    /// `Some` only for `Mode::Hold` sessions (`lease.rs`: "Toggle mode
    /// has no lease").
    pub lease: Option<Arc<StdMutex<LeaseTracker>>>,
    /// Set unconditionally (regardless of stage) by `do_cancel`/
    /// `cancel_all_hold` *before* sending `ControlSignal::Cancel`/aborting
    /// the transcribe task — fixes a TOCTOU review finding (F2): a plain
    /// `signal()` send can land on a channel nobody is reading anymore if
    /// the Recording-phase loop already finalized on its own tick a
    /// moment earlier (silence/max-duration/liveness), and a plain
    /// `transcribe_abort` `take()` can be `None` if `cancel()` arrives
    /// before `finalize` has gotten as far as spawning the HTTP task.
    /// `pipeline::finalize`/`run_transcription` check this flag at their
    /// own decision points instead of relying solely on the signal/abort
    /// having actually landed in time.
    pub cancelled: Arc<AtomicBool>,
}

pub struct ActiveSession {
    pub id: SessionId,
    pub mode: Mode,
    pub stage: Stage,
    /// `None` between `SessionGuard::begin` returning an id and
    /// `attach_handles` being called for it. This window is NOT
    /// synchronous: `commands::do_start` now `.await`s
    /// `spawn_blocking(capture.start)` in between the two (`[ADO-8]`,
    /// moving a possibly-blocking capture backend call off the async
    /// worker thread), so another task (a concurrent `cancel()`, or
    /// `cancel_all_hold()` firing from a webview-destroyed/app-exit hook)
    /// CAN observe `handles == None` for `id` while it is still the
    /// active session (hardening-sweep review finding F1 \u2014 this doc
    /// comment used to claim the opposite). `pending` below is what
    /// makes that window safe \u2014 for both `Cancel` (F1) and `Stop`
    /// (F-NEW, since `SessionGuard::signal`/`commands::do_stop` had the
    /// exact same gap).
    pub handles: Option<SessionHandles>,
    /// The control signal to apply retroactively once `handles` exists,
    /// if `Cancel`/`Stop` arrives while it's still `None` (see that
    /// field's doc) \u2014 `attach_handles` checks this and immediately
    /// applies it the moment handles exist, instead of the request
    /// silently being a no-op.
    ///
    /// Originally a plain `cancel_requested: bool` (review finding F1:
    /// previously `trigger_cancel` just returned early when `handles`
    /// was `None`, so a `cancel()`/`cancel_all_hold()` landing in this
    /// window reported success but never actually cancelled anything
    /// \u2014 a real regression of `[R1-Safety S4]`, Hold-mode
    /// mic-safety-on-webview-death). Generalised to `Option<ControlSignal>`
    /// (review finding F-NEW) once `SessionGuard::signal`/`do_stop` was
    /// found to have exactly the same gap for `Stop`: an `.expect()`
    /// panic instead of silently no-op'ing, which is arguably worse
    /// (with the workspace's `panic = "abort"` release profile, a Live
    /// Activity Stop tapped in this window crashed the whole app). A
    /// pending `Cancel` is never downgraded back to a plain `Stop` by a
    /// later/duplicate `stop()` landing in the same window \u2014 see
    /// `trigger_stop`.
    pub pending: Option<ControlSignal>,
}

/// Holds at most one `ActiveSession` \u2014 single-flight across the whole
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
    /// `Recording`, no handles yet). Returns `AlreadyRecording` if one is
    /// already claimed \u2014 in ANY stage, `Recording` or `Transcribing`
    /// (Task 3b's state-machine acceptance: single-flight now covers the
    /// whole lifecycle, not just `Recording`).
    pub fn begin(&self, mode: Mode) -> Result<SessionId, PluginError> {
        let mut guard = self.active.lock().unwrap();
        if guard.is_some() {
            return Err(PluginError::AlreadyRecording);
        }
        let id = SessionId::new();
        *guard = Some(ActiveSession { id: id.clone(), mode, stage: Stage::Recording, handles: None, pending: None });
        Ok(id)
    }

    /// Attaches the handles `pipeline::spawn` produced for `id`. A no-op
    /// if `id` is no longer the active session (defensive only \u2014 see
    /// `ActiveSession::handles`'s doc: `do_start` can only reach this
    /// call for the same `id` it got from `begin()`, and single-flight
    /// means no other session can have claimed the slot in between).
    /// If a `cancel()`/`cancel_all_hold()`/`stop()` arrived while
    /// `handles` was still `None` (`pending`, review findings F1/F-NEW),
    /// applies it immediately \u2014 right here, before any caller can
    /// observe the newly attached handles as un-cancelled/un-stopped.
    pub fn attach_handles(&self, id: &SessionId, handles: SessionHandles) {
        let mut guard = self.active.lock().unwrap();
        if let Some(active) = guard.as_mut() {
            if &active.id == id {
                active.handles = Some(handles);
                match active.pending.take() {
                    Some(ControlSignal::Cancel) => Self::trigger_cancel(active),
                    Some(ControlSignal::Stop) => Self::trigger_stop(active),
                    Some(ControlSignal::None) | None => {}
                }
            }
        }
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

    /// `Stop` counterpart to `request_cancel` (review finding F-NEW):
    /// used by `commands::do_stop` instead of `signal()` so that a
    /// `stop()`/Live Activity Stop intent arriving while `id`'s handles
    /// are still `None` (`do_start`'s `spawn_blocking(capture.start)`
    /// window, `ActiveSession::handles`'s doc) is recorded (`pending`)
    /// and applied by `attach_handles`, instead of `signal()`'s old
    /// `.expect()` panicking there (which, under the workspace's
    /// `panic = "abort"` release profile, crashed the whole app).
    /// Returns `false` if `id` isn't the active session (same
    /// `UnknownSession` contract `signal()` had for that case).
    pub fn request_stop(&self, id: &SessionId) -> bool {
        let mut guard = self.active.lock().unwrap();
        match guard.as_mut() {
            Some(active) if &active.id == id => {
                Self::trigger_stop(active);
                true
            }
            _ => false,
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
    /// transcription task directly. Both `pipeline::finalize` and
    /// `run_transcription` independently re-check the flag at their own
    /// decision points, so a signal/abort that misses its window here
    /// (the loop already finalized on its own tick; the abort handle
    /// isn't stored yet) still can't result in a real transcription
    /// being reported for a cancelled session.
    ///
    /// If `active.handles` is still `None` (review finding F1 \u2014 the
    /// `do_start`/`spawn_blocking(capture.start)` window,
    /// `ActiveSession::handles`'s doc), there is nothing to signal/abort
    /// yet: sets `pending = Some(Cancel)` instead (unconditionally \u2014
    /// `Cancel` always wins over an already-pending `Stop`, see
    /// `pending`'s doc), so `attach_handles` applies the cancellation
    /// retroactively the moment handles exist, rather than the request
    /// silently vanishing.
    fn trigger_cancel(active: &mut ActiveSession) {
        let Some(handles) = active.handles.as_ref() else {
            active.pending = Some(ControlSignal::Cancel);
            return;
        };
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

    /// `Stop` counterpart to `trigger_cancel` (review finding F-NEW):
    /// sends `Stop` into the Recording-phase control channel if handles
    /// are already attached (a harmless no-op if the loop already moved
    /// on into `Transcribing`, exactly like `signal()`'s own doc), or, if
    /// `active.handles` is still `None`, records the intent as `pending`
    /// so `attach_handles` applies it retroactively instead of this
    /// request silently vanishing or (pre-fix) panicking `signal()`'s
    /// `.expect()`. Deliberately does NOT overwrite an already-pending
    /// `Cancel`: a later/duplicate `stop()` landing in this same window
    /// must not downgrade an already-requested cancellation back into
    /// "finalize and transcribe normally".
    fn trigger_stop(active: &mut ActiveSession) {
        let Some(handles) = active.handles.as_ref() else {
            if active.pending != Some(ControlSignal::Cancel) {
                active.pending = Some(ControlSignal::Stop);
            }
            return;
        };
        let _ = handles.control_tx.send(ControlSignal::Stop);
    }

    /// Moves `id` from `Recording` to `Transcribing` \u2014 called by
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
    /// of its own to call `signal`/`request_cancel` with (unlike every
    /// other caller of those two methods, which already holds an id
    /// handed back by `start()`); single-flight (at most one
    /// `ActiveSession` ever, this struct's own top-level doc comment)
    /// makes "the active session" unambiguous, so this is a plain,
    /// read-only mirror of `has_active()`/`is_active(id)` with no new
    /// invariant to maintain.
    pub fn active_id(&self) -> Option<SessionId> {
        self.active.lock().unwrap().as_ref().map(|active| active.id.clone())
    }

    /// Plugin-wide `state()` (Idle/Recording/Transcribing) \u2014 there is at
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
    /// file \u2014 the `RecFile` lives inside the pipeline task now, dropped
    /// there). Called exactly once per session, by `pipeline::finalize`
    /// at the very end of its work, whatever the outcome.
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

    /// Sends `signal` to `id`'s Recording-phase loop and returns a clone
    /// of its outcome receiver \u2014 works whether the session is still
    /// `Recording` (the loop's `select!` observes the signal on its next
    /// poll) or already `Transcribing` (the loop has already exited; the
    /// send is a harmless no-op into a channel nothing is reading
    /// anymore, and the caller still gets a valid receiver for whatever
    /// `finalize` is already in the middle of producing) \u2014 this is what
    /// makes a second/late `stop()` call "no-op, not error" instead of
    /// needing a special case.
    ///
    /// A third case exists in principle \u2014 `handles` still `None`
    /// (`ActiveSession::handles`'s doc: `do_start`'s
    /// `spawn_blocking(capture.start)` window) \u2014 which this function's
    /// `.expect()` cannot handle without a receiver to hand back (there
    /// is no pipeline task/outcome channel yet). That case used to be
    /// reachable through `commands::do_stop`, which panicked here on a
    /// real (if narrow) production timing window \u2014 with the workspace's
    /// `panic = "abort"` release profile, a crash (hardening-sweep review
    /// finding F-NEW). Fixed not by changing this function (its
    /// `Result<watch::Receiver<..>, _>` signature is also relied on by
    /// `pipeline.rs`'s own tests, always called after `attach_handles`)
    /// but by giving `do_stop` a `signal()`-free path for that window:
    /// `request_stop`/`outcome_receiver`, mirroring `do_cancel`/
    /// `request_cancel`. `signal()` itself is therefore only ever called
    /// once `handles` is known `Some` \u2014 the `.expect()`'s premise holds
    /// for every remaining caller, it just no longer includes `do_stop`.
    pub fn signal(&self, id: &SessionId, signal: ControlSignal) -> Result<watch::Receiver<Option<Outcome>>, PluginError> {
        let guard = self.active.lock().unwrap();
        match guard.as_ref() {
            Some(active) if &active.id == id => {
                let handles = active.handles.as_ref().expect(
                    "handles are attached before do_start returns the session id to any caller \
                     that could reach signal() for it -- do_stop no longer calls signal() until \
                     it has confirmed handles are attached, see this function's doc",
                );
                let _ = handles.control_tx.send(signal);
                Ok(handles.outcome_rx.clone())
            }
            _ => Err(PluginError::UnknownSession { session_id: id.to_string() }),
        }
    }

    /// The shared abort-handle cell for `id`'s (possibly not-yet-started)
    /// transcription task \u2014 `do_cancel` uses this to abort directly when
    /// `id` is already `Transcribing`. Degrades to `None` (rather than
    /// `signal()`'s `.expect()`-panic pre-F-NEW-fix approach) when
    /// `handles` is still `None` \u2014 intentionally lenient, unlike
    /// `signal()`: `do_cancel`'s own caller already treats "no abort cell
    /// yet" as just another shape of "nothing to abort yet", not an error.
    pub fn transcribe_abort_cell(&self, id: &SessionId) -> Option<Arc<StdMutex<Option<AbortHandle>>>> {
        self.active
            .lock()
            .unwrap()
            .as_ref()
            .filter(|a| &a.id == id)
            .and_then(|a| a.handles.as_ref())
            .map(|h| h.transcribe_abort.clone())
    }

    /// `id`'s lease tracker, if it has one (`Mode::Hold` only). Degrades
    /// to `None` when `handles` is still `None`, same intentional
    /// leniency as `transcribe_abort_cell` above (`do_hold_lease` already
    /// treats "no tracker" as a no-op, not an error).
    pub fn lease_tracker(&self, id: &SessionId) -> Option<Arc<StdMutex<LeaseTracker>>> {
        self.active.lock().unwrap().as_ref().filter(|a| &a.id == id).and_then(|a| a.handles.as_ref()).and_then(|h| h.lease.clone())
    }

    /// A clone of `id`'s outcome receiver without sending any signal
    /// (used by `do_cancel`'s `Transcribing` branch, which aborts the
    /// HTTP future directly rather than going through `signal`; also
    /// used by `do_stop`, alongside `request_stop`, review finding
    /// F-NEW). Returns `None` both when `id` isn't the active session
    /// and when it is but `handles` isn't attached yet \u2014 callers that
    /// need to tell those two apart check `is_active`/`has_active`
    /// separately (`do_stop` does, to know whether to keep polling for
    /// handles to attach or give up because the session is simply gone).
    pub fn outcome_receiver(&self, id: &SessionId) -> Option<watch::Receiver<Option<Outcome>>> {
        self.active.lock().unwrap().as_ref().filter(|a| &a.id == id).and_then(|a| a.handles.as_ref()).map(|h| h.outcome_rx.clone())
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
        let id = guard.begin(Mode::Hold).unwrap();
        assert!(guard.is_active(&id));
        assert!(guard.has_active());
        assert_eq!(guard.stage_of(&id), Some(Stage::Recording));
        assert_eq!(guard.state(), State::Recording);
    }

    #[test]
    fn active_id_mirrors_has_active() {
        let guard = SessionGuard::new();
        assert_eq!(guard.active_id(), None);

        let id = guard.begin(Mode::Hold).unwrap();
        assert_eq!(guard.active_id(), Some(id.clone()));

        guard.end(&id).unwrap();
        assert_eq!(guard.active_id(), None);
    }

    #[test]
    fn second_begin_while_active_is_already_recording_even_during_transcribing() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold).unwrap();
        guard.mark_transcribing(&id);

        let second = guard.begin(Mode::Toggle);

        assert!(matches!(second, Err(PluginError::AlreadyRecording)), "single-flight must cover Transcribing too");
    }

    #[test]
    fn mark_transcribing_updates_stage_and_plugin_state() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold).unwrap();
        guard.mark_transcribing(&id);
        assert_eq!(guard.stage_of(&id), Some(Stage::Transcribing));
        assert_eq!(guard.state(), State::Transcribing);
    }

    #[test]
    fn end_frees_the_slot() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold).unwrap();
        guard.end(&id).unwrap();
        assert!(!guard.has_active());
        assert_eq!(guard.state(), State::Idle);
    }

    #[test]
    fn end_with_wrong_id_is_unknown_session_and_does_not_free_the_slot() {
        let guard = SessionGuard::new();
        let real_id = guard.begin(Mode::Hold).unwrap();
        let result = guard.end(&SessionId::new());
        assert!(matches!(result, Err(PluginError::UnknownSession { .. })));
        assert!(guard.is_active(&real_id));
    }

    #[test]
    fn signal_reaches_the_control_channel_and_returns_the_outcome_receiver() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold).unwrap();
        let (session_handles, _outcome_tx) = handles();
        let mut control_rx = session_handles.control_tx.subscribe();
        guard.attach_handles(&id, session_handles);

        let _rx = guard.signal(&id, ControlSignal::Stop).unwrap();

        assert!(control_rx.has_changed().unwrap());
        assert_eq!(*control_rx.borrow_and_update(), ControlSignal::Stop);
    }

    #[test]
    fn signal_on_unknown_id_is_an_error() {
        let guard = SessionGuard::new();
        let result = guard.signal(&SessionId::new(), ControlSignal::Stop);
        assert!(matches!(result, Err(PluginError::UnknownSession { .. })));
    }

    #[test]
    fn signal_after_the_recording_phase_moved_on_is_still_ok_not_error() {
        // Simulates a late/duplicate stop() call reaching a session
        // that's already Transcribing: signal() must still succeed (the
        // send into a channel nothing reads anymore is a harmless no-op)
        // instead of erroring \u2014 "stop during Transcribing = no-op".
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold).unwrap();
        let (session_handles, outcome_tx) = handles();
        guard.attach_handles(&id, session_handles);
        guard.mark_transcribing(&id);
        outcome_tx.send(Some(Ok(DictationResult {
            session_id: id.clone(),
            text: "hi".into(),
            language: None,
            duration_ms: 10,
            guard_outcome: crate::models::GuardOutcome::Finalized,
        }))).unwrap();

        let mut rx = guard.signal(&id, ControlSignal::Stop).unwrap();
        assert_eq!(rx.borrow_and_update().as_ref().unwrap().as_ref().unwrap().text, "hi");
    }

    #[test]
    fn request_cancel_sets_the_flag_and_signals_the_recording_phase() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold).unwrap();
        let (session_handles, _outcome_tx) = handles();
        let mut control_rx = session_handles.control_tx.subscribe();
        let cancelled = session_handles.cancelled.clone();
        guard.attach_handles(&id, session_handles);

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
        let id = guard.begin(Mode::Toggle).unwrap();
        let (session_handles, _outcome_tx) = handles();
        let cancelled = session_handles.cancelled.clone();
        guard.attach_handles(&id, session_handles);

        guard.cancel_all_hold();

        assert!(!cancelled.load(Ordering::SeqCst), "Toggle-mode sessions must be untouched by cancel_all_hold");
    }

    #[test]
    fn cancel_all_hold_cancels_a_hold_session() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold).unwrap();
        let (session_handles, _outcome_tx) = handles();
        let mut control_rx = session_handles.control_tx.subscribe();
        let cancelled = session_handles.cancelled.clone();
        guard.attach_handles(&id, session_handles);

        guard.cancel_all_hold();

        assert!(cancelled.load(Ordering::SeqCst));
        assert_eq!(*control_rx.borrow_and_update(), ControlSignal::Cancel);
    }

    #[test]
    fn request_cancel_while_transcribing_aborts_directly_instead_of_signalling() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Hold).unwrap();
        let (session_handles, _outcome_tx) = handles();
        let mut control_rx = session_handles.control_tx.subscribe();
        control_rx.borrow_and_update(); // clear the initial "changed" from channel creation
        guard.attach_handles(&id, session_handles);
        guard.mark_transcribing(&id);

        assert!(guard.request_cancel(&id));

        assert!(!control_rx.has_changed().unwrap_or(false), "Transcribing must abort directly, not go through the control signal");
    }

    #[test]
    fn lease_tracker_absent_for_toggle_mode() {
        let guard = SessionGuard::new();
        let id = guard.begin(Mode::Toggle).unwrap();
        let (session_handles, _tx) = handles();
        guard.attach_handles(&id, session_handles);
        assert!(guard.lease_tracker(&id).is_none());
    }
}
