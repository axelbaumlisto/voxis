# PHASE-5 review 1 — INTEGRATION critic (seams between the ~13 steps)

Inputs: `/tmp/ado.SjrXbf/FULL-clean.diff` (all Rust hunks read: recorder, stream,
commands/recording, config/*, breadcrumbs, heartbeat, audio_level, dispatch, mod,
press_release, recording, recording_guard, transcription/*, permissions/*,
config_sqlite; TS hunks; plists; CHANGELOG/docs), plan §1–§4, plus targeted greps in
the live tree. Pre-verified test/clippy/tsc results adopted as given.

VERDICT: **GO — maturity 8/10**

No seam I found is a ship-stopper. There is one narrow, newly-introduced hole of the
*same class* as the bug being fixed (finding 2.1) that is a ~5-line change and I would
strongly prefer it land before the tag, but it needs a second press *source* mid-recording
(overlay tap or the raw `start_recording` command — the rdev listener already filters
auto-repeat) coinciding within single-digit ms with the key release, so I do not rate it
blocking for v0.1.3.

---

## 1. BLOCKING findings

None.

---

## 2. Non-blocking findings (ordered by importance)

### 2.1 Admission-before-decision opens a ms-wide "swallowed release" window (same bug class)
`orchestrator/recording.rs` `on_hotkey_pressed` ~L288–L330 + `press_release.rs`
`release_arrived` / `clear`.
- Step "machine" put `press_enter()` on the very first line (deviation 2), *before* the
  stage/mode read. Step "recording.rs driver" then handles `PressAction::Ignore`
  (hold-mode press while `Recording`) and `StopToggle` by `press_exit.early_return()`.
- Between `press_enter()` and `early_return()` the driver does `current_stage()` +
  `load_config_from_app()` (opens a fresh SQLite connection, reads ~40 keys → ms).
  During that window `in_flight == Some`, so a genuine release of the **already-running**
  recording hits `release_arrived` → `ArmReleasePending` → returns **without**
  `stop_recording`. `early_return()` then unconditionally sets `release_pending = false`.
  The release is gone; the recording stays up until the next press+release — exactly the
  incident shape in plan §1.1, just orders of magnitude narrower.
- Reachable today via: overlay `pointerdown` (`manual_start`) while a keyboard-held
  recording is running, or the raw `start_recording` Tauri command. Not via key
  auto-repeat (`hotkey/mod.rs:398` `!is_pressed` filter).
- Minimal fix (either): (a) read `stage`/`is_toggle_mode` **before** `press_enter()` and
  only admit on `PressAction::Start` (the two `Ignore`/`StopToggle` branches then never
  occupy `in_flight`); or (b) have `PressReleaseMachine::early_return` return
  `release_was_pending: bool` and, in the `Ignore` branch, call
  `stop_recording(StopReason::Release)` when it is `true` (harmless `Skip` in every other
  early-return site). Add a machine test: admit → `release_arrived` → `early_return` must
  surface the pending release rather than drop it.

### 2.2 Stale cross-step doc comments (steps didn't re-read each other)
- `orchestrator/recording.rs:223` — `guard_cancel` doc still says "Token for the
  **not-yet-landed** recording guard (Layer 2). Always `None` until that step fills it".
  The guard landed in this same change set.
- `diagnostics/breadcrumbs.rs` `recording_stop_recover` doc still lists "a bypassing raw
  `stop_recording` Tauri command stopped the recorder underneath the orchestrator" as a
  cause — that bypass was removed by the later `commands/recording.rs` step in this set.
- `press_release.rs` `release_arrived` doc: "Called unconditionally from
  `on_hotkey_released` (hold mode only …)" — correct, but the module doc's residual-window
  paragraph still argues about "config load … before it", i.e. reasoning from an earlier
  revision. Harmless, but confusing for the next reader.
- Internal step/review labels leaked into shipped source **and the public TS bindings**:
  `src/bindings.ts:632,635` ("the T3 r1 review", "pre-T4c signature"), and ~60 `T<n>`
  references across `recording.rs` / `press_release.rs` / `recording_guard.rs` /
  `breadcrumbs.rs` / `commands/recording.rs`. `bindings.ts` is specta-generated from the
  Rust doc comment, so fix the Rust doc and regenerate.

### 2.3 API surface: `transcribe_audio` + `pending_audio` are now write-orphaned, silently
- `commands/recording.rs` raw `start_recording`/`stop_recording` are now `async` wrappers
  over `manual_start`/`manual_stop`; `stop_recording` no longer writes `pending_audio`.
  `transcribe_audio` (`commands/recording.rs:138`) still reads it → any caller of the old
  start → stop → transcribeAudio sequence now always gets "No audio data to transcribe".
- `bindings.ts`/`commands.ts` still type-check (return types unchanged; TS `invoke` is
  already async) and **no frontend caller exists** (`overlay.tsx` uses
  `manualStartRecording`), so nothing breaks today — but nothing flags it either: no
  `#[deprecated]`, no doc on `transcribe_audio`, and `AudioState.pending_audio`
  (`lib.rs:75`, `setup/state.rs:143`) is now dead state kept alive only by its own unit
  tests. Recommend: delete `transcribe_audio` + `pending_audio` (and the TS wrappers), or
  doc them as deprecated in the same commit that orphaned them.
- Minor duplication: `start_recording` runs `check_microphone_permission()` and then
  `on_hotkey_pressed` runs the same probe again (both `blocks_start()`, both native now —
  two ~10 ms calls, harmless).

### 2.4 Silence auto-stop **Finalizes**: possible auto-typed hallucination with no user action
`recording_guard.rs` → `stop_recording(SilenceTimeout)` → `StopDecision::Finalize` →
`queue.push` → transcription → `auto_type`.
- Design-consistent (plan says Finalize) and the too-short drop + VAD (default `enabled:
  true`) + `is_likely_hallucination` make the common case a silent discard. But if VAD is
  off or the Silero model fails to load and the mic was silent for the *whole* take,
  60–70 s of room noise goes to Whisper, whose well-known silence hallucinations
  ("Thank you for watching", subtitle credits) would be **typed into whatever window has
  focus** with no human in the loop.
- Cheap hardening: the guard already knows whether `rms_peak ≥ silence_rms` was **ever**
  observed in this recording; if never, route as `Discard` (a new reason or a flag on
  `SilenceTimeout`). Otherwise leave Finalize (user spoke, then walked away — they want
  the text).
- Also: effective silence timeout is `silence_timeout_ms + SILENCE_WINDOW_MS` (window must
  be *full* before `silent_ms` accumulates) → default fires at ~70 s, not 60 s. UI text says
  "after this much continuous silence". Either subtract the window or say "≈".

### 2.5 `max_recording_ms = 0` ("off") produces a recording that can never be transcribed
`effective_max_recording_ms(0) = ABS_MAX_RECORDING_MS = 1_800_000` → 30 min @ 16 kHz/16-bit
= 57.6 MB > `MAX_AUDIO_BYTES` (25 MiB) → `exceeds_size_limit` → `AudioTooLarge`, **and** (by
the Layer-4 gate) no failed-audio dump to retry from. The i18n text ("0 = off (an
absolute 30-min safety cap still applies)") reads as a safety feature, not as "anything
past ~13 min is discarded". Either clamp `ABS_MAX_RECORDING_MS` to `MAX_RECORDING_MS_CEILING`
for the *guard's* elapsed check (keep 30 min as the raw-buffer backstop only), or make the
description honest. Config-plumbing otherwise checked end-to-end and consistent: key
names (`silence_timeout_ms`, `max_recording_ms`), ms units, `0 = off`, defaults 60000 /
600000, ranges 5000–300000 / 10000–780000 appear identically in `consts.rs`,
`config/mod.rs` (`#[serde(default)]`), `config_sqlite.rs` load+save, `validation.rs`,
`settingsRegistry.ts` (placeholder + description), `commands.ts`, `bindings.ts`,
`en.json`/`ru.json`. `settingsRenderers.tsx::convertToTypedValue` coerces the "input"
widget to a number, so the value reaches Rust as `u32`, same as `hotkey_hold_ms`.
`GuardCfg::from_app_config` reads the raw (unvalidated-on-load) values; `max` is clamped
via `effective_max_recording_ms`, `silence_timeout_ms` is not (a hand-edited `1` just
fires as soon as the window fills — harmless asymmetry, but note it).

### 2.6 Recorder primitives vs consumers — all consistent, two notes
- `take_rms_peak()` (drain/`swap(0)`) has **exactly one** consumer
  (`recording_guard.rs:371`); `audio_level.rs` poller still uses `audio_level()` /
  `get_recent_samples()`. ✔
- `set_max_samples()` is called once per recording at `recording.rs:584`, after
  `recorder.start()` returned `Ok` and after `await_stage(Recording)` — `sample_rate()` is
  valid there. `max_samples` is intentionally **not** reset in `start()`, so the previous
  take's cap remains in force during the ≤100 ms before it is re-set; on the very first
  take it is `usize::MAX` for that window. Fine. Note the two early exits before that
  line (`!reached_recording`, `StopReleasePending`) never set it — correct, they stop.
- `is_stopping()` is exposed but **never called** in production code (only the recorder's
  own tests); `stop_lock` + `StopInProgress` made it redundant. Dead API — remove or doc
  as test-only.
- `get_recent_samples()` after `mem::take` returns empty — the poller is cancelled under
  `stop_lock` before `recorder.stop()` runs, so no consumer sees the drained buffer. ✔
- `StopInProgress` from `start()`: mapped to a silent debug + `early_return`; from `stop()`:
  `SilentRaceLost`. Consistent with `AudioError` doc. ✔

### 2.7 The three machines — ownership is coherent; stale-stage reads enumerated
Reads of `coordinator.current_stage()` **outside** `stop_lock`:
1. `on_hotkey_pressed` top (`press_action` input). Can only go stale `Recording →
   Processing/Idle` (a stop) — press then proceeds to `Start`, takes `stop_lock` after the
   stop, `recorder.start()` on a stopped recorder, TALRI allows `on_press` from
   `Processing`. Benign. `Idle/Processing → Recording` cannot happen concurrently (single-
   flight admission). Benign.
2. `await_stage` polls — bounded wait, not a decision. Benign.
3. `mirror_state` / `stage_to_state` — UI mirror only. Benign.
Everything decision-bearing (`stop_decision`) re-reads under the lock. ✔
Guard's stop decision is made outside the lock (by design) and re-checks its own token
before calling `stop_recording`; the remaining "guard A's late stop kills fresh recording
B" scenario is prevented only because `tokio::sync::Mutex` is **FIFO-fair** (guard A
enqueues before press B can exist, since B needs A's release to have finished). Worth a
one-line comment; it is a real, if documented-by-tokio, dependency.

### 2.8 Tokens — single owner each ✔
- `wake_token`: created in `press_enter`, cancelled only by `release_arrived`, awaited
  only by the admitting press's `select!`. Left inside `in_flight` and dropped on `clear`.
- `polling_cancel`: set by press (take-and-cancel-old), cancelled by `stop_recording`
  (take) — both under `stop_lock`. Awaited only by the poller.
- `guard_cancel`: same discipline as `polling_cancel`. Awaited only by the guard task;
  the guard is never `abort()`ed. ✔
Lock order is `stop_lock → polling_cancel → guard_cancel → overlay` in both the press
critical section and `stop_recording`; the poller/guard take none. No inversion.

### 2.9 Dead code / duplication
- `exceeds_size_limit` is the only oversize predicate left (client `transcribe()`,
  pipeline gate, `save_failed_audio`). ✔ No leftover `len > MAX_AUDIO_BYTES`.
- `effective_max_recording_ms` is the single clamp behind both `native_cap_samples` and
  the guard's elapsed check. ✔
- `is_granted()` remaining call sites: `setup/permission_check.rs:12` (startup/onboarding
  status display — informational, correct to stay) and
  `checker.rs:102,109` (`all_granted`/`missing` helpers — informational). No start gate is
  left on `is_granted`; both start gates use `blocks_start()`. ✔
- Three private copies of `lock_or_recover` (`audio/sync.rs`, `press_release.rs`,
  `recording.rs::lock_press_release`). Each step declined to widen `audio::sync`
  visibility "out of scope" — the squash is the moment to make it `pub(crate)` and delete
  two copies.

### 2.10 Breadcrumbs
There is no static site table in `breadcrumbs.rs` (task premise) — sites are ad-hoc
`rolling_rate_limited(&STATIC, "name")` pairs. All 12 new statics have exactly one
emitter each; all 12 emitters are reached from production code (verified by reading
the call sites: 5 in `stop_recording`, 3 in `on_hotkey_pressed`, 1 in
`on_hotkey_released`, 3 in the guard). Names match the plan's Layer 7 list for the four
it names. **None of the new names appear in `docs/` or `CHANGELOG.md`** — if there is a
diagnostics/breadcrumb reference doc, it is now incomplete.

### 2.11 Smaller items
- `persist_bytes_atomic` (no `sync_all`) is also the writer of the clean-shutdown marker;
  a power cut immediately after a clean quit can now yield a zero-length marker on
  journaled FS → the next start reports a spurious `heartbeat.crashed.json`. Same class of
  false positive plan §1.2 already accepts; mention in docs.
- `test_check_microphone_native_smoke` asserts `< 200 ms` on a cold AVFoundation call in
  CI (measured 41 ms cold locally); on the 4-core KVM macOS VM this is a plausible flake.
- Pre-cutoff beep reuses `SoundType::Error` — indistinguishable from the `Recover` error
  cue (disclosed in code). Fine for 0.1.3, but a `Warning` variant is a 10-line follow-up.
- `load_config_from_app` opens a new SQLite connection per call; the press path now
  performs 3 loads and the release path 2–3. Not a perf problem, but it is what sizes the
  window in 2.1.
- `AudioState` is still `manage()`d and still owns `recorder` (used by
  `list_audio_devices`?) — verify nothing else reads `state.recorder` directly now that
  the two commands moved to `OrchestratorState`; a residual direct `recorder.start()`
  elsewhere would bypass every machine above.

---

## 3. What is right (so §2 is read in proportion)

- **Layer 1 single-flight stop** is genuinely one path: release, toggle press, cancel,
  `ReleasePending`, and both guard reasons all funnel into `stop_recording`; `stop_lock`
  is held from decision through `queue.push`/`coordinator.on_release`, and the
  recorder's own `stopping` CAS + RAII guard makes the primitive safe even if the lock
  were bypassed. `mem::take` removes the 2× peak and frees capacity.
- **Stage is never flipped before `recorder.stop()`** — the `Command::Cancel`-no-op-in-
  `Processing` invariant is pinned by a test against the real coordinator, and every
  `coordinator.cancel()` in the stop path is provably run while stage is `Recording`.
- **Layer 0** admission is atomic under one std Mutex; the invariant
  `release_pending ⇒ in_flight.is_some()` holds and is tested; `PressExitGuard` makes the
  reset discipline structural. The residual pre-admission window is honestly disclosed.
- **Native permission probe** (objc2 `authorizationStatusForMediaType:`) with a bounded
  1 s osascript fallback, `Granted`-only caching, and `blocks_start()` semantics threaded
  consistently through both start gates — the 0.3–5.4 s root-cause window is gone.
- **Guard** is one task, two conditions, pure `guard_step`, token-cancelled never aborted,
  max-duration precedence, `cap_hit` byte-level backstop, `effective_max_recording_ms`
  shared with the buffer cap; the pathological beep-lead > timeout case is handled.
- **Layer 4**: oversize gate precedes both dumps and `validate_config`; spectrum log
  throttled + `trace!`; heartbeat fsync removed with tests pinning atomicity.
- **Config plumbing** is consistent in every layer (see 2.5 for the enumeration).
- CI signing lane, own VM image, host-wide flock, `signingIdentity: "-"`, entitlements
  for audio-input + apple-events — all coherent with the CHANGELOG.

---

## 4. Residual risks for the manual Phase-5 checklist (real hardware only)

1. **Silence threshold** `SILENCE_RMS = 0.005` (−46 dBFS) is explicitly unvalidated
   (`consts.rs`). On the built-in MacBook mic in a quiet room, confirm a 90 s idle take
   auto-stops (~70 s expected, see 2.4) and that normal quiet speech does **not**. On the
   BY-V lavalier in standby (zeros) confirm the stop and the resulting UI state.
2. **What gets typed** after a silence auto-stop with (a) VAD on, (b) VAD off, into a
   focused text field. Confirm nothing is typed for an all-silent take.
3. **Pre-cutoff beep** audible ~3 s before the silence stop, exactly once; confirm the
   speaker beep picked up by the mic does not reset the silence run (window fraction
   should absorb it).
4. **Max-duration**: set `max_recording_ms = 10000`, record 15 s → auto-stop at ~10 s,
   transcribed. Then `0` → confirm a >13 min take yields "Audio too large" with **no**
   `failed_audio/` or `debug/` WAV written and RAM returns to baseline.
5. **Race reproduction**: overlay tap-and-release faster than the permission check used
   to take is no longer reproducible, but do: press-hold ~350 ms then release (the rdev
   incident shape) 30×; press+release 6× in 2 s; toggle mode press/press. Confirm
   `recording:release_pending_*` / `press_ignored_in_flight` breadcrumbs appear and no
   take stays in `Recording`.
6. **2.1 window**: while holding the hotkey, tap the overlay cell and release the key at
   the same instant, repeatedly — confirm the recording always stops.
7. **Permission states on a fresh install**: `NotDetermined` → first press must reach
   `recorder.start()` and trigger the OS prompt (not the "grant in System Settings" error);
   `Denied` → error path; revoke mid-session → guard stops within ~70 s.
8. **Signed/notarized DMG**: `spctl -a -vvv` = Notarized Developer ID; with Hardened
   Runtime confirm mic capture works and the Accessibility prompt fires (Apple-Events
   entitlement) — the CHANGELOG claims both.
9. **Stop latency on a large buffer** (10 min take): `recorder.stop()` runs in
   `spawn_blocking` under `stop_lock`; confirm the UI stays responsive and a hotkey press
   during that window is refused silently (no error toast) and works right after.
10. First start after upgrade: expect a spurious `heartbeat.crashed.json` for the pkill'd
    0.1.2 process (plan §1.2) — not a regression.
