// src/theme-engine/builtin/living_reed/index.ts
/**
 * Living Reed — balanced motion, warm green palette.
 * The original reference organic profile.
 * Values copied verbatim from legacy theme.json / Rust builtin_living_reed().
 */
import { createRingRenderer } from "../../renderers/ring";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const renderer = createRingRenderer(container, {
    shape: {
      gap_degrees: 42.0,
      base_thickness: 7.2,
      taper: 0.7,
      roundness: 0.9,
      active_zones: 3,
    },
    motion: {
      idle_breathing: 0.1,
      speech_responsiveness: 0.92,
      drift: 0.38,
      settle_speed: 0.6,
    },
    color: "#7cc287",
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