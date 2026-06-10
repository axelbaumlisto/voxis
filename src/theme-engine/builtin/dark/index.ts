// src/theme-engine/builtin/dark/index.ts
/**
 * Dark — purple spectrum bars.
 * Builtin theme.
 */
import { createBarsRenderer } from "../../renderers/bars";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const renderer = createBarsRenderer(container, {
    gradient: { bottom: "#7c4dff", middle: "#9c6dff", top: "#b388ff" },
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