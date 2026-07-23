---
title: Theme Editing Workflow
layout: default
---

# Theme Editing Workflow

Theme changes do not require a full Tauri rebuild. Themes are `theme.json` + `theme.js` files loaded from disk.

> **Security:** `theme.js` is executable JavaScript trusted by the app webview. Do not install or copy themes from untrusted sources without reviewing the code first.

## Source and bundled output

Builtin theme source lives under:

```text
src/theme-engine/builtin/<id>/
```

Build bundled theme files with:

```bash
bun run build:themes
```

The build writes bundled output to:

```text
src-tauri/themes/<id>/theme.js
src-tauri/themes/<id>/theme.json
```

## User theme directory

The running app loads user themes from the platform config directory:

- Linux: `~/.config/voxis/themes/<id>/`
- macOS: `~/Library/Application Support/voxis/themes/<id>/`
- Windows: `%APPDATA%/voxis/themes/<id>/`

At startup the app seeds bundled themes into the user directory. If a user theme already has `manifest_version: 2`, it is preserved. For bundled theme ids, an existing legacy/non-v2 user copy is overwritten with the bundled v2 copy; arbitrary custom invalid/non-v2 folders are skipped by the scanner.

## Deploy a builtin theme change locally

```bash
bun run build:themes

THEME_DIR="$HOME/.config/voxis/themes"        # Linux
# THEME_DIR="$HOME/Library/Application Support/voxis/themes"  # macOS

for t in drifting_contour living_reed quiet_reed radiolarian; do
  mkdir -p "$THEME_DIR/$t"
  cp src-tauri/themes/$t/theme.{js,json} "$THEME_DIR/$t/"
done
```

Then reload/reselect the theme in Settings or restart the app.

## Visual harness

Use the browser harness for fast visual iteration:

```bash
bun run harness
# open http://localhost:5173/harness.html
```

The harness uses the same `ThemeHost` contract as the overlay and can drive mode, audio level, scenarios, canvas size, scale, background, and params JSON.

## Overlay size

If a theme needs a custom window size, set both dimensions in `theme.json`:

```json
{ "overlay_width": 160, "overlay_height": 160 }
```

The native overlay validates sizes (both dimensions required, each in 16..=4096) and resizes the OS window. If no custom size is declared, the standard overlay size is **172×36** logical pixels.
