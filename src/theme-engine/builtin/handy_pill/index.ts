// src/theme-engine/builtin/handy_pill/index.ts
/**
 * Handy Pill — compact pill overlay with mic icon, 9 bars, cancel button.
 * Restores the cancel button + transcribing label UX from the legacy Handy theme.
 */
import { createPillRenderer } from "../../renderers/pill";
import type { ThemeApi, ThemeInstance } from "../../contract";

/* Legacy Handy pink palette from DEFAULT_HANDY_THEME (src/themes/handy.ts). */
const HANDY_PINK_PALETTE = {
  icon_color: "#FAA2CA",
  bar_color: "#ffe5ee",
  bar_glow: "#FAA2CA",
  shadow: "rgba(0, 0, 0, 0.45)",
  transcribing_text: "#ffffff",
  cancel_hover_bg: "rgba(250, 162, 202, 0.2)",
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const renderer = createPillRenderer(container, {
    palette: HANDY_PINK_PALETTE,
    onCancel: () => api.actions.cancel(),
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return {
    unmount() {
      unsubscribe();
      renderer.destroy();
    },
  };
}
