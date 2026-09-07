# Changelog

## v0.1.4

macOS release lane: sign every bundled executable (voice AND typing_bench) with
Developer ID + Hardened Runtime + entitlements; v0.1.3's notarization was rejected on
typing_bench, so v0.1.3 shipped without a DMG (Linux/Windows/Homebrew tarball
unaffected). No app-code changes.

## v0.1.3

Fixes the "stuck recording" class of incidents (recording never stops, RAM grows to
gigabytes, multi-GB WAV dumps, app goes deaf until restart) and adds a recording guard.

### Root cause fixed
- Press/release ordering race: a hotkey/overlay release arriving while the press was
  blocked in the (0.2–5 s) synchronous microphone-permission probe was silently dropped,
  leaving a recording nobody would stop. Now: single-flight start, release-pending
  checkpoints, deterministic — the recording either never starts or stops immediately.
- Microphone permission probe is native (AVFoundation, ~10–40 ms) instead of `osascript`.

### Recording guard (new settings, Recording section)
- Auto-stop after continuous silence (default 60 s + ~10 s detection window; 0 = off)
  with a warning beep 3 s before. A take that was silent from start to finish is
  discarded instead of transcribed, to avoid an auto-typed Whisper silence hallucination.
- Max recording length (default 10 min; 0 = off — recording still stops at ~13 min, the
  transcription limit; the raw audio buffer keeps a separate, larger safety backstop).
- Buffer is hard-capped at the native sample rate; memory is released on stop.

### Robustness
- One serialized stop path for hotkey release, toggle press, cancel button and the guard;
  toggle mode's tap-to-stop (previously dead code) works.
- Dead audio stream mid-recording recovers to idle with an error cue instead of pinning
  the app in "Recording" — on the next stop request, or automatically once the recording
  guard notices the stream died.
- Oversize audio (>25 MB) is rejected before any disk write or network call; the
  failed-audio and debug dumps no longer write multi-GB files.
- Overlay spectrum logging throttled; heartbeat no longer fsyncs every 10 s.

### macOS release pipeline
- CI now codesigns (Developer ID, Hardened Runtime + microphone/Apple-Events
  entitlements), notarizes and staples a DMG (falls back to an ad-hoc-signed DMG when
  signing secrets are absent; unstapled if Apple's queue exceeds 30 min — see
  `docs/MACOS_SIGNING_TODO.md`); own VM image and a host-wide launch lock.

## v0.1.2

First signed+notarized macOS DMG via the CI lane (commit e188a8d); no app-code changes.

## v0.1.1

CI/release-pipeline hardening (no user-facing app changes):
- Release publishes deb/rpm to both Forgejo and GitHub with hard-fail asserts.
- Homebrew tap `axelbaumlisto/homebrew-voxis` wired up with a tarball integrity
  gate (`brew install axelbaumlisto/voxis/voxis`, macOS arm64).
- Docs regeneration decoupled from release into a scheduled workflow that opens
  a PR to main (deploys to docs.voxis.top via GitHub Pages).
- Re-publish guard prevents overwriting an already-published tag.

## v0.1.0

First public release of Voxis — a private, local-first voice dictation app
(Tauri v2 + Rust core). Records audio via a global hotkey, transcribes through
a Whisper-compatible HTTP endpoint (Groq by default), and outputs text via
clipboard or auto-typing.

### Highlights
- Global push-to-talk hotkey with buffered concurrent recordings
- Whisper-compatible transcription (custom endpoints via `api_url_override`)
- Dictionary word-replacement + learning suggestions
- Optional LLM post-processing with multi-prompt templates
- Clipboard and auto-typing output backends
- Transcription history with SQLite storage
- Themeable recording overlay (manifest v2 theme engine)

### Downloads
- **Linux**: `voxis-linux-x64-gui` (binary), `Voxis_0.1.0_amd64.deb`, `Voxis-0.1.0-1.x86_64.rpm`
- **Windows**: `voxis-windows-x64-gui.exe` (portable), `Voxis_0.1.0_x64-setup.exe` (NSIS installer)
- **macOS**: unsigned Apple Silicon binary (`voxis-macos-arm64`) — DMG signing/notarization to follow

Binaries are unsigned in this release.
