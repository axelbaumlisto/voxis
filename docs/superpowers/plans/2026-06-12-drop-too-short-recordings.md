# Drop Too-Short Recordings (silence the "Audio file is too short" error)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Problem (observed):** After adding press-and-hold dictation on the overlay, a quick click/tap produces a tiny audio clip. The hotkey `hotkey_hold_ms` debounce (default 300ms) rejects presses *shorter than the hold threshold*, but a press just past it still yields a sub-second clip. That clip is pushed to the transcription queue, Whisper rejects it, and the user sees a red **"Transcription failed: API error: Audio file is too short"** toast. A too-short recording should be silently dropped, not surfaced as an error.

**Root cause:** `RecordingController::on_hotkey_released()` (src/orchestrator/recording.rs) calls `recorder.stop()` → gets WAV bytes → `queue.push(audio_data)` UNCONDITIONALLY. There is no minimum-duration guard before enqueueing, so trivially short clips reach the API.

**Fix (KISS, at the source):** Before pushing, measure the WAV duration. If it is below a configurable minimum (`min_recording_ms`, default 400ms), DO NOT enqueue: cancel the recording back to Idle (`coordinator.cancel()`), hide the overlay, log it, and return — exactly like the "short press" path, but based on actual captured audio length (which also accounts for VAD trimming, e.g. a hold over silence that VAD strips to near-zero). No error toast, no API call.

**Architecture / SRP:**
- A pure, dependency-free helper `wav_duration_ms(&[u8]) -> Option<u32>` parses the canonical 44-byte PCM WAV header (sample_rate @ offset 24, bits_per_sample @ 34, channels @ 22, data chunk size @ 40) to compute duration in ms. Unit-tested against `samples_to_wav` output.
- `on_hotkey_released` gains a single guard using that helper + the new config value. The decision logic is otherwise unchanged.

**Tech Stack:** Rust, Tauri v2, cargo test.

**SOLID / DRY / KISS rationale:**
- **SRP** — duration parsing is a pure function in the audio module; the orchestrator only decides.
- **DRY** — reuses `coordinator.cancel()` (existing Recording→Idle path) and overlay.hide(); no new state machine.
- **OCP** — additive: new pure fn + new config field + one guard block. Existing behavior for long-enough recordings is unchanged.
- **KISS** — a length check, not a content/energy heuristic. VAD already handles silence trimming; we just refuse to ship near-empty clips.

**Anti-goals (YAGNI):** no min-energy/RMS gate (separate concern), no frontend change, no new user-facing toast (the whole point is to NOT toast), no per-provider minimums. Keep the existing `hotkey_hold_ms` press debounce as-is — this is a complementary, audio-length guard.

---

## File Structure

- **Modify** `src/audio/encoder.rs` — add pure `wav_duration_ms(wav: &[u8]) -> Option<u32>` + unit tests. (Lives next to `samples_to_wav`, the producer.)
- **Modify** `src/audio/mod.rs` — re-export `wav_duration_ms` if the module re-exports encoder fns (match the existing export style for `samples_to_wav`).
- **Modify** `src/config/consts.rs` — add `pub const DEFAULT_MIN_RECORDING_MS: u32 = 400;`.
- **Modify** `src/config/mod.rs` — add `min_recording_ms: u32` field to `AppConfig` with `#[serde(default = "default_min_recording_ms")]`, the default fn, and the `Default` impl entry.
- **Modify** `src/orchestrator/recording.rs` — in `on_hotkey_released`, after `recorder.stop()` succeeds, guard on `wav_duration_ms(&audio_data)` < `config.min_recording_ms` → cancel + hide + return (no enqueue, no error).
- **Modify** `src/orchestrator/recording.rs` tests (or `src/orchestrator/tests.rs`) — cover the drop path if feasible; otherwise rely on the pure-fn tests + a coordinator-level assertion.

NOTE: confirm whether `src/audio/mod.rs` re-exports `samples_to_wav` (e.g. `pub use encoder::...`). If so, add `wav_duration_ms` the same way so `crate::audio::wav_duration_ms` resolves in recording.rs. Otherwise import via `crate::audio::encoder::wav_duration_ms`.

---

## Task 1: Pure `wav_duration_ms` helper

**Files:**
- Modify: `src/audio/encoder.rs` (add fn + tests)
- Modify: `src/audio/mod.rs` (re-export, matching `samples_to_wav` style)

- [ ] **Step 1: Failing tests (append to encoder.rs `#[cfg(test)] mod tests`)**

```rust
#[test]
fn test_wav_duration_ms_one_second_16k_mono() {
    // 16000 samples @ 16kHz mono = 1000 ms
    let samples = vec![0.0f32; 16_000];
    let wav = samples_to_wav(&samples, 16_000).unwrap();
    let ms = wav_duration_ms(&wav).expect("should parse");
    assert!((ms as i64 - 1000).abs() <= 2, "got {ms} ms");
}

#[test]
fn test_wav_duration_ms_short_clip() {
    // 1600 samples @ 16kHz = 100 ms
    let samples = vec![0.0f32; 1_600];
    let wav = samples_to_wav(&samples, 16_000).unwrap();
    let ms = wav_duration_ms(&wav).expect("should parse");
    assert!((ms as i64 - 100).abs() <= 2, "got {ms} ms");
}

#[test]
fn test_wav_duration_ms_empty_samples_is_zero() {
    let wav = samples_to_wav(&[], 16_000).unwrap();
    assert_eq!(wav_duration_ms(&wav), Some(0));
}

#[test]
fn test_wav_duration_ms_rejects_garbage() {
    assert_eq!(wav_duration_ms(&[0u8; 10]), None);
    assert_eq!(wav_duration_ms(b"not a wav file at all........"), None);
}

#[test]
fn test_wav_duration_ms_44100_mono() {
    let samples = vec![0.0f32; 44_100]; // 1s @ 44.1k
    let wav = samples_to_wav(&samples, 44_100).unwrap();
    let ms = wav_duration_ms(&wav).expect("parse");
    assert!((ms as i64 - 1000).abs() <= 2, "got {ms} ms");
}
```

- [ ] **Step 2: Run — verify fail**

Run: `cd src-tauri && cargo test wav_duration_ms 2>&1 | tail -20`
Expected: FAIL (fn missing / does not compile).

- [ ] **Step 3: Implement `wav_duration_ms` in encoder.rs**

```rust
/// Duration in milliseconds of a canonical PCM WAV (as produced by
/// `samples_to_wav`: 44-byte header, "RIFF"/"WAVE", PCM, mono/stereo).
///
/// Pure & dependency-free: reads sample_rate (@24), channels (@22),
/// bits_per_sample (@34) and the data chunk size (@40) from the header.
/// Returns `None` if the bytes aren't a WAV we recognize.
pub fn wav_duration_ms(wav: &[u8]) -> Option<u32> {
    if wav.len() < 44 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return None;
    }
    let le16 = |o: usize| u16::from_le_bytes([wav[o], wav[o + 1]]) as u32;
    let le32 = |o: usize| {
        u32::from_le_bytes([wav[o], wav[o + 1], wav[o + 2], wav[o + 3]])
    };
    let channels = le16(22).max(1);
    let sample_rate = le32(24);
    let bits = le16(34).max(1);
    let data_size = le32(40);
    if sample_rate == 0 {
        return None;
    }
    let bytes_per_sample_frame = channels * (bits / 8).max(1);
    if bytes_per_sample_frame == 0 {
        return None;
    }
    let frames = data_size / bytes_per_sample_frame;
    // ms = frames * 1000 / sample_rate (u64 to avoid overflow)
    Some(((frames as u64 * 1000) / sample_rate as u64) as u32)
}
```

In `src/audio/mod.rs`, re-export it next to `samples_to_wav` (match existing style, e.g. `pub use encoder::{samples_to_wav, wav_duration_ms, ...};`).

- [ ] **Step 4: Run — verify pass**

Run: `cd src-tauri && cargo test wav_duration_ms 2>&1 | tail -20`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd src-tauri && cargo fmt
git add src/audio/encoder.rs src/audio/mod.rs
git commit -m "feat(audio): pure wav_duration_ms WAV-header duration parser"
```

---

## Task 2: Config `min_recording_ms`

**Files:**
- Modify: `src/config/consts.rs`
- Modify: `src/config/mod.rs`

- [ ] **Step 1: Add the constant**

In `src/config/consts.rs` near `DEFAULT_HOTKEY_HOLD_MS`:
```rust
/// Recordings shorter than this (after VAD) are silently dropped instead
/// of sent to the transcription API (which rejects sub-second clips as
/// "Audio file is too short"). Guards accidental short clicks/taps on the
/// press-and-hold overlay.
pub const DEFAULT_MIN_RECORDING_MS: u32 = 400;
```

- [ ] **Step 2: Add the field + default fn + Default impl**

In `src/config/mod.rs`:
- Add the field to `AppConfig` (near `hotkey_hold_ms`):
  ```rust
  /// Minimum captured-audio duration (ms, after VAD) below which a
  /// recording is dropped without hitting the API. See
  /// `DEFAULT_MIN_RECORDING_MS`.
  #[serde(default = "default_min_recording_ms")]
  pub min_recording_ms: u32,
  ```
- Add the default fn (near `default_hotkey_hold_ms`):
  ```rust
  fn default_min_recording_ms() -> u32 {
      DEFAULT_MIN_RECORDING_MS
  }
  ```
- Add to the `Default for AppConfig` impl (near `hotkey_hold_ms: DEFAULT_HOTKEY_HOLD_MS,`):
  ```rust
  min_recording_ms: DEFAULT_MIN_RECORDING_MS,
  ```
- Ensure `DEFAULT_MIN_RECORDING_MS` is imported (it's in the same `consts` module the file already uses for `DEFAULT_HOTKEY_HOLD_MS`).

- [ ] **Step 3: Build + existing config tests**

Run: `cd src-tauri && cargo build 2>&1 | tail -5` → compiles.
Run: `cd src-tauri && cargo test config 2>&1 | tail -20` → green (serde default keeps old configs loading; specta::Type derive still ok — `min_recording_ms` is a plain u32).

NOTE: `AppConfig` derives `specta::Type`, so the field will appear in generated bindings. That's fine (additive). If a test asserts an exact field count or a snapshot of the config shape, update it.

- [ ] **Step 4: Commit**

```bash
cd src-tauri && cargo fmt
git add src/config/consts.rs src/config/mod.rs
git commit -m "feat(config): min_recording_ms (default 400) to drop too-short clips"
```

---

## Task 3: Guard in `on_hotkey_released` — drop short clips silently

**Files:**
- Modify: `src/orchestrator/recording.rs`
- Modify: `src/orchestrator/tests.rs` (or recording.rs tests) if a unit test is feasible

- [ ] **Step 1: Implement the guard**

In `on_hotkey_released`, AFTER the `let audio_data = match self.recorder.stop() { ... }` block succeeds and BEFORE the stop beep / `queue.push`, insert:

```rust
        // Drop too-short captures (accidental click/tap on the overlay, or a
        // hold over silence that VAD trimmed to near-zero). Sending these to
        // the API yields a user-facing "Audio file is too short" error, so we
        // silently cancel back to Idle instead.
        let min_ms = release_config.min_recording_ms;
        if let Some(dur_ms) = crate::audio::wav_duration_ms(&audio_data) {
            if dur_ms < min_ms {
                tracing::info!(
                    "on_hotkey_released: dropping too-short recording ({dur_ms}ms < {min_ms}ms)"
                );
                self.coordinator.cancel();
                self.overlay.lock().await.hide();
                self.mirror_state().await;
                return;
            }
        }
```

(Place it using `release_config`, already loaded just above for audio feedback. `coordinator.cancel()` transitions Recording→Idle; `mirror_state()` syncs the cached RecordingState; `overlay.hide()` removes the pill. No error toast, no beep — a silent no-op from the user's perspective.)

DECISION on the stop beep: keep the existing stop beep AFTER this guard (so a dropped clip makes no "captured" beep — correct, nothing was captured). Verify the guard sits BEFORE the `SoundType::Stop` play call.

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo build 2>&1 | tail -5` → compiles.

- [ ] **Step 3: Test (best-effort unit/integration)**

Check `src/orchestrator/tests.rs` for an existing harness that drives `on_hotkey_pressed`/`on_hotkey_released` with a fake/mock recorder. If one exists and a recorder can return a short WAV, add a test asserting that after a short-clip release the coordinator returns to `Idle` and the queue stayed empty. If the harness can't inject audio length easily, SKIP a brittle test here — the pure `wav_duration_ms` tests (Task 1) + the guard's simple branch are sufficient; note this in the commit body. Do NOT fabricate a passing test that doesn't actually exercise the path.

Run: `cd src-tauri && cargo test 2>&1 | tail -20` → all green (854+ existing, +5 wav, + any new).

- [ ] **Step 4: clippy + fmt + commit**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings 2>&1 | tail -15` → 0 warnings.
Run: `cd src-tauri && cargo fmt`.

```bash
git add src/orchestrator/recording.rs
# + tests file if changed
git commit -m "fix(orchestrator): silently drop sub-min_recording_ms clips (no 'too short' error)"
```

---

## Task 4: Full verification + live check + ship

**Files:** none.

- [ ] **Step 1: Rust suites**

Run: `cd src-tauri && cargo test --lib 2>&1 | grep "test result"` → green (854 + new).
Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings` → 0 warnings.
Run (frontend sanity, bindings regen may add the field): `bun run test:run 2>&1 | grep -E "Tests "` → green; `bunx tsc --noEmit` clean. If `src/bindings.ts` regenerated with `min_recording_ms`, that's expected — commit it if the build regenerates it.

- [ ] **Step 2: Live check (controller)**

Build debug, launch via setsid (DISPLAY=:0 XAUTHORITY=/tmp/xauth_UYrikP). With xdotool, do a SHORT click-hold on the pill (e.g. ~350ms — just past the 300ms press debounce but under 400ms audio) → confirm NO "too short" error toast and the log shows "dropping too-short recording". Then a LONGER hold with speech → normal transcription still works. Inspect /tmp/log.

- [ ] **Step 3: Ship**

```bash
git checkout main && git merge feature/drop-too-short-recordings --no-edit
git branch -d feature/drop-too-short-recordings
git push gitverse main
cd src-tauri && cargo build --release && cd ..
```

---

## Self-Review (run before execution)

**Spec coverage:**
- Eliminate the "Audio file is too short" toast from accidental short overlay taps → Task 3 guard drops sub-threshold clips before enqueue/API. ✓
- Configurable, sensible default → Task 2 `min_recording_ms = 400`. ✓
- Don't break normal dictation → only clips shorter than 400ms are dropped; longer holds unaffected. ✓
- Accounts for VAD-trimmed silence (hold over quiet) → duration measured on the FINAL post-VAD WAV that `recorder.stop()` returns. ✓

**Why not raise hotkey_hold_ms instead?** That gates the *press* duration, not the *captured audio* duration, and wouldn't catch a long hold over silence that VAD trims to near-zero. The audio-length guard is the correct layer. Both stay.

**Type/ækconsistency:** `wav_duration_ms(&[u8]) -> Option<u32>` Task 1 ↔ Task 3 caller. `min_recording_ms: u32` Task 2 field ↔ `release_config.min_recording_ms` Task 3. ✓

**Risk:** if `wav_duration_ms` returns `None` (unexpected header), the guard does NOT drop (falls through to normal enqueue) — fail-open, so a parsing quirk never silently eats a real recording. Acceptable. The 400ms default is below typical one-word utterances (~500-700ms) so real speech isn't dropped; if a user dictates ultra-short words they can lower it. 

**Placeholder scan:** full code for the helper + guard + config; tests concrete. ✓

---

## Execution Handoff

Subagent-Driven: implementer `o/deepseek-v4-pro` per task; reviewer `o/fable-5` after Task 3 and before ship.
