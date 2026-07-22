# Theme Author Guide

Voxis themes are self-contained ES modules that render the recording overlay.
Each theme is a folder with `theme.json` (manifest v2) and a `theme.js` entry
module. This guide covers everything you need to write one.

> **Security:** `theme.js` is executable JavaScript trusted by the app webview.
> It is not sandboxed for untrusted code. Only install themes from sources you
> trust, and review third-party theme code before using it.

## What a Theme Is

A theme is a directory inside the user themes folder:

| OS      | Path                                     |
|---------|------------------------------------------|
| Linux   | `~/.config/voxis/themes/`                |
| macOS   | `~/Library/Application Support/voxis/themes/` |
| Windows | `%APPDATA%/voxis/themes/`                 |

Each subdirectory is one theme. A minimal theme contains these two files:

```
my_theme/
├── theme.json    ← manifest v2 (name, entry point, optional params/size)
└── theme.js      ← self-contained ES module (your code)
```

The folder name **is** the theme id. If your `theme.json` id field disagrees
with the folder name, the folder name wins automatically — no silent failures.

Builtin themes are seeded to your themes folder on first launch. You can copy
an existing theme folder manually to make a custom variant; the current Settings
UI exposes theme selection plus preview/reload actions, not an Export button.
Existing manifest-v2 user themes are preserved by app updates. Bundled-theme
user copies with legacy/non-v2 manifests may be upgraded/overwritten with the
bundled v2 equivalent.

## Quick Start

1. Copy a builtin or user theme folder from the themes directory.
2. Rename the copied folder to your theme id (e.g. `pulsar`).
3. Edit `theme.json` — update `name` and `description`. Leave
   `manifest_version: 2`, `api_version: 1`, and `entry: "theme.js"` alone.
4. Edit `theme.js` — change colours, behaviour, or throw it away and start
   fresh.
5. Use **Reload + Preview**, restart, or reselect the theme in Settings. Your theme appears in the dropdown.

The overlay shows the **selected theme immediately**. If your theme loads
and no errors appear in the browser console, it's working.

## Manifest Reference

`theme.json` uses manifest v2. Every field is required unless marked optional.

| Field             | Type   | Constraints                                  |
|-------------------|--------|----------------------------------------------|
| `manifest_version`| number | Must be `2`. Bundled legacy themes are upgraded during startup seeding; arbitrary invalid/non-v2 user themes are skipped. |
| `id`              | string | Safe path component: no `/` `\` `..` `:` `.` |
| `name`            | string | Human-readable, shown in the dropdown.       |
| `description`     | string | Optional. Shown in Settings.                 |
| `api_version`     | number | Must be `1`.                                 |
| `entry`           | string | Plain filename, no slashes (e.g. `"theme.js"`). |
| `params`          | object | Optional. Free-form JSON handed to your theme at `api.params`. |
| `overlay_width`   | number | Optional. Overlay window width in logical px. |
| `overlay_height`  | number | Optional. Overlay window height in logical px. |

Example:

```json
{
  "manifest_version": 2,
  "id": "pulsar",
  "name": "Pulsar",
  "description": "A pulsing circle that grows with audio level",
  "api_version": 1,
  "entry": "theme.js",
  "overlay_width": 172,
  "overlay_height": 36,
  "params": { "color": "#ff4400", "minRadius": 4, "maxRadius": 16 }
}
```

## The Contract

Every `theme.js` must export a `mount` function. The app calls it once, passes
a DOM container and an API object, and expects back an object with `unmount()`.

### theme.js template

```js
export function mount(container, api) {
  // container — a <div> sized to the overlay window.
  // api — { apiVersion, params, size, onState, actions }

  // 1. Read params from manifest (optional)
  const color = api.params?.color ?? "#ff4400";

  // 2. Set up your rendering (canvas, DOM, whatever)
  const canvas = document.createElement("canvas");
  canvas.width = api.size.width;
  canvas.height = api.size.height;
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // 3. Subscribe to state pushes
  const unsub = api.onState((state) => {
    // state = { mode, audioLevel, spectrumBins }
    // Clear + redraw
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const r = 4 + state.audioLevel * 12; // pulse radius
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  // 4. Return instance with unmount
  return {
    unmount() {
      unsub();              // stop receiving state
      canvas.remove();      // clean up DOM
    },
  };
}
```

### ThemeApi

| Property / Method | Type | Description |
|-------------------|------|-------------|
| `api.apiVersion`  | `1`  | Contract version (additive within v1). |
| `api.params`      | `unknown` | Your manifest `params` object, or `null`. |
| `api.size`        | `{width, height}` | Theme canvas/container dimensions in logical px. Defaults to the standard overlay size unless the manifest declares `overlay_width` / `overlay_height`. |
| `api.onState(cb)` | `(cb: (s: ThemeState) => void) => () => void` | Subscribe to state pushes. Fires **immediately** with the current state. Returns an unsubscribe function. |
| `api.actions.cancel()` | `() => void` | Cancel the in-flight recording. |

### ThemeState

```ts
{
  mode: "idle" | "recording" | "transcribing" | "error",
  audioLevel: number,      // 0..1, smoothed
  spectrumBins: number[],  // 32 floats, each 0..1 (FFT magnitude)
}
```

State pushes are event-driven. While recording, the Rust backend emits audio
level and spectrum updates at a polling cadence of roughly 80 ms; other modes
usually update on mode transitions. If your theme needs smoother motion, run its
own `requestAnimationFrame` loop and use the latest received `ThemeState` as
input. The visual harness can also drive animation independently for previewing.

## Rules & Gotchas

1. **Self-contained only.** `theme.js` must not import anything — no `import`
   statements, no `require`. Builtin themes are bundled with Bun
   (`bun run build:themes`) into a single file. If your theme needs helpers,
   inline them or bundle your own `theme.js` before placing it in the folder.

2. **Errors → fallback.** If your `theme.js` crashes during load or `mount()`,
   the overlay silently falls back to the builtin default theme. The overlay
   is **never** blank. Check the browser console for error details (Ctrl+Shift+I
   while the overlay is shown).

3. **User themes survive updates.** App updates seed v2 builtins to the
   themes folder, but any existing v2 theme (detected by `manifest_version: 2`)
   is left untouched — even if it's broken. Bundled themes whose existing user
   copy is legacy/non-v2 are overwritten with the bundled v2 equivalent; arbitrary
   custom invalid/non-v2 themes are skipped by the scanner rather than migrated.

4. **Canvas size comes from the overlay window.** Themes without explicit
   sizing use the standard overlay dimensions; themes with `overlay_width` /
   `overlay_height` get that size. On HiDPI displays the physical pixels are
   higher, but `api.size` is always in logical CSS pixels.

5. **Folder name is id.** If you copy `winamp_classic/` and rename it to
   `my_winamp/`, the theme id becomes `my_winamp` regardless of what
   `theme.json` says. Edit `theme.json`'s `id` field to match to avoid
   confusion.

6. **Valid ids are simple.** No slashes, backslashes, `..`, `:`, or empty
   strings. Stick to `[a-z0-9_]` for safety.

## Full Example: Pulsar

A minimal custom theme — one file each. Copy these verbatim and reload/reselect the theme.

### pulsar/theme.json

```json
{
  "manifest_version": 2,
  "id": "pulsar",
  "name": "Pulsar",
  "description": "A pulsing circle that grows with audio level",
  "api_version": 1,
  "entry": "theme.js",
  "params": { "color": "#00ff88", "minRadius": 3, "maxRadius": 15 }
}
```

### pulsar/theme.js

```js
export function mount(container, api) {
  const cfg = api.params ?? {};
  const color = cfg.color ?? "#00ff88";
  const minR = cfg.minRadius ?? 3;
  const maxR = cfg.maxRadius ?? 15;

  const canvas = document.createElement("canvas");
  canvas.width = api.size.width;
  canvas.height = api.size.height;
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const unsub = api.onState((state) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const r = minR + state.audioLevel * (maxR - minR);
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  return {
    unmount() {
      unsub();
      canvas.remove();
    },
  };
}
```

Place both files in `<themes dir>/pulsar/`, reload themes, select Pulsar, and
speak — the circle pulses with your voice.

> **Modifying an existing theme and want it live?** See the practical
> workflow in [`THEME_EDITING.md`](./THEME_EDITING.md) — two file locations,
> the seeding gotcha, harness/E2E, and deploy-without-rebuild.

## Editing Builtin Themes

The builtin themes (Winamp Classic, Handy Pill, Default, Neon, etc.) are the
best reference for advanced rendering. Their source lives at
`src/theme-engine/builtin/` in the repo, and they use helper renderers
(`bars`, `pill`, `ring`) that are bundled into the final `theme.js`. When
building your own theme, you can't import those helpers; the builtins show
the final bundled output in `src-tauri/themes/<id>/theme.js` after running
`bun run build:themes`.

## Developing Themes with the Visual Harness

You can test and iterate on theme visuals WITHOUT building or running the Tauri
app. The visual harness loads the **same** builtin theme modules and the exact
production `<ThemeHost/>` component — just in a plain browser tab via Vite.

1. Run `bun run dev` (or `bun run harness`).
2. Open the printed URL and add `/harness.html`
   (e.g. `http://localhost:5173/harness.html`).
3. Pick a theme from the dropdown, then drive its state:
   - **Mode** — switch between idle / recording / transcribing / error.
   - **Audio level** — slider 0–1 that feeds `audioLevel`.
   - **Scenario buttons** — play pre-defined behaviours:
     `Speech → grow → silence`, `Startle burst`, `Idle morph`, `Steady speech`.
   - **Animate** — enable/disable the rAF frame loop (turn on in manual mode to
     see idle morph and time-based motion).
   - **Params JSON** — live-edit theme `params` (shown as `api.params` inside
     the module); the preview remounts instantly on every change.
   - **Scale** — zoom the preview for easier inspection.
   - **Background** — toggle between dark/medium grey so light and dark themes
     are both visible.

The harness uses the **same** builtin modules + ThemeHost contract as the
overlay. No Tauri build, no cargo, no hotkey — just save your `theme.js` and
reload the browser.

## Debugging

- Open the overlay then press Ctrl+Shift+I (or right-click → Inspect) to get a
  DevTools console scoped to the overlay window.
- Check for `[ThemeHost]` messages in the console — they log load failures
  and fallback activations.
- The Rust command `validate_visualization_theme` performs manifest + entry
  checks without touching the JS runtime; it is available through the Tauri
  command surface for developer tooling/tests.
