# Voxis (formerly SoupaWhisper / TALRI)

A blazing fast, completely private desktop voice dictation engine built with **Tauri v2**, **React 18**, and **Rust**.

Zero-lag native hotkeys, Rust CPAL audio core, and a Whisper-compatible transcription client (Groq by default).

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust + Tauri v2
- **Testing**: Vitest + Cargo test + Playwright E2E
- **License**: MIT

## Privacy: where the audio goes

By default, recorded audio is sent to Groq's cloud API for transcription using a Whisper-compatible client — audio leaves your machine on every recording. If you need fully local processing, you can point Voxis at any OpenAI-compatible `/audio/transcriptions` endpoint (e.g. a self-hosted whisper.cpp or `speaches` container) by setting the provider option `api_url_override` (the `apiUrlOverride` field of the provider settings); once that is set, no audio reaches Groq or any other third-party server. See [SECURITY.md](SECURITY.md) for credential and data-storage guidance.

## Documentation

Published docs: <https://docs.voxis.top/>

- [Installation](https://docs.voxis.top/installation.html)
- [Usage](https://docs.voxis.top/usage.html)
- [Settings](https://docs.voxis.top/settings.html)
- [Themes](https://docs.voxis.top/themes.html)
- [Self-Hosted Transcription](https://docs.voxis.top/self-hosted-transcription.html)
- [Security](https://docs.voxis.top/security.html)
- [Security policy (repository)](SECURITY.md)
- [Troubleshooting](https://docs.voxis.top/troubleshooting.html)

`CLAUDE.md` is optional contributor guidance for AI coding assistants; normal user and developer documentation starts with this README and the published docs above.

## Feedback

Questions, ideas, and general discussion belong in [GitHub Discussions](https://github.com/axelbaumlisto/voxis/discussions).
Bug reports and reproducible defects go to [GitHub Issues](https://github.com/axelbaumlisto/voxis/issues).

## Development

```bash
# Install dependencies
bun install

# Run development server with Tauri
bun run tauri dev

# Run checks
bun run test:run                  # Frontend tests
cd src-tauri && cargo test        # Rust tests
bun run test:e2e                  # Playwright E2E
bun run lint                      # ESLint
```

## Configuration and credentials

Voxis uses cloud transcription by default. For the default Groq endpoint,
create a key in the [Groq Console](https://console.groq.com/) and paste the raw
key into **Settings → Provider → API Key**. Groq keys usually look like
`gsk_...`; paste only the key, without `Bearer`, quotes, or extra spaces. Check
current access limits/pricing in the Groq Console.

The default transcription model is `whisper-large-v3`; Settings also offers
`whisper-large-v3-turbo`. The Provider dropdown stores Groq/OpenAI labels, but
the current transcription path uses the default Groq-compatible endpoint unless
a Custom Endpoint URL is set in Settings → Provider → "Custom Endpoint URL
(Advanced)" (stored as `api_url_override`; also settable by tests or a custom
build). OpenAI keys often start
with `sk-...`; that is only an OpenAI credential example, not the expected key
for default Groq transcription. Optional LLM post-processing has separate
provider/model/API-key settings.

Voxis stores API keys as **local runtime configuration** and must not
commit them to git. Configure the transcription API key and optional LLM key
through the app settings UI; the application does not automatically load
credentials from environment variables.

### Alternative and self-hosted transcription providers

The transcription client speaks the standard OpenAI-compatible
`/audio/transcriptions` protocol (multipart form: `file`, `model`,
`response_format=verbose_json`, optional `language`, and optional
`task=translate`). Any
endpoint implementing that same contract works by setting
`api_url_override` to the endpoint's `/audio/transcriptions` URL — no code
changes required. This is intentional: Voxis deliberately does **not** ship
built-in support for every provider or a platform-native (e.g. macOS
`SpeechAnalyzer`) transcription backend, to keep the transcription client
small and avoid multiplying platform-specific code paths.

Self-hosting for fully offline/local transcription (e.g. a Docker-hosted
Whisper server via `speaches` or a whisper.cpp OpenAI-shaped wrapper) is
supported through this same mechanism and has been independently verified
against the app's real client code. For a quick start, run
`docker compose -f docker-compose.selfhost.yml up -d` (works on Linux,
macOS, and Windows) — see
**[docs/SELF_HOSTED_TRANSCRIPTION.md](docs/SELF_HOSTED_TRANSCRIPTION.md)**
for the full provider list, setup steps, and verification details.

Do not commit `config.db`, `history.db`, `dictionary.txt`, `corrections.db`,
`providers.db`, `prompts.db`, user `themes/`, `failed_audio/`, `debug/`, `logs/`,
`.env*`, or local agent scratch files. See [SECURITY.md](SECURITY.md).

## Build

```bash
bun run tauri build
```

## Features

- Voice recording with hotkey trigger and optional overlay click/press control
- Transcription through the app's Whisper-compatible client (default Groq endpoint)
- Optional LLM post-processing
- Settings management
- Transcription history and retry handling for failed audio
- Dictionary replacements and learning suggestions
- User-editable recording overlay themes
- System tray integration

## Custom Themes

The recording overlay supports user-written themes — self-contained ES modules
that render into the overlay webview. Each theme is a folder in your config's
`themes/` directory with a manifest v2 (`theme.json`) and a `theme.js` entry
point. Themes can declare their own `overlay_width` / `overlay_height`; otherwise
the default overlay size is used. That folder holds only your own themes: builtin
themes ship inside the app (they update and disappear with it), and a valid
folder carrying a builtin's id shadows that builtin. Start from the template in
the guide, edit the code, then use Reload + Preview or reload/reselect it in
Settings. See the full guide at **[docs/THEMES.md](docs/THEMES.md)**.

### Orb themes

The builtin orb set was trimmed to the owner's shortlist: `orb_shdr_03`,
`orb_shdr_06`, `orb_shdr_07`, `orb_rocaille`, `orb_falls`. The other orbs
(`orb_bitdumb`, `orb_corona`, `orb_dispersion`, `orb_dither`, `orb_hydrogen`,
`orb_ion`, `orb_mosaic`, `orb_muons`, `orb_nimbus`, `orb_phosphor`,
`orb_vectors` and SHDR-04/05/08/09/10/12/16/17/18/19/24/25/26/27/30/32/33)
were removed; they remain in git history if one is ever wanted back.

## Embeddable plugin (`tauri-plugin-voxis`)

Voxis's dictation engine is also available as an embeddable Tauri 2 plugin
(desktop + iOS) for third-party apps that want in-app dictation rather than
switching to the standalone Voxis app. See
**[crates/tauri-plugin-voxis/README.md](crates/tauri-plugin-voxis/README.md)**
(Rust: installation, commands/events, permissions) and
**[crates/tauri-plugin-voxis/guest-js/README.md](crates/tauri-plugin-voxis/guest-js/README.md)**
(TypeScript client + `<voxis-overlay>` component), plus
**[docs/PLUGIN.md](docs/PLUGIN.md)** for the architecture/guarantees and
**[docs/PLUGIN_IOS_HOST.md](docs/PLUGIN_IOS_HOST.md)** for the iOS host
checklist. This is a separate artifact from the Voxis desktop app above —
see `CHANGELOG.md` for its own version history.

## License

MIT. See [LICENSE](LICENSE).

## Dependency refresh policy

Dependencies are refreshed within manifest constraints by the ring on request
(`ring-deps` block, `cargo: *`). Lock files are written only by the package
manager, never edited by hand. Every refresh must pass the full offline test
suite before it merges.
