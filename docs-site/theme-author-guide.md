---
title: Theme Author Guide
layout: default
---

# Theme Author Guide

Voxis themes are self-contained ES modules loaded from the user themes directory.

> **Security:** theme modules are executable JavaScript trusted by the app. They are not a sandbox for untrusted code. Only use third-party themes after reviewing their `theme.js`.

A minimal theme contains:

```text
my_theme/
├── theme.json
└── theme.js
```

## Manifest

`theme.json` uses manifest version 2:

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
  "params": { "color": "#00ff88" }
}
```

Required fields are `manifest_version`, `id`, `name`, `api_version`, and `entry`.
`description`, `params`, `overlay_width`, and `overlay_height` are optional.
The folder name is authoritative: if it differs from the manifest `id`, the loader uses the folder name.

## JavaScript contract

`theme.js` must export `mount(container, api)` and return an object with `unmount()`:

```js
export function mount(container, api) {
  const canvas = document.createElement("canvas");
  canvas.width = api.size.width;
  canvas.height = api.size.height;
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const unsubscribe = api.onState((state) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = api.params?.color ?? "#00ff88";
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 4 + state.audioLevel * 12, 0, Math.PI * 2);
    ctx.fill();
  });

  return {
    unmount() {
      unsubscribe();
      canvas.remove();
    },
  };
}
```

## Theme API

The Theme API version is `1` and includes:

- `api.apiVersion`
- `api.params`
- `api.size`
- `api.onState(callback)`
- `api.actions.cancel()`

`ThemeState` has:

```ts
{
  mode: "idle" | "recording" | "transcribing" | "error",
  audioLevel: number,
  spectrumBins: number[]
}
```

## Runtime behavior

- Theme scripts are loaded from disk at runtime.
- Builtin themes are bundled from `src/theme-engine/builtin/` to `src-tauri/themes/` with `bun run build:themes`.
- Existing manifest-v2 user themes are preserved on startup and are not overwritten by bundled copies.
- During bundled-theme seeding, existing user copies of bundled themes that are legacy/non-v2 are overwritten with bundled v2 copies; arbitrary custom invalid/non-v2 themes are skipped by the scanner.
- If a theme fails to load or mount, the overlay falls back to the builtin default theme.
- Without `overlay_width` / `overlay_height` (both required, each in 16..=4096), the overlay uses the standard **172×36** logical-pixel window.
