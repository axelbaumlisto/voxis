# PHASE5 review 4 — fresh critic, final repeat round (post-audit fix set)

Scope: the 5 behavior fixes (A–E) + doc sweep, i18n parity, CHANGELOG, test expectations.
Blind review (no git log / other reviews / plans). Read current sources directly; ran
`cargo test --lib orchestrator::` once → **241 passed / 0 failed**.

VERDICT: **GO — maturity 8.5/10**

All five fixes are present and correct as claimed; nothing new of BLOCKING severity was
introduced. Findings below are all minor (UX/observability polish), none require a code
change before merge.

## A–E

### A. `press_enter()` moved after `press_action` — VERIFIED
- `recording.rs:312` reads `current_stage()`; `:336` `load_config_from_app`; `:338` `match press_action(...)`.
- `StopToggle` (`:339-348`) → `stop_recording(TogglePress).await; return` — **no** `press_enter`, **no** `early_return`.
- `Ignore` (`:349-352`) → `tracing::debug!; return` — untouched machine.
- `Start` (`:353`) falls through; `press_enter()` is at `:367`, and `PressExitGuard` is created only after (`:380`).
- Remaining `early_return()` calls (`:437`, `:482`, `:503`) are all on the Start path *after* admission — correct.
- Release during Ignore/StopToggle: `in_flight == None` → `release_arrived` → `ProceedRelease` (`:668`) → `stop_recording(Release)` → stage Recording + is_recording → `Finalize`. The regression (overlay tap swallowing a keyboard-held release) is closed.
- Trade-off: the pre-admission window for Start presses now includes a sync stage read + one SQLite config load. Acceptable: the exposure requires the press task to be starved for ≥ `hold_ms` (default 300 ms) while a release is fully processed first, and its failure mode is a *Skip* (nothing starts), not an orphaned recorder — the strictly better direction versus the bug A fixes. `press_release.rs:105-121` module doc states this honestly ("Honestly, this window is no longer JUST the scheduler gap … that config load can itself take low-single-digit milliseconds … this trade is deliberate"). Inline comment at `recording.rs:355-364` matches.

### B. `ever_loud` / `SilenceTimeoutNoSpeech` → Discard — VERIFIED
- `recording_guard.rs:319-325`: `is_silent = rms_peak < cfg.silence_rms; if !is_silent { ever_loud = true }` — set **before** `window.push`, never reset (`GuardState` doc `:224-231`, init `false` at `:242`). Order doesn't matter functionally (the flag is independent of the window), but it's the clear reading.
- NaN: `NaN < x` is `false` → would set `ever_loud`. **Not reachable**: `audio/level.rs:77` guards `if rms.is_finite()` before `fetch_max`, and the atomic starts at `0` bits (`recorder.rs:85,142`) → first poll of a silent take reads `0.0` → silent. Fine.
- `:368-372` returns `Stop(SilenceTimeout)` iff `ever_loud`, else `Stop(SilenceTimeoutNoSpeech)`.
- `recording.rs:172`: `Cancel | SilenceTimeoutNoSpeech => Discard`. Discard path `:838-847`: no `queue.push`, no Stop beep (beeps are after this early return), `coordinator.cancel()` → `await_stage(Idle)` → `overlay.hide()` → `mirror_state()`. `coordinator.rs:226-233` Cancel only flips Recording→Idle — stage is guaranteed Recording here, so it applies.
- Loud-then-silent → `SilenceTimeout` → `Finalize` (`test_silence_timeout_after_earlier_speech_finalizes_normally`, `:655`).
- Distinct breadcrumb `recording:auto_stopped_silence_no_speech` (`breadcrumbs.rs:599-602`, wired at `recording_guard.rs:476-478`).

### C. `guard_max_recording_ms` only for the elapsed check — VERIFIED
- `recording_guard.rs:293-294` = `effective_max(...).min(MAX_RECORDING_MS_CEILING)`; used exactly once, `:333` (guard elapsed/cap check).
- `native_cap_samples` (`:302-303`) still uses `effective_max_recording_ms` (ABS 30 min); sole caller `recording.rs:616` `set_max_samples(native_cap_samples(...))`. No other non-comment reader of `effective_max_recording_ms` for elapsed.
- Test seed `:865` `elapsed_ms = MAX_RECORDING_MS_CEILING - cfg.poll_ms`; `:1018-1028` pins the two clamps diverge above CEILING.
- `MAX_RECORDING_MS_CEILING = 780_000` (`config/consts.rs:152`) = 13 min → i18n "still stops at ~13 min" correct.

### D. Guard `!is_recording()` → `stop_recording(StreamDied)` — VERIFIED
- `recording_guard.rs:417-438`: warn → `if token.is_cancelled() { break }` → `coordinator.stop_recording(StopReason::StreamDied).await; break`.
- `stop_decision(Recording, false, StreamDied)` → `Recover` (`recording.rs:167-170`, any reason). Recover arm `:711-742`: cancels tokens (incl. the guard's own — harmless, the guard is past its `select!` and breaks right after), Error beep, `emit_error("Recording was interrupted …")`, `coordinator.cancel()`, `await_stage(Idle)`, overlay hide, `mirror_state`. No double call: a concurrent release holding `stop_lock` cancels the guard token *before* `recorder.stop()` (`:696-698`), so by the time `is_recording()` goes false from a normal stop, `token.is_cancelled()` is already true → guard breaks; and if the guard does enter `stop_recording`, re-check under the lock sees stage Idle → `Skip`.
- Post-Ok breadcrumb match `:830-836`: `StreamDied` arm is `tracing::debug!` — **no `unreachable!`/panic**. The guard-side `unreachable!` at `:481` covers only `guard_step` outputs, which are exactly the 3 listed variants (`:334`, `:368-372`).
- `test_stop_decision_stream_died_recovers` (`:1164`) + coordinator-level Recover test (`:1171-1191`) present and passing.

### E. `release.yml` advisory warning — VERIFIED
- P5.diff `:1-19`: `::warning::` annotation + guarded `>> "$GITHUB_STEP_SUMMARY"` append; `continue-on-error`/no `exit 1` preserved; still inside the same `else`. Quoting/heredoc-safe (backticks escaped). YAML validity reported ok by the orchestrator; structure of the hunk is indentation-consistent.

## Also

(i) **Doc sweep** — 5 spot-checks, rationale preserved in every case:
1. `press_release.rs:1-20` root-cause paragraph keeps the 0.3–5.4 s permission-check story and the "single source of truth / thin drivers" WHY; only `plan §…` labels dropped.
2. `press_release.rs:24-26` token purpose ("purely to let `release_arrived` wake a sleeping press early") kept; review-round tag removed.
3. `press_release.rs:40+` "Disclosed deviations from the plan's literal sketch" → "Design choices worth explaining" — the Dekker-order / single critical-section argument survives intact.
4. `breadcrumbs.rs:503-505` `recording_stop_release` doc updated to "only `Cancel`/`SilenceTimeoutNoSpeech` do" — corrected, not just stripped.
5. `recording_guard.rs:29-60` module doc explains `ever_loud`, the CEILING clamp and the StreamDied route with reasons.

(ii) **i18n parity**: `en.json`/`ru.json` `:88-96` hunks are 1:1 (rolling 10 s window / "stop ≈ N + 10 s" / isolated words don't reset; 0 = off → still stops at ~13 min + separate larger raw-buffer backstop). Russian is a faithful translation.
**CHANGELOG** claims vs code: "+~10 s" ✓ (`SILENCE_WINDOW_MS = 10_000`, `silent_ms` accumulates only once the window is full → stop ≈ N + 10 s); whole-silent take discarded ✓ (B); 13-min cap with 0=off ✓ (C); Recover "on the next stop request, or automatically once the recording guard notices" ✓ (D); ad-hoc fallback ✓ (`release.yml:239`); "unstapled if Apple's queue exceeds 30 min" ✓ (`scripts/macos-vm.sh:369,379,428`, `NOTARY_WAIT` default 1800 s).

(iii) **Test expectations**: the three tests switched to `SilenceTimeoutNoSpeech` (`test_silence_timeout_fires_at_exact_poll_silent_ms_reaches_timeout :589`, `test_pre_cutoff_beep_fires_exactly_once_then_stops :879`, `test_beep_lead_time_exceeding_timeout_does_not_fire_before_window_fills :911`) drive **only** `silent_step` (rms 0.0 < 0.01) — never a loud poll — so `NoSpeech` is the correct, not weakened, expectation. Each is complemented by a Finalize-path sibling (`:655`) so `SilenceTimeout` is still covered.

## NEW findings (all minor)

1. `recording.rs:838-847` — **minor** — the `SilenceTimeoutNoSpeech` Discard is *silent* to the user (no beep, no `emit_error`/toast): overlay just disappears. The user did get the pre-cutoff `Error` beep 3 s earlier, so it is not zero feedback, but "recording vanished, nothing typed" is indistinguishable from a bug. Fix (one line, optional): in the Discard branch, `if reason == StopReason::SilenceTimeoutNoSpeech { self.emit_error("No speech detected — recording discarded") }` (or a non-error info event if one exists). Not blocking.

2. `recording_guard.rs:451-458` — **minor / observability** — the `warn!` on auto-stop logs `elapsed_ms`/`silent_ms` but not the whole-take max `rms_peak`. For the soft-speaker case below, a single extra field (track `max_rms_peak` in `GuardState`) would let a support log prove whether a Discard was justified. Optional.

3. `recording.rs:312,336` — **minor** — `load_config_from_app` is now called up to 4× per press (`:336`, `:402`, `:442`, plus in `stop_recording`). Pure redundancy (µs–low-ms each); `early_config.hotkey_mode`/`hotkey_hold_ms` could be reused for `:402`. Cosmetic, out of scope for this round.

No BLOCKING findings.

## Risk statement — B soft-speaker case

`SILENCE_RMS = 0.005` (−46 dBFS) is compared against the **max per-chunk RMS over each 250 ms poll**, pre-boost (`level.rs:71-78`). Any chunk (~10–20 ms) of the take exceeding −46 dBFS RMS flips `ever_loud` for good. Normal speech into a working mic at default OS input gain lands at roughly −30…−12 dBFS RMS; even quiet, distant speech is typically ≥ −40 dBFS in its loudest syllable chunk. So a false Discard requires a mic whose *loudest 20 ms of the entire take* stays below −46 dBFS — i.e. a mic effectively muted/mis-gained.

Second gate: the Discard only fires if the silence guard *also* judged ≥ 80 % of every 250 ms poll for the full `silence_timeout_ms + 10 s` window (default 70 s) as silent by the same threshold. A hold-mode user releasing after a normal sentence never reaches it; it needs someone to hold/toggle for ≥ 70 s with no chunk ever crossing the floor. Previously such a take would have been sent to Whisper as (perceived) near-silence — with VAD on it would be trimmed to nothing anyway; with VAD off it produced the hallucination B exists to stop. Net: the population affected by the new Discard is the population whose transcription was already unreliable, and the downside changes from "hallucinated text auto-typed into the active app" to "nothing typed" — strictly safer.

**Residual risk: low, not zero, and currently silent (finding 1).** Recommended mitigation if any: not a stricter second floor (that reintroduces the hallucination risk it closes), but the one-line user cue in the Discard branch + logging the take's max `rms_peak` so a mis-gained mic is diagnosable. Leaving as-is and documenting is also defensible.

Stop rule: only minors → **GO**.
