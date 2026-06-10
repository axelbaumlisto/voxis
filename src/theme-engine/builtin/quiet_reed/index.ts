// src/theme-engine/builtin/quiet_reed/index.ts
/**
 * Quiet Reed — minimal motion, cool blue palette.
 * Ambient always-on indicator. Wide gap, thin stroke, low speech responsiveness.
 * Values copied verbatim from legacy theme.json / Rust builtin_quiet_reed().
 */
import { createRingRenderer } from "../../renderers/ring";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const renderer = createRingRenderer(container, {
    shape: {
      gap_degrees: 60.0,
      base_thickness: 5.0,
      taper: 0.4,
      roundness: 0.95,
      active_zones: 2,
    },
    motion: {
      idle_breathing: 0.05,
      speech_responsiveness: 0.6,
      drift: 0.15,
      settle_speed: 0.8,
    },
    color: "#7a9fbd",
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