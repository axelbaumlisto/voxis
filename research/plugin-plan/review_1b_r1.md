# Review 1b r1 — Task 1b (move transcription/llm/learning/audio_wav/hotkey/guard → voxis-core; drop core's tauri dep)

Reviewer: fresh, independent, read-only. Diff base: d98183b (approved Task 1a). Working tree = uncommitted state
(note: all new core files are **untracked** — `git diff --stat` under-reports; verified via `git status` + direct `diff -w` against `git show d98183b:<orig>`).

VERDICT: APPROVE

No blocking findings. This is a genuine move-not-rewrite: every moved module is byte-identical to its d98183b original modulo rustfmt reflow, doc comments, and the minimum visibility/path changes the crate boundary forces. The only behavioural deltas are the two the task explicitly asked for (`HotkeySink` in place of `AppHandle::emit`; `AppPaths::for_desktop()` in place of `AppPaths::new(&AppHandle)`), plus one small, well-contained error-type adapter in `audio_wav` that preserves the caller-facing error exactly.

## Findings (severity, file:line, what, why, fix)

None at blocking severity. All items are in "Minors" below.

## Pre-verified facts: agree/disagree

| Claim | Verdict | Evidence |
|---|---|---|
| 1053 passed vs 1051 baseline | **Agree, and explained**: +2 = the two new tests in `src-tauri/src/audio/encoder.rs` shim (`wav_error_converts_to_audio_error_preserving_message`, `samples_to_wav_wrapper_matches_core_output`). All other `#[test]`/`#[tokio::test]` counts moved 1:1 (guard 23→23, encoder 15→15, transcription 30→30, hotkey 3→3, recording.rs 25→25). Function-name set diff old vs new (guard+recording) shows only two additions (`poll_ms`, `audio_feedback` accessors) and zero removals. | `grep -c` + sorted `fn` name diff |
| core dep tree has no tauri/cpal/rdev/enigo/arboard/objc2 (rdev optional) | Agree | `Cargo.toml`: `rdev = { git…, rev = 7312395…, optional = true }`, `[features] rdev = ["dep:rdev"]`; `lib.rs`: `#[cfg(feature = "rdev")] pub mod hotkey;` — same pinned rev as voice_lib |
| `tauri-support` + `AppPaths::new(&AppHandle)` gone; only two call sites switched to `for_desktop()` | Agree | grep `AppPaths::new` → 0 hits in both crates; `setup/mod.rs:37`, `commands/overlay.rs:115` are the only `for_desktop()` callers |
| guard.rs exports as listed; `stop_decision`/`press_action` stayed in voice_lib | Agree | `recording.rs` now `pub(crate) use voxis_core::guard::{PressAction, StopDecision, StopReason};`; the three enums were deleted from recording.rs verbatim and re-created verbatim (same variants, same derives) in guard.rs |
| `HotkeySink` at `hotkey/mod.rs:33`; adapter at `src-tauri/src/hotkey/mod.rs:28` | Agree | see §3 below |
| fmt dirty is pre-existing | Not re-verified (out of scope, told to ignore) | — |

## Checked and OK

### 1. Move-not-rewrite (the highest-value check)
`diff -w <(git show d98183b:ORIG) NEW` for every moved file:
- **`transcription/mod.rs`** (production Groq path): only differences are (a) module doc addition, (b) `pub(crate)` → `pub` on `MAX_AUDIO_BYTES` and `exceeds_size_limit` (forced by crate boundary; voice_lib shim re-exports them `pub(crate)` so voice_lib-internal visibility is unchanged), (c) rustfmt reflow of 3 call/assert sites. **No change** to timeouts, retry counts, form fields (`build_form_text_params`), error strings, `#[cfg]`s, or the 30 tests.
- **`llm/{client,config,parser,types,provider/mod,provider/tests}.rs`**: byte-identical (`diff -w` empty). `engine.rs`: one `use super::*;` line reordered. `provider/http.rs`: one rustfmt reflow. `llm/mod.rs` in core now declares exactly the same module set/visibility and `pub use` list as the original voice_lib `llm/mod.rs` (`prompts` was already there from 1a).
- **`learning/{mode,normalizer,result,tracker}.rs`**: byte-identical. `learning/mod.rs`: doc comment only; same 4 `pub use`s.
- **`audio/encoder.rs` → `audio_wav.rs`**: identical except the error type (see §2). Resampling (`downsample`), WAV header/spec, `wav_duration_ms`, `TRANSCRIPTION_SAMPLE_RATE`, and all 15 tests unchanged.
- **`hotkey/mod.rs`**: see §3. `hotkey/tests.rs`: byte-identical.
- **`recording_guard.rs` → `guard.rs`**: all decision logic, consts usage, `GuardCfg::from_app_config`, `guard_step` body, `effective_max_recording_ms`, `guard_max_recording_ms`, `native_cap_samples` identical modulo rustfmt. Visibility widened `struct`/`fn` → `pub` only on items the plan lists.

### 2. `audio_wav` error handling
- Core introduces a minimal `WavError::Encode(String)` (`#[error("Failed to write WAV: {0}")]`) because `AudioError` (cpal/recorder-specific) correctly stays in voice_lib.
- voice_lib `audio/encoder.rs` keeps `pub fn samples_to_wav(...) -> Result<Vec<u8>, AudioError>` (same signature) and `impl From<WavError> for AudioError` maps `Encode(msg)` → `AudioError::WavError(msg)`. Since the original code did `AudioError::WavError(e.to_string())` with the hound error, callers receive the **same variant with the same inner string**, and `AudioError::WavError`'s own `#[error("Failed to write WAV: {0}")]` display is unchanged (`audio/error.rs:16-17`). No caller matches on a different variant; `WavError` is only referenced in `error.rs` (definition + display test) and the shim. The `From` impl is exhaustively destructured (single variant) so adding a variant later is a compile error, not a silent mismap — good.
- `downsample`, `wav_duration_ms`, `TRANSCRIPTION_SAMPLE_RATE` are plain `pub use` re-exports.

### 3. `HotkeySink` decoupling
- Core listener thread body is **line-for-line identical** to d98183b except: `app.emit("hotkey-pressed", ())` → `sink.on_pressed()`, `app.emit("hotkey-released", ())` → `sink.on_released()`, and `crate::diagnostics::fatal::install_thread_altstack_best_effort()` → `on_thread_start()` hook. `is_pressed`/`last_pressed_key` state machine, `should_stop` check, `target_key` atomic reload per event, `key_id != 0` guard, `#[cfg(target_os="macos")] rdev::set_is_main_thread(false)`, `listen()` error logging — all unchanged. There was no `catch_unwind` before and there is none now (nothing dropped).
- voice_lib `TauriHotkeySink` emits exactly `"hotkey-pressed"` / `"hotkey-released"` with payload `()` and the same `tracing::error!("Failed to emit …: {}", e)` strings. Wrapper `HotkeyListener { inner }` keeps `new/start(app, hotkey)/stop/set_hotkey/restart(&mut self, _app, hotkey)` — `restart` still used by `config/change_handler.rs:47`; core drops `restart` (it was a tauri-signature alias for `set_hotkey`), which is correct since core has no `AppHandle`.
- Altstack install preserved via `start_with_thread_init(sink, hotkey, || install_thread_altstack_best_effort())` — the diagnostics hook still runs first thing on the listener thread.
- `pub` widening: only `HotkeySink` (new) and `start_with_thread_init` (new). All pre-existing items (`HotkeyModifier`, `HotkeyCombo`, `HotkeyParseError`, `parse_hotkey`, `HotkeyListener::{new,start,stop,set_hotkey}`) were already `pub`. voice_lib re-exports the parser types + `HotkeySink`, keeps `TauriHotkeySink` private. 
- Fake-sink unit test: **absent** (see Minors M2). The press/release state machine lives inside the rdev callback closure — same as before the move — so it was never unit-testable; the move didn't make this worse.

### 4. `guard.rs`
- `SILENCE_RMS` calibration block present: `// ---- SILENCE_RMS hardware calibration (2026-09-07)` at guard.rs:1012, `test_reference_room_floor_reads_silent_at_calibrated_threshold` at :1015 with the p90/max numbers and the `fraction_at(SILENCE_RMS)` assertion intact. `SILENCE_RMS` occurrence count 8→11 (all additions are doc-comment mentions).
- voice_lib `spawn_recording_guard` task: identical loop — `tokio::select!` on token/`sleep(cfg.poll_ms())`, `is_recording()` → `StreamDied`, `take_rms_peak()`/`cap_hit()` → `guard_step(&mut state, rms_peak, cap_hit, &cfg)`, same breadcrumbs, same beep (`SoundType::Error`, `cfg.audio_feedback()`), same pre-stop `token.is_cancelled()` recheck. `GuardCfg::from_app_config` unchanged. Only diff: `cfg.poll_ms`/`cfg.audio_feedback` field reads became the two new accessor calls (fields remain private).
- Tests: 23→23. Two **assertions** (not tests) were dropped inside two guard tests — the cross-crate `stop_decision(Stage::Recording, true, reason) == Discard/Finalize` sanity checks — because `stop_decision`/`Stage` stay in voice_lib. Documented in guard.rs module doc (:38-47) and inline (:587, :620). Verified they are still independently covered: `recording.rs:1010` asserts `stop_decision(Stage::Recording, true, SilenceTimeoutNoSpeech) == Discard`; `recording.rs:1113` covers `SilenceTimeout`. No coverage lost.

### 5. `for_desktop()`
- `get_app_paths(&AppHandle)` / `get_storage_factory(&AppHandle)` shims in `src-tauri/src/storage/mod.rs:44,52` unchanged (still `try_state`-based). Only the two direct constructors changed. `get_themes_dir(_app: AppHandle)` keeps its `AppHandle` param so the tauri-specta TS signature is unaffected.
- Behaviour identical: old `new(_app)` ignored its argument and called `voxis_desktop_config_dir()`; `for_desktop()` does the same.
- Naming: acceptable. `voxis_desktop_config_dir()` already establishes the "desktop" vocabulary in this file and the existing tests (`voxis_desktop_config_dir_matches_v0_1_5_on_macos`) pin it to `dirs::config_dir()/voxis`. It correctly signals "this is NOT the iOS path" to the future plugin author, who will need an `AppPaths::from_dir(PathBuf)`-style constructor (the private `AppPaths { config_dir }` literal already exists, so that's a one-liner later). No change requested.

### 6. Gold-plating / new abstractions
Exactly three new surfaces, all required by the task: `HotkeySink` trait (+ `start_with_thread_init` to keep the altstack hook — justified, and `start` remains the simple default), `AppPaths::for_desktop()`, `audio_wav::WavError` + `From` (unavoidable once `AudioError` stays behind). `GuardCfg` got two trivial accessors instead of making fields `pub` — the more conservative choice. No new traits/generics elsewhere. Core `Cargo.toml` additions (`thiserror`, `async-trait`, `once_cell`, `hound`, `reqwest` with the same `rustls-tls`/`json`/`multipart` features and `default-features = false`; dev: `mockito`, `tokio`) are each used by moved code — verified `async_trait` (llm/provider), `once_cell` (learning/normalizer), `hound` (audio_wav), `thiserror` (transcription/llm/audio_wav).

### Scope
Touched files match the task's `Files:` list plus the deferred M1 (paths.rs, storage/mod.rs, setup/mod.rs, commands/overlay.rs) and the plan-file status annotation. `research/plugin-plan/review_1a_r{1,2}.md` are review artifacts from 1a being committed — informational, not code.

## Minors (non-blocking)

- **M1 — `hound` now unused in voice_lib** (`src-tauri/Cargo.toml:~79`). `grep -rn "hound::" src-tauri/src src-tauri/examples` → zero hits after the move. The comment claims it's "kept … since it's still a small crate with no downside (matches `rdev` below)" — but unlike `rdev` (still used by `examples/test_rdev.rs`), nothing in voice_lib references `hound` any more. Dead direct dependency; drop it in a follow-up (or in 1c if Cargo.toml is touched again). Zero runtime impact (same version already in the graph via core).
- **M2 — No unit test drives `HotkeySink` from the press/release state machine.** Not a regression (the state machine was never unit-tested; it's inline in the rdev callback), and refactoring it out would exceed "move-not-rewrite". Suggest a follow-up (plugin task or later) to extract the `match event.event_type { … }` body into a `pub(crate) fn step(state, key_event, target, &dyn HotkeySink)` so a fake sink can assert pressed→released ordering, double-press suppression (`!is_pressed`), and mismatched-release ignore (`last_pressed_key == Some(key)`). Do **not** block 1b on this.
- **M3 — Verbose doc comments** (transcription/mod.rs, encoder.rs shim, recording_guard.rs, Cargo.toml) narrate "Task 1b moved…" history at length. Harmless, and the review chain values traceability, but some (e.g. the 12-line `audio_wav.rs` header explaining `AudioError`) could be trimmed once the plugin lands. Style only.
- **M4 — `WavError` display string** in core (`"Failed to write WAV: {0}"`) duplicates `AudioError::WavError`'s display. Fine today (voice_lib unwraps the inner `msg`, so no doubled prefix). If a future direct consumer of `voxis_core::audio_wav` ever wraps `WavError` via `.to_string()` into `AudioError::WavError`, you'd get `"Failed to write WAV: Failed to write WAV: …"`. The exhaustive `From` destructure prevents this for the existing path; just flagging for the plugin author.
- **M5 — `get_themes_dir(_app: AppHandle)`** — the parameter is now unused but kept to preserve the tauri-specta command signature. Correct choice; a one-line comment saying "kept for signature stability" would prevent a future clippy-driven removal.
