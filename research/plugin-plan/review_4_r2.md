# Task 4 — Round 2 Review (fresh reviewer, read-only)

VERDICT: APPROVE with minors — all 7 round-1 REJECT-FIX items verified FIXED at the cited lines; one new non-blocking Medium (pre-existing design gap, not introduced by the fixes) and a handful of nits, none of which warrant another round.

Scope reviewed: `/tmp/ado.C4YWdv/diff_4_r2.patch` (full 2090 lines read), plus targeted line-number confirmation in the working tree (`desktop.rs`, `desktop/pure.rs`, `hotkey_desktop.rs`, `lib.rs`, `commands.rs`, `session.rs`). No cargo runs (facts pre-verified by orchestrator: plugin 91/132 tests green, clippy clean, iOS build green, host-min builds, workspace 1217/0). `git diff --cached --stat` is empty → nothing staged.

## Round-1 checklist

| ID | Status | Evidence |
|----|--------|----------|
| **H1** double `take_peak()` → peak always 0 | **FIXED** | `desktop.rs:214` single `let peak = window_peak.take_peak();` → `desktop.rs:218` `pure::level_sample_from_peak(peak, false, cap_hit)`. `pure.rs:75` `level_sample_from_peak(peak, muted, cap_hit) -> LevelSample { rms: peak, peak, .. }` — single `f32` arg makes the double-drain structurally impossible. Test `pure.rs` `level_sample_from_peak_rms_equals_peak_and_is_nonzero` asserts `rms != 0.0 && rms == peak == 0.5` from one drained accumulator. |
| **H2** unordered per-edge tasks → quick tap stuck | **FIXED** | `lib.rs:311` `tokio::sync::mpsc::unbounded_channel()`; `lib.rs:318` `run_hotkey_edge_loop` is the single consumer (`while let Some(..) = edge_rx.recv().await`), calling `apply_hotkey_edge(..).await` (`lib.rs:271`) one edge at a time — `do_start().await` fully resolves and `*active = Some(id)` is set before the next edge is dequeued. Pure `decide_hotkey_action` (`lib.rs:249`) covers the 7-row table. **rdev thread non-blocking:** `hotkey_desktop.rs:306` callback → `actions.on_pressed(mode)` → `lib.rs:329/333` `edge_tx.send(..)` only (UnboundedSender::send never blocks). **Release during in-flight start:** it is queued, not dropped; dequeued after `do_start` returns with `active = Some` → `HotkeyAction::Stop` → `do_stop`. Covered by `lib.rs:511` `quick_hold_tap_starts_then_stops…`, `lib.rs:529` toggle double-tap, `lib.rs:548` toggle-release-noop. **Bounded/unbounded:** unbounded — fine, edges are human-rate. **If loop task dies:** loop exits only when all senders drop (sender lives in `PluginHotkeySink` → `RdevHotkey` → `PluginState`, i.e. never) or on a panic inside `apply_hotkey_edge`; after a panic, `edge_tx.send` returns `Err` which is silently discarded (`let _ =`) → hotkey silently dead until restart. See Minor N1. `app.state::<PluginState>()` at `lib.rs:321` is only reached on first edge, which requires a `set_hotkey` command, which requires the state to be managed — no startup-order panic. |
| **M1** cap_samples 16 kHz vs native buffer | **FIXED** | `desktop.rs:358` `scale_cap_samples(max_samples.load(), config.sample_rate().0)` stored back into `max_samples` *before* `build_stream_for_format`; `start()` re-stores the raw 16 kHz cap and resets `native_rate=0` each session, so no double-scaling across sessions. `pure.rs:89` passthrough for `usize::MAX` and `native_rate == 0`, u128 math; tests `scale_cap_samples_{scales_16k_cap_to_native_rate,usize_max_passes_through_unscaled,zero_native_rate_passes_through_unscaled}`. Module doc "Self-cap unit" bullet present. |
| **M2** cpal `err_fn` only logged | **FIXED** | `desktop.rs:472` `err_fn` → `pure::record_stream_runtime_error` (`pure.rs:119` sets `last_error` + `stage = FAILED`). Level thread `desktop.rs:231` `_ => return` on FAILED → ticks stop (liveness). **`stop()` consults `last_error`:** `desktop.rs:255` `if let Some(cause) = self.last_error.lock().unwrap().take() { return Err(CaptureError::Backend(cause)); }` after joining both threads, before WAV finalization. `stop()` storing `STOPPED` at the top overwrites `FAILED` on the stage flag, but the error is carried by `last_error`, so the outcome survives; `desktop.rs:410` `compare_exchange(RUNNING→STOPPED)` in the audio thread likewise preserves a `FAILED` set by `err_fn`. Test `record_stream_runtime_error_sets_last_error_and_failed_stage`. |
| **M3** fixed 250 ms startup sleep | **FIXED** | `pure.rs:104` `stage::{STARTING,RUNNING,FAILED,STOPPED}`; level thread `desktop.rs:222` STARTING → `sleep(20ms)` and re-poll (no tick, no give-up), RUNNING → tick + 250 ms, `desktop.rs:231` FAILED/STOPPED → exit. Audio thread sets RUNNING only after `stream.play()` succeeds. |
| **L1** gen/schemas + .gitignore | **FIXED** | `.gitignore` adds `crates/tauri-plugin-voxis/examples/host-min/src-tauri/gen/`; pre-verified not in tree; diff no longer carries the 4.8k schema lines. |
| **L2** `set_hotkey` checks `startup_result` every call | **FIXED** | `hotkey_desktop.rs:271` `else if let Some(result) = self.startup_result.lock().unwrap().clone() { return result.map_err(PermissionDenied) }` on the non-spawning path. First call still bounded by `STARTUP_GRACE` 300 ms (`:230/:261`). |
| Minor: redundant `store(true)` | **FIXED** | `desktop.rs:161` `swap(true, AcqRel)` only. |
| Minor: `HotkeyTracker.held` cleared on release | **FIXED** | `hotkey_desktop.rs:191` `self.held.clear()` inside the release-trigger branch, with rationale comment. |

## New findings

**N-M1 (Medium, non-blocking, pre-existing in round-1 design — not caused by the H2 fix): hotkey loop's `active` can go stale when a session ends by any path other than the hotkey itself.**
`lib.rs:271-283` — `active` is only cleared by the loop's own `Stop` action. If a session ends via the UI `stop`/`cancel` command, `cancel_all_hold`, the max-duration cap, the silence guard (when enabled), or a pipeline failure, `SessionGuard.end()` clears the real slot but `active` remains `Some(stale_id)`. Consequences with `decide_hotkey_action`:
- Hold: next press → `(Hold, Pressed, Some)` = **Noop** (swallowed); the release → `do_stop(stale)` → `Err(UnknownSession)` (`session.rs:265`), ignored, `active` cleared. Net: the first hold-to-talk after a non-hotkey stop records nothing.
- Toggle: next press → `Stop` on the stale id → `Err`, cleared; user must press again to start.
Suggested one-line reconcile at the top of `apply_hotkey_edge`: `if active.as_ref().is_some_and(|_| !state.sessions.has_active()) { *active = None; }` (`has_active()` exists at `session.rs:210`; it covers Transcribing too, so it won't clear a live hotkey session mid-transcription). Plus one test: end the session via `state.sessions.end(&id)` (or `do_stop` directly), then assert a Hold press starts a new session. Recommend folding into Task 4 if the worker touches `lib.rs` again, otherwise carry as a follow-up — it does not reintroduce a stuck recording (nothing is left active), so it does not block.

**N-M2 (Low, design note): the edge loop is serialized behind transcription latency.**
`commands.rs:72` `do_stop` awaits the *full* pipeline outcome (upload + STT), so a Hold release parks `run_hotkey_edge_loop` for the whole transcription. Edges arriving meanwhile are queued and replayed afterwards (a press+release pair during transcription would start-then-immediately-stop a new session; a toggle tap would start one after the previous finished). Balanced, never stuck, and `SessionGuard` single-flight means a concurrent start would be rejected anyway — so this is consistent, just worth knowing. If desired later, await only the `signal(Stop)` ack rather than the outcome.

No other correctness issues found. Feature gating, `catch_unwind` on cpal build/play, rdev `set_is_main_thread(false)` under `cfg(target_os = "macos")`, host-min path dep (`../../..` → `crates/tauri-plugin-voxis`), CSP, capability file, and workspace membership all check out.

## Minors

- **N1** `lib.rs:329/333` `let _ = self.edge_tx.send(..)` — a closed channel (loop task panicked) is silently swallowed; add `tracing::error!` on `Err` so a dead hotkey loop is diagnosable.
- **N2** `lib.rs:243` `HotkeyEdge` duplicates `hotkey_desktop::Edge` (`hotkey_desktop.rs`); could reuse one enum.
- **N3** `desktop.rs:214-220` level thread sleeps a full 250 ms while RUNNING, so `stop()` blocks up to ~250 ms on `level_thread.join()`; slicing the sleep (e.g. 20 ms × N with a stage check) would make stop snappier. Pre-existing, cosmetic.
- **N4** `desktop.rs:255` error path of `stop()` returns before clearing `samples`/`path`/`start_instant`; they are reset at the next `start()`/`reset()`, so no leak of behaviour, only of memory until then. Fine, but a `reset()`-style cleanup there would be tidier.
- **N5** `hotkey_desktop.rs:261-270` first-call 300 ms grace still returns `Ok(())` on timeout even if `rdev::listen` fails at 301 ms; L2 mitigates this on the *next* `set_hotkey`, but the very first registration can report success for a listener that later dies. Acceptable given rdev's fail-fast behaviour; documented in module doc.
- **N6** `Cargo.toml` (root): host-min added as a workspace member means `cargo test --workspace` now compiles a full `tauri` app target; pre-verified green (1217/0), just a CI-time cost to be aware of.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only review; no repo files edited. Only artifact written is /tmp/ado.C4YWdv/review_4_r2.md. All 7 round-1 REJECT-FIX items (H1,H2,M1,M2,M3,L1,L2) plus two minors verified FIXED with file:line evidence; verdict APPROVE with minors."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report contains per-item file:line citations (desktop.rs:214/218/255/358/472, pure.rs:75/89/104/119, hotkey_desktop.rs:191/271/306, lib.rs:249/271/311/318/321/329, session.rs:265), test names for each fix, one new Medium finding with a concrete one-line remedy, and six nits."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read /tmp/ado.C4YWdv/diff_4_r2.patch (3 reads, full 2090 lines)",
      "result": "passed",
      "summary": "Full diff reviewed"
    },
    {
      "command": "grep -n <fix anchors> crates/tauri-plugin-voxis/src/{desktop.rs,desktop/pure.rs,hotkey_desktop.rs,lib.rs}",
      "result": "passed",
      "summary": "Confirmed line numbers for every claimed fix"
    },
    {
      "command": "grep do_start/do_stop/begin/end/signal in commands.rs, session.rs",
      "result": "passed",
      "summary": "Confirmed stale-id do_stop yields Err(UnknownSession), not panic; has_active() exists"
    },
    {
      "command": "git diff --cached --stat; git status --short",
      "result": "passed",
      "summary": "Nothing staged; expected modified/untracked Task 4 files only"
    }
  ],
  "validationOutput": [
    "H1 FIXED desktop.rs:214/218 + pure.rs:75 + test level_sample_from_peak_rms_equals_peak_and_is_nonzero",
    "H2 FIXED lib.rs:311/318/271 single-consumer unbounded mpsc; rdev callback send-only (hotkey_desktop.rs:306 -> lib.rs:329); release queued behind in-flight start; tests lib.rs:511/529/548",
    "M1 FIXED desktop.rs:358 + pure.rs:89 + 3 tests",
    "M2 FIXED desktop.rs:472 err_fn -> record_stream_runtime_error; stop() consults last_error at desktop.rs:255",
    "M3 FIXED pure.rs:104 stage consts; desktop.rs:222/231 poll loop",
    "L1 FIXED .gitignore; L2 FIXED hotkey_desktop.rs:271; minors FIXED desktop.rs:161, hotkey_desktop.rs:191",
    "Pre-verified by orchestrator: plugin tests 91/132 green, clippy clean, iOS build green, host-min builds, workspace 1217/0"
  ],
  "residualRisks": [
    "N-M1: hotkey loop `active` goes stale after a non-hotkey session end (UI stop, cancel, max-duration cap, guard, pipeline failure) — next hotkey tap swallowed once; one-line reconcile against state.sessions.has_active() suggested (lib.rs:271)",
    "N-M2: edge loop serialized behind full transcription in do_stop; edges during transcription replay afterwards (balanced, not stuck)",
    "N1: closed edge channel send errors silently discarded (lib.rs:329/333)"
  ],
  "noStagedFiles": true,
  "diffSummary": "No repo changes by this reviewer. Reviewed worker diff vs bebdd35: desktop.rs (+497), desktop/pure.rs (+271), hotkey_desktop.rs (+524), lib.rs (+~200 incl. tests), commands.rs/error.rs small, Cargo.toml feature `desktop`, examples/host-min/**, .gitignore.",
  "reviewFindings": [
    "no blockers",
    "medium (non-blocking, pre-existing): lib.rs:271 apply_hotkey_edge — stale `active` after non-hotkey session end swallows the next hotkey tap; reconcile with state.sessions.has_active()",
    "minor: lib.rs:329/333 silent send failure; lib.rs:243 HotkeyEdge duplicates hotkey_desktop::Edge; desktop.rs:214 250ms stop latency from level-thread sleep; desktop.rs:255 error path leaves samples until next start; hotkey_desktop.rs:261 first-call 300ms grace can report Ok for a listener that fails later (L2 catches it on next call)"
  ],
  "manualNotes": "Anti-ping-pong rule applied: all round-1 items FIXED, new findings are non-blocking -> APPROVE with minors. Parent may choose to fold N-M1 (one-line + one test) into Task 4 before merge or defer to a follow-up."
}
```
