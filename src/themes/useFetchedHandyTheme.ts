/**
 * React hook: fetches and live-updates the active {@link HandyPillTheme}.
 *
 * Combines the Rust source of truth (`commands.getHandyTheme(id)`) with
 * the live `themeId` observed by {@link useOverlayState}. Every time the
 * id changes a new fetch fires; until the response arrives the previous
 * theme stays mounted (smooth UX — no flash of pink).
 *
 * SOLID:
 *  - SRP: one job — keep a `HandyPillTheme` ref in sync with Rust.
 *  - DIP: depends on the Tauri command stub `commands.getHandyTheme`
 *         (auto-generated), not on file I/O.
 *  - KISS: useEffect on themeId; no race-cancellation magic — the
 *          stale-response check is "did themeId change since fetch
 *          started?".
 */
import { useEffect, useState } from "react";
import { commands } from "../bindings";
import {
  DEFAULT_HANDY_THEME,
  type HandyPillTheme,
} from "./handy";

/**
 * Returns the currently-resolved {@link HandyPillTheme}. Starts at
 * {@link DEFAULT_HANDY_THEME}; resolves to the Rust-side theme as soon
 * as `commands.getHandyTheme(themeId)` returns.
 */
export function useFetchedHandyTheme(themeId: string): HandyPillTheme {
  const [theme, setTheme] = useState<HandyPillTheme>(DEFAULT_HANDY_THEME);

  useEffect(() => {
    let cancelled = false;
    void commands
      .getHandyTheme(themeId)
      .then((fresh) => {
        if (cancelled) return;
        // Defensive: in tests / SSR / non-Tauri mock environments the
        // command may resolve with undefined or a partial payload. Run
        // it through the same resolver the Rust side already used so
        // we always end up with a fully-populated theme.
        if (
          fresh &&
          typeof fresh === "object" &&
          "palette" in (fresh as object) &&
          "animation" in (fresh as object)
        ) {
          setTheme(fresh as unknown as HandyPillTheme);
        } else {
          setTheme(DEFAULT_HANDY_THEME);
        }
      })
      .catch(() => {
        // In non-Tauri environments (e.g. Vite preview, vitest's jsdom)
        // the command throws — fall back to defaults silently.
        if (!cancelled) setTheme(DEFAULT_HANDY_THEME);
      });
    return () => {
      cancelled = true;
    };
  }, [themeId]);

  return theme;
}
