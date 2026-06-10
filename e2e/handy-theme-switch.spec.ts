/**
 * DELETED — Phase 5 switched overlay rendering from HandyPill/ClassicBars/
 * OrganicRing to ThemeHost.
 *
 * This spec targeted legacy rendering paths:
 *   - Pixel probes for icon_color on organic_ring/handy themes
 *   - DOM contract checks for ClassicBars (.classic-bar, data-family)
 *   - `?mode=recording` URL hook (dead)
 *
 * Visual theme correctness now lives in theme-engine tests:
 *   - src/theme-engine/builtin/__tests__/ (per-theme mount/unmount)
 *   - src/theme-engine/renderers/__tests__/ (per-renderer pixels)
 *   - src/__tests__/overlay.test.tsx (ThemeHost integration)
 *
 * See: docs/superpowers/plans/2026-06-10-user-themes-v1.md — Task 5.1
 */
