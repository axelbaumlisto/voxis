# TALRI

Voice dictation app built with Tauri v2, React, and Rust.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust + Tauri v2
- **Testing**: Vitest (138 tests) + Cargo test (34 tests) + Playwright E2E

## Development

```bash
# Install dependencies
bun install

# Run dev server
bun run tauri dev

# Run tests
bun run test:run        # Frontend tests
cd src-tauri && cargo test  # Rust tests
```

## Build

```bash
bun run tauri build
```

## Features

- Voice recording with hotkey trigger
- Transcription via Groq/OpenAI Whisper API
- Settings management
- Transcription history
- Dictionary for word replacements
- Recording overlay
- System tray integration

## Custom Themes

The recording overlay supports user-written themes — self-contained ES modules
that render a 172×36 px canvas. Each theme is a folder in your config's
`themes/` directory with a manifest v2 (`theme.json`) and a `theme.js` entry
point. Export a builtin theme from Settings as a starting point, edit the code,
and hit Reload. See the full guide at **[docs/THEMES.md](docs/THEMES.md)**.
