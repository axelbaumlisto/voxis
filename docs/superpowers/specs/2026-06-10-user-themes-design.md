# User Themes v1 — Design

**Date:** 2026-06-10
**Status:** Approved (brainstorm with owner)

## Goal

Users can write their own overlay themes as code (JS), with full creative freedom.
Builtin themes are converted to the same format and double as documentation/examples.
Business logic of themes is fully separated from the app: Rust knows nothing about
theme content; the overlay webview is a thin host.

## Decisions made

| Question | Decision |
|---|---|
| Theme capability level | **C — full freedom**: theme is user code, not just parameters |
| Native egui overlay | Already removed (Phase 7). Remaining `overlay_native/` window backends (NSPanel/Webview) **stay** — they host the web overlay |
| Sandbox | **None** — users are trusted. Error boundary protects overlay from broken themes, not from malicious ones |
| Theme API style | **C — explicit contract**: `mount(container, themeApi)` + `apiVersion`, not raw iframe/postMessage |
| Builtin themes | All 8 converted to the new format (vanilla JS, no React) |

## Theme format (apiVersion 1)

A theme is a directory in the themes dir (`<config>/themes/<id>/`):

```
my-theme/
├── theme.json      # manifest
└── theme.js        # single-file ES module (no imports — must be self-contained)
```

**Manifest (`theme.json`, manifest_version 2):**

```json
{
  "manifest_version": 2,
  "id": "my-theme",
  "name": "My Theme",
  "description": "…",
  "api_version": 1,
  "entry": "theme.js",
  "params": { "any": "JSON the theme wants" }
}
```

**Contract (`theme.js`):**

```js
export function mount(container, themeApi) {
  // container: HTMLElement inside the overlay window (172×36 by default)
  // themeApi.apiVersion: 1
  // themeApi.params: the manifest "params" object
  // themeApi.size: { width, height }
  // themeApi.onState(cb): subscribe to { mode, audioLevel, spectrumBins };
  //                       returns unsubscribe fn
  // themeApi.actions.cancel(): cancel current recording
  return { unmount() { /* cleanup */ } };
}
```

`mode ∈ "idle" | "recording" | "transcribing" | "error"`.
`spectrumBins`: 32 floats in [0,1]. `audioLevel`: float in [0,1].

## Architecture

### Separation of concerns

- **Rust = engine only.** Scans themes dir, parses manifests, serves theme script
  content (`read_theme_script` command), emits state events
  (`overlay://state`, `overlay://audio-level`, `overlay://spectrum-bins`,
  `overlay://theme`). Zero knowledge of colors/shapes/animation.
  `overlay_native/theme.rs` (1006 lines of theme semantics) shrinks to a
  manifest schema + loader (~200 lines).
- **TS host = thin adapter.** `overlay.tsx` renders `<ThemeHost>`: subscribes to
  state via existing `useOverlayState`, loads active theme module (Blob URL +
  dynamic `import()`), calls `mount`, pushes states, swaps themes on
  `overlay://theme`. Error boundary → fallback to statically-imported default
  theme.
- **Themes = all visual logic.** Bars/ring/pill rendering, palettes, easing —
  lives in theme code only.

### Builtin themes (DRY without runtime imports)

Runtime theme.js must be a single self-contained file. To avoid 8× copy-paste,
builtin sources live in TypeScript with shared renderers and are **bundled at
build time**:

```
src/theme-engine/
├── contract.ts          # ThemeApi/ThemeModule/ThemeState types (apiVersion 1)
├── loader.ts            # blob-import + module validation
├── ThemeHost.tsx        # React host + error boundary
├── renderers/
│   ├── bars.ts          # ported from ClassicBars + useBarPeaks (vanilla, RAF)
│   ├── ring.ts          # ported from OrganicRing + ringGeometry
│   └── pill.ts          # ported from HandyPill + HandyBars + CSS
└── builtin/
    ├── default/index.ts        (bars renderer + blue params)
    ├── dark/ neon/ monochrome/ winamp_classic/        (bars)
    ├── quiet_reed/ living_reed/ drifting_contour/     (ring)
    └── …each: ~10-line index.ts + manifest.json
```

`scripts/build-themes.ts` (bun build) bundles each `builtin/<id>/index.ts` into
self-contained `src-tauri/themes/<id>/theme.js` + copies manifest. Bundled
output is seeded into the user themes dir on startup (existing seeding
mechanism, extended to copy `theme.js`). Users copy any builtin dir as a
starting point.

### What gets deleted (after integration)

- Rust: `overlay/themes/handy.rs` (511), `overlay/themes_handy_tests.rs` (276),
  theme semantics in `overlay_native/theme.rs` (~800 of 1006), commands
  `get_handy_theme`, `get_theme_colors`, `get_overlay_theme_data`; broken
  examples.
- TS: `src/themes/handy.ts` (504), `builtinHandyThemes.ts`,
  `HandyThemeProvider.tsx`, `useFetchedHandyTheme.ts`,
  `src/components/overlay/*` (moved into theme-engine renderers), old render
  path in `overlay.tsx`.

Net effect: theme truth exists in exactly one place (theme dirs), Rust↔TS
mirror eliminated.

### Kept as-is

- `OverlayBackend` trait + NSPanel/Webview/Noop window backends
- Event flow orchestrator → overlay (push-based, already clean)
- `get_visualization_themes` command name (reimplemented over new loader) —
  settings ThemeSelect keeps working
- `preview_visualization_theme`, `validate_visualization_theme` (revalidated
  against manifest v2)

## Error handling

- Theme script fails to load/parse → log + fallback to builtin default (static import)
- Theme `mount` throws → same fallback
- Theme runtime errors → window `error` listener logs; overlay keeps last good frame
- Manifest invalid → theme excluded from list, `validate_visualization_theme`
  reports errors

## Testing

- **Contract/loader/host:** vitest + jsdom — fake theme modules, mount/unmount
  lifecycle, state push, error fallback, apiVersion rejection
- **Renderers:** vitest — DOM structure after mount, reaction to state pushes,
  unmount cleans up RAF/listeners
- **Builtin themes:** each TS source mounted in jsdom + smoke test that built
  `theme.js` output parses and exports `mount`
- **Rust:** loader unit tests (tempfile), manifest validation, seeding,
  contract test "every bundled theme dir has valid manifest + entry file"
- **Manual:** macOS smoke (the only platform tested so far)

## Companion cleanups (same plan)

1. Delete broken `src-tauri/examples/*` referencing removed `LlmProcessor`;
   add `cargo build --examples` to the test script
2. Shrink `config_ini.rs` to a read-only migration parser
3. Typed `AppError` (thiserror + specta) for overlay/theme commands
