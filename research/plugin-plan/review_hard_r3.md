# Hardening Sweep Review — Round 3 (fresh reviewer, F-NEW only)

VERDICT: APPROVE

Scope: verifying only the F-NEW fix from round 2
(`/tmp/ado.C4YWdv/review_hard_r2.md`) — Stop arriving while `do_start`
awaits `spawn_blocking(capture.start)` causing `signal()`'s `.expect()`
to panic (SIGABRT under `panic = "abort"`). Read/grep only, no bash, no
edits. Files read in full or in the relevant sections: `session.rs`,
`commands.rs` (module doc, `do_start`, `do_stop`,
`wait_for_outcome_receiver`, `do_cancel`, `await_outcome`, and all six
new/relevant tests), `lib.rs::handle_live_activity_stop_intent` +
`live_activity_intent_tests`. Grepped every `.signal(` call site across
`src/`.

## Findings

No blocking findings against F-NEW's own scope.

## Checked OK

1. **Every remaining production caller of `signal()` is post-attach.**
   Grepped `.signal(` across the whole crate: the only non-test callers
   are inside `pipeline.rs`'s test module itself (all under
   `#[cfg(test)]`) and `session.rs`'s own unit tests — there is now
   **zero** production/`do_*`-command call site left that calls
   `signal()` directly. `do_stop` (the historical offender) now calls
   `request_stop`/`wait_for_outcome_receiver` instead, never `signal()`.
   Every `pipeline.rs` test call to `sessions.signal(&id, ...)` I
   sampled (lines ~511, 577, 650, 772, 799, 833, 934, 959, 1022, 1082,
   1287) is preceded in the same test by
   `sessions.attach_handles(&id, handles)` a few lines above, so
   `handles` is `Some` by construction at the point `signal()` is
   called — the `.expect()`'s premise genuinely holds for every
   remaining caller, confirming `signal()`'s updated doc comment's
   claim ("`signal()` itself is therefore only ever called once
   `handles` is known `Some`").

2. **`pending: Option<ControlSignal>` precedence is correct and
   verified in code, not just doc.**
   - `trigger_stop`: `if active.pending != Some(ControlSignal::Cancel) {
     active.pending = Some(ControlSignal::Stop); }` — a pending `Cancel`
     is never overwritten/downgraded by a later `Stop` landing in the
     same window. A `None` or already-`Stop` pending is (harmlessly)
     set/re-set to `Stop`.
   - `trigger_cancel`: unconditionally sets
     `active.pending = Some(ControlSignal::Cancel)` when handles are
     `None` — Cancel always wins, matching the doc's stated intent
     ("`Cancel` always wins over an already-pending `Stop`").
   - Net effect: Stop-then-Cancel → `pending == Cancel` (Cancel wins);
     Cancel-then-Stop → `pending` stays `Cancel` (Stop is rejected by
     the guard above) — both orderings converge on Cancel, as intended
     for the mic-safety-sensitive case.
   - `attach_handles` applies `pending` via `.take()` exactly once
     (`match active.pending.take() { Some(Cancel) => ..., Some(Stop) =>
     ..., Some(None) | None => {} }`), under the same lock acquisition
     that sets `handles = Some(..)` first — so a concurrent second
     `attach_handles` call for the same id cannot double-apply (also
     structurally impossible: `attach_handles` is only ever called once
     per session, from `do_start`, and single-flight (`begin`)
     guarantees only one `ActiveSession` exists for a given id at a
     time).

3. **`wait_for_outcome_receiver` is correctly bounded, and the
   multi-thread runtime assumption is implicit rather than explicitly
   documented — a minor, non-blocking gap.**
   The loop exits either by returning `Ok(rx)` once
   `outcome_receiver(id)` becomes `Some` (handles attached), or by
   returning `Err(UnknownSession)` once `is_active(id)` goes false
   (covers `do_start`'s own rollback path on a capture-backend
   failure, which calls `sessions.end(&id)` without ever attaching
   handles) — genuinely bounded, not an infinite spin if the session
   vanishes without ever attaching. The `tokio::task::yield_now().await`
   busy-poll is acceptable for this narrow, short-lived window (bounded
   by however long `spawn_blocking(capture.start)` takes, not
   arbitrary). On a strictly single-worker (`current_thread`) runtime
   this loop and the task that eventually calls `attach_handles` would
   need to interleave on the same one worker — `yield_now` does
   correctly yield back to the executor each iteration, so it would
   still make progress on a `current_thread` runtime too (not a true
   deadlock), but production Tauri apps use a multi-thread runtime by
   default (`tauri::async_runtime::spawn`/the Tauri runtime), and none
   of the touched files (`commands.rs`, `session.rs`, `lib.rs`)
   contains an explicit comment stating "this relies on the production
   runtime being multi-thread" the way the *tests* explicitly encode it
   via `#[tokio::test(flavor = "multi_thread", worker_threads = 2)]`.
   This is a documentation gap, not a correctness bug — flagged as a
   Minor below, not blocking APPROVE.

4. **The two new `commands.rs` tests genuinely exercise `do_stop` in
   the exact window F-NEW identified.**
   - `do_stop_arriving_while_capture_start_is_blocked_finalizes_
     normally_no_panic`: uses the same `BlockingStartCapture`
     ready/release handshake as F1's cancel tests, reads
     `active_id()` while `capture.start()` is still parked, spawns
     `do_stop` concurrently, releases the block, and asserts
     `stop_task.await.unwrap()` is `Ok(..)` **or** a `Transcription`
     error but never any other error/panic — `.unwrap()` on the
     `JoinHandle` itself is the real teeth here: a panic inside the
     spawned `do_stop` task would make this `.unwrap()` panic instead
     of returning a `Result`, so the test would fail loudly (not
     silently pass) if the old `.expect()` panic still fired. Then
     asserts slot freed (`!has_active()`), capture actually stopped
     (`!mock.is_running()`), and rec file deleted
     (`read_dir(..).count() == 0`) — mirrors F1's assertion shape.
   - `live_activity_style_stop_arriving_while_capture_start_is_blocked_
     finalizes_normally_no_panic`: the more targeted regression test —
     reads `active_id()` fresh **inside the spawned task itself**,
     exactly matching `lib.rs::handle_live_activity_stop_intent`'s own
     pattern (`state.sessions.active_id()` then `do_stop(state, &id)`),
     rather than reusing an id obtained elsewhere. This is the
     concrete real-world trigger the round-2 finding named (the Live
     Activity Stop button), and the test structurally reproduces it
     rather than just asserting the same thing a different way. Same
     no-panic / slot-freed / capture-stopped / file-deleted assertions.
   - Both tests run on `flavor = "multi_thread", worker_threads = 2`,
     matching F1's sibling tests' documented reasoning (the blocked
     `capture.start()` runs on the blocking pool, not a worker; the
     `do_start` task and the concurrent `do_stop` task each need a live
     async worker).

5. **`lib.rs::handle_live_activity_stop_intent` is unchanged**, confirmed
   by reading it end-to-end: still reads `state.sessions.active_id()`
   and delegates to `commands::do_stop(state, &id)` on `Some`, warns and
   no-ops on `None`. No direct call to `signal()` anywhere in `lib.rs`.
   Fixing the gap entirely inside `do_stop`'s own implementation (rather
   than requiring every caller, including this one, to special-case the
   window) is the correct place for the fix — a caller-side workaround
   here would have been fragile and easy to miss for any future caller.

6. **Docs updated consistently.** `session.rs`'s doc comments for
   `signal()`, `ActiveSession::handles`, `ActiveSession::pending`,
   `request_stop`, `trigger_stop`, `transcribe_abort_cell`, and
   `lease_tracker` all explicitly reference F-NEW, explain the
   panic/abort risk that motivated the fix, and (for
   `transcribe_abort_cell`/`lease_tracker`) explicitly contrast their
   own intentional `None`-degrading leniency against `signal()`'s
   (now-justified) strictness — this directly resolves round-2's two
   Minors ("`signal()`'s doc comment should mention the third
   possibility" and "`transcribe_abort_cell`/`lease_tracker` worth a
   one-line comment noting they're intentionally lenient where
   `signal()` is not"). `commands.rs`'s `do_stop`/
   `wait_for_outcome_receiver` doc comments both explicitly cite
   "Hardening-sweep review finding F-NEW" and correctly describe the
   fix and the reasoning, matching the actual code.

7. **No stray regression to F1's cancel path.** `trigger_cancel`'s own
   logic is untouched by this round's diff beyond the `pending`
   generalization (`bool` → `Option<ControlSignal>`), and F1's own
   three tests (`cancel_arriving_while_capture_start_is_blocked_...`,
   the `cancel_all_hold` sibling, and the no-cancel control) are present
   unchanged in `commands.rs` and still assert the same properties I
   spot-checked in round 2's review — consistent with the diff being
   additive (new `Stop` variant + `request_stop`/`trigger_stop`
   functions) rather than restructuring the existing `Cancel` path.

## Minors

- `wait_for_outcome_receiver`'s `yield_now`-based poll loop relies on
  the production Tauri async runtime being multi-thread for the two
  concurrent tasks (the in-flight `do_start` and the polling `do_stop`)
  to make independent progress without one starving the other; this
  assumption is true in practice (Tauri's default runtime is
  multi-thread, and the new tests explicitly use
  `worker_threads = 2` to model it) but is not written down anywhere
  in the touched non-test source (`commands.rs`, `session.rs`,
  `lib.rs`) the way the test annotations encode it. A one-line comment
  on `wait_for_outcome_receiver` or `do_stop` stating this assumption
  would make the reasoning self-contained for a future reader who
  doesn't cross-reference the test flavor. Not blocking — even under a
  hypothetical single-worker runtime this loop still yields and makes
  progress each iteration rather than deadlocking; it would just be
  slower to observe.
- Did not independently re-run the worker's reported test/clippy/build
  counts in this pass (read/grep-only per this review's constraints);
  the task prompt's "pre-verified" claims (plugin desktop 171/0 ×3 of
  4, no-features 124/0, clippy clean, host-min smoke 4/4) are taken as
  given, not re-executed here.
- Did not re-open round 2's F1/F2 findings in this pass beyond what was
  necessary to confirm F-NEW's fix didn't regress them (item 7 above)
  — per this round's explicit scope, only F-NEW was to be re-verified.

## Manual notes

This round's task was scoped strictly to re-verifying round 2's F-NEW
finding (the `signal()` `.expect()` panic reachable via `do_stop`/
`handle_live_activity_stop_intent` during `do_start`'s
`spawn_blocking(capture.start)` window). The fix (`pending:
Option<ControlSignal>` generalizing F1's `cancel_requested`,
`request_stop`/`trigger_stop` mirroring `request_cancel`/
`trigger_cancel`, `do_stop` rerouted through
`request_stop`+`wait_for_outcome_receiver` instead of `signal()`) is
structurally sound, correctly prioritizes Cancel over Stop in the
`pending` slot, is applied exactly once inside `attach_handles`, is
exercised by two genuinely-targeted new tests (one of which
specifically reproduces the Live Activity call pattern that made this
a real, not just theoretical, crash risk), and every remaining
production/test caller of the still-strict `signal()` is confirmed
post-attach by construction. No blocking findings. APPROVE.
