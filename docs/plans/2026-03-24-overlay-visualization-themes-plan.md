# Overlay Visualization Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert all overlay visualizations into theme-defined presets, add the new organic ring family (`quiet-reed`, `living-reed`, `drifting-contour`), and let users install custom themes from theme folders containing `theme.json`.

**Architecture:** Extend the current overlay theme contract from color-only themes into full visualization presets with a `renderer family` plus shape/motion parameters. Keep the current bar visualizer as one family, add an `organic_ring` family for the new meditative contour styles, and load both built-in and disk themes through the same validated Rust pipeline. Frontend theme selection must become dynamic so custom themes show up automatically.

**Tech Stack:** Rust (Tauri v2, egui), TypeScript/React, Vitest, cargo test, serde JSON.

---

## Guardrails for all agents

- **SOLID:** keep schema, loading, validation, rendering, and UI wiring in separate units.
- **DRY:** one canonical theme contract; built-in and custom themes use the same structures.
- **KISS:** only support two renderer families in this iteration: `bars` and `organic_ring`.
- **TDD:** every task starts with tests, then minimal implementation, then verification.
- **Frequent commits:** commit after each task passes.

## File structure map

### Rust backend / overlay domain
- Modify: `src-tauri/src/overlay_native/theme.rs`
  - Expand `VisualizationTheme` into a full preset contract.
  - Add built-in organic themes.
- Modify: `src-tauri/src/overlay_native/theme_file.rs`
  - Define external folder-based `theme.json` schema.
- Modify: `src-tauri/src/overlay_native/theme_loader.rs`
  - Load theme folders, support compatibility for legacy flat JSON, validate presets.
- Modify: `src-tauri/src/overlay_native/renderer.rs`
  - Dispatch by renderer family.
  - Keep bar renderer intact.
  - Add organic ring renderer.
- Modify: `src-tauri/src/overlay_native/state.rs`
  - Ensure state exposes enough smoothed data for organic ring behavior.
- Modify: `src-tauri/src/commands/overlay.rs`
  - Return richer theme metadata, export built-ins as folders, reload/validate.

### Frontend / settings
- Modify: `src/lib/commands.ts`
  - Extend theme metadata types if needed.
- Modify: `src/lib/settingsRegistry.ts`
  - Replace hardcoded overlay theme options with a custom async-backed field.
- Create: `src/hooks/useVisualizationThemes.ts`
  - Fetch built-in + custom themes for settings UI.
- Create: `src/components/settings/ThemeSelect.tsx`
  - Async theme selector for overlay themes.
- Modify: `src/pages/SettingsPage.tsx`
  - Render `ThemeSelect` as a custom component.
- Modify: `src/hooks/useThemeColors.ts`
  - Keep CSS syncing safe for bar families; degrade gracefully for organic families.

### Tests
- Modify: `src-tauri/src/overlay_native/theme_file.rs` tests
- Modify: `src-tauri/src/overlay_native/theme_loader.rs` tests
- Modify: `src-tauri/src/overlay_native/theme.rs` tests
- Modify: `src-tauri/src/overlay_native/renderer.rs` tests
- Modify: `src-tauri/src/overlay_native/state.rs` tests
- Modify: `src-tauri/src/commands/overlay.rs` tests
- Modify: `src/lib/__tests__/commands.test.ts`
- Modify: `src/lib/__tests__/settingsRegistry.test.ts`
- Modify: `src/pages/__tests__/SettingsPage.test.tsx`
- Create if needed: `src/hooks/__tests__/useVisualizationThemes.test.ts`

### Docs / plan artifacts
- Created: `docs/plans/2026-03-24-overlay-visualization-themes-design.md`
- This file: `docs/plans/2026-03-24-overlay-visualization-themes-plan.md`

---

### Task 1: Define the visualization preset contract

**Files:**
- Modify: `src-tauri/src/overlay_native/theme.rs`
- Modify: `src-tauri/src/overlay_native/theme_file.rs`
- Test: `src-tauri/src/overlay_native/theme.rs`
- Test: `src-tauri/src/overlay_native/theme_file.rs`

- [ ] **Step 1: Write failing Rust tests for the new theme contract**

Add tests that expect:
- a renderer family enum with `bars` and `organic_ring`
- organic ring shape/motion structs on `VisualizationTheme`
- conversion to/from file format preserving renderer family
- built-in `quiet-reed`, `living-reed`, `drifting-contour` IDs

Run: `cd src-tauri && cargo test overlay_native::theme -- --nocapture`
Expected: FAIL for missing types/fields/built-ins.

- [ ] **Step 2: Add the minimal domain types in `theme.rs`**

Implement minimal focused types such as:
- `VisualizationFamily`
- `OrganicRingShape`
- `OrganicRingMotion`
- `ThemeBehavior` or equivalent per-state settings

Keep them data-only and serializable where needed.

- [ ] **Step 3: Extend `VisualizationTheme` minimally**

Add fields for:
- renderer family
- bar settings compatibility
- organic ring shape params
- organic ring motion params
- metadata needed by frontend theme listing

Do not refactor renderer yet.

- [ ] **Step 4: Extend `theme_file.rs` to match the new contract**

Define `ThemeFile` to support:
- metadata
- family
- color block
- optional `bars` block
- optional `organic_ring` block

Preserve defaults so older tests can be migrated cleanly.

- [ ] **Step 5: Re-run Rust theme tests**

Run: `cd src-tauri && cargo test overlay_native::theme overlay_native::theme_file -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/overlay_native/theme.rs src-tauri/src/overlay_native/theme_file.rs
git commit -m "feat: define overlay visualization preset contract"
```

---

### Task 2: Load theme folders and keep legacy compatibility

**Files:**
- Modify: `src-tauri/src/overlay_native/theme_loader.rs`
- Modify: `src-tauri/src/commands/overlay.rs`
- Test: `src-tauri/src/overlay_native/theme_loader.rs`
- Test: `src-tauri/src/commands/overlay.rs`

- [ ] **Step 1: Write failing tests for folder-based loading**

Add tests that expect:
- `themes/<id>/theme.json` loads successfully
- invalid folder themes surface validation errors/warnings
- legacy flat `*.json` themes still load or cleanly fall back
- `export_builtin_theme` creates a folder with `theme.json`, not a flat file

Run: `cd src-tauri && cargo test overlay_native::theme_loader commands::overlay -- --nocapture`
Expected: FAIL on current flat-file assumptions.

- [ ] **Step 2: Implement folder scanning in `theme_loader.rs`**

Add small focused helpers:
- `scan_theme_dirs()`
- `load_theme_dir(path)`
- `load_theme_json(path)`
- `load_legacy_theme_file(path)`

Keep one conversion path into `VisualizationTheme`.

- [ ] **Step 3: Add validation and fallback rules**

Validation should reject:
- unknown renderer family
- missing required family blocks
- invalid numeric ranges

Fallback behavior:
- invalid disk theme does not crash loading
- unknown selected theme falls back to built-in default

- [ ] **Step 4: Update export/reload commands**

Change `export_builtin_theme` to create `<themes_dir>/<theme-id>_custom/theme.json`.
Keep `get_visualization_themes`, `reload_visualization_themes`, and `validate_visualization_theme` aligned with the new loader.

- [ ] **Step 5: Re-run backend tests**

Run: `cd src-tauri && cargo test overlay_native::theme_loader commands::overlay -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/overlay_native/theme_loader.rs src-tauri/src/commands/overlay.rs
git commit -m "feat: load overlay themes from theme folders"
```

---

### Task 3: Keep bar themes working under the new contract

**Files:**
- Modify: `src-tauri/src/overlay_native/renderer.rs`
- Modify: `src-tauri/src/overlay_native/theme.rs`
- Test: `src-tauri/src/overlay_native/renderer.rs`
- Test: `src-tauri/src/overlay_native/theme.rs`

- [ ] **Step 1: Write failing tests for renderer-family dispatch**

Add tests that expect:
- `bars` family uses existing bar rendering path
- built-in bar themes advertise `bars` family
- transcribing/queued/idle bar-family behavior remains unchanged

Run: `cd src-tauri && cargo test overlay_native::renderer -- --nocapture`
Expected: FAIL for missing family dispatch.

- [ ] **Step 2: Extract the current bar implementation behind a clear function boundary**

Introduce a small dispatcher pattern such as:
- `draw_overlay(...)` -> match on `theme.family`
- `draw_bars_overlay(...)`
- `draw_organic_ring_overlay(...)` stubbed for now

Do not change bar visuals yet.

- [ ] **Step 3: Rebind built-in legacy themes to the new family**

Mark existing built-ins (`default`, `winamp_classic`, `dark`, `neon`, `monochrome`) as `bars` themes with current color/gradient behavior.

- [ ] **Step 4: Re-run renderer tests**

Run: `cd src-tauri && cargo test overlay_native::renderer overlay_native::theme -- --nocapture`
Expected: PASS with no visual-regression logic changes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/overlay_native/renderer.rs src-tauri/src/overlay_native/theme.rs
git commit -m "refactor: dispatch overlay rendering by theme family"
```

---

### Task 4: Implement the organic ring family with KISS geometry

**Files:**
- Modify: `src-tauri/src/overlay_native/renderer.rs`
- Modify: `src-tauri/src/overlay_native/state.rs`
- Modify: `src-tauri/src/overlay_native/theme.rs`
- Test: `src-tauri/src/overlay_native/renderer.rs`
- Test: `src-tauri/src/overlay_native/state.rs`

- [ ] **Step 1: Write failing tests for organic ring behavior**

Add tests that cover:
- organic ring themes route to the organic renderer
- idle uses low-amplitude breathing
- recording uses multiple soft local oscillation zones
- transcribing settles to a calmer contour
- shape remains readable as a circle with an open gap

Run: `cd src-tauri && cargo test overlay_native::renderer overlay_native::state -- --nocapture`
Expected: FAIL.

- [ ] **Step 2: Add minimal contour helpers in `renderer.rs`**

Implement focused helpers, e.g.:
- `build_ring_points(...)`
- `apply_gap(...)`
- `apply_local_oscillations(...)`
- `stroke_width_at_angle(...)`
- `draw_organic_ring_path(...)`

KISS rule: stay with a simple sampled contour and egui painter path/segments. No GPU rewrite. No advanced mesh system unless required.

- [ ] **Step 3: Use existing audio data with smoothing, not a new signal pipeline**

In `state.rs`, add only the minimum state support needed for the new family:
- smoothed speech energy derived from existing levels/bins
- helper(s) for calm interpolation between frames

Do not introduce a second audio-analysis subsystem.

- [ ] **Step 4: Add the three built-in organic themes**

Implement in `theme.rs`:
- `builtin_quiet_reed()`
- `builtin_living_reed()`
- `builtin_drifting_contour()`

Use the approved defaults:
- monochrome palette
- open contour
- reed-like thin taper
- `living_reed` as balanced default for the family

- [ ] **Step 5: Re-run targeted backend tests**

Run: `cd src-tauri && cargo test overlay_native::renderer overlay_native::state overlay_native::theme -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/overlay_native/renderer.rs src-tauri/src/overlay_native/state.rs src-tauri/src/overlay_native/theme.rs
git commit -m "feat: add organic ring overlay themes"
```

---

### Task 5: Make theme selection dynamic in the frontend

**Files:**
- Create: `src/hooks/useVisualizationThemes.ts`
- Create: `src/components/settings/ThemeSelect.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/lib/settingsRegistry.ts`
- Modify: `src/lib/commands.ts`
- Test: `src/pages/__tests__/SettingsPage.test.tsx`
- Test: `src/lib/__tests__/commands.test.ts`
- Test: `src/lib/__tests__/settingsRegistry.test.ts`
- Test: `src/hooks/__tests__/useVisualizationThemes.test.ts`

- [ ] **Step 1: Write failing frontend tests**

Add tests that expect:
- settings page loads themes from backend instead of constants
- custom themes appear in the Theme selector
- missing backend theme list shows a safe fallback state
- command types cover any new metadata fields

Run: `bunx vitest run src/pages/__tests__/SettingsPage.test.tsx src/lib/__tests__/commands.test.ts src/lib/__tests__/settingsRegistry.test.ts`
Expected: FAIL.

- [ ] **Step 2: Add a dedicated theme-loading hook**

Create `useVisualizationThemes.ts` to fetch `getVisualizationThemes()` and map results into select options.
Keep the hook small and focused.

- [ ] **Step 3: Replace hardcoded overlay theme options with a custom field**

In `settingsRegistry.ts`, change `overlay.theme` from static `select` options to a `custom` component entry such as `theme-select`.

- [ ] **Step 4: Implement `ThemeSelect.tsx` and wire it in `SettingsPage.tsx`**

Render:
- async theme list
- current selected value
- graceful loading/error fallback

Do not add preview/editor UI yet.

- [ ] **Step 5: Re-run frontend tests**

Run: `bunx vitest run src/pages/__tests__/SettingsPage.test.tsx src/lib/__tests__/commands.test.ts src/lib/__tests__/settingsRegistry.test.ts src/hooks/__tests__/useVisualizationThemes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useVisualizationThemes.ts src/components/settings/ThemeSelect.tsx src/pages/SettingsPage.tsx src/lib/settingsRegistry.ts src/lib/commands.ts
git commit -m "feat: load overlay themes dynamically in settings"
```

---

### Task 6: Keep frontend CSS sync compatible and non-fragile

**Files:**
- Modify: `src/hooks/useThemeColors.ts`
- Modify: `src/lib/commands.ts`
- Test: `src/lib/__tests__/commands.test.ts`
- Test: `src/pages/__tests__/SettingsPage.test.tsx` (if theme change behavior is covered there)

- [ ] **Step 1: Write failing tests for organic-theme compatibility**

Expect:
- `getThemeColors()` remains safe for organic themes
- `useThemeColors()` does not break if a theme is not gradient-based or not bar-oriented
- existing layout still renders without crashing when an organic theme is selected

Run: `bunx vitest run src/lib/__tests__/commands.test.ts src/pages/__tests__/SettingsPage.test.tsx`
Expected: FAIL or require new assertions.

- [ ] **Step 2: Implement the minimal compatibility layer**

Keep `ThemeColors` as a frontend-friendly projection.
For organic themes, return safe monochrome/fallback CSS values instead of inventing a second frontend renderer.

- [ ] **Step 3: Re-run frontend compatibility tests**

Run: `bunx vitest run src/lib/__tests__/commands.test.ts src/pages/__tests__/SettingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useThemeColors.ts src/lib/commands.ts
git commit -m "fix: keep frontend theme color sync compatible with organic themes"
```

---

### Task 7: Ship sample themes, docs, and verification

**Files:**
- Modify: `src-tauri/src/overlay_native/theme_loader.rs` (sample/scaffold logic if needed)
- Modify: `src-tauri/src/commands/overlay.rs`
- Modify: `docs/plans/2026-03-24-overlay-visualization-themes-design.md` only if implementation realities force updates
- Optionally create sample theme folders in the app themes directory scaffold path logic

- [ ] **Step 1: Write failing tests for scaffold/export behavior**

Add assertions that exported built-ins create usable custom theme folders with `theme.json`.

Run: `cd src-tauri && cargo test overlay_native::theme_loader commands::overlay -- --nocapture`
Expected: FAIL if scaffold/export is incomplete.

- [ ] **Step 2: Implement sample export/scaffold polish**

Ensure users can start from built-ins by exporting:
- a bar theme
- an organic theme

Folder contents must be minimal and readable.

- [ ] **Step 3: Run backend and frontend verification**

Run:
```bash
cd src-tauri && cargo test
cd .. && bun run test:run
```
Expected: PASS.

- [ ] **Step 4: Run lint / targeted smoke check**

Run:
```bash
bun run lint
```
Expected: PASS.

- [ ] **Step 5: Manual visual smoke check (required)**

Run:
```bash
bun run tauri dev
```
Verify manually:
- built-in bar themes still work
- `quiet_reed`, `living_reed`, and `drifting_contour` each render distinctly in overlay
- organic themes stay visually readable as open circular contours
- `recording` feels more expressive than `transcribing`, and `transcribing` visibly settles/calm downs
- Theme selector lists custom folder themes
- exporting a built-in creates a theme folder with `theme.json`
- selecting an invalid/missing custom theme falls back safely

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: finalize overlay visualization theme system"
```

---

## Notes for agent execution

- Prefer **small diffs**. Do not rewrite the overlay system wholesale.
- If `renderer.rs` starts getting too large, split helpers into a new focused module such as `src-tauri/src/overlay_native/organic_ring.rs`, but only if needed to keep SRP/KISS.
- Do not introduce a new audio-analysis subsystem. Reuse existing levels/bins/state.
- Do not add a browser/WebGL renderer for overlay.
- Do not add an in-app theme editor in this plan.
- If legacy theme compatibility becomes expensive, keep support minimal but deterministic and document the canonical folder format.

## Verification checklist before claiming completion

- [ ] All existing bar themes still render correctly.
- [ ] `quiet_reed`, `living_reed`, and `drifting_contour` were visually verified in the running app.
- [ ] Organic themes are selectable exactly like built-in bar themes.
- [ ] Organic themes remain readable as open circular contours, with calmer `transcribing` behavior than `recording`.
- [ ] Custom theme folders load without app restart after reload.
- [ ] Invalid custom themes do not crash overlay loading.
- [ ] Settings UI no longer depends on `OVERLAY_THEME_OPTIONS`.
- [ ] Backend tests pass.
- [ ] Frontend tests pass.
- [ ] Lint passes.

## Suggested first execution mode

Use **Subagent-Driven** execution first because the work decomposes cleanly into:
1. schema/loader
2. renderer
3. frontend settings
4. verification
