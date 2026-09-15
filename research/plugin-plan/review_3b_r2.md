VERDICT: REJECT-FIX

Scope of the rejection is deliberately narrow: the F2 *code* is correct and in place; what is missing is the deterministic test coverage round-1 explicitly asked for on a privacy-critical race. Everything else on the checklist is FIXED. No redo, no new design front.

## Round-1 checklist

### F1 (HIGH) — Tauri hooks → cancel_all(Hold): **FIXED**
- `session.rs` (`diff_3b_r2.patch:2460-2515`): `SessionGuard::request_cancel(id) -> bool` and `cancel_all_hold()` both delegate to a private `trigger_cancel(active)` under a single `self.active.lock()` acquisition. `cancel_all_hold` checks `active.mode == Mode::Hold` and otherwise does nothing.
- `commands.rs` `do_cancel` (`patch:499`) calls `state.sessions.request_cancel(id)` — shared path, no drift.
- `lib.rs` (`patch:1390-1408`): `.on_page_load(|webview, _| if let Some(state) = webview.try_state::<PluginState>() { state.sessions.cancel_all_hold(); })` — fetches via `try_state`, correct. `.on_event(|app, event| matches!(event, RunEvent::WindowEvent { event: WindowEvent::Destroyed, .. } | RunEvent::Exit | RunEvent::ExitRequested { .. }))` then `app.try_state::<PluginState>()` → `cancel_all_hold()`. Variants are the right ones (Destroyed is the terminal window event; Exit + ExitRequested cover both exit paths).
- Tests (`session.rs`, `patch:2780-2810`): `cancel_all_hold_ignores_toggle_sessions` (flag stays false) and `cancel_all_hold_cancels_a_hold_session` (flag true). Plus `request_cancel_sets_the_flag_and_signals_the_recording_phase`, `request_cancel_on_unknown_id_returns_false`, `request_cancel_while_transcribing_aborts_directly_instead_of_signalling`. Note: "file deleted" is not asserted in the session-level tests (sessions no longer own the `RecFile` — it moved into the pipeline task), but file deletion on the cancel path is covered by `cancel_during_transcribing_aborts_http_and_deletes_file` and `cancel_frees_the_slot_and_deletes_the_file_even_if_capture_stop_fails`. Acceptable.

### F2 (MEDIUM, privacy) — cancel TOCTOU: **PARTIAL (code FIXED, tests NOT DONE)**
Code:
- `SessionHandles::cancelled: Arc<AtomicBool>` (`patch:2373`), created in `pipeline::spawn` (`patch:1493`) and moved into the task.
- `trigger_cancel` (`patch:2503-2514`) stores `true` **unconditionally, before** the stage match that sends `ControlSignal::Cancel` or takes/aborts the handle. ✔
- Scenario A (guard loop self-finalized before the signal landed): `finalize` (`patch:1662-1664`) loads the flag after `capture.stop()`/`decide(...)` and **before** `mark_transcribing`; if set, forces `(GuardOutcome::Cancelled, should_transcribe=false)`. ✔
- Scenario B (abort_cell still `None` during file-read/secret/client-build): `run_transcription` checks the flag after `tokio::fs::read` and before `secrets.get`/client build/`tokio::spawn` (`patch:1722`), and again after `handle.await` (`patch:1758`). ✔ Both windows are covered for "no real text ever reported"; scenario B is also covered for "no upload" except for the sub-µs gap noted in Minors.
Tests:
- **No pipeline-level test exercises the flag paths.** `grep` over the pipeline.rs hunk (`patch:1412-2284`) finds `cancelled` only in implementation lines — zero test references, no `request_cancel` call from pipeline tests, no `expect(0)` mock. The only cancel-during-transcribing test (`cancel_during_transcribing_aborts_http_and_deletes_file`, `patch:2119`) still aborts the handle directly after polling until `abort_cell.is_some()` — exactly the test round-1 described as *not* covering the race. Session-level tests only assert the bool flips.
- Round-1 F2 asked explicitly: "Add a test: signal Stop, then cancel while `abort_cell` is still `None` (e.g., via a `SecretStore` that blocks), assert mockito `expect(0)`." The orchestrator checklist requires "at least one deterministic test per scenario". Neither exists.
- **Required fix (small, test-only):**
  1. Scenario B: `SecretStore` (or `AudioCapture::stop`) that blocks on a oneshot; `signal(Stop)`; wait until `stage_of == Transcribing && abort_cell.is_none()`; `sessions.request_cancel(&id)`; release the block; assert outcome `guard_outcome == Cancelled`, `text == ""`, mockito mock `.expect(0)` asserted, file deleted, slot freed.
  2. Scenario A: with `start_paused`, drive the guard loop to self-finalize (e.g. silence timeout) using a blocking `capture.stop()` so `finalize` is parked before the flag check; call `request_cancel` (stage still `Recording` → the `Cancel` send goes to a loop that already exited); release; assert `Cancelled` and `expect(0)` on the mock.

### F3 — Idle right after Error: **FIXED**
- `finalize` (`patch:1691-1696`): `if result.is_err() { emit(Error) }` then unconditionally `emit(Idle)`, then `RESULT_EVENT` only on `Ok`.
- `http_5xx_produces_transcription_error_and_deletes_file` (`patch:1945-1975`) asserts `sink.count(STATE_EVENT) == 4` ("Recording, Transcribing, Error, then back to Idle") and that the **last** state event is `"idle"`. Order verified. ✔

### F4 — slot freed on panic: **FIXED**
- `SessionSlotGuard { sessions, id }` with `Drop` calling `sessions.end(&id)` (`patch:1530-1540`), moved into the spawned task as `_slot_guard` before `record_phase(...)` (`patch:1509-1511`). Double `end` on the normal path is a harmless `UnknownSession`.
- Test `a_panic_inside_finalize_still_frees_the_session_slot` (`patch:2248-2283`) uses `PanicOnStopCapture` whose `stop()` panics; asserts `!sessions.has_active()` and a subsequent `begin` succeeds. ✔

### M2 — dead `started_at`/`elapsed_ms`: **FIXED**
- Removed from `ActiveSession` (`patch:2382-2387`, `2429`) and from `do_stop` (`patch:468`). No remaining references in the diff.

### M1 / M3 — deferred items: **NOT FILED (silently dropped)**
- No mention of M1 (`apply_entries` DRY into voxis-core) or M3 (shared-`SessionGuard` ABA test) anywhere in the diff, in `task_3b.md`, or in any `docs/*.md`. Deferring is fine (M1 is out of 3b's file scope; M3 is test-strength), but they need to be recorded — see Minors.

## New findings
None blocking. One small hardening nit on the F2 code (below) that can be folded into the same fix round since it touches the lines the new tests will exercise.

## Minors
- **N1 (F2 hardening, optional)** `run_transcription` checks the flag *before* `tokio::spawn`/storing the abort handle (`patch:1722`), whereas round-1 suggested re-checking *after* `*abort_cell = Some(handle.abort_handle())`. A `request_cancel` that lands between the pre-send check and the handle store (no `.await` in between, but the command runs on another thread) sets the flag and finds `abort_cell == None` → nothing aborted; the upload proceeds and only the post-receive check drops the result. Real text is never reported (privacy semantics preserved) but the audio bytes go out once. One extra line after the store closes it: `if cancelled.load(SeqCst) { handle.abort(); }`.
- **N2 (M1/M3 bookkeeping)** File M1 and M3 as explicit follow-ups (plan checklist / `docs/` TODO / issue) so they are not lost: M1 = extract `voxis_core::storage::dictionary::apply_entries(text, &[(String,String)])` and have both `DictionaryStorage::apply` and `pipeline::apply_dictionary` call it; M3 = `hold_release_hold_five_times���` should use one shared `SessionGuard`, send `hold_lease` with the previous id after each restart, and assert `UnknownSession` + no `LeaseLost`.
- **N3 (doc nit)** `trigger_cancel` silently returns when `active.handles` is `None` (window between `begin` and `attach_handles` in `do_start`, `patch:422-451`). `do_cancel` would then return `Ok(())` after `request_cancel` reports `true` while nothing was actually cancelled; the pipeline for that id then runs normally. Window is tiny and the frontend can't know the id before `start` returns, so only `cancel_all_hold` from a hook could hit it — and the Hold lease covers that. Worth a one-line comment on `trigger_cancel`; no code change needed.
- **N4** Session-level F1 tests assert the flag but not file deletion; fine given `RecFile` ownership moved, just noting the claim "Hold→Cancelled+file deleted" is only true end-to-end via the pipeline tests.

Pre-verified facts relied on (not re-run): workspace 1174/0, clippy clean, iOS build green, guest-js 184/184, themes byte-identical, scope clean.
