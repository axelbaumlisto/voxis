// src/theme-engine/builtin/winamp_classic/index.ts
/**
 * Winamp Classic — green→yellow→red spectrum bars.
 * Builtin theme, also serves as the reference example for theme authors.
 */
import { createBarsRenderer } from "../../renderers/bars";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const renderer = createBarsRenderer(container, {
    gradient: { bottom: "#299400", middle: "#d6b521", top: "#ef3110" },
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
