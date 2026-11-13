# Editing Themes — Practical Workflow

> **TL;DR — you do NOT need to rebuild Voxis to change a theme.**
> Themes are plain `theme.js` + `theme.json` files. Edit source →
> `bun run build:themes` → **Reload + Preview** in Settings. A dev build reads
> the builtin themes from `src-tauri/themes` on disk, so no `cargo`, no
> `tauri build`.

This document is the hands-on companion to [`THEMES.md`](./THEMES.md) (which is
the theme *author* reference — manifest, contract, ThemeApi). Read this one when
you need to **modify an existing builtin theme and see it live**.

---

## Mental model

Rust knows **nothing** about theme visuals. A theme is just two files:

| File         | Purpose                                                            |
|--------------|-------------------------------------------------------------------|
| `theme.json` | Manifest v2 — id, name, `api_version`, `entry`, optional `params` and `overlay_width/height`. |
| `theme.js`   | Self-contained ESM exporting `mount(container, themeApi)`.        |

The overlay asks the theme loader for `theme.js` and mounts it — builtins from
the binary (a dev build: from `src-tauri/themes` on disk), user themes from the
config folder. So shipping a theme change = updating those files. That's it.

`theme.js` is executable JavaScript trusted by the app webview. Do not install
or copy themes from untrusted sources without reviewing the code first.

---

## Where theme files live

One rule: **a builtin theme lives in the app; the user themes dir holds only
your themes.**

### Builtins — inside the binary

Builtins are bundled from `src/theme-engine/builtin/` into `src-tauri/themes/`
by `bun run build:themes`, then embedded into the executable at compile time
(`src-tauri/src/theme_engine/source.rs`, `include_dir!`). They **update and
disappear together with the app**, and need no folder next to the binary — the
bare `voxis-linux-x64-gui` / `voxis-windows-x64-gui.exe` builds have them too.

The one exception is a debug build (`bun run tauri dev`): there the builtins are
read from `src-tauri/themes/` **on disk**, which is what makes the loop below
work without recompiling. A release build (`tauri build`, installers) has them
baked in, and the app bundle ships no themes folder.

### User themes dir — yours

```
Linux:   ~/.config/voxis/themes/<id>/
macOS:   ~/Library/Application Support/voxis/themes/<id>/
Windows: %APPDATA%/voxis/themes/<id>/
```

Everything in it is yours: exported copies (`<id>_custom`, written by the
`export_builtin_theme` command — it works for any builtin, no copy has to exist
beforehand; further exports become `<id>_custom_1`, `<id>_custom_2`, …) and
hand-made folders. The loader layers `[builtin, user]`, so a user folder with a
**builtin's id** **shadows** it — deliberately: your edit wins until you delete
the folder, as long as it is a valid theme (a broken folder is skipped by the
scanner and the builtin shows).

### Old copies retired by an upgrade

Earlier versions copied every builtin into the user themes dir at startup and
never updated a v2 copy again (legacy non-v2 copies used to be overwritten).
Now, at startup, a copy whose content still matches a builtin version that once
shipped (whitespace-insensitive digest against
`src-tauri/known-builtin-digests.json`) is **moved** — rename, never deleted —
to a sibling folder:

```
Linux:   ~/.config/voxis/themes-retired/<id>/     (collision: <id>.1, …)
macOS:   ~/Library/Application Support/voxis/themes-retired/<id>/
Windows: %APPDATA%/voxis/themes-retired/<id>/
```

An **edited** copy stays and keeps shadowing the builtin, as long as it is a
valid theme (a broken folder is skipped by the scanner and the builtin shows).
Caveat: "untouched" ignores whitespace *everywhere*, including inside strings
(`'a b'` → `'ab'`), so an edit that only moves whitespace around is retired as
well — look in `themes-retired/` and move the folder back if that was yours. A
folder that cannot be renamed (cross-device, locked) stays and is retried on
the next start.

---

## The source of truth

Edit themes here, never the bundled output directly:

```
src/theme-engine/builtin/<id>/
├── index.ts        # mount() entry — imports a shared renderer
└── manifest.json   # → becomes theme.json
```

Shared renderers (not importable by external themes, but builtins use them):

```
src/theme-engine/renderers/{bars,pill,ring,cell,radiolarian}.ts
```

`bun run build:themes` bundles `index.ts` → self-contained
`src-tauri/themes/<id>/theme.js` and copies `manifest.json` → `theme.json`.

---

## Fast iteration: the Visual Harness (no app at all)

To develop visuals with **zero rebuild and instant reload**, use the harness —
it mounts the EXACT production `ThemeHost` + the EXACT builtin modules in a
plain browser tab.

```bash
bun run harness          # = vite dev server
# open http://localhost:5173/harness.html
```

UI controls: theme picker, mode (idle/recording/transcribing/error), audio-level
slider, scenario players, scale, background, live `params` JSON editor.

### URL presets (deep-link / automation)

`harness.html` reads query params so you can drive it without clicks — and so
Playwright can screenshot it:

| Param    | Meaning                              | Example              |
|----------|--------------------------------------|----------------------|
| `theme`  | theme id                             | `drifting_contour`   |
| `mode`   | idle / recording / transcribing / error | `recording`      |
| `level`  | audio level 0..1                     | `0.9`                |
| `w`,`h`  | preview canvas size | `160`,`160`     |
| `scale`  | preview zoom                         | `3`                  |
| `params` | URL-encoded JSON for `api.params`    | `%7B...%7D`          |

Example:
```
http://localhost:5173/harness.html?theme=drifting_contour&mode=recording&level=0.9&w=160&h=160&scale=3
```

> Organic themes (`cell`/`ring`/`radiolarian` renderers) fix `canvas.width/height`
> at mount and usually need a larger/square canvas. Set `w`/`h` in the harness,
> and set matching `overlay_width` / `overlay_height` in the manifest for the
> real overlay.

---

## E2E screenshot proof

`e2e/cell-cilia-curve.spec.ts` drives the harness in **recording** mode at
160×160, screenshots the canvas into `e2e/screenshots/cilia/`, and asserts
geometry directly from the canvas pixel buffer.

```bash
bunx playwright test e2e/cell-cilia-curve.spec.ts --reporter=list
```

This is the no-Tauri way to visually verify a theme change.

---

## Seeing a builtin edit in the running app (no rebuild)

```bash
# 1. Rebuild the bundled JS from source (writes src-tauri/themes/<id>/)
bun run build:themes

# 2. Pick it up in the running app: "Reload + Preview" in Settings → Overlay
#    theme — or restart it
pkill -f 'Voxis|/voice$' || true
```

This needs a **debug build** (`bun run tauri dev`): only there are the builtins
read from `src-tauri/themes` instead of the copy embedded in the binary. A
released build ships a changed builtin as a new app version — a file copy
cannot update it. `src-tauri/.taurignore` keeps `themes/` and
`known-builtin-digests.json` out of the dev watcher, so `bun run build:themes`
rewriting them does not rebuild and restart the app. That skip is configured in
`.taurignore` and has not been verified end-to-end yet: confirm it the first
time you run the loop under `tauri dev` (a rebuild/restart means it is not
taking effect).

To change what a *released* app shows without rebuilding, use the user themes
dir: an exported `<id>_custom`, or a valid folder carrying a builtin's id (it
shadows the builtin). Editing files inside `/Applications/Voxis.app/` does
nothing — the bundle no longer carries a themes folder.

When do you actually need `tauri build`? When you change **Rust** code
(orchestrator, overlay window backends, commands), or want the shipped builtin
theme itself to change — never for iterating on visuals.

---

## Overlay window sizing

If a theme needs a non-pill window size, declare it in the manifest:

```json
{ "overlay_width": 160, "overlay_height": 160 }
```

The Rust side (`OverlayManager::theme_overlay_size`) reads this and resizes the
webview overlay OS window (validated to 16..=4096). Absent → falls back to the
standard overlay window size. `ThemeHost` remounts the canvas whenever
width/height change, so the renderer rebuilds at the new size (it does **not**
CSS-stretch the old canvas).

---

## Checklist for changing a builtin theme

- [ ] Edit `src/theme-engine/builtin/<id>/index.ts` (and/or the shared renderer).
- [ ] If size matters, set `overlay_width/height` in `manifest.json`.
- [ ] Add/adjust a unit test (renderer is pure → TDD it; see `renderers/__tests__/`).
- [ ] `bun run build:themes`.
- [ ] Eyeball in the harness (`bun run harness`, or the Playwright screenshot spec).
- [ ] Reload + Preview in Settings (a debug build reads `src-tauri/themes`).
- [ ] Commit the regenerated `src-tauri/themes/` (and
      `src-tauri/known-builtin-digests.json`) — the release build embeds it.
