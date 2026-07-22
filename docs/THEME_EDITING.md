# Editing Themes — Practical Workflow

> **TL;DR — you do NOT need to rebuild Voxis to change a theme.**
> Themes are plain `theme.js` + `theme.json` files loaded from disk at runtime.
> Edit source → `bun run build:themes` → copy the two files into the user themes
> dir → restart (or re-select the theme). No `cargo`, no `tauri build`.

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

The overlay loads `theme.js` from the filesystem and mounts it. So shipping a
theme change = updating those files. That's it.

`theme.js` is executable JavaScript trusted by the app webview. Do not install
or copy themes from untrusted sources without reviewing the code first.

---

## Where theme files live (TWO locations)

There are two copies, and the distinction matters:

1. **User themes dir** — *this is what actually loads at runtime*:
   ```
   Linux:   ~/.config/voxis/themes/<id>/
   macOS:   ~/Library/Application Support/voxis/themes/<id>/
   Windows: %APPDATA%/voxis/themes/<id>/
   ```
2. **Bundle dir** — seeds the user dir on first run / fresh installs. Common examples:
   ```
   macOS app bundle: /Applications/Voxis.app/Contents/Resources/themes/<id>/
   local release:    src-tauri/target/release/themes/<id>/
   source bundle:    src-tauri/themes/<id>/
   ```

### ⚠️ The seeding gotcha

At startup the app runs `seed_from_bundle` (see
`src-tauri/src/theme_engine/loader.rs`). Its rule:

- user dir missing → copy the whole bundled theme in;
- bundled theme's existing user copy is **legacy/non-v2** → overwrite with the bundled v2;
- user theme is already **v2** → **SKIP** (preserve user edits).

This applies while seeding known bundled themes. Arbitrary invalid/non-v2 custom
folders are skipped by the theme scanner rather than migrated.

**Consequence:** once a v2 theme exists in the user dir, copying new files into
the `.app` bundle alone does **nothing** — the bundle copy is ignored. You must
write the updated files into the **user themes dir** (and ideally the bundle too,
for clean reinstalls).

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

## Deploying a theme change to the running app (no rebuild)

```bash
# 1. Rebuild the bundled JS from source
bun run build:themes

# 2. Copy into the user theme directory (this is what the running app loads)
THEME_DIR="$HOME/.config/voxis/themes"        # Linux
# THEME_DIR="$HOME/Library/Application Support/voxis/themes"  # macOS
for t in drifting_contour living_reed quiet_reed radiolarian; do
  mkdir -p "$THEME_DIR/$t"
  cp src-tauri/themes/$t/theme.{js,json} "$THEME_DIR/$t/"
done

# 3. Restart the app, reload themes, or re-select the theme in Settings
pkill -f 'Voxis|/voice$' || true
```

When do you actually need `tauri build`? Only when you change **Rust** code
(orchestrator, overlay window backends, commands) — never for pure theme visuals.

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
- [ ] Copy `theme.{js,json}` into the **user** themes dir (+ bundle).
- [ ] Restart / re-select the theme.
