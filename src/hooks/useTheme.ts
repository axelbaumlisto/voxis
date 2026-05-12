/**
 * useTheme — fetch overlay theme data (colors + family + organic_ring) by id.
 *
 * Wraps `get_overlay_theme_data` Tauri command. Returns `null` while loading
 * and on errors (with console.warn). Refetches when `themeId` changes.
 *
 * SOLID / DRY / KISS:
 * - SRP: only loads a theme; rendering is the caller's job.
 * - DIP: depends on `@tauri-apps/api/core::invoke` indirection.
 * - DRY: shares the auto-generated `OverlayThemeData` type from bindings.
 * - KISS: useState + useEffect, no caching layer (themes are small, fetch fast).
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OverlayThemeData } from "../bindings";

export type { OverlayThemeData } from "../bindings";

export function useTheme(themeId: string): OverlayThemeData | null {
  const [data, setData] = useState<OverlayThemeData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);

    invoke<OverlayThemeData>("get_overlay_theme_data", { themeId })
      .then((theme) => {
        if (!cancelled) setData(theme);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn(`[useTheme] failed to load ${themeId}:`, err);
          setData(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [themeId]);

  return data;
}
