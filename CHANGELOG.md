# Changelog

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
