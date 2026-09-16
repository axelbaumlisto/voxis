# BLIND review R1 — Rust concurrency/safety, `crates/tauri-plugin-voxis/src` (+ `voxis-core/src/profile*`)

VERDICT: SHIP

Scope reviewed: `session.rs`, `pipeline.rs`, `commands.rs`, `lease.rs`, `secrets.rs`,
`capture.rs` (RecDir/RecFile), `error.rs`, `hotkey_desktop.rs` (permission mapping),
`lib.rs` (hooks/Live-Activity), `voxis-core/src/profile/{secret.rs,crypto.rs}`. Baseline:
`cargo test -p tauri-plugin-voxis --lib` → **124 passed; 0 failed** (2.86s).

## Blockers
None found. Every judged hazard is handled in code and pinned by a test I read.

## Should-fix (non-blocking)
- **`commands.rs:127-135` (`wait_for_outcome_receiver`) busy-spins with `tokio::task::yield_now()`**
  while `handles` is `None` (the `spawn_blocking(capture.start)` window). Correct and bounded by
  `is_active(id)`, but it is a tight cooperative spin: on a single-worker runtime it burns the
  scheduler slice repeatedly until `attach_handles` runs on the same worker. In practice the window
  is microseconds and yields cooperatively, so this is a polish note, not a defect. A short
  `tokio::time::sleep(Duration::from_millis(1))` would bound CPU without changing semantics.
- **`pipeline.rs:245-247 / 264-270` final cancel re-check is inherently racy at the "already
  completed" boundary**: a `cancel()` that lands *after* the last `cancelled.load(SeqCst)` passed
  and the real result is published will be a no-op and the real text is reported. This is the
  correct/only-possible semantics (cancel arriving after transcription fully finished is "too
  late") and is documented; noting only so a later reviewer doesn't mistake it for a missed check.
- **`pipeline.rs` builds `TranscriptionClient` from `api_key.expose()`**: the `Secret` is
  `ZeroizeOnDrop`, but once the key crosses into `TranscriptionClient`/reqwest's bearer header it
  lives as a plain `String` for the client's lifetime (out of this crate's control). Acceptable and
  in line with the `expose()`-only-at-the-boundary design; flagged as a residual, not a fix.

## Verified OK (what I actually checked in code + tests)
- **Single-flight + `SessionSlotGuard` on panic** (`session.rs:120-130`, `pipeline.rs:79-118`):
  `begin()` rejects a second session in *both* `Recording` and `Transcribing`
  (`second_begin_while_active_is_already_recording_even_during_transcribing`). `SessionSlotGuard::drop`
  calls `sessions.end(&id)` on any unwind through the task; `a_panic_inside_finalize_still_frees_the_
  session_slot` proves the slot frees and the next `begin` succeeds. `finalize`'s explicit `end` + a
  second `end` via the guard is a harmless `UnknownSession` no-op.
- **Cancel/Stop during the start window (`handles == None`)**: `trigger_cancel`/`trigger_stop`
  record `pending: Option<ControlSignal>`; `attach_handles` applies it under one lock before any
  caller can observe un-cancelled handles. **Cancel precedence** is real: `trigger_stop` refuses to
  overwrite an already-pending `Cancel` (`session.rs:245-252`), and `trigger_cancel` always sets
  `pending = Some(Cancel)` unconditionally. Covered by `cancel_arriving_while_capture_start_is_
  blocked_*`, `cancel_all_hold_arriving_while_capture_start_is_blocked_*`, and the F-NEW
  `do_stop_arriving_while_capture_start_is_blocked_finalizes_normally_no_panic` +
  `live_activity_style_stop_*`.
- **`signal()`'s `.expect()` is unreachable in production**: grep confirms `sessions.signal(` is
  called only from tests; `do_stop`/`do_cancel` use `request_stop`/`request_cancel` +
  `outcome_receiver`. The `.expect()` premise ("handles always attached before any signal() caller")
  holds. Under `panic = "abort"` the former crash path (F-NEW) is genuinely closed.
- **`spawn_blocking` around capture start/stop**: `commands.rs:56-63` (start) and `pipeline.rs:216-224`
  (stop) both wrap the synchronous backend call; join panics fold into `CaptureError::Backend`.
  Pinned by `do_start_runs_capture_start_off_the_async_worker_thread` and
  `finalize_runs_capture_stop_off_the_async_worker_thread` (thread-id assertions).
- **Hold ≤120s + silence NoSpeech ⇒ no HTTP**: `decide()` maps `SilenceTimeoutNoSpeech` →
  `(NoSpeech, should_transcribe=false)` unconditionally (`pipeline.rs:190`), and `finalize` only
  reaches `run_transcription` when `should_transcribe`. `no_speech_discard_never_calls_transcription`
  asserts `mock.expect(0)`. `muted_sample_is_treated_as_silence_*` covers the muted-but-loud case.
- **Lease expiry**: `LeaseTracker` is per-session (fresh in `pipeline::spawn` only for `Mode::Hold`),
  `is_lost` uses `saturating_duration_since` (no underflow), 3s timeout. `hold_without_heartbeat_
  loses_lease_within_3s`, `stop_at_2_9s_...finalizes_not_lease_lost`, and
  `hold_release_hold_five_times...zero_false_cancels` (ABA) all pass. No shared/global timer.
- **`voxis://result` sessionId correlation + emit-after-slot-free**: `DictationResult` carries
  `session_id`; `finalize` drops the WAV, then `sessions.end(&id)`, then emits `RESULT_EVENT`, then
  publishes `outcome_tx` — i.e. slot-free and file-deleted strictly precede both the event and the
  awaiter waking. `result_event_fires_only_after_the_session_slot_is_freed` (decorator sink checking
  `has_active()` inside `emit`) locks this ordering.
- **Secrets zeroize + atomic `secrets.json`**: `voxis_core::profile::Secret(String)` derives
  `ZeroizeOnDrop` (compile-time-pinned test); `KeySource` and `derive_key`→`Zeroizing<[u8;32]>` too.
  `FileSecretStore::save` writes a `0600` temp file (unix `OpenOptions::mode` on `O_CREAT`),
  `sync_all()`, then same-dir `fs::rename` (atomic-for-visibility), removing the temp on any error;
  `file_secret_store_save_leaves_no_temp_file_behind` + `..._is_0600_on_unix` pass.
- **RecDir sweep + RecFile 0600**: `RecFile::create` applies `0600` atomically via `O_CREAT` mode
  (no chmod window); `Drop` unlinks on every exit. `RecDir::sweep` deletes orphans, tolerates a
  single undeletable file (warns, keeps going), creates the dir on first run. Startup sweep runs
  unconditionally in `build().setup` before `app.manage`. `sigkill_simulation_leaves_rec_dir_empty_
  after_fresh_init`, `sweep_deletes_orphan_files`, `sweep_does_not_fail_the_whole_sweep...` pass.
- **Error mapping to `voxis://error` (late rdev failure → permissionDenied)**: `report_listen_failure`
  (`hotkey_desktop.rs:137-141`) records the outcome AND emits `ERROR_EVENT` with
  `PluginError::PermissionDenied`, so a listener dying after the 300ms grace still reaches the host;
  `set_hotkey` re-checks `startup_result` on *every* call (L2 fix), not just the spawning one.
  `late_listener_failure_emits_an_error_event` asserts `{"kind":"permissionDenied", ...}`. Permission
  detection is never on the press path (module doc) — the original stuck-recording root cause.
- **`cancel_all_hold` safety hooks**: `on_page_load` (iOS WKWebView reload after crash) and
  desktop `WindowEvent::Destroyed`/`Exit`/`ExitRequested` both call `cancel_all_hold`; Toggle
  sessions untouched (`cancel_all_hold_ignores_toggle_sessions`). No lock reentrancy — `trigger_cancel`
  only does a non-blocking `watch::send`/`AbortHandle::abort` under the sessions lock.
- **No `.unwrap()` on user/network input on a reachable path**: the `serde_json::to_value(...).unwrap()`
  calls are all on internal, infallibly-serializable types (`State`, `LevelEvent`, `DictationResult`,
  `PluginError`). `PluginError` is internally-tagged and each variant serializes as a map (verified by
  error.rs tests) so it can cross IPC. Setup uses `?` on `app_config_dir()`/`app_cache_dir()` instead
  of silently defaulting to CWD.
- **TOCTOU (F2)**: `finalize` re-reads `cancelled` (`already_cancelled`) before deciding to transcribe;
  `run_transcription` re-checks after file read, after `secrets.get()`, and after the HTTP join — so a
  cancel racing any of those points still yields `Aborted`, never a reported transcription for a
  cancelled session. `cancel_during_transcribing_aborts_http_and_deletes_file` exercises the direct
  abort-handle path.

## Not covered
- guest-js / `<voxis-overlay>` / HotkeyMachine (TS) and the `naked` host (`NakedVoxisSecretStore`,
  paste sanitization) — outside this role's Rust scope.
- iOS Swift `AVAudioEngine`/Live-Activity bridge (`mobile.rs` real device path) — only the host-side
  `handle_live_activity_stop_intent` branch is unit-tested; on-device IPC not exercised here.
- `profile_source.rs` QR/LAN-import HTTP correctness and `voxis-core` transcription client internals
  (beyond confirming the `Secret`/`KeySource` zeroize boundary) — deferred to the core/profile
  reviewer; I only verified the secret-handling and atomic-write surfaces touching this crate.
- No `cargo miri`/loom run (not requested; ≤25-call / minute-40 budget). Concurrency judged by reading
  the lock discipline (SessionGuard's `std::sync::Mutex` is never held across an `.await`) plus the
  passing multi-thread race tests.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Review-only task; no source edited. Findings confined to the assigned Rust concurrency/safety scope (session/pipeline/commands/lease/secrets/capture/hotkey/lib + voxis-core profile secret/crypto). Report written to the authoritative output path."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Each Verified-OK item cites concrete file:line and the specific passing test that pins it; baseline `cargo test -p tauri-plugin-voxis --lib` = 124 passed/0 failed captured; signal() production-unreachability confirmed by grep."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "cargo test -p tauri-plugin-voxis --lib 2>&1 | tail -5",
      "result": "passed",
      "summary": "124 passed; 0 failed; 0 ignored; finished in 2.86s"
    },
    {
      "command": "grep 'sessions.signal(' crates/tauri-plugin-voxis/src",
      "result": "passed",
      "summary": "signal() called only from #[cfg(test)] code; production uses request_stop/request_cancel — .expect() premise holds"
    }
  ],
  "validationOutput": [
    "test result: ok. 124 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.86s"
  ],
  "residualRisks": [
    "wait_for_outcome_receiver busy-spins with yield_now() in the microsecond capture.start window (bounded, correct, CPU-polish only)",
    "final cancelled re-check in run_transcription is inherently racy at the already-completed boundary — correct semantics, documented",
    "API key becomes a plain String inside TranscriptionClient/reqwest after expose() (outside this crate's zeroize control)"
  ],
  "noStagedFiles": true,
  "diffSummary": "No code changes — blind concurrency/safety review only.",
  "reviewFindings": [
    "no blockers",
    "should-fix: commands.rs:127-135 wait_for_outcome_receiver busy-spin (CPU polish)",
    "should-fix: pipeline.rs final cancel re-check is race-at-completion-boundary (documented, acceptable)"
  ],
  "manualNotes": "SHIP for the Rust concurrency/safety scope. Single-flight, SessionSlotGuard panic recovery, pending Cancel-precedence at attach_handles, spawn_blocking capture start/stop, NoSpeech-no-HTTP, per-session lease, emit-after-slot-free result correlation, zeroize + atomic 0600 secrets.json, RecDir sweep, and late-rdev→permissionDenied error mapping are all implemented and covered by passing tests. Not covered: guest-js/TS, naked host, on-device iOS Swift, profile_source HTTP internals."
}
```
