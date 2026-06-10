// src/theme-engine/builtin/neon/index.ts
/**
 * Neon — cyan/magenta/yellow spectrum bars.
 * Builtin theme.
 */
import { createBarsRenderer } from "../../renderers/bars";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const renderer = createBarsRenderer(container, {
    gradient: { bottom: "#00ffff", middle: "#ff00ff", top: "#ffff00" },
    barCount: 16,
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return {
    unmount() {
      unsubscribe();
      renderer.destroy();
    },
  };
}