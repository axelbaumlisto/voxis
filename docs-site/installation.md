---
title: Installation
layout: default
---

# Installation

## Prerequisites

- Bun for frontend scripts.
- Rust and Cargo for the Tauri backend.
- Platform dependencies required by Tauri v2, WebKitGTK, appindicator, SVG rendering, `patchelf`, and ALSA on Linux.
- A transcription API key configured locally in the app settings.

The repository CI installs these Ubuntu packages for backend tests:

```bash
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libasound2-dev
```

## Development setup

```bash
bun install
bun run tauri dev
```

The Tauri dev config runs `bun run dev` and serves the frontend at `http://localhost:5173`.

## Build

```bash
bun run tauri build
```

The Tauri build config runs `bun run build` first. That script runs `bun run build:themes`, TypeScript type-checking (`tsc`), and the Vite production build.

Configured Tauri bundle targets are `app`, `dmg`, `deb`, and `rpm`. On Linux, bundles are written under `src-tauri/target/release/bundle/`.

## Linux package notes

The Tauri bundle config includes Debian and RPM targets. Build output depends on the host and installed tooling; install the Linux dependencies above before building or running tests on Ubuntu-like systems.

## API keys

Voxis uses cloud transcription by default. For the default Groq endpoint:

1. Create/sign in to a Groq account at [console.groq.com](https://console.groq.com/).
2. Open **API Keys** in the Groq Console.
3. Create a new key and copy it once.
4. Paste it into **Settings → Provider → API Key**.
5. Use the default `whisper-large-v3` transcription model or select `whisper-large-v3-turbo` in Settings.

Key format:

- Paste the raw key only — no `Bearer ` prefix, no quotes, no extra spaces.
- Groq keys usually look like `gsk_...`.
- OpenAI keys usually look like `sk-...`; that is only an OpenAI credential-format example. The Settings UI includes OpenAI, but the current transcription client uses the default Groq-compatible transcription endpoint unless `api_url_override` is set by tests or a custom build.

Check current Groq access limits/pricing in the Groq Console.

Do not commit API keys. Configure transcription and optional LLM keys through the app settings UI; the code stores them in local config storage rather than loading them automatically from environment variables. See [Security](security.md).
