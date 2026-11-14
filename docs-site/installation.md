---
title: Installation
layout: default
---

# Installation

## Install a release

Downloads are on [GitHub Releases](https://github.com/axelbaumlisto/voxis/releases/latest). The links below always point at the latest build.

| OS | Download | Notes |
|---|---|---|
| Windows 10/11 (x64) | [voxis-windows-x64-setup.exe](https://github.com/axelbaumlisto/voxis/releases/latest/download/voxis-windows-x64-setup.exe) | Installer, no admin rights; installs to `%LOCALAPPDATA%\Voxis`. |
| Windows, portable | `voxis-windows-x64-portable.zip` on the release page | Unpack anywhere and run `voxis.exe`. |
| macOS 12+ (Apple Silicon) | [voxis-macos-arm64.dmg](https://github.com/axelbaumlisto/voxis/releases/latest/download/voxis-macos-arm64.dmg) | Open the DMG, drag Voxis to Applications. |
| macOS, Homebrew | `brew install axelbaumlisto/voxis/voxis` | Command-line binary `voxis`. |
| Linux x64 | `Voxis_<version>_amd64.deb` / `Voxis-<version>-1.x86_64.rpm` on the release page | Or the bare [voxis-linux-x64-gui](https://github.com/axelbaumlisto/voxis/releases/latest/download/voxis-linux-x64-gui): `chmod +x voxis-linux-x64-gui && ./voxis-linux-x64-gui`. |

**Signing.** macOS builds are signed with a Developer ID and notarized by Apple, so Gatekeeper opens them without warnings. Windows builds are not code-signed yet: on first run SmartScreen may show "Windows protected your PC" — click **More info → Run anyway**.

**Windows runtime.** The installer and the portable zip carry the Microsoft Visual C++ runtime. The bare `voxis-windows-x64-gui.exe` on the release page does not; it needs the [Visual C++ Redistributable 2015–2022](https://aka.ms/vs/17/release/vc_redist.x64.exe) installed.

**Check the version:** `voxis --version` (Homebrew) or `voice --version` (Linux package) prints `voxis <version>` without starting the app.

After installing, add a transcription key — see [API keys](#api-keys) below.

## Building from source

### Prerequisites

- Bun for frontend scripts.
- Rust and Cargo for the Tauri backend.
- Platform dependencies required by Tauri v2, WebKitGTK, appindicator, SVG rendering, `patchelf`, and ALSA on Linux.
- A transcription API key configured locally in the app settings.

The repository CI installs these Ubuntu packages for backend tests:

```bash
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libasound2-dev
```

### Development setup

```bash
bun install
bun run tauri dev
```

The Tauri dev config runs `bun run dev` and serves the frontend at `http://localhost:5173`.

### Build

```bash
bun run tauri build
```

The Tauri build config runs `bun run build` first. That script runs `bun run build:themes`, TypeScript type-checking (`tsc`), and the Vite production build.

Configured Tauri bundle targets are `app`, `dmg`, `deb`, and `rpm`. On Linux, bundles are written under `src-tauri/target/release/bundle/`.

### Linux package notes

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
- OpenAI keys usually look like `sk-...`; that is only an OpenAI credential-format example. The Settings UI includes OpenAI, but the current transcription client uses the default Groq-compatible transcription endpoint unless a Custom Endpoint URL is set in Settings → Provider → "Custom Endpoint URL (Advanced)" (stored as `api_url_override`; also settable by tests or a custom build).

Check current Groq access limits/pricing in the Groq Console.

For self-hosted or other protocol-compatible transcription endpoints instead of Groq, see [Self-Hosted Transcription](self-hosted-transcription.md).

Do not commit API keys. Configure transcription and optional LLM keys through the app settings UI; the code stores them in local config storage rather than loading them automatically from environment variables. See [Security](security.md).
