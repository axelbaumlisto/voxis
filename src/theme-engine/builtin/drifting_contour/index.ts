// src/theme-engine/builtin/drifting_contour/index.ts
/**
 * Drifting Contour — expressive motion, warm amber palette.
 * Narrow gap, thick stroke, many active zones, high drift — most visually active.
 * Values copied verbatim from legacy theme.json / Rust builtin_drifting_contour().
 */
import { createRingRenderer } from "../../renderers/ring";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const renderer = createRingRenderer(container, {
    shape: {
      gap_degrees: 28.0,
      base_thickness: 9.0,
      taper: 0.9,
      roundness: 0.7,
      active_zones: 5,
    },
    motion: {
      idle_breathing: 0.18,
      speech_responsiveness: 1.1,
      drift: 0.55,
      settle_speed: 0.4,
    },
    color: "#d9a865",
    width: api.size.width,
    height: api.size.height,
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return {
    unmount() {
      unsubscribe();
      renderer.destroy();
    },
  };
}