# Blind Review — Silence-Watchdog Plan (`/tmp/swd-plan-clean.md`)
Lens: concurrency/race/failure-path critic, Rust/tokio/Tauri.

## 1. Errors (wrong facts, wrong reasoning)

**E1 — "idempotent `recorder.stop()`" is false; the double-stop race is not actually closed.**
`AudioRecorder::stop()` (`audio/recorder.rs`) guards only with `if !self.is_recording.load(Ordering::SeqCst) { return Err(NotRecording) }`. On macOS the flip to `false` happens on the *recording thread*, inside `run_command_loop`'s `RecordCommand::Pause` arm (`audio/stream.rs`): `audio_level.store(0,...); is_recording.store(false,...); stream.pause();`. Two concurrent `stop()` callers can both observe `is_recording==true` before either send lands and is processed — there is no CAS, no "in-progress" flag, no mutex serializing the whole `stop()` body. If that happens, both callers pass the guard, both call `stop_macos_pause()` (each sends its own `Pause`; both busy-wait, both see the flag flip and return), both call `get_samples()` (a plain `.clone()` — `stop()` never clears `samples`, only `start()` does), both downsample, and both call `apply_vad`, which locks the **same stateful `Mutex<Option<Box<dyn VoiceActivityDetector>>>`** and mutates Silero's LSTM state — the second pass filters already-consumed audio through an already-advanced VAD state. Both calls then `Ok(wav_bytes)` — the second call does **not** error out. This directly contradicts the plan's Layer 2 claim ("идемпотентный recorder.stop()").

**E2 — the coordinator's `Stage` does not bound the actual `stop()` call, so the check-then-act window is large, not negligible.**
In `recording.rs::on_hotkey_released`, the sequence is: check `current_stage()==Recording` (once) → call `recorder.stop()` (which can block up to **500 ms, or 3 s if `is_ready==false`**, per `stop_macos_pause`'s timeout branches) → too-short check → beep → `queue.push` → **only then** `self.coordinator.on_release()` flips `Stage` to `Processing`. That means `current_stage()` reports `Recording` for the *entire duration* of `stop()`. A watchdog task polling `coordinator.current_stage()==Recording` during exactly this window would still see `Recording` and could independently call `finalize_capture`/`recorder.stop()` a second time — landing in the E1 race. The plan's claim "переходы сериализует worker координатора" is true only for the `Stage` *label*; it does not serialize the *side effect* (`recorder.stop()`), which both call sites invoke directly and independently. This is the crux of question (1) and the plan does not actually close it as described.

**E3 — internal inconsistency: Layer 3 (passive flag) contradicts Test 6 (active finalize).**
Layer 3 states the hard-cap "перестать пушить и выставить флаг «переполнено», который **на стопе** трактуется как завершение" (passive: only takes effect at the *next* stop). Test 6 states "переполнение **финализирует** запись" (active: overflow itself ends the recording). These are two different behaviors with very different implications for the exact failure mode this plan targets (both release and watchdog failing to fire). The plan must pick one and word both places consistently.

**E4 — 15-minute default hard-cap re-triggers the very failure the incident is about.**
15 min @ 16 kHz mono PCM16 WAV ≈ 900 s × 16000 × 2 B ≈ **28.8 MB**, which exceeds the 25 MB Groq limit the plan itself cites in §1.1 ("exceeds 25MB") and reuses for the debug-WAV cap in Layer 4 ("Согласуется с лимитом Groq 25 МБ"). Whenever the hard-cap is the layer that actually fires (e.g., watchdog defeated by ambient noise — see D1), it reproduces an "Audio too large" transcription failure, just at much smaller/safer scale than 1.68 GB. The plan never checks this arithmetic against its own stated 15-minute default.

**E5 — minor: §1.2's evidentiary phrasing is imprecise.** `heartbeat.crashed.json` (verified) contains a single `last_breadcrumb` field, currently `"hotkey:released"`. It cannot contain a pair `(hotkey:released, transcription:failed)` as the plan's prose implies — only one most-recent breadcrumb name is persisted per snapshot. Low severity, doesn't affect the design, but the citation as written slightly overstates what that file proves.

## 2. Missing

**M1 — a pre-existing, verified bug makes toggle mode's own stop path dead code, and the plan's own workaround makes this worse.**
Trace: `setup/hotkey.rs` → `orchestrator/mod.rs::on_hotkey_pressed/on_hotkey_released` → `recording.rs`. In toggle mode, the second press (`recording.rs:124-129`) does:
```rust
if is_toggle_mode && stage == Stage::Recording {
    self.on_hotkey_released().await;
    return;
}
```
But `on_hotkey_released` (`recording.rs:268-277`) begins:
```rust
let mode_config = load_config_from_app(&self.app);
if mode_config.hotkey_mode == "toggle" {
    tracing::debug!("on_hotkey_released: toggle mode — ignoring release");
    return;
}
```
The internal call from the toggle-press branch hits this guard immediately and returns before `recorder.stop()` is ever reached. **In the current codebase, a toggle-mode recording is never stopped by the intended tap-tap gesture.** No test exercises this path (`recording.rs`'s test modules cover only `stage_to_state` mapping and debounce-window arithmetic, nothing end-to-end for toggle). Consequence for this plan:
- Q4's answer is not "should the watchdog apply in toggle mode" — it **must**, because right now the watchdog would be the *only* mechanism that can ever end a toggle-mode recording.
- §7 ("immediate workaround: `hotkey_mode = toggle`, doesn't depend on the release event") is actively dangerous as written: switching a user to toggle mode today turns *every* recording into a stuck recording (100% failure) instead of the intermittent rdev release-loss the plan is trying to route around. This must be fixed or the workaround retracted before it's told to a user.
- Natural fix location: the Layer-2 DRY refactor. When `on_hotkey_pressed`'s toggle branch needs to stop, it should call `finalize_capture(...)` directly, not `on_hotkey_released()`.

**M2 — no epoch/generation guard as a second line of defense.** Even with E1/E2 fixed, nothing in the design prevents a *future* regression from reopening the double-push. A cheap `u64` generation counter bumped on `start()`/`on_press`, captured by both callers and checked before `queue.push`, is a standard idempotency pattern and is absent from the plan.

**M3 — no discussion of VAD statefulness under duplicate/near-duplicate stop calls.** `apply_vad` mutates a shared, stateful Silero LSTM (`audio/recorder.rs::apply_vad`, `lock_or_recover(&self.vad)`); the plan's "idempotent stop" framing silently assumes `stop()` is effect-free to call twice, which is untrue independent of the atomic-bool race (E1).

**M4 — watchdog task lifecycle/cancellation discipline is under-specified (Q7).** The existing overlay-polling code explicitly takes-and-cancels any stale token before installing a new one (`recording.rs:247-253`, `self.polling_cancel`). The plan says the watchdog will "reuse the existing pattern" but never states where its own token is stored, nor what cancels it on the `recorder.stop()` **error** branch of `on_hotkey_released` (which today doesn't touch `polling_cancel` either — a related pre-existing gap). Without an explicit "take-and-cancel-old, tie-to-RAII-guard" rule (comparable to `coordinator::FinishGuard`), a rapid stop→restart cycle can leave a stale watchdog polling the wrong recording, or two watchdogs alive concurrently.

**M5 — no UX signal before auto-stop.** 60 s is a plausible real-world "I'm thinking" pause length in genuine dictation use. Layer 7 only logs a WARN + breadcrumb after the fact; the codebase already has `crate::audio_feedback::play(...)` wired for Start/Stop/Error beeps in the exact file being modified — reusing it for an audible pre-cutoff warning is a small, in-pattern addition the plan omits.

**M6 — TDD list is not directly executable against the current API (partially answers "sanity-check the TDD list").** Tests 1, 2, 4, 5 require injecting synthetic `audio_level()` values or timing a race, but `AudioRecorder::audio_level()` reads a private `AtomicU32` fed only by the live cpal callback (`process_chunk`); there is no mock/trait seam. Compare: this same file already extracts pure, directly-testable helpers (`stage_to_state`, `enters_debounce` in `recording.rs`) specifically to avoid needing a live device/thread in tests. The plan should mandate an analogous pure function, e.g. `fn silence_elapsed(level: u32, elapsed_silence_ms: u32, timeout_ms: u32) -> bool`, tested directly; only tests 3/8/9 (and a real double-stop repro) genuinely need the full async+recorder wiring.

## 3. Doubtful assumptions

**D1 — `recorder.audio_level()` is not a robust, boost-independent silence signal (Q2).**
`level = (rms * boost).min(100.0) as u32` (`audio/level.rs`), where `boost = audio_boost/10`, and `audio_boost` is a **user-configurable** value (`set_audio_boost`, clamped to store `[100,10000]`), giving an effective multiplier range of **10×–1000×** (default 800×, `DEFAULT_AUDIO_BOOST = 800.0`). At the default, `level>0` requires only `rms ≥ 1/800 ≈ 0.00125` — a threshold ordinary room/HVAC/electrical noise crosses easily, meaning genuinely "dead air" (nobody present, but ambient noise) may rarely register 60 *consecutive* exact-zero polls — i.e. the watchdog's actual reliable case is closer to "device produces literal zero samples" (which is exactly how the existing reuse of this signal in `orchestrator/audio_level.rs` frames it: "device may be muted/disconnected/standby"), not general voice-activity silence. Conversely, at the *minimum* clamp (multiplier 10×, reachable by a user who lowers boost), the zero-threshold rises to `rms ≥ 0.1`, which ordinary soft/distant speech can fail to cross — a legitimately-talking-but-quiet user's actual speech, not just their pauses, could read 0 and accumulate toward a 60 s cutoff. Both failure directions asked about in Q2 are reachable through an already-exposed setting, not hypothetical.

**D2 — "coordinator serializes transitions ⇒ single stop" conflates label-serialization with action-serialization (see E2).** This is the most consequential doubtful assumption in the plan and should be treated as unresolved until fixed.

**D3 — "RAM physically cannot grow to gigabytes even if both watchdog and release fail" is true but incomplete.** It says nothing about the residual outcome (mic stays open, thread alive, indefinitely) being an accepted risk, and (per E4) the hard-cap's own trigger still surfaces a transcription failure UX, not a clean resolution.

**D4 — §7's toggle-mode workaround assumes toggle mode is a safe interim fallback.** Per M1, this is very likely false in the current build and should be verified on a real device before recommending it to a user.

## 4. Concrete recommendations (minimal, literal plan edits)

1. Replace "идемпотентный `recorder.stop()`" (Layer 2) with an explicit code change: add `compare_exchange(true, false, ...)` (or an `AtomicBool stopping`) at the very top of `AudioRecorder::stop()`, before `stop_macos_pause()`, so a second concurrent caller gets `Err(NotRecording)` deterministically instead of re-running pause/read/VAD/encode. Add a two-thread concurrent-`stop()` unit test.
2. Move the coordinator's `Recording → Processing` transition to happen **before** the blocking `recorder.stop()` call (or otherwise flip stage first), so a watchdog reading `current_stage()` can never see `Recording` while a stop is already in flight.
3. Fix the toggle-mode dead-stop bug as part of the Layer-2 refactor: `on_hotkey_pressed`'s toggle branch must call `finalize_capture(...)` directly, not `on_hotkey_released()`. Add a regression test: "toggle mode: press, press again → recorder stops." Until this lands, remove or caveat §7's toggle-mode workaround.
4. Resolve the Layer 3 / Test 6 inconsistency explicitly in the doc; recommend making hard-cap overflow **actively** call `finalize_capture`, and size `DEFAULT_MAX_RECORDING_MS` to stay under the 25 MB Groq ceiling already cited elsewhere in the plan (≈13 min at 16 kHz mono, not 15).
5. Decouple the watchdog's silence threshold from the visualizer's `audio_boost` clamp range (10×–1000×): either read raw pre-boost RMS for the watchdog, or explicitly document/accept the boost-coupling and its consequences from D1.
6. Add a generation/epoch counter as a second guard against duplicate `queue.push`, independent of recommendation 1.
7. Extract a pure `silence_elapsed(...)`-style function for the watchdog's decision logic (mirrors `stage_to_state`/`enters_debounce`) so tests 1/2/4/7 are true unit tests, not integration tests against a live `AudioRecorder`.
8. Specify watchdog-token storage/cancellation explicitly, mirroring `polling_cancel`'s take-and-cancel-old-token discipline (`recording.rs:247-253`), and tie cancellation to a guard so the error branch of `stop()` doesn't leak it.
9. Add a pre-cutoff audio cue via the existing `audio_feedback::play(...)` mechanism a few seconds before the silence timeout fires.

## 5. VERDICT: CONDITIONAL — maturity 6/10

Root-cause diagnosis (§1) is well-evidenced against real heartbeat/log data and internally consistent. The overall shape of the fix (watchdog + DRY `finalize_capture` + hard cap + log/disk throttling) is the right architecture. However, the plan asserts two safety properties — "idempotent `stop()`" and "coordinator serializes the stop" — that are demonstrably not true of the current code (E1, E2), which is exactly the race the review was asked to stress-test. It also overlooks an already-present, verified bug (toggle mode's tap-to-stop is dead code) that both raises the stakes for the watchdog and invalidates the plan's own suggested interim workaround. Recommend requiring fixes 1–4 above before implementation, and 5–9 before merge/release.