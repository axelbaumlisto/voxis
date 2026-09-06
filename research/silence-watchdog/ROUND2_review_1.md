# ROUND2 review 1 — FORENSICS verification of §1 (diagnosis) of `/tmp/swd-plan-clean2.md`

Scope: only §1 (and the §7/§8 statements that rest on it). Everything below was re-derived from
source, the two DiagnosticReports, `log show`, and the raw `voice.log.*` files. Blind review.

Legend: ✅ verified, ❌ wrong, ⚠️ imprecise / unsupported.

---

## 0. What I re-derived (evidence table)

| Claim (§) | Result | Evidence |
|---|---|---|
| Release dropped in `on_hotkey_released` because `current_stage() != Recording` (§1.1) | ✅ | `orchestrator/recording.rs:293-296` (`if self.coordinator.current_stage() != Stage::Recording { debug!("Ignoring hotkey release - not recording"); return; }`) |
| Press blocks on synchronous `osascript` inside async fn (§1.1) | ✅ | `recording.rs:185-188` → `permissions/macos.rs:110-126`: `Command::new("osascript")…​.output()` (std, blocking) called from `async fn on_hotkey_pressed`. It blocks one tokio worker, not the runtime — which is exactly why the release *is* processed concurrently and dropped. |
| Sep 5 trace lines 1-10 (§1.1) | ✅ | `voice.log.2026-09-05:1-10`: enter 09:55:26.927, checking 26.942, `Ignoring hotkey release` 27.060 (+118 ms), loading config 29.294 (2.35 s), started OK 29.299. |
| Sep 3 incident same shape (§1.1) | ✅ | `voice.log.2026-09-03:717-724`: enter 18:00:59.323 → checking .349 (26 ms, no debounce) → release dropped .468 (+119 ms) → started OK 18:01:03.602 (4.24 s). |
| 0 rdev `voice_lib::hotkey` lines in incidents (§1.1) | ✅ | Sep 5 file: `grep -c voice_lib::hotkey` = 0. Sep 3 file: 12 rdev lines, all ≤12:35Z; none around 18:00:59Z. Every non-incident press on Sep 3 has `Hotkey pressed: AltGr` 2-3 ms before `enter` and a ~300 ms debounce gap before `checking`. |
| `manual_start()` = `on_hotkey_pressed(true)` (§1.1) | ✅ | `orchestrator/mod.rs:118-120`. Callers: `commands/recording.rs:131-133` (`manual_start_recording`) ← `src/overlay.tsx:80-81` via `createPressController` (pointerdown→start, pointerup→stop) and `src/hooks/useRecording.ts:83`. The latter is not wired to any button (`Layout.tsx:34` only reads state), so the overlay pill is the only UI caller. press→release 118 ms fits pointerdown/pointerup. Inference, but well supported. |
| perm-check durations 2.64 / 4.24 / 2.35 s (§1.1) | ✅ | `checking mic permission`→`loading config` gaps: 2026-09-02T09:32:31 2.64 s; 2026-09-03T18:01:03 4.24 s; 2026-09-05T09:55:29 2.35 s. Aug–Sep: n=41, median 0.52 s, p90 2.64 s, max **5.38 s** (2026-08-08). |
| "15 раз за Aug–Sep" (§1.1) | ✅ | My count of `checking` → `Ignoring hotkey release` → (`started OK`|next press): Aug 8 ×1, Aug 17 ×1, Aug 18 ×6, Aug 28 ×3, Sep 1 ×2, Sep 3 ×1, Sep 5 ×1 = 15. |
| `Audio too large` 4 / 11, max 2545 MB Jul 7 (§1.1) | ✅ | 11 ERROR lines total; last 30 d: Aug 18 (41 MB), Aug 28 (394 MB), Sep 4 (1684 MB), Sep 5 (1163 MB); max 2026-07-07 2545 MB. |
| Timezones / durations (§1.1) | ✅ | 18:01:03Z → 08:44:34Z = 14 h 43 m; `debug/audio_20260904_154434.wav` = 1 684 337 026 B. Sep 5: 09:55Z→20:02Z. |
| `.diag` = monitoring report, `Action taken: none` (§1.2) | ✅ | `voice_2026-09-04-154440_it.diag:22-23`. |
| PID 925 died by `pkill` SIGTERM 2026-09-06 18:14:51 +07 (§1.2) | ✅ | `log show`: `launchd … [gui/501/application.top.voxis.app… [925]]: exited due to SIGTERM \| sent by pkill[69104], ran for 546332166ms`. No memorystatus kill. |
| `heartbeat.crashed.json` = Aug 31 hardware reset (§1.2) | ✅ | crashed.json pid 8404, wall_ts 1788146022 = 2026-08-31 10:13:42 +07, reported 10:14:44; `ResetCounter-2026-08-31-101435.diag`: `Boot faults: rst btn_rst,btn_seq_reset`. Semantics: written on *next start* by `heartbeat.rs:141-176` when heartbeat exists, pid dead/reused, no valid clean marker, and not already reported; overwritten per new death (`persist_bytes_atomic`). ✅ as stated. |
| "Heartbeat last write 10 s before pkill" (§1.2) | ✅ | `heartbeat.json`: pid 925, wall_ts 1788693281 = 18:14:41 +07; pkill 18:14:51. |
| Jetsam killed `replicatord` per-process-limit; voice largestProcess; free ≈190 MB; compressor ≈13 GB (§1.2) | ✅ | `JetsamEvent-2026-09-04-154328.ips`: replicatord `"reason":"per-process-limit"`; `largestProcess":"voice"`; free 11 681 pages ×16 KiB = 191 MB; compressorSize 793 129 pages = 12.99 GB. |
| `samples.push` unbounded (§1.3A) | ✅ | `audio/level.rs:42`. |
| `get_samples` clone / `downsample` copy / pause-not-free / `clear()` keeps capacity (§1.3A) | ✅ | `recorder.rs:191-194`, `:210-213`, `:263-279` (`stop_macos_pause`), `:135-138` (`clear_samples`). |
| 2×1684 MB = 91.6 % of 3677.67 MB (§1.3B) | ✅ arithmetic | 3368.67 / 3677.67 = 0.916. Event `End time 15:44:37.889` = failed_audio save 08:44:37.891Z — the second write closed the event. |
| failed_audio written even with `debug=false` (§1.3B) | ✅ | `pipeline.rs:57` unconditional `save_failed_audio`; `failed_audio.rs:72` `fs::write(&audio_path, audio)`. Debug copy: `pipeline.rs:38-43` under `config.debug`. |
| Heartbeat `write_all`+`sync_all`+`rename` every 10 s (§1.3B) | ✅ | `heartbeat.rs:31, 227-233, 349-353`. |
| Spectrum lines 87 053 / 87 097 (§1.3B) | ✅ | `grep -c "Spectrum \["` = 87 053; `wc -l` = 87 097. |
| Toggle mode can never stop (§1.4) | ✅ | `recording.rs:125-129` → `on_hotkey_released()`; `:273-278` returns immediately when `hotkey_mode == "toggle"`. Real, severe. |
| `stop()` not idempotent (§1.4) | ✅ | `recorder.rs:197-199` load-then-act; flag cleared on the capture thread `stream.rs:148-151`. |
| `Orchestrator::cancel()` doesn't stop recorder (§1.4) | ✅ (line ref off) | actual `mod.rs:128-130`, not 131-133. |
| Silence detector one WARN, under `overlay.enabled` (§1.4) | ✅ | `audio_level.rs:96-118`; `recording.rs:241`. Fired once at 2026-09-05T10:53:10Z (58 min after start) — that is the source of the plan's "58 мин". |
| File appender already DEBUG (§1.4) | ✅ | `setup/logging.rs:33-34`. |
| `min_recording_ms` not persisted; `hotkey_hold_ms` is (§1.4) | ✅ | absent from `config_sqlite.rs` and `settingsRegistry.ts`; `config_sqlite.rs:121-122, :275`; `settingsRegistry.ts:111`. |

---

## 1. Errors (wrong facts, wrong reasoning) — with evidence

1. **❌ "запись, которую никто не остановит" / "приложение глухо — каждый следующий press отвергается" (§1.1, §1.2).**
   The *release* of the next hold does stop the stuck recording; the app self-heals on the next
   press+release cycle at the cost of that utterance and an `Audio too large` error. Evidence:
   - `voice.log.2026-09-04:73355-73361`: `Hotkey pressed` 08:38:19.672 → `Ignoring hotkey press - stage: Recording` → `Hotkey released` 08:38:19.740 → `Queue worker: processing audio (1684337026 bytes…)` 08:44:33.129.
   - `voice.log.2026-08-18:3300-3306`: same shape, 21 min stuck recording → 40 MB → too large.
   - `voice.log.2026-06-19:685-690`: press rejected, release → `dropping too-short recording (140ms…)`.
   The 14 h 43 m and 10 h 06 m durations are "time until the user next touched the hotkey", not "forever". Severity framing and §7 advice depend on this.

2. **❌ §7 "Избегать старта через overlay-tap до фикса Layer 0 (гонка именно там)" — the race is not overlay-specific.**
   Re-deriving the pattern (`checking mic permission` → `Ignoring hotkey release` before start) across **all** `voice.log.*` gives ≈121 occurrences since 2026-05-12, of which **71 arrived via rdev** (a `Hotkey released: AltGr` line ≤0.5 s before the drop) and 50 via the manual path. Monthly: May rdev 41; Jun rdev 21/manual 19; Jul rdev 5/manual 20; Aug manual 7/rdev 4; Sep manual 4. Keyboard example: `voice.log.2026-06-19:661-670` — hold 540 ms (> 300 ms debounce), perm-check 290 ms, release dropped, recording started. Any keyboard hold whose duration falls in (hold_ms, hold_ms + perm_check) hits the same race; with perm-check now 1–5 s on this machine (§0 table) that is a normal hold. The plan's "15 за Aug–Sep" is correct but hides that the race is older, more frequent, and mostly keyboard-driven; the July 7 2545 MB record also originates from a race (`voice.log.2026-07-06: 06:02:54.419 → release-dropped → started 06:02:54.886`).

3. **❌ "voice — ≈22 ГБ resident" (§1.2).** `rpages` 1 342 364 × 16 KiB = 22.0 GB is footprint, not resident RAM: the same record shows `"physicalPages":{"internal":[122717, 1218979]}` → ≈1.9 GB resident + ≈19.5 GB compressed; system-wide uncompressed pages total ≈12 GB on a 24 GB machine with a 13 GB compressor. This is only physically possible because the buffer was almost all zeros (BY-V standby → `max 0.000` on 86 888 of 87 053 Spectrum samples) and compressed to near nothing. Wording should be "footprint ≈22 GB (mostly compressed)".

4. **❌ "swap 2.86 ГБ" attributed to the Sep 4 jetsam evidence (§1.2).** The `.ips` contains no swap field (keys: `memoryStatus{compressorSize, compressions, decompressions, memoryPages…}`, `largestProcess`, `processes`). 2.85 GB is *today's* `sysctl vm.swapusage` (`used = 2853.94M`), i.e. state two days after the event, conflated into the incident record.

5. **⚠️ "48 кГц mono f32 = 192 КБ/с" (§1.3A) is asserted, not measured.** Rate is device-dependent: `recorder.rs:160-161` stores `device.default_input_config().sample_rate()`; the atomic default is 44 100 (`recorder.rs:43`); `level.rs:13` `SAMPLE_RATE = 44100.0` is FFT-only. No log line records the rate. Back-of-envelope from the `.diag` (`Footprint 6449 MB` at 03:43:55Z after 9.71 h of recording) gives ≈184 KB/s incl. app baseline — between 44.1 kHz (176 KB/s) and 48 kHz (192 KB/s); the WAV itself is 16 kHz (1 684 337 026 B / 2 / 53 010 s = 15 887 Hz ✅ downsampled). "≈10 ГБ сэмплов" holds either way (9.35–10.2 GB); the 192 KB/s figure should be written as an estimate.

6. **⚠️ "Stage Recording → Processing переключается после блокирующего recorder.stop() (до 500 мс / 3 с)" (§1.4) understates by two orders of magnitude on the incident data.** 500 ms / 3 s is only the pause wait (`recorder.rs:266-270`). `stop()` also does a full-buffer `clone` under the `samples` mutex, `downsample`, VAD, WAV. Observed: rdev release 08:38:19.740Z → queue push 08:44:33.125Z = **6 min 13 s** (Sep 4); poller's last Spectrum 20:01:14.603Z → push 20:02:28.074Z = **73 s** (Sep 5). The `Spectrum` poller went silent for the whole interval (blocked behind the same mutex / worker), and the jetsam event (08:43:28Z) landed *inside* this window — corroborating "пик — на стопе", but the plan never states that stop() itself is minutes-long on a stuck buffer.

7. Minor line refs: `Orchestrator::cancel` is `mod.rs:128-130` (plan: 131-133); perm-check range is 0.24–5.38 s (plan: 0.3–4.2 s).

## 2. Missing (what the plan omits that matters)

1. **No single-flight *start*.** `voice.log.2026-08-18:101-141`: six `on_hotkey_pressed: enter` within 2.2 s (manual, no rdev), all six blocked in osascript simultaneously, all six releases dropped, then six `recorder started OK` / `sent on_press` interleaved. `recorder.start()` returns `Ok` early (`recorder.rs:76-78`), so N presses in flight all "succeed". Layer 0's per-press `release_pending` needs a press-in-flight mutex or the "which press does this release belong to" question has N answers.

2. **Second in-memory WAV copy in the pipeline.** `orchestrator/dispatch.rs:35` `item.audio_data.clone()` into `TranscriptionContext.audio_data` (kept only for `save_failed_audio`, `pipeline.rs:154-160`) while the original is moved into `transcribe_and_output`. For the Sep 4 case that is an extra 1.68 GB at the moment the system had 190 MB free. Belongs in §1.3A.

3. **Baseline disk-write rate is already 66 % of the monitoring budget without any WAV.** 3677.67 − 3368.67 = 309 MB of non-WAV dirtied pages over 18 910 s = 16.3 KB/s vs the 24.86 KB/s limit. The plan accounts 9.4 MB (log) + ≈31 MB (heartbeat) and leaves ≈268 MB (7.3 %) unexplained. The most plausible sink is the heartbeat's *metadata* churn (tempfile create + fsync + rename every 10 s = directory + inode + data pages, ≈1 891 cycles in the window; 20/39 stack samples are in `persist_bytes_atomic`), i.e. the heartbeat byte estimate is a lower bound. Layer 4 fixes it anyway, but §1.3B's "не в байтах" is not established.

4. **Next launch will produce a spurious `heartbeat.crashed.json` for pid 925.** `diagnostics/` has no clean marker (only `crash.log`, `heartbeat.json`, `heartbeat.crashed.json`); SIGTERM via pkill did not run `write_clean_shutdown_marker` (`lib.rs:268`). `log_previous_unclean_shutdown_once` (`heartbeat.rs:141-176`) will then WARN "previous instance died without shutdown" and overwrite crashed.json with pid 925 / 18:14:41. The plan should pre-empt misreading that as a Sep 6 crash.

5. **Why the buffer was compressible / why the system survived** — see Error 3. Relevant to Layer 3 sizing: with a *live* mic the same 14 h would be ≈10 GB of incompressible noise and the outcome would have been a jetsam kill of `voice`, not `replicatord`. The plan's "не убит" is luck, not design; worth one sentence.

6. `recorder.stop()` holds the `samples` std mutex during the full clone (`recorder.rs:191-194`) — this also blocks the cpal callback thread (`stream.rs` → `process_chunk`) and the spectrum poller (`get_recent_samples`, `recorder.rs:296-304`). Relevant to Layer 1's "flip stage before stop" — the stop itself must not be O(hours-of-audio) on the hot path.

## 3. Doubtful assumptions

1. "Sep 3 / Sep 5 came through overlay tap" — inference from (a) no rdev lines, (b) no debounce gap, (c) release at +118/119 ms, (d) `manual_start_recording` is only invoked from `overlay.tsx:80-81` (`useRecording.start` has no UI caller). Strong, but the plan presents it as observed fact; there is no log line identifying the Tauri command.
2. "Heartbeat застыл на 7.5 ч" — I cannot find what this refers to; heartbeat.json shows the writer alive until 10 s before SIGTERM. Fine as a rebuttal, but the thing being rebutted is not cited.
3. "load average 200+" (§8) — no evidence in the artefacts (`uptime` today: 52/56/74). The osascript slowness is measured (0.24–5.38 s), its cause is not.
4. "BY-V отдаёт нули в standby" — supported (WARN at 10:53:10Z; 99.8 % `max 0.000`), but the 58-min "живой с шумом" claim is the *time until 12 consecutive zero polls*, not 58 min of sound; only 165 non-zero Spectrum samples (~70 s) exist in 10 h. Layer 2's "sliding-window fraction" design is right for exactly this reason — state it that way.
5. "2 × 1684 MB" assumes both dumps are counted 1:1 as dirtied pages; consistent with `End time` = failed_audio save, but `8986 samples lost` in the `.diag` means attribution to the WAVs is by arithmetic, not by sampled stack.

## 4. Concrete recommendations (minimal, literal changes to the plan)

1. §1.1 replace "запись, которую никто не остановит" with "запись, которую остановит только release *следующего* нажатия (Sep 4 08:38:19Z, Aug 18 03:30:20Z); до этого stage=Recording".
2. §1.1 add: "Паттерн не overlay-специфичен: с 2026-05-12 ≈121 случай, 71 через rdev (hold > 300 мс, release во время perm-check, напр. 2026-06-19T12:19:18), 50 через manual_start." Delete §7 bullet "Избегать старта через overlay-tap … (гонка именно там)" or reword to "любой hold длиной 300 мс + perm-check".
3. §1.2 replace "≈22 ГБ resident" with "rpages ≈22 ГБ = 1.9 ГБ resident + 19.5 ГБ compressed (`physicalPages.internal [122717, 1218979]`) — буфер почти весь нули". Delete "swap 2.86 ГБ" or mark it "текущее `vm.swapusage`, не из отчёта".
4. §1.3A change "48 кГц mono f32 = 192 КБ/с" to "device-rate (44.1/48 кГц, `recorder.rs:161`) ≈176–192 КБ/с; из `.diag` footprint ≈184 КБ/с". Add: "+ вторая копия WAV `dispatch.rs:35` (`ctx.audio_data`)".
5. §1.3B: add "остаток 309 МБ (8.4 %) не разложен; heartbeat-метаданные (tempfile+fsync+rename ×1891) — вероятный источник; 31 МБ — нижняя оценка. Базовый рейт 16.3 КБ/с = 66 % лимита 24.86 КБ/с без единого WAV".
6. §1.4 change "(до 500 мс / 3 с)" to "(pause ≤ 3 с + clone/downsample/VAD/WAV O(n): 6 мин 13 с на Sep 4, 73 с на Sep 5, poller и cpal-callback заблокированы на `samples` mutex)".
7. §1.4 add bullet: "Нет single-flight *старта*: 6 параллельных `on_hotkey_pressed` (Aug 18 03:09:06-09Z), все стартуют; `recorder.start()` возвращает `Ok` при уже идущей записи (`recorder.rs:76-78`)". Layer 0 should add an in-flight press guard.
8. §1.2 add: "При следующем запуске появится `heartbeat.crashed.json` для pid 925 (SIGTERM не пишет clean-marker) — это не crash".
9. Fix refs: `mod.rs:128-130`; perm-check range 0.24–5.38 с (max 2026-08-08).
10. §8: drop "load average 200+" or cite the measurement.

## 5. VERDICT

**CONDITIONAL — maturity 7/10.**

The core causal chain in §1.1 (press blocked in synchronous osascript → release processed and dropped by the stage guard → recording never stopped by that cycle) is correct and reproduces from the raw logs; the death cause (pkill SIGTERM, not OOM), the `.diag` interpretation, the heartbeat.crashed.json attribution to the Aug 31 button reset, the unbounded buffer, the double WAV write, and the toggle-mode/cancel/idempotency bugs are all verified against source and evidence. §1 is undermined by four things that change severity/priorities rather than the fix: (1) the recording is not "unstoppable" — the next hold's release stops it; (2) the race is mostly keyboard-driven and 8× more frequent than "15 за Aug–Sep" suggests, so §7's overlay-avoidance advice is wrong; (3) "22 GB resident"/"swap 2.86 GB" are misread or conflated; (4) `stop()` on a stuck buffer takes minutes, not ≤3 s, and there is no single-flight start. Apply §4 items 1-8 and §1 is GO.
