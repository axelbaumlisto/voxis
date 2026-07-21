/**
 * DELETED — Phase 5 switched overlay rendering from HandyPill to ThemeHost.
 *
 * This spec targeted the old HandyPill DOM (`.recording-overlay`, `.bar`,
 * `?mode=recording`, `?theme=handy`). The `?mode=` URL hook is dead; the
 * DOM structure is now governed by theme modules, not the shell.
 *
 * Pill transparency verification now belongs in theme-engine renderer tests
 * (src/theme-engine/renderers/__tests__/) and is covered by ThemeHost
 * integration tests (src/__tests__/overlay.test.tsx).
 *
 * See: docs/THEMES.md and docs/THEME_EDITING.md
 */
