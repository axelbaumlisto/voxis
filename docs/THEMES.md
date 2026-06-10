# Theme Author Guide

TALRI themes are self-contained ES modules that render the recording overlay.
Each theme is a folder with two files: `theme.json` (manifest v2) and `theme.js`
(your code). This guide covers everything you need to write one.

## What a Theme Is

A theme is a directory inside the user themes folder:

| OS      | Path                                     |
|---------|------------------------------------------|
| Linux   | `~/.config/soupawhisper/themes/`         |
| macOS   | `~/Library/Application Support/soupawhisper/themes/` |
| Windows | `%APPDATA%/soupawhisper/themes/`          |

Each subdirectory is one theme. Inside it you place exactly two files:

```
my_theme/
├── theme.json    ← manifest v2 (name, entry point, optional params)
└── theme.js      ← self-contained ES module (your code)
```

The folder name **is** the theme id. If your `theme.json` id field disagrees
with the folder name, the folder name wins automatically — no silent failures.

Builtin themes are seeded to your themes folder on first launch. You can
export any theme as a copy via **Settings → Themes → Export** (creates
`<id>_custom/`). User themes are never overwritten by app updates.

## Quick Start

1. Export a builtin theme from Settings (or just copy a folder from the themes
   directory).
2. Rename the copied folder to your theme id (e.g. `pulsar`).
3. Edit `theme.json` — update `name` and `description`. Leave
   `manifest_version: 2`, `api_version: 1`, and `entry: "theme.js"` alone.
4. Edit `theme.js` — change colours, behaviour, or throw it away and start
   fresh.
5. Hit **Reload Themes** in Settings. Your theme appears in the dropdown.

The overlay shows the **selected theme immediately**. If your theme loads
and no errors appear in the browser console, it's working.

## Manifest Reference

`theme.json` uses manifest v2. Every field is required unless marked optional.

| Field             | Type   | Constraints                                  |
|-------------------|--------|----------------------------------------------|
| `manifest_version`| number | Must be `2`. Themes v1 are auto-upgraded.    |
| `id`              | string | Safe path component: no `/` `\` `..` `:` `.` |
| `name`            | string | Human-readable, shown in the dropdown.       |
| `description`     | string | Optional. Shown in Settings.                 |
| `api_version`     | number | Must be `1`.                                 |
| `entry`           | string | Plain filename, no slashes (e.g. `"theme.js"`). |
| `params`          | object | Optional. Free-form JSON handed to your theme at `api.params`. |

Example:

```json
{
  "manifest_version": 2,
  "id": "pulsar",
  "name": "Pulsar",
  "description": "A pulsing circle that grows with audio level",
  "api_version": 1,
  "entry": "theme.js",
  "params": { "color": "#ff4400", "minRadius": 4, "maxRadius": 16 }
}
```

## The Contract

Every `theme.js` must export a `mount` function. The app calls it once, passes
a DOM container and an API object, and expects back an object with `unmount()`.

### theme.js template

```js
export function mount(container, api) {
  // container — a <div> sized 172×36 px.
  // api — { apiVersion, params, size, onState, actions }

  // 1. Read params from manifest (optional)
  const color = api.params?.color ?? "#ff4400";

  // 2. Set up your rendering (canvas, DOM, whatever)
  const canvas = document.createElement("canvas");
  canvas.width = api.size.width;   // 172
  canvas.height = api.size.height; // 36
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
| `api.size`        | `{width: 172, height: 36}` | Canvas dimensions in px. |
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

State pushes arrive roughly every animation frame while recording. In other
modes (`idle`, `transcribing`, `error`) they arrive on mode transitions.
`spectrumBins` events are your frame clock — render when you get them.

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
   is left untouched — even if it's broken. Only legacy v1 themes get
   overwritten with their v2 equivalents.

4. **Canvas is 172×36 px.** All themes render into this fixed-size container.
   On HiDPI displays the physical pixels are higher, but your layout coordinates
   are always 172×36.

5. **Folder name is id.** If you copy `winamp_classic/` and rename it to
   `my_winamp/`, the theme id becomes `my_winamp` regardless of what
   `theme.json` says. Edit `theme.json`'s `id` field to match to avoid
   confusion.

6. **Valid ids are simple.** No slashes, backslashes, `..`, `:`, or empty
   strings. Stick to `[a-z0-9_]` for safety.

## Full Example: Pulsar

A minimal custom theme — one file each. Copy these verbatim and hit Reload.

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

## Editing Builtin Themes

The builtin themes (Winamp Classic, Handy Pill, Default, Neon, etc.) are the
best reference for advanced rendering. Their source lives at
`src/theme-engine/builtin/` in the repo, and they use helper renderers
(`bars`, `pill`, `ring`) that are bundled into the final `theme.js`. When
building your own theme, you can't import those helpers; the builtins show
the final bundled output in `src-tauri/themes/<id>/theme.js` after running
`bun run build:themes`.

## Debugging

- Open the overlay then press Ctrl+Shift+I (or right-click → Inspect) to get a
  DevTools console scoped to the overlay window.
- Check for `[ThemeHost]` messages in the console — they log load failures
  and fallback activations.
- Use **Settings → Themes → Validate** to run the Rust-side manifest + entry
  checks without touching the JS runtime.
