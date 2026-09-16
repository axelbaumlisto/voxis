# Review R_r1 — Dictation Session Lifecycle Refactor (tauri-plugin-voxis, R1–R5)

VERDICT: APPROVE

Fresh read-only review of the uncommitted diff (`session.rs −159, commands.rs −148,
pipeline.rs +42, capture.rs +58`). Judged against the NEW source, not the commit
message. Ran `cargo test -p tauri-plugin-voxis --lib` once myself: **121 passed; 0
failed** (matches the pre-verified −4/+1 → 124→121). No blockers found. The core
safety fix — attaching `SessionHandles` atomically inside `begin(mode, handles)` so
there is no handle-less window — is correctly implemented and collapses the three
parallel deferral mechanisms (`pending`, `stop_waiters`/`StopRequest`, plus the
production-dead `signal()`) exactly as plan finding 1 prescribed.

## Findings

No blockers, no reject-level issues. All safety contracts (1)–(8) hold in the new
code; see "Checked OK". Two contracts lost a *dedicated* regression test though the
behaviour is preserved structurally — see Minors #1/#2. One behavioural change worth
a downstream verification is Minor #3.

## Checked OK

**(1) Single-flight + panic-safety.** `begin` still rejects a second session in ANY
stage (`session.rs:120-127`; `second_begin_while_active_..._during_transcribing`
passes). `SessionSlotGuard::drop` still frees the slot on a panicking task
(`pipeline.rs:112-140`; both `a_panic_inside_finalize*` tests pass, and now
re-`begin` with `dummy_handles()`).

**(2) No remaining handle-less window; signal latched through the park.** Trace
`do_start → pipeline::spawn`: `begin(mode, handles)` stores handles *under the same
mutex* that reserves the slot (`session.rs:120-127`), BEFORE `do_start` runs
`spawn_blocking(capture.start)` (`commands.rs:53-66`). The spawned task parks on
`capture_ready.await` (`pipeline.rs:124-137`). A `Stop`/`Cancel` arriving during the
park reaches live handles via `request_stop`/`request_cancel`/`cancel_all_hold`
(all operate on `active.handles.*`, no `Option`). The signal survives the park by
**watch latch semantics**: `control_tx.send(Stop|Cancel)` sets the channel value;
`record_phase`'s first `control_rx.changed()` (after `capture_ready=Ok`) observes it
(the receiver never consumed the initial `None`). A `Cancel` during the park sets
`cancelled=true` too, so even if the guard fires its own trigger on the first tick,
`decide()` returns `Cancelled`. `capture.stop()` in `finalize` therefore only ever
runs on a capture that *did* start (start succeeded → `capture_ready=Ok` → task
resumes → stop); on the capture-*failure* branch (`finalize_capture_failure`) there
is no `capture.stop()` call at all, which is correct (nothing started).
Verified by `cancel_arriving_while_capture_start_is_blocked_still_cancels_the_session`
(asserts `!mock.is_running()`, file deleted) and
`stop_arriving_while_capture_start_is_blocked_gets_a_real_outcome_not_unknown_session`.

**(3) capture.start failure path.** `commands.rs:68-83`: on `Err`, `do_start` sends
`capture_ready_tx.send(Err(..))` then `await_outcome(&mut outcome_rx)`. Task routes
to `finalize_capture_failure → finish` (`pipeline.rs:141-158`): `drop(file)` (deletes
WAV) → `end(id)` (frees slot) → no `RESULT_EVENT` (result is `Err`) → `outcome_tx.send`.
`do_start` returns the same `Err`. No HTTP, no result event, slot freed, file gone.
A `stop()` racing the failure gets a real outcome (the `Err`) via its own
`outcome_rx` clone (not UnknownSession, not a hang — `await_outcome` reads
`rx.borrow()` first, so a value published before the await is still observed). A
`stop()` after the slot is freed gets `None → UnknownSession` (correct). The
sender-dropped-without-publishing case (task panic) is handled: `await_outcome`'s
`rx.changed().await.is_err()` → fail-closed `Err`, no hang. Also confirmed:
`AlreadyRecording` from `begin` propagates via `?` *before* `spawn_blocking`, so a
rejected start never opens the mic and drops `file`.

**(4) Cancel precedence over Stop on a last-writer-wins watch channel.** The watch
channel CAN be downgraded `Cancel→Stop` by a later `trigger_stop`, but precedence is
carried by the monotonic `cancelled: AtomicBool`, not by the channel: `trigger_cancel`
always sets `cancelled=true` before sending, and `decide(trigger, .., cancelled)`
checks `if cancelled { return (Cancelled, false) }` FIRST (`pipeline.rs:249-251`). So
any session that ever saw a `Cancel` finalises `Cancelled` with `should_transcribe=false`
regardless of a racing/duplicate `Stop`. Correct and robust.

**(5) Single decision point + justified re-checks.** `decide()` is now the sole
mapper from `Trigger`+`cancelled` to `(GuardOutcome, should_transcribe)`; the old
inline `already_cancelled` override in `finalize` is gone (`pipeline.rs:307-308`).
The two remaining `cancelled.load()` re-checks in `run_transcription`
(`pipeline.rs:385-393` after `secrets.get`; `pipeline.rs:427-433` after the HTTP
join) are real races — `abort_cell` has no handle until the HTTP task is spawned, and
a cancel that lands after the response fully arrived can't abort the socket — and
each is justified in a one-paragraph comment. The former third check (post `fs::read`)
was correctly dropped as subsumed by monotonicity.

**(6) finish() ordering.** `pipeline.rs:349-355`: `drop(file)` → `end(id)` → emit
`RESULT_EVENT` (only on `Ok`) → `outcome_tx.send(Some(result))`, in that order, in one
function; the load-bearing ordering comment moved onto it. Emit-after-slot-free holds;
`DictationResult.session_id` is populated at every construction site in `finalize`.

**(7) State events.** `State::Recording` is now emitted from the task after
`capture_ready=Ok` (`pipeline.rs:126-128`) rather than synchronously in `spawn`.
Plugin `state()` (`do_state`) is unaffected — it derives from `Stage`, set at `begin`,
so `state_is_idle_then_recording_then_idle` still sees `Recording` synchronously after
`do_start` returns. Within the crate, `pipeline.rs:758` still asserts the full
4-event `Recording,Transcribing,Error,Idle` sequence and passes. (See Minor #3 for the
one out-of-crate implication.)

**(8) Lease / hold ≤120 s.** Untouched: `lease` is still built in `spawn` for
`Mode::Hold` only and threaded through unchanged; `hold_mode_clamps_max_recording_ms_to_120s`
and `lease_tracker_absent_for_toggle_mode` pass.

**(9) Deleted-test accounting (contract-by-contract).**
- `do_stop_arriving_while_capture_start_is_blocked_finalizes_normally_no_panic` →
  contract "stop in the start window never panics / no UnknownSession" is **still
  pinned** by the rewritten `stop_arriving_while_capture_start_is_blocked_gets_a_real_outcome_not_unknown_session` (keeps the 50 ms "slot freed before the stop task resumes" twist).
- `live_activity_style_stop_..._no_panic` → the "read `active_id()` fresh at the call
  site" (Live Activity Stop) angle is **folded into** that same rewritten stop test,
  which now reads `active_id()` fresh. Contract preserved.
- `cancel_all_hold_arriving_while_capture_start_is_blocked_..._cancels_the_hold_session`
  → the *cancel_all_hold-specific* start-window path is **no longer pinned** by a
  dedicated test (Minor #1). Behaviour is preserved structurally: `cancel_all_hold`
  and `do_cancel` share `trigger_cancel` on always-present handles.
- `start_with_no_cancel_in_the_blocking_window_is_unaffected` → normal-path start is
  covered by the happy-path pipeline/command tests; **no dedicated pin** (Minor #2).

**(10) Test helpers don't hide behaviour.** `BlockingLatch::block()` is a genuine
ready(oneshot)+release(mpsc.recv) handshake — a real OS-thread park, not a stub;
its three consumers (`BlockingStartCapture`/`BlockingStopCapture`/`BlockingSecretStore`)
now share it with no loss of the latch-driven determinism. `spawn_session` sends
`capture_ready=Ok` immediately (legitimate: these tests pre-`start()` the MockCapture
and drive the pipeline directly). `mock_server` centralises the `ServerOpts{port:0}`
rule. `dummy_handles`/`handles()` feed the slot-reuse assertions only. No vacuous
asserts; the race tests still assert real behaviour (outcome text, `!is_running()`,
file gone, slot free).

## Minors

1. **cancel_all_hold-in-start-window lost its dedicated regression test.** The
   `[R1-Safety S4]` webview-death-during-`spawn_blocking(capture.start)` scenario is
   now only covered by the general `cancel_all_hold_cancels_a_hold_session` (no
   blocking start) plus the `do_cancel` window test. Given both paths funnel through
   `trigger_cancel` on always-present handles this is low risk, but a one-line
   `cancel_all_hold`-flavoured variant of the kept cancel test would restore an exact
   pin at ~zero cost. Non-blocking.

2. **start_with_no_cancel_in_the_blocking_window** removed with no direct replacement;
   the "nothing racing → capture actually recording, no spurious cancel" property now
   relies on the general happy-path tests. Acceptable, worth a note.

3. **`State::Recording` event is now asynchronous relative to `start()` returning.**
   In-crate `state()` stays synchronous, and guest-js `dictate()` awaits its listeners
   before calling `start`, so it is unaffected. The task itself flags the open
   question "naked host?" — any external consumer that assumes the `voxis://state`
   Recording event has already fired by the time `start()` resolves would now observe
   it slightly later. Out of this crate's scope to verify; called out as a residual
   risk for the parent to route to whoever owns the naked host.

4. The kept stop-window test accepts `Ok | Err(Transcription)` — slightly loose, but
   justified: the contract under test is "never UnknownSession, never panic" (CI-6882
   class), and both shapes satisfy it.

## Validation
- `cargo test -p tauri-plugin-voxis --lib` → **121 passed; 0 failed** (ran once, as
  instructed). Matches pre-verified 124→121 (−4 blocking-window tests, +1 rewritten).
- Grepped removed symbols (`attach_handles`, `StopRequest`, `signal(`, `stop_waiters`,
  `.pending`) → only doc-comment mentions remain; no stray call sites.
- Sole production `begin` call site is `pipeline.rs:112`; `mobile.rs` routes through
  commands, so the `begin(mode, handles)` signature change carries no cross-cutting
  compile risk (consistent with the pre-verified `--features desktop` 168/168).
- Did NOT re-run clippy / the 20× race loop / `--features desktop` myself (pre-verified
  per brief; brief asked for the `--lib` run only). Did not touch any files.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only review; produced verdict + findings for the R1-R5 refactor without editing source or widening scope. Only wrote the mandated review file."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Traced all 10 judged contracts in the NEW source with file:line, ran the lib test suite (121/121), grepped for removed-symbol call sites, and accounted for every deleted test."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "cargo test -p tauri-plugin-voxis --lib",
      "result": "passed",
      "summary": "121 passed; 0 failed; 0 ignored (matches pre-verified 124->121)"
    },
    {
      "command": "cargo test -p tauri-plugin-voxis --lib -- --list",
      "result": "passed",
      "summary": "confirmed the rewritten cancel/stop blocking-window tests exist and the 4 deleted ones are gone"
    }
  ],
  "validationOutput": [
    "test result: ok. 121 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.70s",
    "grep of attach_handles|StopRequest|.signal(|stop_waiters|.pending -> only doc-comment matches, no call sites",
    "sole production begin() call is pipeline.rs:112 via pipeline::spawn; mobile.rs routes through commands"
  ],
  "residualRisks": [
    "Minor: cancel_all_hold-in-start-window scenario ([R1-Safety S4] webview death) no longer has a dedicated regression test; behaviour preserved structurally via shared trigger_cancel on always-present handles.",
    "Minor: start_with_no_cancel_in_the_blocking_window removed with no direct replacement; covered by general happy-path tests.",
    "Behavioural change: State::Recording voxis://state event now fires asynchronously from the pipeline task after capture_ready=Ok, not synchronously within start(); in-crate state() and guest-js unaffected, external/naked host consumers relying on synchronous emission should be verified (out of this crate's scope).",
    "Did not independently re-run clippy -D warnings, the 20x race loop, or --features desktop (pre-verified per brief; brief requested only the --lib run)."
  ],
  "noStagedFiles": true,
  "diffSummary": "Reviewed only (no edits). The diff attaches SessionHandles atomically in begin(mode,handles), parks the pipeline task on a capture_ready oneshot, and deletes pending/stop_waiters/StopRequest/signal() plus 4 blocking-window tests, replacing them with 2 rewritten ones; decide() gains a cancelled param as the single cancel decision point; finish() encapsulates the drop->end->emit->send ordering.",
  "reviewFindings": [
    "no blockers",
    "minor: session.rs/commands.rs - cancel_all_hold start-window scenario lost its dedicated test (behaviour preserved structurally)",
    "minor: commands.rs - start_with_no_cancel_in_the_blocking_window deleted with no direct replacement",
    "note: pipeline.rs:126 - State::Recording event now emitted asynchronously after capture_ready=Ok; verify external/naked host consumers"
  ],
  "manualNotes": "VERDICT: APPROVE. cargo test -p tauri-plugin-voxis --lib = 121/121. All 10 judged safety contracts verified in the new code: no handle-less window (handles atomic at begin, signal latched through the capture_ready park by watch semantics, cancelled AtomicBool as the precedence backstop over a last-writer-wins watch channel), capture-start failure rolls back cleanly with no hang/UnknownSession, single decide() decision point with the two run_transcription re-checks justified, finish() ordering preserved with emit-after-slot-free + sessionId. Only non-blocking minors above."
}
```
