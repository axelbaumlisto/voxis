# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TALRI is a voice dictation app built with Tauri v2, React 18, and Rust. It records audio via hotkey, transcribes via Groq/OpenAI Whisper API, and outputs text via clipboard or auto-typing.

## Development Commands

```bash
# Install dependencies
bun install

# Run development server with Tauri
bun run tauri dev

# Run frontend tests
bun run test:run

# Run Rust tests
cd src-tauri && cargo test

# Run E2E tests (requires Playwright browsers)
bun run test:e2e

# Build for production
bun run tauri build

# Lint
bun run lint
```

To run a single frontend test file:
```bash
bunx vitest run src/path/to/file.test.tsx
```

To run a single Rust test:
```bash
cd src-tauri && cargo test test_name
```

## Architecture

### Frontend (src/)
- **React 18 + TypeScript + Vite** with React Router
- **Pages**: `src/pages/` - HomePage, SettingsPage, HistoryPage, DictionaryPage
- **Hooks**: `src/hooks/` - Custom hooks for async data, recording state, settings, etc.
- **Commands**: `src/lib/commands.ts` - Type-safe wrappers for all Tauri invoke calls
- **Components**: Domain-organized under `src/components/{dictionary,history,settings}/`
- **Tests**: Co-located as `__tests__/*.test.tsx` alongside source files

### Backend (src-tauri/)
- **Rust + Tauri v2** with SQLite storage
- **Two binaries**: `voice` (main app) and `voice-overlay` (native overlay process)

Key modules:
- `orchestrator/` - Workflow coordination: hotkey → recording → transcription → output. Uses a queue for buffered concurrent recordings.
- `audio/` - Recording via cpal, WAV encoding
- `transcription/` - Whisper API client (Groq/OpenAI)
- `output/` - Clipboard (arboard) and auto-typing
- `hotkey/` - Low-level keyboard input via rdev
- `storage/` - SQLite + file-based storage (config, history, dictionary, providers)
- `overlay_native/` - egui-based passthrough overlay for recording visualization
- `llm/` - Post-processing transcriptions via LLM
- `learning/` - Dictionary learning/suggestion system
- `commands/` - Tauri commands exposed to frontend

### Data Flow
1. User presses hotkey → `hotkey::HotkeyListener` detects
2. `Orchestrator::on_hotkey_pressed()` starts `AudioRecorder`
3. User releases hotkey → audio queued in `TranscriptionQueue`
4. Queue worker processes: transcribe → apply dictionary → optional LLM → output
5. Frontend receives state via Tauri events (`state-changed`, `error`)

### Storage Files
All stored in platform-specific config directory:
- `config.db` - SQLite key-value settings
- `history.db` - Transcription history
- `dictionary.txt` - Word replacement mappings
- `corrections.db` - Learning suggestions tracking
- `providers.json` - Custom LLM provider definitions

## Testing

- Frontend: Vitest with jsdom, React Testing Library. Setup in `src/test/setup.ts`
- Backend: Cargo test with tempfile for isolation, mockito for HTTP mocking
- E2E: Playwright (not frequently used)

## Key Patterns

- **Tauri state management**: Domain-specific state structs (`AudioState`, `OutputState`, etc.) managed via `app.manage()`
- **Frontend/backend communication**: All via `invoke()` calls defined in `src/lib/commands.ts`
- **Async hooks**: `useAsyncData` and `useAsyncAction` patterns for loading/mutation states
- **Recording context**: React context (`RecordingContext`) shares recording state across components
