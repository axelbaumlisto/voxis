/**
 * DELETED — Phase 7 eliminated the `get_theme_colors` Tauri command.
 *
 * Spectrum CSS variables (--spectrum-bottom, --spectrum-middle,
 * --spectrum-top, --spectrum-recording, --spectrum-transcribing,
 * --spectrum-idle) are now static defaults in src/styles/index.css
 * and are decoupled from overlay themes. Theme-driven spectrum
 * styling is handled by the theme-engine (manifest v2 code modules),
 * not by a per-theme color map served from Rust.
 *
 * Theme visual correctness tests now live in:
 *   - src/theme-engine/builtin/__tests__/ (per-theme mount/unmount)
 *   - src/theme-engine/renderers/__tests__/ (per-renderer pixels)
 *   - src/__tests__/overlay.test.tsx (ThemeHost integration)
 *
 * See: docs/superpowers/plans/2026-06-10-user-themes-v1.md — Task 7
 */
