//! Press/release ordering state machine (plan §3 Layer 0(a)).
//!
//! Root cause (plan §1.1): `on_hotkey_pressed` can block for 0.3-5.4s in a
//! synchronous microphone permission check (and, more generally, anywhere
//! between "the debounce hold-timer resolved" and "the coordinator's stage
//! actually became `Recording`"). Press and release are independently
//! spawned tasks, so a release arriving during that window used to be
//! silently dropped by the stage guard in `on_hotkey_released`
//! (`stage != Recording` → no-op) — the recorder then started anyway, with
//! no future event left to stop it (until the *next* press's release
//! caught it, sometimes hours later).
//!
//! This module is the single source of truth for that ordering — plan §9:
//! "the machine is the single source of truth for ordering, no duplicated
//! ordering logic in the drivers". `RecordingCoordinator::on_hotkey_pressed`
//! / `on_hotkey_released` (in `recording.rs`) are thin drivers: they feed
//! this machine events at named checkpoints and act on the actions it
//! returns; none of them re-derive the ordering decision themselves.
//!
//! # State
//!
//! - `in_flight: Option<(u64, CancellationToken)>` — the id of the one press
//!   currently between admission (`press_enter`) and either aborting or
//!   reaching `Stage::Recording`, plus a token the *same* press is (or
//!   will be) sleeping on during its debounce hold-timer. At most one
//!   press is ever in flight — a second `press_enter` call while one is
//!   outstanding is refused (`IgnorePress`), which is this module's
//!   single-flight-start guarantee (plan §1.4 "нет single-flight старта";
//!   plan §4 test 9). The token exists purely to let `release_arrived`
//!   wake a sleeping press early (T4a r1 review finding 1) — it carries no
//!   ordering decision of its own; the checkpoint the woken press falls
//!   through to (`post_debounce`) is unchanged and remains the single
//!   decision point.
//! - `release_pending: bool` — a release arrived while a press was in
//!   flight and hasn't been consumed by that press's next checkpoint yet.
//!
//! **Invariant**: `release_pending` can only be `true` while `in_flight` is
//! `Some` (enforced by `release_arrived` only setting it in that branch,
//! and every terminal checkpoint clearing both fields together). This is
//! what makes a *stale* `release_pending` from one press cycle provably
//! unable to poison a later, unrelated press: by the time `in_flight`
//! becomes `None` again, `release_pending` is already `false` too (see
//! `test_invariant_release_pending_implies_in_flight_across_full_lifecycle`).
//!
//! # Disclosed deviations from the plan's literal sketch
//!
//! 1. **One `std::sync::Mutex<PressReleaseMachine>`, not two separate
//!    primitives** (`Arc<Mutex<Option<u64>>>` + `AtomicBool`) as the plan's
//!    §3 Layer 0(a) bullet literally lists them. Both pieces of state are
//!    read-then-written together at every checkpoint; one lock makes the
//!    "Dekker order" the plan calls for trivially atomic (one critical
//!    section) instead of relying on getting two independent atomics'
//!    acquire/release orderings exactly right, and gives the ordering
//!    logic exactly one place to live (the stated goal of plan §9). A
//!    plain `std::sync::Mutex` (not `tokio::sync::Mutex`) is used
//!    deliberately: no method here ever awaits while holding the lock, so
//!    there is no reason to pay for the async-aware variant, and it lets
//!    `PressExitGuard`'s `Drop` clean up synchronously (see below).
//!
//! 2. **Admission (`press_enter`) happens at the very top of
//!    `on_hotkey_pressed`, before the debounce sleep** — not "right after
//!    the debounce block" as the plan's §3 Layer 0(a) bullet says. Reason:
//!    placing admission after the debounce block reopens exactly the
//!    "micro-window" the plan's own checkpoint (i) is trying to close —
//!    between the debounce sleep resolving and the (now-eliminated, see
//!    deviation 3) `pending_press` slot being cleared, a release could
//!    still slip through unseen. Admitting immediately (no `.await` runs
//!    between the `press_action` match and `press_enter()`, so there is no
//!    scheduler-preemptable gap for a same-cycle release to land in)
//!    closes that window structurally instead of by careful sequencing.
//!
//! 3. **`pending_press` (the old debounce-phase cancellation-token slot) is
//!    eliminated, folded into this machine.** It covered only the
//!    "sleeping in the hold-timer" sub-window, leaving a seam with the new
//!    `in_flight`/`release_pending` pair covering the *next* sub-window
//!    (post-debounce through `Stage::Recording`) — two overlapping
//!    ordering mechanisms with a gap between them is itself "duplicated
//!    ordering logic" (plan §9). The old instant-wake behaviour is
//!    preserved, not lost: `press_enter` hands the caller a
//!    `CancellationToken` (returned inside `PressEnterAction::Proceed`),
//!    and `release_arrived` cancels that SAME token (in addition to
//!    setting `release_pending`) when it finds a press in flight. The
//!    driver races this token against its debounce sleep
//!    (`select! { sleep(hold_ms), token.cancelled() }`) and falls through
//!    to the *same*, unchanged `post_debounce` checkpoint either way —
//!    the token is only a wake-up, never a second decision point.
//!    (T4a r1 review finding 1: an earlier revision of this module used a
//!    plain, uncancellable `sleep`, which left `in_flight` occupied for up
//!    to the full `hold_ms` after a release, silently dropping a
//!    legitimate follow-on press admitted in that window —
//!    `hotkey/mod.rs`'s press/release alternation filter guarantees such a
//!    follow-on press always means the first press's key was already
//!    released, never a real single-flight conflict. See
//!    `test_release_during_debounce_wakes_press_and_frees_slot_for_next_press`.)
//!
//! 4. **`release_arrived` only arms `release_pending` (and cancels the
//!    wake token) when `in_flight` is `Some`** (conditional set), not
//!    unconditionally as the plan's bullet literally reads
//!    ("`release_pending.store(true)` до проверки stage"). An
//!    unconditional store, combined with `press_enter` never resetting it
//!    (needed so a press racing its *own* matching release isn't wiped by
//!    admission — see deviation 2), would leave `release_pending=true`
//!    dangling after every *normal* release of a fully-started recording
//!    (`in_flight` is already `None` there, `post_stage_recording` already
//!    cleared it) — poisoning the *next* press's first checkpoint (every
//!    second recording would silently fail to start). The conditional
//!    version preserves the invariant above and is the only correct
//!    choice given press and release run as independent tasks (T4a r1
//!    review, D4 ruling) — **do not change this arm to unconditional.**
//!
//!    The residual (unclosed) race this leaves is a release that arrives
//!    and is fully processed (`release_arrived` sees `in_flight == None`
//!    → `ProceedRelease` → `stop_recording` → `Skip`, since
//!    `coordinator.on_press()` hasn't run yet) *before* the matching
//!    press's task ever reaches `press_enter()` — i.e. the press task is
//!    starved for the entire hold/tap duration (≥`hotkey_hold_ms` for the
//!    keyboard path) while the release task runs to completion. This is
//!    the actual size of the window (corrected from an earlier, inaccurate
//!    claim of "a few CPU instructions": `press_enter()` is called after a
//!    stage read and a synchronous SQLite config load, so the true
//!    pre-admission window is on the order of the scheduler's fairness
//!    plus that load, not zero) — still orders of magnitude narrower than
//!    the observed bug (a 0.3-5.4s permission check) and not a pattern
//!    seen in any of the ~121 historical incidents analysed for the plan.
//!    Structurally closing it requires in-order delivery between the
//!    independent press/release tasks (e.g. a single ordered event channel
//!    or per-event sequence numbers) — carried forward past this step.
//!    See `test_release_with_no_press_in_flight_is_proceed_release` for
//!    why the conditional arm, not this residual, is the load-bearing
//!    correctness property here.

use std::sync::{Arc, Mutex, MutexGuard};
use tokio_util::sync::CancellationToken;

/// Local copy of `crate::audio::sync::lock_or_recover` — that module is
/// private to `audio` (`mod sync;`, not `pub(crate)`), and widening its
/// visibility is outside this step's file scope. Same one-line poisoning
/// recovery, KISS: not worth a cross-module visibility change for one
/// helper (`audio/recorder.rs` has its own analogous local need already).
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Outcome of `PressReleaseMachine::press_enter`. Not `PartialEq`/`Eq`:
/// `CancellationToken` doesn't implement them; tests match on the variant
/// instead of comparing whole values.
#[derive(Debug, Clone)]
pub(crate) enum PressEnterAction {
    /// Admitted. Carries the id to pass to every later checkpoint for
    /// this press (also usable as a `PressExitGuard`'s key), plus a
    /// `CancellationToken` the caller should race against its debounce
    /// sleep (`select! { sleep(hold_ms), token.cancelled() }`) —
    /// `release_arrived` cancels this same token if a release arrives
    /// while this press is in flight, waking the sleep early (T4a r1
    /// review finding 1). The token is only a wake-up: the caller falls
    /// through to the unchanged `post_debounce` checkpoint either way.
    Proceed(u64, CancellationToken),
    /// Another press is already in flight — plan §1.4 "нет single-flight
    /// старта" / plan §4 test 9 (six concurrent presses admit exactly
    /// one).
    IgnorePress,
}

/// Outcome of `PressReleaseMachine::release_arrived`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReleaseAction {
    /// A press is in flight; it will see `release_pending` at its own
    /// next checkpoint and stop itself. The caller (`on_hotkey_released`)
    /// must return without calling `stop_recording` — there's nothing
    /// stage-visible to stop yet.
    ArmReleasePending,
    /// No press is currently tracked as in flight — either nothing ever
    /// started, or the in-flight press already fully started (steady
    /// state `Recording`, `in_flight` already cleared by
    /// `post_stage_recording`). The caller should proceed to
    /// `stop_recording(StopReason::Release)` exactly as it would without
    /// this machine existing at all.
    ProceedRelease,
}

/// Outcome of `post_debounce` / `pre_start` — identical shape at both
/// checkpoints (see plan §3 Layer 0(a) checkpoints i/ii), kept as one
/// type rather than two near-duplicates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ContinueOrAbort {
    /// No release recorded yet — proceed toward `recorder.start()`.
    Continue,
    /// A release was recorded before this checkpoint. The caller must
    /// never call `recorder.start()` for this press: no beep, no
    /// `coordinator.on_press()`, just a silent return (plan §3 Layer
    /// 0(a): "перед `recorder.start()` → не стартовать (без beep, без
    /// on_press)").
    NeverStart,
}

/// Outcome of `post_stage_recording` (checkpoint iii).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PostStageAction {
    /// No race — this press's recording is genuinely underway; proceed
    /// to show the overlay / spawn the spectrum poller.
    ProceedNormally,
    /// A release arrived in the residual window between `recorder
    /// .start()` returning `Ok` and the coordinator's stage actually
    /// becoming `Recording`. The caller must immediately call
    /// `stop_recording(StopReason::ReleasePending)` instead of showing
    /// the overlay (plan §3 Layer 0(a) checkpoint iii).
    StopReleasePending,
}

/// Single source of truth for press/release ordering. See module docs for
/// the state, the invariant it maintains, and disclosed deviations from
/// the plan's literal two-primitive sketch.
#[derive(Debug, Default)]
pub(crate) struct PressReleaseMachine {
    next_id: u64,
    in_flight: Option<(u64, CancellationToken)>,
    release_pending: bool,
}

impl PressReleaseMachine {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Admit a new press cycle, or refuse if one is already in flight.
    pub(crate) fn press_enter(&mut self) -> PressEnterAction {
        if self.in_flight.is_some() {
            return PressEnterAction::IgnorePress;
        }
        self.next_id += 1;
        let id = self.next_id;
        let token = CancellationToken::new();
        self.in_flight = Some((id, token.clone()));
        // Defensive: the invariant (see module docs) already guarantees
        // this is false whenever `in_flight` was `None`, but stating it
        // explicitly costs nothing and guards against a future bug
        // elsewhere in this file silently breaking that invariant.
        self.release_pending = false;
        PressEnterAction::Proceed(id, token)
    }

    /// A release event arrived. Called unconditionally from
    /// `on_hotkey_released` (hold mode only — toggle mode never calls
    /// this at all, releases are meaningless there). Cancelling the
    /// in-flight press's token here (T4a r1 review finding 1) is what lets
    /// a press sleeping in its debounce hold-timer wake within µs of the
    /// matching release, instead of occupying `in_flight` for the rest of
    /// `hold_ms` and silently dropping a legitimate follow-on press.
    pub(crate) fn release_arrived(&mut self) -> ReleaseAction {
        if let Some((_, token)) = self.in_flight.as_ref() {
            self.release_pending = true;
            token.cancel();
            ReleaseAction::ArmReleasePending
        } else {
            ReleaseAction::ProceedRelease
        }
    }

    /// Shared implementation for checkpoints (i) and (ii) — both check
    /// `release_pending` and, if set, clear state and report
    /// `NeverStart`; the logic does not differ between them, only *when*
    /// each is called (T4a r1 review finding 3: kept as one body with two
    /// named, thin call sites below rather than two independent copies —
    /// the two names carry real documentation value about which
    /// checkpoint fired).
    fn checkpoint(&mut self, id: u64) -> ContinueOrAbort {
        if self.release_pending {
            self.clear(id);
            return ContinueOrAbort::NeverStart;
        }
        ContinueOrAbort::Continue
    }

    /// Checkpoint (i): right after the debounce sleep resolves (or
    /// immediately, for `skip_debounce`/`hotkey_hold_ms == 0`, since that
    /// path never sleeps at all) — plan §3 Layer 0(a).
    pub(crate) fn post_debounce(&mut self, id: u64) -> ContinueOrAbort {
        self.checkpoint(id)
    }

    /// Checkpoint (ii): immediately before `recorder.start()` (after the
    /// permission check) — plan §3 Layer 0(a), the checkpoint that closes
    /// the actual observed bug (a 0.3-5.4s synchronous permission probe).
    pub(crate) fn pre_start(&mut self, id: u64) -> ContinueOrAbort {
        self.checkpoint(id)
    }

    /// Checkpoint (iii): `await_stage(Stage::Recording)` succeeded — plan
    /// §3 Layer 0(a) residual-window check.
    pub(crate) fn post_stage_recording(&mut self, id: u64) -> PostStageAction {
        let pending = self.release_pending;
        self.clear(id);
        if pending {
            PostStageAction::StopReleasePending
        } else {
            PostStageAction::ProceedNormally
        }
    }

    /// `await_stage(Stage::Recording)` timed out: the coordinator's own
    /// internal 30ms press-debounce (`coordinator::DEBOUNCE`) can drop
    /// the `Press` command after `recorder.start()` already returned
    /// `Ok`, leaving `is_recording()==true` while the stage never became
    /// `Recording` (plan §1.4 / T3 r1 review carry-forward C1 — an
    /// "orphan" recorder). There is only one possible response
    /// (stop the orphaned recorder directly, bypassing `stop_decision`
    /// since `stage != Recording` would make it say `Skip`) so this just
    /// clears state; the driver performs the actual stop.
    pub(crate) fn stage_timeout(&mut self, id: u64) {
        self.clear(id);
    }

    /// Any other early return not covered by a named checkpoint above:
    /// permission denied, `recorder.start()` returned `Err` (including
    /// `StopInProgress`). Reset discipline (plan §3 Layer 0(a) step 6).
    pub(crate) fn early_return(&mut self, id: u64) {
        self.clear(id);
    }

    fn clear(&mut self, id: u64) {
        if matches!(self.in_flight.as_ref(), Some((in_id, _)) if *in_id == id) {
            self.in_flight = None;
        }
        self.release_pending = false;
    }
}

/// RAII guard ensuring `id`'s press cycle is cleared from the machine on
/// every exit path of `on_hotkey_pressed` after admission — mirrors
/// `AudioRecorder::StoppingGuard` (T2): a `Drop` impl is the only way to
/// guarantee a *future* early return added by someone who doesn't re-read
/// this whole function can't leak a stale `in_flight` (plan §3 Layer 0(a)
/// step 6: "use a small RAII guard struct... so no path is missed").
///
/// Explicit checkpoint calls (`post_debounce`, `pre_start`, ...) are the
/// normal path and additionally control *when* state clears relative to
/// other work in each branch; `Drop` is the safety net for anything they
/// don't cover, not a replacement for calling them.
pub(crate) struct PressExitGuard {
    machine: Arc<Mutex<PressReleaseMachine>>,
    id: u64,
    /// Set once an explicit checkpoint has already cleared this press,
    /// so `Drop` doesn't redundantly lock+match on the common (explicit
    /// exit) path. `PressReleaseMachine::clear` is id-checked and
    /// idempotent, so a missed reset here would only be a wasted lock
    /// round-trip, never incorrect.
    cleared: bool,
}

impl PressExitGuard {
    pub(crate) fn new(machine: Arc<Mutex<PressReleaseMachine>>, id: u64) -> Self {
        Self {
            machine,
            id,
            cleared: false,
        }
    }

    pub(crate) fn post_debounce(&mut self) -> ContinueOrAbort {
        let action = lock_or_recover(&self.machine).post_debounce(self.id);
        if matches!(action, ContinueOrAbort::NeverStart) {
            self.cleared = true;
        }
        action
    }

    pub(crate) fn pre_start(&mut self) -> ContinueOrAbort {
        let action = lock_or_recover(&self.machine).pre_start(self.id);
        if matches!(action, ContinueOrAbort::NeverStart) {
            self.cleared = true;
        }
        action
    }

    pub(crate) fn post_stage_recording(&mut self) -> PostStageAction {
        self.cleared = true;
        lock_or_recover(&self.machine).post_stage_recording(self.id)
    }

    pub(crate) fn stage_timeout(&mut self) {
        self.cleared = true;
        lock_or_recover(&self.machine).stage_timeout(self.id);
    }

    pub(crate) fn early_return(&mut self) {
        self.cleared = true;
        lock_or_recover(&self.machine).early_return(self.id);
    }
}

impl Drop for PressExitGuard {
    fn drop(&mut self) {
        if self.cleared {
            return;
        }
        lock_or_recover(&self.machine).early_return(self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn admit(m: &mut PressReleaseMachine) -> u64 {
        match m.press_enter() {
            PressEnterAction::Proceed(id, _token) => id,
            PressEnterAction::IgnorePress => panic!("expected admission"),
        }
    }

    /// Like `admit`, but also returns the wake token — for tests that
    /// exercise the early-wake mechanism itself (T4a r1 review finding 1).
    fn admit_with_token(m: &mut PressReleaseMachine) -> (u64, CancellationToken) {
        match m.press_enter() {
            PressEnterAction::Proceed(id, token) => (id, token),
            PressEnterAction::IgnorePress => panic!("expected admission"),
        }
    }

    // ---- t7: press → release during perm-check → never starts ---------
    // Reproduces the Sep 5 log ordering (plan §1.1): press enters, clears
    // the debounce checkpoint, THEN (during what would be the permission
    // check) a release arrives, THEN pre_start (right before
    // recorder.start()) must say NeverStart.
    #[test]
    fn test_t7_release_during_permcheck_never_starts() {
        let mut m = PressReleaseMachine::new();
        let id = admit(&mut m);
        assert_eq!(m.post_debounce(id), ContinueOrAbort::Continue);
        assert_eq!(m.release_arrived(), ReleaseAction::ArmReleasePending);
        assert_eq!(m.pre_start(id), ContinueOrAbort::NeverStart);
    }

    // ---- t8: release immediately after admission (before post_debounce
    // ---- even runs) → never starts. Reframed from the plan's literal
    // ---- "between select!-exit and pending_press slot-clear" phrasing:
    // ---- that exact slot no longer exists (deviation 3), but the same
    // ---- class of "released the instant the debounce window opens"
    // ---- race is what this exercises.
    #[test]
    fn test_t8_release_immediately_after_admission_never_starts() {
        let mut m = PressReleaseMachine::new();
        let id = admit(&mut m);
        assert_eq!(m.release_arrived(), ReleaseAction::ArmReleasePending);
        assert_eq!(m.post_debounce(id), ContinueOrAbort::NeverStart);
    }

    // ---- T4a r1 review finding 1 (regression fix): a release arriving
    // ---- while a press sleeps in its debounce hold-timer must cancel
    // ---- that press's wake token (so it wakes within µs instead of
    // ---- occupying `in_flight` for the rest of `hold_ms`) AND free the
    // ---- slot for the next press once the woken press clears at its
    // ---- `post_debounce` checkpoint. --------------------------------
    #[test]
    fn test_release_during_debounce_cancels_token_and_frees_slot() {
        let mut m = PressReleaseMachine::new();
        let (id1, token1) = admit_with_token(&mut m);
        assert!(!token1.is_cancelled(), "token must not be cancelled at admission");

        assert_eq!(m.release_arrived(), ReleaseAction::ArmReleasePending);
        assert!(
            token1.is_cancelled(),
            "release_arrived must cancel the in-flight press's wake token"
        );

        assert_eq!(m.post_debounce(id1), ContinueOrAbort::NeverStart);

        // Slot is free: the next press is admitted with a NEW id, not
        // refused as IgnorePress.
        match m.press_enter() {
            PressEnterAction::Proceed(id2, _) => {
                assert_ne!(id1, id2, "next press must get a fresh id")
            }
            PressEnterAction::IgnorePress => {
                panic!("slot must be free for the next press after the woken press cleared")
            }
        }
    }

    // ---- T4a r1 review finding 1 (the exact regression): a release
    // ---- during debounce must not leave `in_flight` occupied for the
    // ---- rest of `hold_ms` — a legitimate follow-on press arriving in
    // ---- that window (e.g. AltGr tapped as a modifier, then
    // ---- press-and-held to dictate, both within 300ms) must be
    // ---- admitted, not silently dropped. Negative half: single-flight
    // ---- still holds when no release has freed the slot yet. -----------
    #[test]
    fn test_follow_on_press_within_hold_ms_is_admitted_not_ignored() {
        // Positive: release during press#1's debounce frees the slot
        // immediately (via checkpoint), so press#2 is admitted.
        let mut m = PressReleaseMachine::new();
        let id1 = admit(&mut m);
        assert_eq!(m.release_arrived(), ReleaseAction::ArmReleasePending);
        assert_eq!(m.post_debounce(id1), ContinueOrAbort::NeverStart);
        match m.press_enter() {
            PressEnterAction::Proceed(id2, _) => assert_ne!(id1, id2),
            PressEnterAction::IgnorePress => panic!(
                "a follow-on press after a release during debounce must be admitted, \
                 not dropped (T4a r1 review finding 1 regression)"
            ),
        }

        // Negative: single-flight still holds — a second press arriving
        // BEFORE any release is refused, exactly as t9 exercises with six.
        let mut m2 = PressReleaseMachine::new();
        let _id1 = admit(&mut m2);
        match m2.press_enter() {
            PressEnterAction::IgnorePress => {}
            PressEnterAction::Proceed(..) => {
                panic!("single-flight-start must still refuse a concurrent press")
            }
        }
    }

    // ---- D4 ruling (T4a r1 review): pins the CURRENT (correct)
    // ---- semantics of the conditional `release_pending` arm so a
    // ---- future edit doesn't "fix" it into the plan's literal
    // ---- unconditional-store variant. A release arriving before the
    // ---- matching press's task ever reaches `press_enter()` (the press
    // ---- task starved for the whole hold/tap duration — the actual,
    // ---- narrow residual window, see press_release module docs
    // ---- deviation 4) is consumed as a plain `ProceedRelease` and must
    // ---- NOT leave any trace that could poison the next, unrelated
    // ---- press. The plan's "unconditional store(true) FIRST" would
    // ---- instead leave `release_pending` dangling `true` after every
    // ---- normal release (since `in_flight` is already `None` by then),
    // ---- making every second press's first checkpoint report
    // ---- `NeverStart` — i.e. every second recording would silently
    // ---- fail to start. Structurally closing the residual window
    // ---- itself requires in-order delivery between the independent
    // ---- press/release tasks (single ordered event channel or
    // ---- per-event sequence numbers) — carried forward past this step. -
    #[test]
    fn test_residual_pre_admission_window_is_documented() {
        let mut m = PressReleaseMachine::new();

        // A release with no press in flight at all (the residual window:
        // the matching press task hasn't called `press_enter()` yet).
        assert_eq!(m.release_arrived(), ReleaseAction::ProceedRelease);
        assert!(
            !m.release_pending,
            "the conditional arm must leave release_pending false when no press is in flight — \
             an unconditional store here would poison the next press (D4 ruling)"
        );

        // The next, unrelated press must be admitted and reach its first
        // checkpoint as Continue — a stale release must not poison it.
        let id = admit(&mut m);
        assert_eq!(
            m.post_debounce(id),
            ContinueOrAbort::Continue,
            "a release consumed before press_enter must not poison the next press's checkpoint"
        );
    }

    // ---- t9: six concurrent presses → exactly one admitted -------------
    #[test]
    fn test_t9_six_concurrent_presses_admit_exactly_one() {
        let mut m = PressReleaseMachine::new();
        let mut admitted = 0;
        let mut ignored = 0;
        for _ in 0..6 {
            match m.press_enter() {
                PressEnterAction::Proceed(..) => admitted += 1,
                PressEnterAction::IgnorePress => ignored += 1,
            }
        }
        assert_eq!(admitted, 1, "exactly one of six concurrent presses admitted");
        assert_eq!(ignored, 5);
    }

    // ---- t10: early return (perm denied / recorder.start Err) clears
    // ---- in_flight AND release_pending, so the NEXT press isn't
    // ---- poisoned by a stale flag from this one. ------------------------
    #[test]
    fn test_t10_early_return_clears_in_flight_for_next_press() {
        let mut m = PressReleaseMachine::new();
        let id1 = admit(&mut m);
        m.early_return(id1);
        match m.press_enter() {
            PressEnterAction::Proceed(id2, _) => assert_ne!(id1, id2),
            PressEnterAction::IgnorePress => {
                panic!("state must be cleared after early_return")
            }
        }
    }

    #[test]
    fn test_t10_early_return_clears_release_pending_for_next_press() {
        let mut m = PressReleaseMachine::new();
        let id1 = admit(&mut m);
        assert_eq!(m.release_arrived(), ReleaseAction::ArmReleasePending);
        m.early_return(id1);
        let id2 = admit(&mut m);
        assert_eq!(
            m.post_debounce(id2),
            ContinueOrAbort::Continue,
            "a stale release_pending from press 1 must not poison press 2"
        );
    }

    // ---- t10b: release AFTER stage became Recording (normal hold) is
    // ---- ProceedRelease, not tied to the finished press; release
    // ---- exactly BETWEEN StartOk and StageBecameRecording is
    // ---- StopReleasePending. ---------------------------------------------
    #[test]
    fn test_t10b_release_after_stage_recording_is_proceed_release() {
        let mut m = PressReleaseMachine::new();
        let id = admit(&mut m);
        assert_eq!(m.post_debounce(id), ContinueOrAbort::Continue);
        assert_eq!(m.pre_start(id), ContinueOrAbort::Continue);
        assert_eq!(
            m.post_stage_recording(id),
            PostStageAction::ProceedNormally
        );
        // The eventual real release for this (now steady-state)
        // recording must be treated as a normal release, not swallowed.
        assert_eq!(m.release_arrived(), ReleaseAction::ProceedRelease);
    }

    #[test]
    fn test_t10b_release_between_start_ok_and_stage_recording_stops_pending() {
        let mut m = PressReleaseMachine::new();
        let id = admit(&mut m);
        assert_eq!(m.post_debounce(id), ContinueOrAbort::Continue);
        assert_eq!(m.pre_start(id), ContinueOrAbort::Continue);
        assert_eq!(m.release_arrived(), ReleaseAction::ArmReleasePending);
        assert_eq!(
            m.post_stage_recording(id),
            PostStageAction::StopReleasePending
        );
    }

    // ---- t10c: stage timeout (C1 orphan) clears state for next press ---
    #[test]
    fn test_t10c_stage_timeout_clears_state_for_next_press() {
        let mut m = PressReleaseMachine::new();
        let id1 = admit(&mut m);
        assert_eq!(m.pre_start(id1), ContinueOrAbort::Continue);
        m.stage_timeout(id1);
        match m.press_enter() {
            PressEnterAction::Proceed(id2, _) => assert_ne!(id1, id2),
            PressEnterAction::IgnorePress => {
                panic!("state must clear after stage_timeout")
            }
        }
    }

    // ---- release with no press ever in flight: harmless no-op ----------
    #[test]
    fn test_release_with_no_press_in_flight_is_proceed_release() {
        let mut m = PressReleaseMachine::new();
        assert_eq!(m.release_arrived(), ReleaseAction::ProceedRelease);
        match m.press_enter() {
            PressEnterAction::Proceed(..) => {}
            PressEnterAction::IgnorePress => {
                panic!("a spurious release must not block a later press")
            }
        }
    }

    // ---- invariant: release_pending ⟹ in_flight.is_some(), across a
    // ---- full lifecycle (white-box: reads private fields from the
    // ---- parent module, same pattern as AudioRecorder's own tests). ----
    #[test]
    fn test_invariant_release_pending_implies_in_flight_across_full_lifecycle() {
        let mut m = PressReleaseMachine::new();
        let holds = |m: &PressReleaseMachine| !m.release_pending || m.in_flight.is_some();

        assert!(holds(&m));
        let id = admit(&mut m);
        assert!(holds(&m));
        assert_eq!(m.release_arrived(), ReleaseAction::ArmReleasePending);
        assert!(holds(&m));
        assert_eq!(
            m.post_stage_recording(id),
            PostStageAction::StopReleasePending
        );
        assert!(holds(&m));
        assert!(m.in_flight.is_none() && !m.release_pending);
    }

    // ---- PressExitGuard --------------------------------------------------

    #[test]
    fn test_exit_guard_drop_clears_state_if_no_checkpoint_ran() {
        let machine = Arc::new(Mutex::new(PressReleaseMachine::new()));
        let id = admit(&mut lock_or_recover(&machine));
        {
            let _guard = PressExitGuard::new(Arc::clone(&machine), id);
            // No checkpoint called — simulates a future code path that
            // returns without remembering to call one.
        }
        match lock_or_recover(&machine).press_enter() {
            PressEnterAction::Proceed(..) => {}
            PressEnterAction::IgnorePress => panic!(
                "PressExitGuard::drop must clear in_flight when no checkpoint ran"
            ),
        };
    }

    #[test]
    fn test_exit_guard_explicit_checkpoint_then_drop_is_not_double_cleared_incorrectly() {
        let machine = Arc::new(Mutex::new(PressReleaseMachine::new()));
        let id = admit(&mut lock_or_recover(&machine));
        let mut guard = PressExitGuard::new(Arc::clone(&machine), id);
        guard.early_return();
        drop(guard); // must be a no-op now — already cleared explicitly
        match lock_or_recover(&machine).press_enter() {
            PressEnterAction::Proceed(..) => {}
            PressEnterAction::IgnorePress => panic!(),
        };
    }

    #[test]
    fn test_exit_guard_post_stage_recording_matches_direct_machine_call() {
        let machine = Arc::new(Mutex::new(PressReleaseMachine::new()));
        let id = admit(&mut lock_or_recover(&machine));
        let mut guard = PressExitGuard::new(Arc::clone(&machine), id);
        assert_eq!(guard.post_debounce(), ContinueOrAbort::Continue);
        assert_eq!(guard.pre_start(), ContinueOrAbort::Continue);
        assert_eq!(guard.post_stage_recording(), PostStageAction::ProceedNormally);
        drop(guard);
        // Cleared by the explicit checkpoint, not by Drop — next press
        // must be admitted.
        match lock_or_recover(&machine).press_enter() {
            PressEnterAction::Proceed(..) => {}
            PressEnterAction::IgnorePress => panic!(),
        };
    }
}
