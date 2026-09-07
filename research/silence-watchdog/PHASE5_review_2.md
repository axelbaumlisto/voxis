# PHASE-5 review #2 — CONFORMANCE critic (spec ↔ code ↔ CHANGELOG ↔ user surface)

Inputs: `/tmp/ado.SjrXbf/FULL-clean.diff` (41 files, read in full except two pure-test tails), `/tmp/ado.SjrXbf/plan-clean.md`, current repo sources for context. Blind to git log / prior reviews / ROUNDS. Pre-verified test/clippy/vitest results adopted; no full suite re-run.

---

## VERDICT: GO — maturity 8/10

No claim in CHANGELOG v0.1.3 is *false* against the code; every §3 layer is DELIVERED or DELIVERED-with-disclosed-improvement; the version quadruple is consistent; entitlements ↔ usage strings match; UI ranges/defaults match Rust validation exactly. What holds it below 9: three semantic over-simplifications a user will notice (silence timer ~+10 s vs. the label, "warning beep" is the *Error* sound, "dead stream recovers" only on the next user gesture), one newly-dead Tauri command, and §4 tests 18/25 not automated (2/21 only at pure-function level). None requires a code change before tagging v0.1.3; all are listed for the release note / follow-up.

---

## 1. BLOCKING findings

None.

---

## 2. Non-blocking findings (ordered by user-visibility)

**N1. Silence auto-stop fires at `timeout + SILENCE_WINDOW_MS` of wall-clock silence, not at `timeout`.**
`src-tauri/src/orchestrator/recording_guard.rs` `guard_step`: `silent_ms` only starts accumulating on the poll where `window.is_full()` first becomes true (40 polls × 250 ms = 10 s of silence already elapsed, `silent_ms == 250` at that moment — pinned by `test_single_loud_poll_within_fraction_tolerance_does_not_reset`). With defaults the recording therefore stops after ≈69.75 s of continuous silence and the beep sounds at ≈66.75 s. CHANGELOG says "default 60 s"; en/ru descriptions say "after this much continuous silence". Deviation from plan §3 Layer 2 (plan says `elapsed_silent ≥ silence_timeout_ms`; it too only accumulates once the window is full, so the *plan* has the same +10 s — the code is faithful to the spec, the *label* is the imprecise part). Minimal fix (either): (a) seed `silent_ms = cfg.window_ms` on the first full-and-silent poll, or (b) add "(+~10 s detection window)" to the two `*Desc` strings and the CHANGELOG line. I'd take (b) for v0.1.3.

**N2. "Warning beep 3 s before" is `SoundType::Error`.**
`recording_guard.rs` `GuardEvent::PreCutoffBeep` arm plays `SoundType::Error` (the author's comment discloses it: no Warning variant exists, `audio_feedback/mod.rs` out of step scope). Consequence: the user hears the *failure* cue while the recording is still live, and the same cue as the `Recover` path's genuine error. CHANGELOG "warning beep" is technically backed (a beep, 3 s before) but the connotation is inverted. Follow-up: add `SoundType::Warning` (short double-tick) — 10 lines in `audio_feedback`.

**N3. "Dead audio stream mid-recording recovers to idle" — only on the next user gesture, not autonomously.**
`recording_guard.rs:365-368`: when `!recorder.is_recording()` the guard `break`s silently; the overlay poller (`audio_level.rs`) exits the same way. Nobody calls `stop_recording`, so the coordinator stays at `Stage::Recording` (overlay shows "Recording") until the user's release (hold) / next press (toggle) reaches `stop_recording` → `StopDecision::Recover` (`recording.rs`). In hold mode that is at most the duration of the hold, so the claim is *practically* true; in toggle mode it is "until the next tap". Minimal improvement: in the guard, replace `break` with `coordinator.stop_recording(StopReason::MaxDuration /*any*/).await; break;` — `stop_decision` maps it to `Recover` regardless of reason. Not blocking; CHANGELOG wording "instead of pinning the app in Recording" is fair for hold mode.

**N4. `transcribe_audio` Tauri command is now dead.**
`src-tauri/src/commands/recording.rs:129-147` still `take()`s `AudioState.pending_audio`, but the only writer (old `stop_recording`) was removed in this diff (`commands/recording.rs` hunk `@@ -29,24 +50,39`). The command will always return `Err("No audio data to transcribe")`. No production frontend caller (`src/lib/commands.ts:305` wrapper + its unit test only), so no user impact — but it is a latent trap and `AudioState.pending_audio` (`lib.rs:75`, `setup/state.rs:143`) is now write-never. Follow-up: delete the command + field + `transcribeAudio` wrapper, regenerate `bindings.ts`.

**N5. `start_recording`/`stop_recording` commands silently changed semantics.**
Now thin wrappers over `manual_start`/`manual_stop` (i.e. `on_hotkey_pressed(true)` / `on_hotkey_released`). In `hotkey_mode = "toggle"`, `stop_recording` → `on_hotkey_released` → early return (toggle guard, `recording.rs` `on_hotkey_released`) → **no-op**. Same pre-existing behaviour as `manual_stop_recording`, so not a regression, but the doc comment on `stop_recording` doesn't say so. `device_id` is accepted and ignored (disclosed in the doc comment). No frontend caller → no user impact.

**N6. Layer 0(b) fallback is synchronous, not `spawn_blocking`.**
Plan: "Fallback: `spawn_blocking` + `timeout(1 s)`". Code: `permissions/macos.rs` `check_microphone_osascript_fallback` → `wait_with_timeout` busy-polls `try_wait` every 10 ms **on the calling tokio worker** for up to 1 s. Only reachable when `AnyClass::get("AVCaptureDevice")` misses (practically never), and bounded at 1 s, so the press/release race is still closed by Layer 0(a). Deviation = simplification, acceptable.

**N7. `Recover`/Discard/too-short paths call `overlay.hide()` — fine — but the `Recover` path also plays `SoundType::Error` and `emit_error`, while the plan's Layer 1 only spoke of `handle_error`. Improvement (skips the 2 s cooldown). Just noting it is extra-spec.**

**N8. §4 test gaps (see matrix): 18 (guard token cancelled on normal release / rapid restart leaves one guard) and 25 (breadcrumb emission for the 4 new sites) have no automated test — the code comment in `recording_guard.rs` tests says so explicitly for 18; nothing says so for 25 (`breadcrumbs.rs` diff adds 12 sites, zero tests). 2 (release↔guard race → one `queue.push`, no UI error) and 21 (oversize → *both* dumps skipped) are covered only at pure-function level (`map_stop_error`/`stop_decision`, `exceeds_size_limit` boundary) — the actual `run_transcription_pipeline` ordering (`pipeline.rs:42` gate before `:61` `save_debug_audio`) is verified by reading, not by a test. Accepted given the harness-B decision, but should be on the manual checklist (§4 below).**

**N9. CHANGELOG "CI now codesigns … notarizes and staples a DMG" is unconditional; the code is conditional.** `macos-vm.sh` `cmd_build_gui` degrades to an **ad-hoc-signed DMG** if `SIGNING_IDENTITY`/`APPLE_API_ISSUER` are unset or the identity/`.p8` is missing in the VM, and ships a signed-but-**unstapled** DMG on a >30 min Apple queue (`NOTARY_WAIT`), recorded in `artifacts/.notary-pending`. `docs/MACOS_SIGNING_TODO.md` documents both degradations accurately; the CHANGELOG line does not. Suggest appending "(falls back to ad-hoc when signing secrets are absent)". Not blocking — the secrets are stated to exist (plan §6).

**N10. Release job budget.** `release.yml:87` job `timeout-minutes: 180`, macOS step `:210` = 150. The step now runs Lane 1 (`cmd_build`, which `rm -rf ~/voxis` **without** the target stash → cold cargo build every run, `macos-vm.sh:261`, pre-existing) **plus** Lane 2 (`cargo tauri build` reusing Lane 1's target via stash, then up to 30 min app-notarization wait + up to 20 min DMG wait). Worst case ≈ cold build + 50 min of Apple queue inside 150 min — plausible but untested. `continue-on-error: true` means a timeout costs only the macOS artefacts, so not blocking.

**N11. `docs/MACOS_SIGNING_TODO.md:407`** still reads "Until then, Voxis correctly ships **unsigned** macOS binaries" — inside the clearly-labelled "History" section, so not a contradiction, but a grep-hit landmine. Consider a one-line "(historical — see Current implementation)" suffix.

**N12. Minor spec-text drift in Layer 7 WARN format.** Plan: `WARN: auto-stopped: {reason} after {N}s`. Code (`recording_guard.rs`): `"recording guard: auto-stopping ({reason:?}) after {}ms elapsed ({}ms accumulated silence)"`. Same information, ms not s, "auto-stopping" not "auto-stopped". Fine.

---

## 3. Conformance matrix — plan §3 layers

| Layer / bullet | Status | Evidence (diff / file) | Note |
|---|---|---|---|
| **L1** `#[derive(Clone)] RecordingCoordinator` | DELIVERED | `recording.rs` `#[derive(Clone)] pub struct RecordingCoordinator` | |
| L1 `stop_recording(&self, reason)` single path; body moved from `on_hotkey_released` | DELIVERED | `recording.rs` `pub(crate) async fn stop_recording` — cancels `polling_cancel` + `guard_cancel` → `spawn_blocking(recorder.stop())` → too-short drop → beep → `queue.push` → `on_release` → overlay | |
| L1 `stop_lock: Arc<tokio::Mutex<()>>` + re-check inside | DELIVERED | `stop_lock` field; `stop_decision(stage, is_recording, reason)` evaluated under `_guard` | pure fn `stop_decision` is an improvement (testable) |
| L1 `stopping: AtomicBool` CAS in `stop()`, reset on every exit, **and in `start()`** | DEVIATED (improvement) | `audio/recorder.rs` `StoppingGuard` RAII resets on every exit; `start()` **refuses** with new `AudioError::StopInProgress` instead of clearing | plan's "store(false) in start()" would mask a live stop; the code's choice is safer and documented in-line; new error variant `audio/error.rs` |
| L1 don't touch `is_recording` in `stop()` | DELIVERED | CAS is on `stopping` only | |
| L1 Stage not flipped before `recorder.stop()` | DELIVERED | `stop_recording`: `coordinator.cancel()/on_release` only after `stop_result` | |
| L1 `on_hotkey_pressed` waits `stop_lock` if `is_stopping()` | DELIVERED (stronger) | `let _start_guard = self.stop_lock.lock().await;` unconditionally before `pre_start`/`recorder.start()` and held through overlay+guard spawn | |
| L1 toggle-press → `stop_recording` | DELIVERED | `press_action` → `PressAction::StopToggle` → `stop_recording(StopReason::TogglePress)` | fixes §1.4 dead code |
| L1 `Orchestrator::cancel()` async → `stop_recording(Cancel)` discard | DELIVERED | `orchestrator/mod.rs` `pub async fn cancel`; `commands/recording.rs` `cancel_operation` `.await` | |
| L1 `get_samples()` → `mem::take` | DELIVERED | `recorder.rs` `std::mem::take(&mut *samples_guard)`; test `test_get_samples_drains_and_releases_capacity` asserts `capacity()==0` | |
| L1 `dispatch.rs` no `audio_data.clone()` into ctx | DELIVERED | `dispatch.rs` ctor arg removed; `context.rs` field removed; `pipeline.rs` clones once only for HTTP body | |
| **L0(a)** `in_flight` + `release_pending` | DEVIATED (improvement, disclosed) | `orchestrator/press_release.rs` one `std::sync::Mutex<PressReleaseMachine>` instead of two primitives; 4 numbered deviations in module doc | atomic Dekker in one critical section |
| L0(a) `press_seq` on both paths | DELIVERED | `next_id += 1` in `press_enter`, called first line of `on_hotkey_pressed` regardless of `skip_debounce` | |
| L0(a) `in_flight = Some(N)` after debounce block | DEVIATED (improvement) | admission **before** debounce; the wake token replaces `pending_press` | closes the select!→slot-clear micro-window structurally |
| L0(a) release: `release_pending.store(true)` **before** stage check (unconditional) | DEVIATED (improvement, documented as load-bearing) | `release_arrived` sets it only if `in_flight.is_some()`; invariant `release_pending ⇒ in_flight` + test | unconditional would poison every second recording; residual race disclosed (press task starved for the whole hold) |
| L0(a) checkpoints (i) post-select, (ii) pre-start, (iii) post-`await_stage` | DELIVERED | `press_exit.post_debounce()`, `.pre_start()` under `stop_lock`, `.post_stage_recording()` → `stop_recording(ReleasePending)` | |
| L0(a) clear on every early return | DELIVERED (+RAII) | `PressExitGuard` `Drop`; explicit `early_return()` on perm-denied, start-Err, toggle, ignore; `stage_timeout()` for orphan | orphan-recorder recovery is extra-spec, good |
| **L0(b)** objc `AVCaptureDevice authorizationStatusForMediaType:` | DELIVERED | `permissions/macos.rs` `check_microphone_native`, `#[link(name="AVFoundation")]`, `AnyClass::get` (no panic) | measured 9–41 ms, not µs — disclosed |
| L0(b) cache only `Granted` | DELIVERED | `MICROPHONE_GRANTED_CACHE` + `check_microphone_with` tests | |
| L0(b) fallback `spawn_blocking` + `timeout(1 s)` | PARTIAL | sync `wait_with_timeout` 1 s on the worker (N6) | |
| L0(b) `Unknown` → go to `recorder.start()` | DELIVERED | `PermissionStatus::blocks_start()` (Denied only); used in `recording.rs` and `commands/recording.rs` | |
| **L2** `recording_guard.rs`, one task two conditions | DELIVERED | `spawn_recording_guard`, `guard_step` returns `Stop(SilenceTimeout|MaxDuration)` | |
| L2 runs regardless of `overlay.enabled`; token take-and-cancel-old; never `abort()` | DELIVERED | `recording.rs` guard spawn after the `if config.overlay.enabled` block; `guard_cancel` slot; no `JoinHandle` kept | |
| L2 boost-independent peak RMS via `fetch_max`/`swap(0)` | DELIVERED | `audio/level.rs` `rms_peak_bits.fetch_max(rms.to_bits())` (+NaN guard); `recorder.take_rms_peak()` | plan name `rms_peak()` → `take_rms_peak()` |
| L2 constants | DELIVERED | `config/consts.rs` all 9 present with plan values; `SILENCE_RMS` doc says "not empirically validated" | plan §5 asked for one built-in-mic measurement — **not done** (see §4 checklist) |
| L2 ring buffer, full-window gating, fraction, single click doesn't reset | DELIVERED | `SilenceWindow`; tests t12–t14 | see N1 for the +window latency |
| L2 pure `guard_decision(...)` | DELIVERED | `guard_step(&mut GuardState, rms, cap_hit, &GuardCfg)` | signature differs (state struct) — equivalent |
| L2 beep once at `timeout − 3000` | DELIVERED | `beeped` latch; re-armed on un-silence (t17b) | uses `SoundType::Error` (N2) |
| L2 detector removed from `audio_level.rs` | DELIVERED | hunk deletes `silent_iters`/`SILENT_ITER_THRESHOLD` block | |
| **L3** `set_max_samples` → callback stops pushing + `cap_hit` | DELIVERED | `level.rs` `if samples.len() < max {push} else {hit=true}`; `stream.rs` plumbing through 4 fns | |
| L3 cap = `max_recording_ms/1000 × native_rate`; 0 → `ABS_MAX` | DELIVERED | `native_cap_samples` / `effective_max_recording_ms` (also clamps >ABS) ; `recorder.sample_rate()` accessor | |
| L3 active stop from guard | DELIVERED | `guard_step`: `cap_hit || elapsed ≥ max` → `MaxDuration` (checked first) | |
| **L4** `MAX_AUDIO_BYTES` gate at pipeline start, skips both dumps | DELIVERED | `pipeline.rs:42` before `validate_config`/`save_debug_audio:61`; `save_failed_audio` also self-guards; `exceeds_size_limit` pub(crate) | |
| L4 Spectrum → `trace!` ≤1/5 s | DELIVERED (both) | `audio_level.rs` `should_log_spectrum` (62 polls ≈ 4.96 s) + `tracing::trace!` | |
| L4 heartbeat: drop `sync_all` | DELIVERED | `heartbeat.rs` line removed; 2 tests | |
| **L5** consts / `config/mod.rs` `#[serde(default)]` / sqlite load+save / `validate_zero_or_range` / ranges | DELIVERED | all four files; ranges `{0}∪[5000,300000]`, `{0}∪[10000,780000]` | |
| L5 `settingsRegistry.ts`, `commands.ts`, `bindings.ts` | DELIVERED | all three; `commands.ts` also adds the previously-missing `min_recording_ms` | |
| **L6** UI settings (0 = off) | DELIVERED | `en.json`/`ru.json` 4 keys; registry section "Recording" | strings state 5000-300000 / 10000-780000 / defaults 60000 / 600000 / "30-min safety cap" — **exactly** match Rust |
| **L7** WARN + 4 breadcrumbs | DELIVERED | `breadcrumbs.rs` 12 new sites incl. the 4 named; `warn!` in guard | no tests (N8) |
| **L8** bump 0.1.2→0.1.3 `Cargo.toml` + `tauri.conf.json` | DELIVERED (+) | also `package.json` (was 0.1.0) and `Cargo.lock` voice entry; all four = 0.1.3 (verified in repo) | |
| **L9 / §6.1** `cmd_build_gui` sign→notarize→staple→DMG in VM, scp, fallback unsigned, `cmd_notary_finish` | DELIVERED | `scripts/macos-vm.sh` `cmd_build_gui` (~280 lines), `cmd_notary_finish`; Entitlements passed on both `codesign` calls; `.notary-pending` protocol | `Invalid/Rejected` hard-fails (good) |
| §6.2 `signingIdentity` `"Voxis Dev"` → `"-"` | DELIVERED | `tauri.conf.json` + `entitlements: "Entitlements.plist"` | |
| §6.3 `release.yml` → `build-gui`, keep `continue-on-error`, publish `.dmg`+`.tar.gz` | DELIVERED | Lane 2 block; both artefact loops + verify step include `Voxis_*_aarch64.dmg` | timeout 60→150 |
| §6.4 in-VM verification `codesign --verify --strict`, `spctl -a -vvv`, `stapler validate` | DELIVERED | inside `SIGNEOF`/`DMGSIGN` heredocs | `spctl` on arm64 app inside x86_64 VM — see §4 |
| §6.5 `MACOS_SIGNING_TODO.md` updated, secrets by path only | DELIVERED | new "Current implementation" section; no secret values | N11 |
| §6.6(a) own image `~/voxis-macos-vm/…`, `cp --reflink=auto`, PREPARED path, refuse w/o clone | DELIVERED | `VM_DIR` default changed; `cmd_clone_image`; `cmd_naked` error message; `release.yml` preflight path aligned | CI never auto-clones (documented) |
| §6.6(b) host-wide `flock -n /home/spex/.macos-vm.lock` around `docker run`, message naming holder | DEVIATED (improvement) | `vm_lock_acquire_or_die`: `flock -w 15` (not `-n`, reason documented) + authoritative `docker ps \| grep -iE 'macos\|osx'` gate + lifetime holder (`vm_lock_spawn_holder`, `setsid -f`); `--restart no` | stronger than spec; `-w 15` rationale (own stale holder) is sound |

## Conformance matrix — plan §4 tests

| # | Status | Evidence |
|---|---|---|
| 1 | PARTIAL | `test_concurrent_stop_is_single_flight` (device-dependent; headless fallback only checks reset). Loser gets `StopInProgress` (plan said `NotRecording` — deliberate improvement). "VAD mutated once" not asserted. |
| 2 | PARTIAL | pure: `map_stop_error` `SilentRaceLost`, `stop_decision` Skip. No integration of "one `queue.push`". |
| 3 | DELIVERED (pure) | `test_press_action_toggle_mode_recording_stops_toggle` |
| 4 | PARTIAL | `test_cancel_decision_is_discard_not_finalize` + `test_get_samples_drains_and_releases_capacity` (capacity==0). `polling_cancel` cancelled — by reading only. |
| 5 | DELIVERED | `test_cancel_ordering_assumption_matches_coordinator_semantics` + `…recover_path_via_real_coordinator` (real coordinator) |
| 6 | DELIVERED | `test_start_refused_while_stopping` |
| 7 | DELIVERED | `test_t7_release_during_permcheck_never_starts` |
| 8 | DELIVERED (reframed) | `test_t8_release_immediately_after_admission_never_starts` (slot no longer exists) |
| 9 | DELIVERED | `test_t9_six_concurrent_presses_admit_exactly_one` |
| 10 | DELIVERED | `test_t10_early_return_clears_*` (×2) |
| 11 | DELIVERED | `test_permission_blocks_unknown_passes`, `test_check_microphone_native_smoke` (<200 ms bound, not µs — disclosed) |
| 12–17 | DELIVERED | `recording_guard.rs` tests t12…t17 + t17b + beep>timeout pathological case |
| 18 | MISSING (declared) | comment in `recording_guard.rs` tests: not automatable without `tauri/test`; → manual checklist |
| 19 | DELIVERED | `test_process_chunk_respects_sample_cap`, `test_native_cap_samples_zero_uses_absolute_backstop` |
| 20 | DELIVERED | `test_process_chunk_peak_tracks_loudest_chunk_then_take_resets` |
| 21 | PARTIAL | `exceeds_size_limit_at_boundary` etc.; "both dumps skipped" verified by code order only |
| 22 | DELIVERED | `should_log_spectrum_at_most_one_line_per_five_seconds` |
| 23 | DELIVERED | `heartbeat_persist_without_sync_all_is_valid_and_leaves_no_temp_file` |
| 24 | DELIVERED | config default/serde/zero tests; sqlite round-trip ×2; `validate_zero_or_range` ×3 + 8 field tests |
| 25 | MISSING | no test asserts the 4 new breadcrumb sites emit |
| 26 | DELIVERED | pre-verified (1031 lib tests, clippy clean, vitest 1891) |

## CHANGELOG v0.1.3 — claim-by-claim

| Claim | Backed? | Where |
|---|---|---|
| Press/release race fixed; single-flight start; release-pending checkpoints; "either never starts or stops immediately" | YES | `press_release.rs` + 3 checkpoints in `recording.rs`; residual scheduler-gap race disclosed in module doc (orders of magnitude narrower) |
| Mic probe native AVFoundation ~10–40 ms | YES | `permissions/macos.rs` doc: 9 ms warm / 41 ms cold |
| Silence auto-stop default 60 s, 0 = off, **warning beep 3 s before** | YES with caveats | 60 s of *accumulated* silence after a 10 s detection window (N1); beep = Error sound (N2) |
| Max length default 10 min, 0 = off; **absolute 30-min cap always applies** | YES | `effective_max_recording_ms`, `native_cap_samples`, `guard_step` max-first |
| Buffer hard-capped at native rate; **memory released on stop** | YES | `level.rs` cap; `mem::take` in `get_samples` |
| One serialized stop path (release, toggle, cancel, guard); **toggle tap-to-stop works** | YES | `stop_recording` + `stop_lock`; `PressAction::StopToggle`; `Orchestrator::cancel` async; guard calls same fn |
| Dead stream mid-recording recovers to idle with error cue | YES (on next gesture — N3) | `StopDecision::Recover` arm |
| Oversize >25 MB rejected before any disk write / network | YES | `pipeline.rs:42` |
| Spectrum log throttled; heartbeat no fsync | YES | `audio_level.rs`, `heartbeat.rs` |
| CI codesigns (Dev ID, Hardened Runtime + mic/Apple-Events entitlements), **notarizes and staples a DMG**; **own VM image and host-wide launch lock** | YES, conditional (N9) | `cmd_build_gui` `--options runtime --entitlements`; `stapler staple` app + DMG; `cmd_clone_image`; `vm_lock_*` |
| v0.1.2 entry "out-of-tree signed rebuild … no source changes" | consistent with plan §6 fact | — |

## User-visible surface checks

- **Settings labels/descriptions (en+ru) vs Rust validation**: `silence_timeout_ms` "5000-300000; 0 = off" ↔ `validate_zero_or_range(…, 5_000, 300_000)`; `max_recording_ms` "10000-780000 (~13 min…); 0 = off (absolute 30-min safety cap…)" ↔ `(…, 10_000, MAX_RECORDING_MS_CEILING=780_000)` + `ABS_MAX_RECORDING_MS=1_800_000`; placeholders 60000/600000 ↔ `DEFAULT_*`. **All match.** ru.json is a faithful translation of en.json.
- **Info.plist ↔ Entitlements.plist**: `com.apple.security.device.audio-input` ↔ `NSMicrophoneUsageDescription` (pre-existing); `com.apple.security.automation.apple-events` ↔ `NSAppleEventsUsageDescription` (added). **Complete.** Tauri v2 auto-merges `src-tauri/Info.plist`; `tauri.conf.json` references `Entitlements.plist`.
- **Versions**: `tauri.conf.json` = `Cargo.toml` = `package.json` = `Cargo.lock [[package]] voice` = **0.1.3** (verified in repo, not just diff). `cmd_build_gui` additionally gates Cargo.toml == tauri.conf.json at runtime.
- **`docs/MACOS_SIGNING_TODO.md` vs `release.yml`/`macos-vm.sh`**: entry point, artefact name `Voxis_<ver>_aarch64.dmg`, `continue-on-error`, `NOTARY_WAIT` 1800 s, `.notary-pending`, lock path `/home/spex/.macos-vm.lock`, `--restart no`, `clone-image` requirement, `"-"` signing identity — all consistent. Only N11 (historical sentence).

## §7 "immediate measures" / §8 "out of scope" — accidental implementation or contradiction?

- §7 "do NOT switch `hotkey_mode = toggle`": default stays `"hold"` (`config/mod.rs` `default_hotkey_mode` untouched). The *reason* for the measure (toggle can't stop) is now fixed, so the measure becomes obsolete — CHANGELOG should not tell users to avoid toggle; it doesn't. ✓
- §7 change `audio_device` to built-in mic: **not** implemented in code (no default change) — correct, it was a user action. ✓
- §7 clear `debug/`/`failed_audio/`: no code deletes user data. ✓ (Layer 4 only *prevents future* oversize dumps.)
- §7 expect spurious `heartbeat.crashed.json`: heartbeat change (no `sync_all`) doesn't alter clean-marker semantics. ✓
- §8 osascript slowness root cause: not investigated; native path removes the dependency. ✓ No contradiction.

---

## 4. What is right (proportion)

- The root-cause fix is *structurally* correct and better than the plan's sketch: one mutex-guarded ordering machine, admission before any await, RAII exit guard, and the release-pending invariant is stated and tested. The four deviations from the plan's literal text are each documented with the failure mode the literal version would have had — that is exactly the kind of engineering judgement a spec-conformance review wants to see.
- Every stop path (release, toggle, cancel, guard, release-pending, orphan) funnels through one function under one lock, with the stage flipped only after `recorder.stop()` returns — the §1.4 toggle dead-code and `cancel()`-leaves-mic-open bugs are gone, and `Recover` closes a case the plan didn't name (recorder dies with stage pinned at Recording).
- Memory story is complete end-to-end: native-rate cap in the callback, `mem::take` on stop, no second WAV copy in the pipeline, oversize gate before any I/O.
- Layer 9 is a faithful port with meaningful hardening beyond spec (lifetime lock holder, `docker ps` ground-truth gate, hard-fail on Invalid/Rejected, ship-now-staple-later with a recorded submission id, version-consistency gate, DMG size sanity).
- User-visible ranges/defaults are identical across Rust validation, TS registry, en, ru, and CHANGELOG. Version quadruple consistent.

---

## 5. Residual risks for the manual Phase-5 checklist (real hardware / real CI only)

1. **`SILENCE_RMS = 0.005` unvalidated** (plan §5 asked for one built-in-mic idle measurement; `consts.rs` doc admits it isn't done). On the MacBook Air mic in a quiet room: does a normal *pause in speech* (≥10 s) ever trip the window while the user is still thinking? And does the BY-V-in-standby zero stream trip it (it should)? Test both; adjust constant before tag if idle floor is above −46 dBFS.
2. **Silence stop wall-clock**: with defaults, confirm stop at ≈70 s (not 60 s) of silence, beep at ≈67 s (N1), and decide whether to reword the label.
3. **Beep timbre** (N2): confirm the pre-cutoff cue is distinguishable enough from a real error for the user; otherwise add `SoundType::Warning` in a point release.
4. **§4 test 18 by hand**: (a) start, release normally → guard log "Recording guard cancelled" appears; (b) start/stop/start rapidly → only one "Starting recording guard" alive per recording (no duplicate `auto-stopping` lines later).
5. **§4 test 25 by hand**: trigger each of the 4 breadcrumbs (`recording:press_ignored_in_flight` via 2 quick overlay taps, `recording:release_pending_applied` via a fast tap, `recording:auto_stopped_silence`, `recording:auto_stopped_max_duration` with `max_recording_ms=10000`) and check `breadcrumbs` output.
6. **Layer 0 end-to-end** (plan §5 asked for a temporary `[[bin]]`): on real hardware, tap the overlay cell as fast as possible ×20 and hold AltGr for 350–600 ms ×20 — no `recorder started OK` without a matching stop within 1 s; no "Ignoring hotkey release" lines.
7. **Dead-stream behaviour** (N3): unplug/disable the input device mid-recording in **toggle** mode and confirm the overlay stays "Recording" only until the next tap, then shows the error cue and returns to idle.
8. **Notarized DMG on a clean Mac**: `spctl -a -vvv -t open --context context:primary-signature Voxis_0.1.3_aarch64.dmg` → `accepted, source=Notarized Developer ID`; launch; verify the **microphone prompt appears** and **auto-typing Accessibility prompt appears** (the two entitlements under Hardened Runtime — the exact failure the Entitlements.plist comment warns about). Also verify `spctl -t exec` inside the x86_64 VM actually assesses the arm64 bundle rather than erroring (the script treats a non-zero there as fatal under `set -e`).
9. **CI wall-clock** (N10): first tagged run — measure Lane 1 + Lane 2 against the 150-min step budget; if the Apple queue is slow, confirm the `.notary-pending` path produces an unstapled-but-signed DMG and that `notary-finish` re-emits it *before* the next release wipes `~/voxis` in the VM.
10. **Host lock on spex**: with clipshot's VM up, run `scripts/macos-vm.sh naked` → must refuse with the clipshot container named; with nothing up, run `naked` then `stop`, then `naked` again within 5 s → must succeed (the `-w 15` self-holder window).
11. **`max_recording_ms = 0` UX**: at the 30-min absolute cap the audio (57.6 MB @16 kHz) is *guaranteed* to hit the 25 MB gate and be rejected without a dump — confirm the error message is the "too large" one and that no `failed_audio/` entry is written.
