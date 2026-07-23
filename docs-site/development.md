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

## Product metadata (from source of truth)

- npm/bun package name/version: `voxis` / see root `package.json`
- Tauri product name / version / identifier: `Voxis` / value in `src-tauri/tauri.conf.json` (and matching `src-tauri/Cargo.toml`) / `top.voxis.app`
- Bundle targets: `app`, `dmg`, `deb`, `rpm`

Prefer the Tauri/Cargo version as the shipped app version when they differ from `package.json`.

## Architecture

Frontend code lives in `src/` and uses React 18, TypeScript, Vite, React Router, and Tauri invoke wrappers. Public routes/pages are Settings, History, Dictionary, and Onboarding.

Important frontend areas:

- `src/lib/commands.ts` and `src/bindings.ts` — invoke wrappers and generated bindings.
- `src/lib/settingsRegistry.ts` and `src/lib/constants.ts` — settings UI registry and option lists.
- `src/hooks/` — async data, settings, audio devices, recording, overlay state, provider, and theme hooks.
- `src/components/` — layout plus dictionary, history, settings, and spectrum components.
- `src/theme-engine/` — ThemeHost, contract, builtin sources, and renderers.
- `src/overlay.tsx` — overlay webview entry point and pointer recording wiring.

Backend code lives in `src-tauri/` and uses Rust with Tauri v2. Important modules include:

- `audio/` — recording via CPAL, audio levels, VAD, and WAV encoding.
- `orchestrator/` — hotkey-to-transcription workflow, queueing, overlay updates, post-processing, and output.
- `transcription/` — Whisper-compatible HTTP client.
- `output/` — clipboard, paste shortcuts, auto-typing, and auto-submit.
- `storage/` — config, history, dictionary, corrections, provider/prompt, failed-audio, theme, and debug storage.
- `theme_engine/` and `overlay_native/` — manifest/script loading and overlay window handling.
- `commands/` — Tauri commands exposed to the frontend.

## GitHub Pages docs

The docs site is in `docs-site/` and is built by `.github/workflows/pages.yml` on pushes to `main` that touch `docs-site/**` or the workflow. The workflow uses `actions/configure-pages`, `actions/jekyll-build-pages` with `docs-site` as the source, `actions/upload-pages-artifact`, and `actions/deploy-pages`.

Do not add hosted URLs or screenshots unless they exist. Keep public docs free of credentials and local database contents.
