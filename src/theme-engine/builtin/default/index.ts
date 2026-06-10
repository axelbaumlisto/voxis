// src/theme-engine/builtin/default/index.ts
/**
 * Default — blue spectrum bars.
 * Builtin theme.
 */
import { createBarsRenderer } from "../../renderers/bars";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const renderer = createBarsRenderer(container, {
    gradient: { bottom: "#1e88e5", middle: "#42a5f5", top: "#64b5f6" },
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