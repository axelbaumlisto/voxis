# BLIND architecture review #1 — silence-watchdog plan (`/tmp/swd-plan-clean.md`)

Reviewer lens: SOLID/DRY/KISS, Rust + Tauri. Blind review: only the plan, the listed source files, the `.diag`, and runtime logs were read. No project files modified.

Verdict up front: the **core fix (watchdog + shared stop path) is the right idea and is feasible**, but the plan's diagnosis contains several wrong facts, the DRY refactor is under-specified on the one thing that matters (single-flight stop), the silence criterion is undefined and coupled to a visualization knob, and two of the "defense-in-depth" layers as written do nothing (Spectrum → DEBUG) or miss half the disk damage (`failed_audio/`).

---

## 1. Errors (wrong facts, wrong reasoning)

### E1. "Process disappears = SIGKILL/jetsam caused by the stuck recording" — contradicted by evidence
- `diagnostics/heartbeat.crashed.json`: `pid 8404, wall_ts 1788146022` → **2026-08-31 03:13:42 UTC**, `reported_at 1788146084` (62 s later). This death is **not** from the 09-04 or 09-05 incidents; the gap is 62 s, not "7.5 h".
- `logs/voice.log.2026-08-31:2` — `previous instance died without shutdown` is the **only** such warning; `grep "died without"` over `voice.log.2026-09-0*` → no hits.
- `diagnostics/heartbeat.json`: `pid 925` (same PID as the `.diag`), `monotonic_uptime_s 546320` (6.3 days), last `wall_ts` → 2026-09-06 11:14 UTC. **pid 925 survived both the 09-04 (+10 GB footprint) and 09-05 incidents** and was alive ~15 h after the second one.
- The `.diag` is a **Microstackshots "disk writes" resource-limit report**, `Action taken: none` (line 22) — it is not a kill.
- Real user-visible failure is visible in logs instead: `voice.log.2026-09-04:73359 Ignoring hotkey press - stage: Recording`, `voice.log.2026-09-05:87078 ... stage: Recording` — the app is "deaf" while a stuck Recording lasts. The watchdog fixes exactly this; the jetsam narrative is unnecessary and wrong.

### E2. "Spectrum log = the disk writes from the `.diag`" — misattributed
- `.diag` lines 75–95: heaviest stacks — **20/39 samples in `heartbeat::persist_bytes_atomic`** (11 `rename`, 9 `write_all`), 18/39 in the tracing appender thread, 1 in `dispatch::spawn_worker` (the WAV write).
- By **bytes**: 09-04 wrote the 1 684 337 026-byte WAV **twice** — `debug_storage` (`pipeline.rs:38-41`) **and** `failed_audio` (`voice.log.2026-09-04:73371 Failed audio saved: id=001 ... 1684337026 bytes`). 2 × 1.68 GB ≈ 3.37 GB of the reported 3 677 MB. The 09-05 log file is 11 MB total — the Spectrum spam is a nuisance, not the disk-write budget.
- `heartbeat.rs:337-353` does `NamedTempFile` + `write_all` + **`sync_all()`** + rename **every 10 s unconditionally** (`heartbeat.rs:226-231`). The plan relegates this to "(check) 10 s interval OK".

### E3. "Lower Spectrum from INFO to DEBUG" removes 99.9 % of lines — false
- `setup/logging.rs:34-35`: `EnvFilter::from_default_env().add_directive(Level::DEBUG.into())` — the file appender already records DEBUG (the 09-05 log contains `DEBUG voice_lib::orchestrator::recording: Ignoring hotkey release`). INFO→DEBUG changes nothing on disk. Must be TRACE or a time-throttle.

### E4. "22 stuck recordings per month" — overcount
- `grep -h "ERROR.*Audio too large" voice.log.*` → **11** incidents over May–Sep (each incident logs two lines: `failed_audio` INFO + ERROR → 22 lines). Last 30 days: **4** (08-18, 08-28, 09-04, 09-05).

### E5. "Idempotent `recorder.stop()`" resolves the release↔watchdog race — false
- `recorder.rs:200-203`: second `stop()` returns `Err(AudioError::NotRecording)`. In `recording.rs:290-301` that error path runs `handle_error` → emits `error` + `Error` state to the UI, `coordinator.cancel()`, 2 s sleep. So a late release landing between the watchdog's `recorder.stop()` and its `coordinator.on_release()` (stage still `Recording`) yields a **user-visible spurious error and `cancel()` flipping stage to Idle** while the audio is already queued. The coordinator worker serializes *stage transitions* (`coordinator.rs:241-266`), not the side-effects around them. A stage check + "idempotent stop" is not a single-flight guarantee.

### E6. §7 workaround `hotkey_mode = toggle` makes recordings **unstoppable**
- `recording.rs:125-129`: toggle + Recording → `self.on_hotkey_released().await`.
- `recording.rs:274-278`: `on_hotkey_released` returns immediately when `hotkey_mode == "toggle"`.
- Net: in toggle mode nothing (hotkey, `manual_stop` → `on_hotkey_released`, `mod.rs:125-127`) ever calls `recorder.stop()`. Recommending toggle as the "immediate workaround" is the opposite of safe. (Also a strong argument *for* the shared stop helper — the toggle branch must call it directly.)

### E7. 15-minute hard-cap vs 25 MiB Groq limit / 30 MB debug cap — inconsistent numbers
- `encoder.rs:8,65`: 16 kHz, 16-bit → 32 000 B/s. 15 min = **28.8 MB > 25 MiB** (`transcription/mod.rs:14`). A capture that hits the hard-cap and is "treated as completion" is guaranteed to fail `AudioTooLarge` and be written to disk twice. Max transcribable duration ≈ 819 s (~13.6 min). Debug cap of "30 MB" is above the API limit too.

### E8. Layer 5 targets the wrong file for persistence
- `orchestrator/mod.rs:36-43` `load_config_from_app` only calls `ConfigSqliteStorage::load()`; per-key read/write lives in `storage/config_sqlite.rs` (`:121-122` load, `:275` save for `hotkey_hold_ms`). `grep min_recording_ms storage/config_sqlite.rs` → **no hits**: `min_recording_ms` is *not persisted* and is absent from `src/lib/settingsRegistry.ts` (only `hotkey_hold_ms` at `:111`). Copying the `min_recording_ms` pattern literally yields a setting that silently never saves. Correct pattern to copy is `hotkey_hold_ms`.

---

## 2. Missing (omitted but material)

### M1. Silence criterion is undefined; the only existing usage is `== 0`
- `level.rs:48-54`: `audio_level = (rms * boost).min(100) as u32`, `boost` = **overlay visualization** `audio_boost` (default 800, `config/mod.rs:158-159`, `recorder.rs:44`). The existing "silence" check in `audio_level.rs:110-121` is `raw_level == 0`.
- Evidence this fails for the real case: on 09-05 the mic was live with a noise floor > 0 for **58 min** (first `Audio level has been 0` WARN at `voice.log.2026-09-05:8184`, 10:53Z; recording started 09:55Z; user spoke at 09:59Z/10:04Z, lines 2630/6340). An `== 0` watchdog would have fired at ~10:54Z after buffering ~113 MB of WAV (→ `AudioTooLarge`). With the built-in MacBook mic (which §7 recommends) a `== 0` reading is essentially never observed → watchdog never fires.
- A threshold on `audio_level()` couples auto-stop correctness to a visualization slider. Need a boost-independent RMS (dBFS) source and a fixed threshold.

### M2. No wall-clock max-duration **auto-stop**
- Layer 3 only stops *pushing samples*; nobody stops the recording, so the mic stays open, `is_recording` stays true, overlay keeps animating on discarded audio, and stage stays `Recording` (app remains deaf). The max-duration condition belongs in the same watchdog task as silence: one task, two conditions, one stop path. It is also the only heuristic-free defense (doesn't depend on RMS thresholds or keyboard-click noise).

### M3. `failed_audio/` writes the full WAV on `AudioTooLarge`
- `pipeline.rs:55-57` → `save_failed_audio` → `failed_audio.rs:70-71 fs::write(&audio_path, audio)`; `voice.log.2026-09-05:87090` shows 1 163 050 712 bytes saved. Capping only `debug/` leaves half the write amplification. Better: check `MAX_AUDIO_BYTES` **before** `save_debug_audio` and skip both dumps (or truncate) for oversize audio — an oversize WAV is not retryable anyway.

### M4. `Vec::clear()` retains capacity → footprint never drops
- `recorder.rs:131-134` `samples.clear()`. After the 09-04 stop, ~16 GB of capacity stays mapped until process exit — consistent with `.diag` "Footprint 6.4 GB → 16.4 GB" and with a *delayed* memory-pressure death days later (E1: pid 8404 died 2.5 days after an `Audio too large: 393911000` on 08-28, `voice.log.2026-08-28:28995`). Plan should `shrink_to_fit()`/replace the Vec after `stop()` when capacity exceeds a threshold. With a 15-min cap this is ~170 MB, still worth one line.

### M5. `Orchestrator::cancel()` bypasses the recorder
- `mod.rs:131-133` → `coordinator.cancel()` only; `recorder.stop()` never called, so the mic keeps recording with stage `Idle`. Next `recorder.start()` returns `Ok(())` early (`recorder.rs:78-80`) **without** `clear_samples()` → old buffer is appended to. The shared stop helper should be the single place that stops the recorder for release, watchdog, toggle-press, and cancel(discard).

### M6. DRY: the existing silent-device detector stays
- `audio_level.rs:96-121` remains a second silence detector inside the overlay loop. Plan should move it into the watchdog (or delete it) — otherwise two modules independently interpret "silence".

### M7. Test seams
- `RecordingCoordinator` needs an `AppHandle`; tests in `recording.rs` are pure-function only (`:410-495`). Plan tests 1, 3, 5 ("helper called exactly once", "race → one stop") are not writable against the real type without a mock app or a seam. The watchdog module should take `level: impl Fn() -> f32`, `is_recording: impl Fn() -> bool`, and `on_trigger: impl FnOnce(StopReason)` so tests 1–4 are pure; test 5 needs the stop mutex (R2) to be unit-testable in isolation.

### M8. Heartbeat write amplification
- `heartbeat.rs:349-352` `sync_all()` + rename every 10 s. Top stack in the `.diag`. Drop `sync_all` (liveness marker doesn't need durability across power loss) or lengthen the interval; write is already atomic via rename.

---

## 3. Doubtful assumptions

### D1. "Any sound resets the counter" is fragile for a dictation user
`audio_level` is the RMS of the **latest cpal chunk** (`level.rs:47-53`). A 200 ms poll sees one ~10 ms chunk; a single keyboard click above threshold resets a 60 s counter. A user typing with a live mic may never accumulate 60 s. Consider "fraction of polls above threshold in a sliding window" or accept that the max-duration stop (M2) is the real backstop.

### D2. "Captured audio goes to the queue — VAD/too-short will filter garbage"
After a 60 s silence timeout the capture contains ≥ 60 s of silence; VAD (`recorder.rs:230-249`) will trim it, but the trailing 60 s of silence has already been buffered at 48 kHz f32 (≈ 11.5 MB). Fine at 60 s; not fine if the user sets 600 s. Consider bounding `silence_timeout_ms` (e.g. ≤ 300 000) in `validate`.

### D3. `finalize_capture(ctx, StopReason)` as a free function over a new `ctx` struct
Feasible — every field of `RecordingCoordinator` is `Arc<_>` or `AppHandle` (`recording.rs:56-78`), so a `'static` task can hold clones. But a new `ctx` struct duplicates the field list (DRY). Cheaper: `#[derive(Clone)] RecordingCoordinator` and an `async fn stop_recording(&self, reason)` method; the watchdog captures a clone. No new type, `handle_error`/`mirror_state`/`await_stage` reused as-is.

### D4. Separate `silence_watchdog.rs` — SRP or over-engineering?
Justified: the overlay loop is gated on `overlay.enabled` (`recording.rs:238`) and owns FFT concerns; a watchdog must run regardless. Not over-engineering **provided** it is one small task (~60 lines) that also carries max-duration (M2) and absorbs the existing `==0` detector (M6). If it stays silence-only while max-duration lives in `process_chunk`, the layering is redundant rather than defensive.

### D5. `u32` ms with `0 = off` is consistent with `hotkey_hold_ms` (`recording.rs:154 if hold_ms > 0`)
OK. But UI label "seconds" vs stored ms needs a conversion in `settingsRegistry`; `hotkey_hold_ms` is exposed raw in ms (`settingsRegistry.ts:111-120`) — pick one convention.

### D6. Bumping 0.1.2 → 0.1.3 and shipping via CI in the same plan
Scope creep for a review of design; fine operationally, but the plan mixes diagnosis errors (E1/E2) into release notes — fix the narrative before it's committed.

---

## 4. Concrete recommendations (minimal, literal changes to the plan)

R1. **§1.2 rewrite**: replace "SIGKILL/jetsam" with: "stuck `Recording` stage makes the app ignore all presses (`Ignoring hotkey press - stage: Recording`) until a release finally arrives; memory/disk damage is collateral." Drop the `heartbeat.crashed.json` reference (it's 08-31, unrelated). Cite the `.diag` only for footprint and the double WAV write.

R2. **Layer 2**: add `stop_lock: Arc<tokio::sync::Mutex<()>>` to `RecordingCoordinator`; `stop_recording(&self, reason)` acquires it, re-checks `current_stage()==Recording && recorder.is_recording()` *inside* the lock, then does `recorder.stop()` → … → `on_release`. Replace "idempotent recorder.stop()" with this. Make the toggle branch (`recording.rs:125-129`) and `Orchestrator::cancel()` call the helper (cancel with `StopReason::Cancel` → discard, `coordinator.cancel()`). `#[derive(Clone)]` instead of a `ctx` struct.

R3. **Layer 1**: rename to `recording_guard.rs` (or keep name) with **two** conditions: `silence >= silence_timeout_ms` **and** `elapsed >= max_recording_ms`. Silence source: add `AtomicU32` `rms_bits` (f32 RMS, boost-independent) in `process_chunk`; expose `recorder.rms()`; threshold constant `SILENCE_RMS = 0.005` (~-46 dBFS) in `config/consts.rs`. Poll 250 ms. Move `audio_level.rs:96-121` detector into it. Take `Fn` seams for tests.

R4. **Layer 3**: keep the sample cap but derive it from `max_recording_ms` and the actual `sample_rate` (`recorder.rs:161`), and set `DEFAULT_MAX_RECORDING_MS = 600_000` (10 min → 19.2 MB WAV < 25 MiB). Add `shrink_to_fit()` (or `*samples = Vec::new()`) after `get_samples()` when `capacity > cap`.

R5. **Layer 4**: (a) Spectrum log → `tracing::trace!` **or** once per 5 s — not DEBUG. (b) Move the `MAX_AUDIO_BYTES` check to the top of `run_transcription_pipeline` and skip **both** `save_debug_audio` and `save_failed_audio` when oversize. (c) Remove `sync_all()` from `heartbeat::persist_bytes_atomic` (or make it 30 s).

R6. **Layer 5**: replace "pattern like `min_recording_ms`" with "pattern like `hotkey_hold_ms`": `config_sqlite.rs` load (`:121`) + save (`:275`), `settingsRegistry.ts` entry, `commands.ts` type; `bindings.ts` is specta-generated (`lib.rs:243`). Add `validate`: `silence_timeout_ms == 0 || (5_000..=600_000).contains(..)`.

R7. **§7 workaround**: delete the `hotkey_mode = toggle` bullet (E6) or add a fix for `recording.rs:274-278` to the release. Keep device switch + clearing `debug/`.

R8. **§4 tests**: add (10) toggle-press while Recording stops via the helper; (11) `Orchestrator::cancel()` stops the recorder; (12) oversize audio skips both dumps; (13) Spectrum log emits ≤ 1 line / 5 s. Mark test 5 as requiring the stop-lock seam.

R9. **§1.1**: "11 incidents May–Sep, 4 in the last 30 days" (E4).

---

## 5. VERDICT

**CONDITIONAL GO — maturity 5/10.**

The architecture (independent watchdog task + one shared stop path + config `0=off` + buffer cap) is sound and matches existing patterns (`CancellationToken`/`polling_cancel`, `hotkey_hold_ms`). It is feasible with a `Clone` coordinator and no new types. But as written the plan would ship with: an undefined silence criterion that wouldn't have caught the 09-05 incident (M1), no auto-stop when the silence heuristic fails (M2), a stop race that surfaces spurious errors (E5), a log change that does nothing (E3), half the disk damage untouched (M3), a wrong-file persistence step (E8), and a workaround that makes recordings unstoppable (E6). Fix R1–R7 before implementation; R8–R9 before commit.
