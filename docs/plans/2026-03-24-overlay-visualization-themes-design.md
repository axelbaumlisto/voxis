# Overlay Visualization Themes Design

**Date:** 2026-03-24
**Status:** Approved in brainstorming

## Goal

Turn every overlay visualization in TALRI into a first-class theme, including both existing bar/spectrum visualizations and new organic ring-based styles, while allowing users to add their own themes from theme folders on disk.

## User-approved direction

For the new organic overlay family:
- not a direct Arrival copy
- calm / meditative overall mood
- expressive reaction to speech
- open contour rather than a perfectly closed ring
- monochrome visual language
- line behavior closer to grass / reed than ink splash or heavy branch
- movement should come from several soft local oscillations rather than one traveling hotspot or full-shape pulsing
- silhouette should still read as a circle, but can loosen into a living contour while recording
- transcribing state should become calmer and more collected than recording

## Product requirements

1. **All overlay visualizations must be themes**
   - Existing bar themes remain available.
   - New organic styles are added as themes, not hardcoded special modes.
   - Users choose a single theme, not a separate visualization mode plus color mode.

2. **Users can create custom themes**
   - No in-app theme editor in the first version.
   - Custom themes live in a theme folder.
   - Each theme folder contains at minimum `theme.json`.
   - The format must be declarative and safe: data only, no user code.

3. **Built-in and custom themes share one contract**
   - Same renderer family model.
   - Same state behavior model.
   - Same validation path.

## Non-goals

- No in-app visual theme editor yet.
- No arbitrary scripting or plugin execution in themes.
- No attempt to port browser/WebGL shader stacks into the current native overlay.
- No removal of existing bar-based themes in this iteration.

## Current system summary

Current overlay theming is primarily color-driven:
- `VisualizationTheme` stores colors and gradient settings.
- `renderer.rs` renders bar-based states directly.
- External themes are loaded from flat JSON files in the themes directory.
- Frontend settings currently use a static theme list.

This is insufficient because the desired new styles differ in geometry and motion, not just color.

## Proposed architecture

### 1. Theme = visualization preset

A theme becomes a combination of:
- metadata
- color palette
- renderer family
- shape parameters
- motion parameters
- per-state behavior

This makes themes the single source of truth for both appearance and behavior.

### 2. Renderer families

A theme declares its renderer family. Initial families:
- `bars` — existing FFT/bar visualizer family
- `organic_ring` — new calm expressive contour family

Built-in themes can then be expressed as:
- `default-bars`
- `winamp-classic`
- `dark-bars`
- `neon-bars`
- `monochrome-bars`
- `quiet-reed`
- `living-reed`
- `drifting-contour`

The exact IDs can be finalized during implementation, but the core rule is: every visual style is selected as a theme.

### 3. Organic ring family

The new family renders an open circular contour with soft local motion.

#### Core characteristics
- monochrome stroke
- open ring with configurable gap
- thin, reed-like taper
- several local oscillation zones during recording
- calm idle breathing
- more settled transcribing behavior
- queued state remains readable, likely via badge or subtle accent

#### Motion model
- **Idle:** almost still; faint breathing only
- **Recording:** several soft local bends and thickness changes, driven by audio activity
- **Transcribing:** contour gathers and settles; less amplitude, slower movement
- **Queued:** quiet contour plus count indicator/accent

#### Data source use
- use current audio level and/or FFT bins already available in overlay state
- prefer smoothed, low-frequency motion over literal bar translation
- avoid nervous or jittery movement

## Theme folder format

### Directory structure

```text
<themes-dir>/
  quiet-reed/
    theme.json
  living-reed/
    theme.json
  drifting-contour/
    theme.json
  my-custom-theme/
    theme.json
```

Future-compatible additions may include:
- `preview.png`
- textures or auxiliary data files
- notes/readme files

### `theme.json` responsibilities

`theme.json` should include:
- `id`, `name`, `description`
- renderer family
- color definitions
- shape parameters
- motion parameters
- optional per-state overrides

The format should remain declarative and validated by Rust.

## Backward compatibility

Backward compatibility should be preserved in two ways:

1. Existing built-in bar themes remain supported.
2. Existing flat JSON theme files should either:
   - continue loading through compatibility handling, or
   - be migrated automatically/exported into folder format with a clear fallback path.

The implementation should prefer one canonical on-disk format going forward: **theme folders with `theme.json`**.

## Frontend implications

The settings UI must stop relying on a hardcoded theme list.
Instead it should:
- fetch available themes from the backend
- render built-in and custom themes together
- remain resilient if a theme disappears from disk

If a selected theme becomes invalid or missing:
- backend falls back to a safe default theme
- validation surfaces warnings/errors to the user

## Validation requirements

Theme validation should check at minimum:
- required fields present
- supported renderer family
- valid colors
- numeric ranges for motion/shape params
- family-specific required parameters

Validation should return both:
- hard errors (cannot render)
- warnings (renders, but values are suspicious)

## Testing strategy

### Rust
- theme file parsing for folder-based themes
- compatibility handling for legacy themes
- builtin theme registration
- renderer-family dispatch
- organic ring parameter validation
- fallback behavior when theme is invalid/missing

### Frontend
- settings page loads dynamic theme options
- selected custom theme appears in UI
- missing theme fallback behavior
- CSS sync still works for bar themes where relevant

## Recommended built-in organic themes

### Quiet Reed
- most restrained
- ring remains highly circular
- low-amplitude motion
- ideal for minimal users

### Living Reed
- recommended default organic theme
- several soft moving zones
- balanced calm + responsiveness

### Drifting Contour
- loosest and most artistic
- strongest contour drift
- still circular enough to read as a HUD mark

## Risks

1. **Theme schema creep**
   - Mitigation: start with only `bars` and `organic_ring` families.

2. **Overlay motion becoming noisy**
   - Mitigation: strong smoothing, limited oscillation zones, state-specific amplitude caps.

3. **Frontend/backend mismatch**
   - Mitigation: keep one shared source of truth from backend theme metadata.

4. **Legacy theme breakage**
   - Mitigation: compatibility loader tests and safe fallback to default built-in theme.

## Recommended implementation order

1. Extend theme contract and loader for visualization presets.
2. Keep existing bar renderer working under the new contract.
3. Add the organic ring renderer family.
4. Add built-in organic themes.
5. Update commands and frontend to load themes dynamically.
6. Add sample export/folder scaffolding and validation coverage.
