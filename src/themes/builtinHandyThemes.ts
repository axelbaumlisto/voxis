/**
 * Compile-time import of all repository theme.json files.
 *
 * Vite's `import.meta.glob` walks `../../src-tauri/themes/*\/theme.json`
 * at build time and inlines the parsed JSON. This lets the frontend
 * resolve themes even when no Tauri runtime is available (Chrome /
 * Playwright synthetic tests, Vite preview), without duplicating the
 * data.
 *
 * SOLID/DRY:
 *  - DRY: themes/<id>/theme.json is still the single source of truth.
 *  - SRP: this module only loads + indexes built-in themes; resolution
 *    logic lives in `resolveHandyTheme()`.
 *  - DIP: callers depend on `getBuiltinHandyTheme(id)`, not on glob
 *    internals.
 *
 * Path: themes live one directory up from `src/` (the React source
 *       tree), under `src-tauri/themes/<id>/theme.json`.
 */
import { resolveHandyTheme, type HandyPillTheme } from "./handy";

// Eager import all themes — small payload (~1 KB each * 7 = ~7 KB).
const RAW = import.meta.glob<{ default: unknown }>(
  "../../src-tauri/themes/*/theme.json",
  { eager: true },
);

/** Map of `<id> → resolved HandyPillTheme`. */
const BUILTIN: Map<string, HandyPillTheme> = (() => {
  const out = new Map<string, HandyPillTheme>();
  for (const [path, mod] of Object.entries(RAW)) {
    // Extract the directory name: ".../themes/living_reed/theme.json"
    const match = path.match(/themes\/([^/]+)\/theme\.json$/);
    if (!match) continue;
    const id = match[1];
    const raw = (mod as { default: unknown }).default;
    out.set(id, resolveHandyTheme(raw));
  }
  return out;
})();

/** Sorted list of available builtin theme ids. */
export function listBuiltinHandyThemeIds(): string[] {
  return Array.from(BUILTIN.keys()).sort();
}

/**
 * Returns the builtin theme by id, or `null` if no such id exists.
 * Used as the synthetic fallback when no Tauri runtime is present.
 */
export function getBuiltinHandyTheme(id: string): HandyPillTheme | null {
  return BUILTIN.get(id) ?? null;
}
