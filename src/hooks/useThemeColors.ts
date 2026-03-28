import { useEffect, useCallback, useRef, useState } from "react";
import { getConfig, getThemeColors, type ThemeColors } from "../lib/commands";
import { useThemeCssVars } from "./useThemeCssVars";

/**
 * Hook for synchronizing theme colors from native overlay to CSS variables.
 *
 * Loads the current theme from config, fetches its colors from backend,
 * and delegates CSS custom property application to useThemeCssVars.
 *
 * Listens to "config-saved" event to reload when theme changes.
 *
 * @returns useGradient - whether current theme uses gradient
 */
export function useThemeColors(): boolean {
  const loadedThemeRef = useRef<string | null>(null);
  const [useGradient, setUseGradient] = useState(true);
  const [currentColors, setCurrentColors] = useState<ThemeColors | null>(null);

  const isValidThemeColors = useCallback((colors: unknown): colors is ThemeColors => {
    if (!colors || typeof colors !== "object") {
      return false;
    }

    const candidate = colors as Partial<ThemeColors>;
    return [
      candidate.gradient_bottom,
      candidate.gradient_middle,
      candidate.gradient_top,
      candidate.recording,
      candidate.transcribing,
      candidate.idle,
    ].every((value) => typeof value === "string") && typeof candidate.use_gradient === "boolean";
  }, []);

  const loadTheme = useCallback(async () => {
    try {
      const config = await getConfig();
      const themeId = config.overlay.theme || "default";

      // Skip if already loaded this theme
      if (loadedThemeRef.current === themeId) {
        return;
      }

      const colors = await getThemeColors(themeId);
      if (!isValidThemeColors(colors)) {
        throw new Error(`Invalid theme colors payload for theme '${themeId}'`);
      }

      setCurrentColors(colors);
      setUseGradient(colors.use_gradient);
      loadedThemeRef.current = themeId;
    } catch (err) {
      console.warn("[useThemeColors] Failed to load theme colors:", err);
    }
  }, [isValidThemeColors]);

  // Load on mount
  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  // Reload when config is saved
  useEffect(() => {
    const handleConfigSaved = () => {
      // Reset loaded theme to force reload
      loadedThemeRef.current = null;
      loadTheme();
    };

    window.addEventListener("config-saved", handleConfigSaved);
    return () => {
      window.removeEventListener("config-saved", handleConfigSaved);
    };
  }, [loadTheme]);

  useThemeCssVars(currentColors);

  return useGradient;
}
