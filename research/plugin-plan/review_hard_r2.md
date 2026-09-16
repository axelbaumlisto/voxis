# Hardening Sweep Review — Round 2 (fresh reviewer)

VERDICT: REJECT-FIX

Scope: `/tmp/ado.C4YWdv/diff_hard2.patch` against
`crates/tauri-plugin-voxis/`, `crates/voxis-core/`, `src-tauri/Cargo.toml`
in `/Users/shamash/work/voxis`. Read/grep only (no bash/find), no edits
made. This pass re-verifies round-1's F1/F2 rejections and traces the
fix through the actual current source files (not just the diff hunks).
Worker's pre-verified suite/clippy counts were **not** independently
re-run here (no bash access) — taken as reported.

## Findings

### F-NEW — HIGH / must-fix: F1's `cancel_requested` fix protects the
cancel-path but leaves the **stop**-path (`do_stop` → `SessionGuard::
signal`) hard-panicking in the exact window this diff widens, and
`panic = "abort"` in `[profile.release]` turns that panic into a full
process crash (`session.rs::signal`, `commands.rs::do_stop`,
`lib.rs::handle_live_activity_stop_intent`)

The round-2 fix (`ActiveSession::cancel_requested`, `trigger_cancel`,
`attach_handles`) correctly closes the cancel-during-`spawn_blocking
(capture.start)` window for `request_cancel`/`cancel_all_hold` — verified
by reading `session.rs` end-to-end and the new `commands.rs` tests. But
`SessionGuard::signal` (`session.rs:300-311`, unchanged by this diff) —
what `do_stop` calls — still does:

```rust
pub fn signal(&self, id: &SessionId, signal: ControlSignal) -> Result<...> {
    let guard = self.active.lock().unwrap();
    match guard.as_ref() {
        Some(active) if &active.id == id => {
            let handles = active.handles.as_ref().expect(
                "handles are attached before do_start returns the session id \
                 to any caller that could reach signal() for it",
            );
            ...
        }
        _ => Err(...),
    }
}
```

That `.expect()`'s premise is precisely the invariant `session.rs`'s own
updated `ActiveSession::handles` doc comment (this same diff) now says is
**false**: "another task ... CAN observe `handles == None` for `id`
while it is still the active session." The doc comment was fixed for
`handles` itself, but `signal()`'s separate, still-live `.expect()` two
methods below it was not updated to match.

For most callers this remains unreachable because they only ever obtain
`id` from `start()`'s own return value, which is guaranteed to postdate
`attach_handles`. But this crate has exactly one caller that deliberately
sidesteps that guarantee: `lib.rs::handle_live_activity_stop_intent`
(Task 9a, the iOS Live Activity/Dynamic-Island Stop button), which reads
`state.sessions.active_id()` — documented as "a plain, read-only mirror
of `has_active()`/`is_active(id)`" and populated the instant `begin()`
runs, *before* `attach_handles` — and calls `commands::do_stop(state,
&id)` with it:

```rust
pub(crate) async fn handle_live_activity_stop_intent(state: &PluginState) {
    match state.sessions.active_id() {
        Some(id) => { if let Err(e) = commands::do_stop(state, &id).await { ... } }
        None => ...,
    }
}
```

`do_stop` → `signal(id, Stop)`. If this Stop intent fires while the
just-started session's `capture.start()` is still parked inside
`commands::do_start`'s `spawn_blocking` (the exact window this diff
introduces/widens by moving `capture.start()` off the async worker — on
iOS this is a real `run_mobile_plugin` IPC round-trip to Swift, not a
negligible instant), `active_id()` returns `Some(id)` with `handles`
still `None`, and `signal()`'s `.expect()` panics.

This is not merely a task-local panic: the workspace root `Cargo.toml`
sets `[profile.release] panic = "abort"` specifically so that *any*
panic becomes SIGABRT (the crash-diagnostics design explicitly relies on
this: "Panics therefore become SIGABRT"). So in a release build, a user
tapping the Live Activity Stop button in the small window right after
starting a Hold recording — plausible, real-world timing, not a
contrived race — crashes the entire app, not just drops a cancel. This
is materially worse than the bug F1 fixed (a silently-dropped cancel):
it's the app crashing during exactly the safety-relevant Hold-recording
flow this whole sweep is trying to harden.

`transcribe_abort_cell`/`lease_tracker` (the other two `handles`-reading
accessors added/touched nearby) both correctly use `.and_then(|a| a.
handles.as_ref())` and degrade to `None` — only `signal()` still
hard-unwraps. No test in this diff exercises "stop()/Live Activity Stop
arrives while `capture.start()` is still in flight" — the three new
`commands.rs` tests (`cancel_arriving_while_capture_start_is_blocked_
still_cancels_the_session`, the `cancel_all_hold` sibling, and the
no-cancel control) only call `do_cancel`, never `do_stop`, in that
window.

Fix direction (not prescribing): either have `signal()` treat
`handles == None` the same way `trigger_cancel` now does (queue the Stop
intent and apply it in `attach_handles`, mirroring `cancel_requested`),
or have `do_stop`/`handle_live_activity_stop_intent` return
`UnknownSession`/retry instead of hard-panicking when the session hasn't
finished attaching yet.

### F1 (round-1 finding) — otherwise correctly fixed, verified in depth

- `ActiveSession::cancel_requested: bool` added; `trigger_cancel` (now
  `fn trigger_cancel(active: &mut ActiveSession)`) sets it instead of
  silently returning when `handles` is `None`.
- `attach_handles` now takes `&mut` access, sets `handles = Some(..)`
  first, then checks `cancel_requested` and re-invokes `trigger_cancel`
  — at that point `handles` is `Some`, so the real signal/abort actually
  fires. Ordering is correct: no window where a caller could observe
  "handles attached, cancel silently dropped."
- `request_cancel`/`cancel_all_hold` both now take the lock as `&mut`
  (needed for `trigger_cancel(&mut ActiveSession)`) and still do the
  check-and-act atomically under one lock acquisition, preserving the
  earlier F1/F2-era TOCTOU fix.
- `do_cancel` (commands.rs): when `request_cancel` succeeds but
  `outcome_receiver(id)` returns `None` (handles not attached yet),
  it returns `Ok(())` immediately without awaiting anything — and this
  is now **honestly documented** in `do_cancel`'s own new doc-comment
  paragraph ("Documented exception ... this call's 'cleanup already
  visible' guarantee is relaxed for this one narrow, short-lived
  window"). This is a reasonable, disclosed trade-off, not a silent gap
  — good.
- Cancel-before-`begin()`: trivially fine, `request_cancel` returns
  `false` (`UnknownSession`), same as any unknown id, unrelated to this
  window.
- Cancel arriving after `attach_handles` but before the pipeline task's
  first poll: fine — `handles` is `Some`, `trigger_cancel` runs the real
  `Stage::Recording` branch (`control_tx.send(Cancel)`), which the
  pipeline task's `select!` picks up on its very first poll; no
  window here distinct from the pre-existing, already-reviewed
  Recording-phase cancel path.
- `ActiveSession::handles`'s doc comment: corrected as instructed — now
  accurately states the window is real and explains why
  `cancel_requested` makes it safe (for the cancel path — see F-NEW
  above for the gap it doesn't cover).
- New tests (`commands.rs`): `BlockingStartCapture` genuinely blocks a
  real OS thread inside `AudioCapture::start` via a
  `oneshot`(ready)/`mpsc`(release) handshake — confirmed by reading the
  full harness (`blocking_start_state`, `ready_rx.await`, `release_tx.
  send`). All three new tests (`cancel_arriving_while_capture_start_is_
  blocked_still_cancels_the_session`, the `cancel_all_hold` sibling, and
  `start_with_no_cancel_in_the_blocking_window_is_unaffected`) run on
  `flavor = "multi_thread", worker_threads = 2` (required — a
  single-worker runtime would deadlock: the blocked `capture.start()`
  call itself runs on tokio's separate blocking-pool, not a worker
  thread, but `do_start`'s awaiting task and the concurrent `do_cancel`
  call both need a live worker each). Assertions genuinely cover: slot
  freed (`!state.sessions.has_active()`, polled with a bounded 500×2ms
  retry loop — no fixed sleep race), capture backend actually stopped
  (`!mock.is_running()`), rec file deleted (`read_dir(..).count() == 0`).
  "No HTTP call happened" is not asserted by a literal mock-server
  absence check, but is implied correctly: `AppConfig::default()` +
  `Mode::Hold` + a `Cancelled` guard outcome means `should_transcribe`
  is false, so `run_transcription` (the only HTTP call site) is never
  reached — consistent with the pre-existing, independently-tested
  cancellation contract elsewhere in `pipeline.rs`. "State idle" is not
  asserted via `state()` directly but is logically implied by
  `!has_active()` (per `SessionGuard::state()`'s own `None -> Idle`
  mapping) — acceptable, if slightly indirect.
- do_start_runs_capture_start_off_the_async_worker_thread: legitimate,
  deterministic thread-identity check, no timing assumptions.

### F2 (round-1 finding) — correctly fixed, verified in depth

- `DictationResult.session_id` (`models.rs`) added, `#[serde(rename_all
  = "camelCase")]` makes the wire field `sessionId` — confirmed via the
  updated snapshot test and fixture.
- `pipeline.rs::finalize`: all three `DictationResult { .. }`
  constructions (`should_transcribe == false`, `TranscribeOutcome::Text`,
  `TranscribeOutcome::Aborted`) now set `session_id: id.clone()` from the
  real, correct session id — verified in the diff, no stray/default id.
- `contract/fixtures/dictation-result.json` updated with a `sessionId`
  field; `contract.test.ts` and the fixture-parsing round-trip test both
  updated to match.
- `guest-js/src/types/contract.ts`: `DictationResult.sessionId:
  SessionId` added to the interface; `parseDictationResult` now parses
  and requires it (`expectString(value.sessionId, ...)`) — a missing
  `sessionId` now fails parsing rather than silently producing an
  incomplete object. Doc comment above the interface correctly explains
  *why* (the post-reorder narrow race) and correctly instructs
  "never by assuming 'the next result event after my start()' is
  necessarily mine."
- `guest-js/src/client.ts::dictate()`: tracks `sessionId` (set only once
  `client.start(mode)` resolves, via a new `.then((id) => { sessionId =
  id; })` link in the promise chain), and the `RESULT_EVENT` listener
  now does `if (sessionId === undefined || event.payload.sessionId !==
  sessionId) return;` before resolving — correctly ignores a result that
  arrives *before* `sessionId` is known (i.e. before `start()` itself
  resolved) as well as one for a different, foreign id. Doc comment
  above `dictate()` was rewritten to state the real guarantee
  (`[fixed per REJECT-FIX F2]`) instead of the previously-overstated
  "next result event == mine" claim.
- New test `"ignores a voxis://result event carrying a foreign session id
  [F2]"` (client.test.ts): genuinely emits a `voxis://result` with
  `sessionId: "session-0-not-mine"` first, asserts the `dictate()`
  promise has *not* settled (`settled === false` after flushing
  microtasks), then emits the matching `sessionId: "session-1"` result
  and asserts the promise resolves with exactly that payload. This is a
  real, meaningful assertion, not a tautology.
- `models.rs::ERROR_EVENT`/session_id doc comments cross-reference the
  finding accurately.
- `pipeline.rs`'s reorder comment (`drop(file); sessions.end(&id);` then
  `RESULT_EVENT` emit) — confirmed the emit still happens strictly after
  both cleanup steps, preserving the round-2-review M1 "slot free ==
  file gone" property while also being after cleanup, and the comment
  now explicitly extends the "cleanup must complete before publish"
  reasoning to `voxis://result` too (`[ADO-3b]` paragraph) — accurate.
  New pipeline test `result_event_fires_only_after_the_session_slot_is_
  freed` uses a decorator `SlotCheckingSink` that snapshots
  `!sessions.has_active()` synchronously *inside* the `emit()` call for
  `RESULT_EVENT` specifically — genuinely would have failed under the
  old ordering, a real regression test, not just a happy-path check.
- `README.md`'s command-table and event-table rows for `stop`/
  `voxis://result` updated consistently with the new field and the new,
  honestly-stated narrower race.
- host-min smoke (`examples/host-min`, not in this diff): confirmed by
  reading `scripts/host-min-smoke.sh` and `src-tauri/src/lib.rs`'s
  `install_smoke_listeners` — it prints the *raw* `event.payload()` JSON
  and the smoke script asserts via `grep`/substring matching (`grep
  "RESULT_EVENT" ... | tail -1`, pattern-matched against expected
  substrings like `finalized` or dictionary-rewritten text), not a
  literal/exact-shape JSON comparison. Adding a new `sessionId` field to
  the payload does not change any byte sequence the existing grep
  patterns look for — consistent with the pre-verified smoke pass being
  genuinely compatible, not accidentally so.

## Checked OK

- `secrets.rs::save()`: confirmed `sync_all()` is called on the temp
  file, inside the same closure, immediately before `fs::rename` — the
  doc comment's "atomicity is about visibility, not durability" framing
  is accurate and now backed by the actual `sync_all()` call (round-1's
  minor is resolved). Temp file removed on both the write-failure and
  rename-failure paths; new test
  `file_secret_store_save_leaves_no_temp_file_behind` asserts the
  directory contains exactly `secrets.json` after a successful save,
  genuinely catching an orphaned-temp-file regression.
- `PanicOnStopCapture`'s doc comment was corrected to accurately
  describe what it now exercises post-`[ADO-8]` (an ordinary `JoinError`
  → `Err` path, not a real unwind) rather than leaving the stale round-1
  framing in place — round-1's minor finding is resolved. A **new**,
  distinct test (`a_panic_inside_finalizes_own_body_outside_spawn_
  blocking_still_frees_the_session_slot`, via `PanicOnIdleStateSink`
  panicking synchronously inside `deps.events.emit(STATE_EVENT, "idle")`,
  which runs directly in `finalize`'s own body, never inside
  `spawn_blocking`) genuinely re-injects a real unwind through
  `finalize`/the spawned pipeline task and confirms `SessionSlotGuard::
  drop`'s panic-recovery path (`sessions.has_active() == false`,
  `sessions.begin(..)` succeeds afterward) is still exercised by
  *something* in the suite. Verified this panic site is reached before
  `finalize`'s own `sessions.end(&id)` call (state:idle emit precedes
  `drop(file); sessions.end(&id);` in the current file), so the sender
  really is dropped without publishing, as the test's own comment
  claims.
- `regex` dependency: grepped `crates/tauri-plugin-voxis/src` directly —
  zero `regex::` usages remain outside doc comments; `Cargo.toml`'s
  removal and `Cargo.lock`'s corresponding entry removal are consistent
  and complete, not a dangling loose end this time (round-1's minor is
  fully resolved, not just "acknowledged").
- `voxis_core::storage::dictionary::apply_entries` shared function:
  confirmed both `DictionaryStorage::apply` (voxis-core) and
  `tauri-plugin-voxis::pipeline::apply_dictionary` now delegate to it —
  single implementation, no drift risk; matches round-1's "Checked OK"
  assessment, now with the `regex` dependency itself also cleaned up on
  the plugin side.
- Shared `EventSink`: `desktop_hotkey_factory` now takes `events: Arc<dyn
  EventSink>` as a parameter and `build()` passes the *same* `Arc`
  (`events.clone()`) it constructed for `PluginState` — round-1's minor
  (two independent `TauriEventSink` instances) is fully resolved, not
  just documented; verified via `lib.rs`'s `build()` body.
- `PanicOnStopCapture`/`ThreadRecordingCapture` (`pipeline.rs`) `stop()`-
  side `spawn_blocking` test (`finalize_runs_capture_stop_off_the_async_
  worker_thread`) is analogous to and consistent with the `do_start`-side
  one — both genuinely assert a thread-identity mismatch, not a timing
  heuristic.

## Minors

- `SessionGuard::signal`'s doc comment (unrelated to F-NEW's `.expect()`
  line itself, which needs the code fix, not just the doc) still reads
  "works whether the session is still Recording ... or already
  Transcribing" — true, but doesn't mention the third, now-real
  possibility (handles not yet attached) that this same file's
  `ActiveSession::handles` doc explicitly warns about a few dozen lines
  above. Once F-NEW is fixed, this doc comment should be updated to
  match, the same way `ActiveSession::handles`'s was.
- `session.rs::transcribe_abort_cell`/`lease_tracker` degrade to `None`
  when `handles` is `None` rather than asserting — correct defensively,
  but worth a one-line comment noting they're intentionally lenient
  where `signal()` is not (would have made the F-NEW asymmetry easier
  to spot in review).
- iOS `AudioCapture.swift`: `engineNeedsRebuildAfterReset` is a plain
  `Bool` read/written only from `self.queue` (the notification handler
  dispatches via `self?.queue.async { ... }`, and `startEngine()`'s own
  check-and-clear also appears to run on the same serial queue based on
  the surrounding class's existing pattern) — not independently
  re-verified line-by-line for every call site in this pass, flagged
  only as a "worth a second look" item, not a concrete bug found.
- `voxis-core/src/storage/config_sqlite.rs`'s replacement test
  (`test_backend_text_processing_overlay_size_margin_llm_provider_and_
  dictionary_learning_mode_persist_through_roundtrip`) is unrelated to
  F1/F2 and out of this round's explicit verification scope — not
  re-reviewed in depth this pass beyond confirming it's present in the
  diff as described; round-1 already checked the coverage claim in
  detail and this diff doesn't touch it further.

## Manual notes

- F-NEW is the reason for `REJECT-FIX`: it's a concrete, traceable,
  release-mode-crash-causing gap in the exact fix under review (F1),
  found by tracing every reader of `ActiveSession::handles` rather than
  just the ones round-1 flagged. It is narrowly scoped (one `.expect()`
  in `SessionGuard::signal`, mirrorable to the same `cancel_requested`
  pattern `trigger_cancel`/`attach_handles` already use), so `REJECT-FIX`
  rather than `REJECT-REDO`.
- F1 and F2 as originally scoped by round-1 are otherwise both correctly
  and thoroughly fixed, with honest documentation of the residual,
  narrower trade-offs each fix intentionally leaves (do_cancel's relaxed
  "cleanup visible" guarantee; session_id-based correlation replacing an
  ordering assumption). Do not re-litigate those; only F-NEW blocks
  approval.
- I could not independently re-run the worker's reported test/clippy/
  build counts in this pass (read/grep-only per this review's
  constraints); all "pre-verified" claims in the task prompt are taken
  as given, not re-executed here.
