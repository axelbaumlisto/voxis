import { useEffect } from "react";
import type { ThemeColors } from "../lib/commands";

/**
 * Hook that applies theme colors as CSS custom properties on document.documentElement.
 *
 * Separated from useThemeColors to follow Single Responsibility Principle:
 * useThemeColors handles fetching/validation, useThemeCssVars handles DOM updates.
 *
 * @param colors - Theme colors to apply, or null to skip
 */
export function useThemeCssVars(colors: ThemeColors | null): void {
  useEffect(() => {
    if (!colors) return;
    const root = document.documentElement;
    root.style.setProperty("--spectrum-bottom", colors.gradient_bottom);
    root.style.setProperty("--spectrum-middle", colors.gradient_middle);
    root.style.setProperty("--spectrum-top", colors.gradient_top);
    root.style.setProperty("--spectrum-recording", colors.recording);
    root.style.setProperty("--spectrum-transcribing", colors.transcribing);
    root.style.setProperty("--spectrum-idle", colors.idle);
  }, [colors]);
}
