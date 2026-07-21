---
title: Living Cell Motion Notes
layout: default
---

# Living Cell Motion Notes

Several builtin themes use the living-cell renderer family under `src/theme-engine/renderers/cell/`.
The public entry point `src/theme-engine/renderers/cell.ts` re-exports the split implementation.

The renderer maps `ThemeState` to organic motion:

- `mode` controls idle, recording, transcribing, and error behavior.
- `audioLevel` drives growth, energy, color accents, and speech-reactive motion.
- `spectrumBins` provide frequency-domain input for visualization.

Important implementation areas:

- `renderers/cell/activity.ts` — energy and activity mapping.
- `renderers/cell/growth`, `startle`, and related helpers — speech response and decay.
- `renderers/cell/cilia.ts` — cilia geometry and beat behavior.
- `renderers/cell/aquarium/` — multi-organism scenes.
- `renderers/cell/renderer.ts` — main draw/update path.

Tests are split across focused files such as `cell-cilia.test.ts`, `cell-contour.test.ts`, `cell-interior.test.ts`, `cell-organelles.test.ts`, `cell-render-golden.test.ts`, and aquarium-specific tests.

For detailed formulas and historical design notes, see the source repository file [`docs/CELL_MATH.md`](https://github.com/axelbaumlisto/voice/blob/main/docs/CELL_MATH.md).
