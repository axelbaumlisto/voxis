# BLIND review #2 — root-cause / forensics critic (macOS internals)

Artifact: `/tmp/swd-plan-clean.md`. Lens: is the DIAGNOSIS (§1) correct? Every claim below is checked against source, the `.diag`, the unified log (`log show`), `heartbeat*.json`, and `voice.log.*`.

Summary up front: **the memory-growth diagnosis (§1.3-A) is correct and quantitatively consistent; the disk diagnosis (§1.3-B) is half right; the "kill" diagnosis (§1.2, §1.3-C) is wrong; the "lost rdev release" root cause (§1.1, §8) is wrong — the release was received and discarded by our own code.** The plan's Layer 1 (silence watchdog) is a mitigation for a bug the plan has not actually identified.

---

## 1. Errors (wrong facts, wrong reasoning) — with evidence

### E1. The process was NOT killed by the system. It was `pkill`-ed by the user, 2 days after the `.diag`.
- `.diag` header: `Event: disk writes` / **`Action taken: none`** (`voice_2026-09-04-154440_it.diag`, lines 21-22). A "disk writes" resource report on macOS is *monitoring only*; it never terminates the process.
- Same PID kept running: `.diag` `PID: 925`; live `diagnostics/heartbeat.json` = `{"pid":925,"monotonic_uptime_s":546320,"wall_ts":1788693281,...}` → last heartbeat **2026-09-06 18:14:41 +07**, 6.32 days uptime (started right after the Aug 31 10:28 boot). The Sep 5 10-hour recording and its 1.16 GB dump (`voice.log.2026-09-05` 20:02:28–20:02:45Z) were processed by this same, still-alive process.
- Cause of death, unified log:
  `2026-09-06 18:14:51.872 launchd[1]: [gui/501/application.top.voxis.app...[925]] exited due to SIGTERM | sent by pkill[69104], ran for 546332166ms`
  `runningboardd: termination reported by launchd (2, 15, 15)`; `ControlCenter: Process exited: ... domain:signal(2) code:SIGTERM(15)`.
  → **SIGTERM from `pkill`, not SIGKILL, not memorystatus.**
- No `memorystatus`/kernel kill line for pid 925 exists in `log show` for 18:14:00–18:15:30; no `voice*.ips` crash report exists in either DiagnosticReports directory.
- Plan §1.2 "процесс исчез без чистого выхода = SIGKILL от системы" and §1.3-C "система убивает процесс" are therefore **unsupported and contradicted**.

### E2. `heartbeat.crashed.json` refers to an Aug 31 power-button reset, not to Sep 4/5.
- File contents: `{"pid":8404,"wall_ts":1788146022 (=2026-08-31 10:13:42 +07),"reported_at_wall_ts":1788146084 (10:14:44),"snapshot":{...,"last_breadcrumb":"hotkey:released",...}}`.
- `last reboot`: `reboot time пн 31 авг. 10:14`; `/Library/Logs/DiagnosticReports/ResetCounter-2026-08-31-101435.diag`: `"Boot faults: rst btn_rst,btn_seq_reset"` → hardware button reset at 10:14:35, then a macOS update (26.5.2→26.6.2) and reboot 10:28.
- Semantics (`heartbeat.rs:150-176`, `log_previous_unclean_shutdown_once`): the file is written **once, at the next startup**, when `heartbeat.json` has a dead PID and no `heartbeat.clean.json`. It means only "no clean-shutdown marker was written" — any hard reboot, `kill`, Force Quit, or logout produces it. It does not distinguish SIGKILL from a reboot, and it cannot describe the Sep 6 death because the app has not been restarted since (`ps -p 925` → gone; no new `heartbeat.crashed.json`; `heartbeat.clean.json` absent).
- Plan §1.2 cites breadcrumbs "`hotkey:released`, `transcription:failed`": the first is from `heartbeat.crashed.json` (Aug 31), the second from the live `heartbeat.json` (pid 925). Two different files/incidents conflated.

### E3. "Heartbeat застывает на 7.5 ч" is an artefact of the app having been pkill-ed.
`heartbeat.json` mtime = Sep 6 18:14 (last write 10 s before the SIGTERM at 18:14:51). The 7.5 h gap is simply Sep 6 18:14 → the time the plan author looked (~Sep 7 01:45). Nothing "froze"; the writer thread (`heartbeat.rs:220-231`) ran every 10 s until the process was terminated.

### E4. The `release` event was NOT lost by rdev. It was received and discarded by `on_hotkey_released`.
Both incidents show the identical trace (`voice.log.2026-09-05`, non-Spectrum lines 1-10; `voice.log.2026-09-03` 18:00:59Z):
```
09:55:26.927Z on_hotkey_pressed: enter
09:55:26.942Z on_hotkey_pressed: checking mic permission
09:55:27.060Z DEBUG Ignoring hotkey release - not recording        <-- release ARRIVED (+118 ms)
09:55:29.294Z on_hotkey_pressed: loading config                    <-- perm check blocked 2.35 s
09:55:29.299Z recorder started OK ... stage now Recording           <-- recording nobody will stop
```
- Discard site: `orchestrator/recording.rs:293-296` — `if self.coordinator.current_stage() != Stage::Recording { tracing::debug!("Ignoring hotkey release - not recording"); return; }`.
- Blocking site: `recording.rs:185-188` → `create_permission_checker().check(Permission::Microphone)` → `permissions/macos.rs:110-126` spawns **`osascript` synchronously** (AVFoundation authorizationStatus) inside an `async fn`. Measured duration from logs: 0.27 s … **4.24 s** (Sep 2: 2.64 s; Sep 3: 4.24 s; Sep 5: 2.35 s). Load average on this Mac right now is 217 — osascript latency of seconds is expected.
- No debounce sleep between `enter` and `checking mic permission` (+15…26 ms) and no `voice_lib::hotkey: Hotkey pressed/released` DEBUG lines in either incident (they *are* present for real key presses, e.g. Sep 3 12:35:49Z). ⇒ both incidents came through `on_hotkey_pressed(true)` = `Orchestrator::manual_start()` (`orchestrator/mod.rs:118-120`), i.e. the **overlay pointer/tap path**, not rdev at all. Config confirms `hotkey_hold_ms=300`, so a keyboard press would have shown a 300 ms debounce.
- Frequency: the "release-ignored during perm-check" pattern occurs **15 times in Aug–Sep logs** (Aug 8, Aug 17, 6× Aug 18 03:09, 3× Aug 28, 2× Sep 1, Sep 3, Sep 5). Every one of those starts a recording with no matching stop.
- Plan §1.1 "потерянное событие release rdev" and §8 "первопричина потери release в rdev — отдельный баг" are wrong. The bug is a press/release ordering race in `RecordingCoordinator` and is fixable deterministically; it is *in scope*, not out of scope.

### E5. "22 залипшие записи за месяц" is not supported by the logs.
`grep "ERROR.*Audio too large" voice.log.*` → **11 in the entire log history (Feb–Sep), 4 in the last 30 days** (Aug 18, Aug 28, Sep 4, Sep 5). Max size is **2545 MB** (2026-07-07), not 1.68 GB. If "22" counts something else (e.g. the ×2 lines per incident: `failed_audio` + `error`), the plan should say what.

### E6. Disk writes: the Spectrum log is ~0.25 % of the 3677 MB, not "это и есть disk writes".
- `.diag` end time `15:44:37.889 +07` == exactly `08:44:37.891Z Failed audio saved: id=001 ... 1684337026 bytes` in `voice.log.2026-09-04`. One second earlier: `08:44:36.314Z Debug: saved audio ... (1684337026 bytes)`.
- Arithmetic: 2 × 1684.3 MB = **3368.7 MB = 91.6 %** of 3677.67 MB, written in a ~3 s burst at the very end of the 18910 s window. The "194.48 KB/s average" is a burst averaged over 5 h, not a steady stream.
- Log file for Sep 4 (whole day, 73 375 lines) = 9.39 MB = **0.26 %**. Heartbeat ≈ 1 dirtied 16 KB page /10 s ≈ 31 MB over the window ≈ 0.8 %.
- The plan omits the **second full-size copy written by `storage/failed_audio.rs:72` (`fs::write(&audio_path, audio)`)** — it is as large as the debug dump and is written even when `debug=false`.
- The "heaviest stack" (heartbeat `persist_bytes_atomic` 20/39 samples, log-writer `write_all` 18/39) is a *sample count* (Microstackshots sample syscalls, "8986 samples lost, 10.49 MB/step"), not a byte attribution. The plan reads it as "what wrote the bytes". It shows what was *frequently in a write syscall* (fsync+rename every 10 s at `heartbeat.rs:352-353`; a log line every 400 ms), not what dirtied 3.6 GB.

### E7. Wrong timezone / wrong recording attached to the `.diag`.
Log timestamps are UTC (`Z`). "09:55 → 20:02" is UTC = **16:55 Sep 5 → 03:02 Sep 6 local** (matches `audio_20260906_030230.wav`). The `.diag` (Sep 4) belongs to the **other** stuck recording: Sep 3 18:01:03Z → Sep 4 08:44:34Z = **14 h 43 m** (01:01 → 15:44 local), producing the 1.68 GB file. The plan never mentions the 14.7 h one explicitly and mixes the two incidents' numbers.

### E8. "jetsam" is the wrong word for what happened to `voice` (even though jetsam did run).
- macOS *does* have memorystatus/jetsam and it *did* fire: `/Library/Logs/DiagnosticReports/JetsamEvent-2026-09-04-154328.ips` (15:43:28, one minute before the recording stopped). It killed **`replicatord` (pid 32045, reason `per-process-limit`)**. `voice` pid 925 is listed as `"largestProcess": "voice"`, `rpages 1342364` (≈ 22.0 GB resident), `states: ["active"]`, **no `reason`, not killed**. Free memory was 11 681 pages (≈ 190 MB), compressor 793 129 pages (≈ 13 GB), swap 2.86 GB used.
- runningboardd logs for ordinary GUI apps read "Ignoring jetsam update because this process is not memory-managed" — desktop apps have no per-process footprint limit on macOS; jetsam on macOS targets idle/suspended/limited processes and does not SIGKILL a foreground-capable app for footprint alone. The correct statement: *voice caused system-wide memory pressure severe enough that jetsam killed **another** process; voice itself was never killed by the OS.*

---

## 2. Missing (what the plan omits that matters)

- **M1. The actual root cause and its deterministic fix.** A release arriving while `on_hotkey_pressed` is between the debounce and `recorder.start()` (`recording.rs:185-206`) is silently dropped (`recording.rs:293-296`). Fix options the plan should contain: (a) record a "release seen for press N" flag in `on_hotkey_released` when a press is in flight and check it right after `recorder.start()` (stop immediately / never start); (b) move the `osascript` permission probe off the hot path (`tokio::task::spawn_blocking`, or cache after first Granted, or use the native `AVCaptureDevice.authorizationStatus` via objc without spawning a process). Without this the watchdog only shortens the damage; a stuck recording in a non-silent room (Sep 5: RMS>0 for the first 58 min — silence WARN only at 10:53:10Z) still runs until silence.
- **M2. `failed_audio` writes a full-size second copy** (`failed_audio.rs:72`) — same 1.68 GB, unconditional on `debug`. The plan caps only the debug dump.
- **M3. RAM is not released at stop on macOS.** `recorder.stop()` → `stop_macos_pause()` only pauses the stream (`recorder.rs:248-262`); the `Vec<f32>` is cleared only on the *next* `start()` (`recorder.rs:82 clear_samples`). After the Sep 4 stop the ~10 GB buffer stayed resident until Sep 5 16:55 local. The hard-cap (Layer 3) does not address this; a `shrink_to_fit()`/`clear()` at stop should be listed.
- **M4. Stop-time copies are the actual footprint peak**, and the `Vec` doubling policy adds a third copy. `get_samples()` clones the whole buffer (`recorder.rs:191-194`), `downsample` allocates a 1/3 copy (`recorder.rs:212`), WAV another. Also `Vec::push` growth reallocates at powers of two — at 10.2 GB the capacity is 17.2 GB and old+new coexist during the copy. This explains `rpages`≈22 GB at 15:43 with only ~10 GB of samples. The plan's "×2–3 при транскрипции" understates and misplaces the peak.
- **M5. Overlay tap path.** Both incidents came via `manual_start()`/overlay pointer (E4). The plan's workaround "hotkey_mode = toggle" only changes keyboard-hotkey semantics; the tap-then-quick-release race is unchanged (a tap still blocks in osascript).
- **M6. Heartbeat fsync cadence.** `persist_bytes_atomic` does `write_all` + `sync_all` + `rename` every 10 s unconditionally (`heartbeat.rs:220-231, 349-353`): ~8 640 fsync+rename/day. Bytes are negligible, but it is why the heartbeat dominates the sampled stacks; if the plan keeps "(проверить) heartbeat", the concrete check is "drop `sync_all` or write only when the snapshot changed".
- **M7. Evidence that memory pressure hurt the *system*, not the app** (JetsamEvent on Sep 4 killing `replicatord`, 13 GB compressor, 2.9 GB swap). This is the real user-facing harm and belongs in §1.

---

## 3. Doubtful assumptions

- **D1. "Silence" == `recorder.audio_level() == 0`.** `audio_level` is `(rms × boost).min(100) as u32` (`level.rs:51-53`); with `overlay_audio_boost=950` it is 0 only when RMS < ~1/95 ≈ −40 dBFS. In a quiet room with a live mic, ambient noise may keep it ≥1 indefinitely; conversely a mic in standby (BY-V) gives exact zeros within 1.5 s (Sep 3 18:01:05Z WARN). The watchdog needs a stated dBFS threshold, not "RMS atomic".
- **D2. `recorder.stop()` is "idempotent".** Second call returns `Err(NotRecording)` (`recorder.rs:197-199`); in `on_hotkey_released` that path calls `handle_error` → `coordinator.cancel()` + `overlay.hide()` (`recording.rs:305-313`) — i.e. the loser of a release↔watchdog race emits a user-visible Error and hides the overlay while the winner is transcribing. Not benign.
- **D3. "One root, one main fix".** With E4 established, the *main* fix is a ~10-line ordering fix in `recording.rs` (+ un-blocking the permission probe); the watchdog is defense-in-depth. The plan inverts this priority.
- **D4. Footprint "+10 GB" as steady growth.** Over the 5 h sampled window the buffer grows 18 041 s × 192 KB/s ≈ 3.5 GB (48 kHz mono f32 — consistent with 6.45 GB at 10:43 local after 9.7 h); the rest of the +10 GB is the stop-time spike (M4). The start/end footprint numbers are right; the interpretation is not.
- **D5. "Нет визуализации / не распознаёт после перезапуска" ⇐ dead process.** The process was alive (E1). The observed symptom is fully explained by stage stuck at `Recording` (every subsequent press: `Ignoring hotkey press - stage: Recording`, Sep 4 08:38:19Z and Sep 5 20:01:14Z) plus BY-V emitting zeros.

---

## 4. Concrete recommendations (minimal, literal changes to the plan)

1. §1.1 — replace "потерянное событие release rdev" with: *"release доставлен, но отброшен в `on_hotkey_released` (`recording.rs:293-296`), потому что `on_hotkey_pressed` в этот момент блокируется на синхронном `osascript` проверки микрофона (`permissions/macos.rs:110-126`, 0.3–4.2 с). Оба инцидента (Sep 3 18:00:59Z, Sep 5 09:55:26Z) пришли через `manual_start()` (overlay tap), не через rdev."* Replace "22 залипшие записи" with "4 `Audio too large` за 30 дней, 11 за всю историю; 15 срабатываний гонки press/release за Aug–Sep".
2. §1.2 — delete "SIGKILL от системы", "resource-limit / memory-pressure kill (jetsam)", "процесс мёртв/задушен". Replace with: *"`.diag` — отчёт мониторинга (`Action taken: none`); PID 925 жил до 2026-09-06 18:14:51 и был завершён `pkill` (SIGTERM). `heartbeat.crashed.json` описывает аппаратный reset 31 авг (ResetCounter: `btn_rst`). Реальный ущерб системе: JetsamEvent 2026-09-04 15:43:28 убил `replicatord`, `voice` — largestProcess ≈22 GB, не убит."*
3. §1.3-B — replace "Это и есть disk writes из .diag" with: *"3677 MB = 2 × 1684 MB (debug WAV + `failed_audio` копия) в конце окна; лог = 9.4 MB (0.26 %), heartbeat ≈ 31 MB."* Keep the Spectrum→DEBUG change, but justify it by log hygiene, not by disk writes.
4. §1.3-A — add: буфер не освобождается на `stop()` (macOS pause path), `get_samples()` клонирует, `Vec` растёт удвоением (старый+новый при realloc).
5. §3 — insert **Layer 0 (главный, детерминированный)**: (a) in `on_hotkey_released`, if a press is in flight (past debounce, before `stage==Recording`), set a `release_pending` flag; in `on_hotkey_pressed` check it immediately after `recorder.start()`/`await_stage(Recording)` and stop (or skip start); (b) run the permission probe via `spawn_blocking` or cache it. Demote the silence watchdog to Layer 1 = defense-in-depth. Add a unit test that reproduces the log ordering (press → release during permission check → recorder must not stay recording).
6. §3 Layer 3 — add `samples.clear(); samples.shrink_to_fit()` (or `Vec::new()`) at `stop()`; consider `Vec::with_capacity` reserve for the cap to avoid doubling.
7. §3 Layer 4 — add `failed_audio` size cap alongside the debug cap; make the heartbeat check concrete (drop `sync_all` or write-on-change).
8. §7 — note that `hotkey_mode=toggle` does not remove the race for overlay taps; recommend the immediate mitigation "avoid overlay tap until fix" or the Layer-0 patch.
9. §8 — remove the rdev item (no evidence); replace with "why does `osascript` take 2–4 s on this machine (load 200+)" as the genuinely out-of-scope question.
10. Fix timezones in §1.1 (log is UTC; give local times or mark `Z`) and attach the `.diag` to the Sep 3/4 14.7 h recording, not the Sep 5 one.

---

## 5. VERDICT

**CONDITIONAL — NO-GO on §1 as written; GO on Layers 3–5 as defense-in-depth once §1 is rewritten and a deterministic Layer 0 is added.**

What is right: unbounded `samples.push` (`level.rs:42`) is the RAM source and the numbers fit 48 kHz f32 mono (192 KB/s); debug WAV dump dominates disk; Spectrum INFO spam is 99.9 % of log lines (87 053/87 097 ✓, 435 263 iters / 5 ✓); silence detection only exists under `overlay.enabled` (`recording.rs:241`) and only warns once (`audio_level.rs:99-114`) ✓; no panic report exists ✓.

What is wrong and load-bearing: the process was never killed by macOS (pkill SIGTERM, Sep 6); `heartbeat.crashed.json` is an Aug 31 button reset; the release was received and discarded by `recording.rs:294` during a 2–4 s synchronous `osascript` call on the overlay-tap path — the "rdev lost release" root cause is fiction and the deterministic fix is missing from the plan; the disk figure is two 1.68 GB file writes, not log spam; the `failed_audio` copy and the no-free-on-stop behaviour are omitted; "jetsam" mis-attributes a real jetsam event (which killed `replicatord`) to voice.

**Maturity: 4/10** for the diagnosis section (correct symptom inventory and memory mechanism; wrong causal chain and wrong death story), **6/10** for the remedial layers (sound as hardening, but built around the wrong primary root cause).
