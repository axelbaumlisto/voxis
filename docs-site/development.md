---
title: Development
layout: default
---

# Development

## Commands from `package.json`

```bash
bun install
bun run dev                 # Vite frontend dev server
bun run harness             # Vite server for /harness.html
bun run build               # build themes, type-check, Vite build
bun run build:themes        # bundle builtin themes to src-tauri/themes/
bun run tauri dev           # Tauri dev app
bun run tauri build         # production Tauri build
bun run test:run            # Vitest once
bun run test:coverage       # Vitest coverage
bun run test:e2e            # Playwright tests
bun run test:all            # Vitest + Playwright
bun run test:rust           # cargo build examples + cargo test
bun run lint                # ESLint over src/**/*.ts(x)
```

Rust tests can also be run directly:

```bash
cd src-tauri && cargo test
```

## Architecture

Frontend code lives in `src/` and uses React 18, TypeScript, Vite, React Router, and Tauri invoke wrappers. Public routes/pages are Settings (`/settings`), History (`/` and `/history`), Dictionary (`/dictionary`), and Onboarding (`/onboarding`).

Important frontend areas:

- `src/lib/commands.ts` and `src/bindings.ts` — invoke wrappers and generated bindings.
- `src/lib/settingsRegistry.ts` and `src/lib/constants.ts` — settings UI registry and option lists.
- `src/hooks/` — async data, settings, audio devices, recording, overlay state, provider, and theme hooks.
- `src/components/` — layout plus dictionary, history, settings, and spectrum components.
- `src/theme-engine/` — ThemeHost, contract (`apiVersion` 1), builtin sources, and renderers.
- `src/overlay.tsx` — overlay webview entry point and pointer recording wiring.

Backend code lives in `src-tauri/` and uses Rust with Tauri v2. There are two binaries: `voice` (main app) and `typing_bench` (auto-type latency benchmark).

Important modules include:

- `audio/` — recording via CPAL, audio levels, VAD, and WAV encoding.
- `orchestrator/` — hotkey-to-transcription workflow, queueing, overlay updates, post-processing, and output.
- `transcription/` — Whisper-compatible HTTP client (default Groq transcription URL; custom endpoints only via `api_url_override`).
- `output/` — clipboard, paste shortcuts, auto-typing, and auto-submit.
- `hotkey/` — low-level keyboard input via rdev.
- `storage/` — config, history, dictionary, corrections, provider/prompt, failed-audio, theme, and debug storage under the platform `voxis` config directory.
- `theme_engine/` and `overlay_native/` — manifest/script loading and overlay window handling (cross-platform webview backend; standard size 172×36 logical px unless a theme sets valid `overlay_width`/`overlay_height`).
- `llm/` and `learning/` — optional LLM post-processing and dictionary learning suggestions.
- `commands/` — Tauri commands exposed to the frontend.

### Data flow

1. Hotkey press → `hotkey::HotkeyListener` → `Orchestrator::on_hotkey_pressed()` starts `AudioRecorder`.
2. Hotkey release (hold mode) or second tap (toggle mode) queues audio in `TranscriptionQueue`.
3. Queue worker: transcribe → dictionary → optional LLM → clipboard/auto-type output.
4. Frontend receives `state-changed` and `error` events from the backend.

## GitHub Pages docs

The docs site is in `docs-site/` and is built by `.github/workflows/pages.yml` on pushes to `main` that touch `docs-site/**` or the workflow. The workflow uses `actions/configure-pages`, `actions/jekyll-build-pages` with `docs-site` as the source, `actions/upload-pages-artifact`, and `actions/deploy-pages`.

Do not add hosted URLs or screenshots unless they exist. Keep public docs free of credentials and local database contents.
