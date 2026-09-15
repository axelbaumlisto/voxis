# host-min

The minimal Tauri 2 host for `tauri-plugin-voxis`: one `index.html` with a
Start/Stop button and a `<pre id="result">`, no framework, no bundler
(`ui/main.js` talks to the plugin's raw `plugin:voxis|*` commands through
`window.__TAURI__` directly, `withGlobalTauri: true`). Registers the
plugin in `src-tauri/src/main.rs`; capability file
(`src-tauri/capabilities/default.json`) grants `voxis:default`.

`cargo build -p host-min` must compile on macOS without a real
microphone/hotkey involved (`MockCapture`, the default). Running it
(`cargo run -p host-min` — see below) will prompt for microphone
permission the first time `VOXIS_CAPTURE=cpal` is used.

## Run

```sh
# MockCapture — no real microphone, deterministic (CI-path).
cargo run -p host-min

# Same, explicit fixture path reserved for Task 3.5's own MockCapture
# scripting wire-up (not yet consumed here — Task 4 only makes the
# backend selectable).
VOXIS_CAPTURE=mock:/path/to/fixture.wav cargo run -p host-min

# CpalCapture + RdevHotkey (Task 4's real desktop backends) — prompts for
# microphone permission (and, for the hotkey listener, macOS
# Accessibility/Input Monitoring) on first use.
VOXIS_CAPTURE=cpal cargo run -p host-min
```

`VOXIS_STT_URL` (overrides `api_url_override` for a fake-STT server) is
accepted and logged today but not yet threaded into the plugin's pipeline
config — that lands with `VoxisProfile`/`apply_profile` (Task 2/6/7).
