// src/theme-engine/builtin/drifting_contour/index.ts
/**
 * Living Cell — organic membrane visualization.
 *
 * The cell deforms with multi-octave FBM noise for a lumpy, biological
 * outline; amoeboid pseudopods protrude in slowly drifting directions that
 * intensify with voice activity; an iridescent hue shimmer travels around
 * the contour over a warm amber base (#d9a865, hue ≈ 34°).
 *
 * The membrane has a translucent filled cytoplasm and a brighter stroked
 * outline rendered with a closed Catmull-Rom spline for smoothness.
 *
 * During silence the cell breathes subtly (idle energy). During recording
 * it becomes visibly active with larger deformations and stronger shimmer.
 */
import { createCellRenderer } from "../../renderers/cell";
import type { ThemeApi, ThemeInstance } from "../../contract";
import { PARAMECIUM_BASE_HUE, PARAMECIUM_CELL_PARAMS } from "../_shared/paramecium";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const userParams = (api.params && typeof api.params === "object" ? api.params : {}) as Record<string, unknown>;

  const renderer = createCellRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: PARAMECIUM_BASE_HUE,
    params: {
      ...PARAMECIUM_CELL_PARAMS,
      enableAquarium: true,
      aquariumSeed: 17,
      aquariumAlpha: 0.68,
      aquariumActivityBoost: 1.0,
      diatomCount: 0,
      diatomAlpha: 0.16,
      diatomDriftSpeed: 0.35,
      euglenaCount: 1,
      euglenaSpeed: 0.20,
      euglenaSpeedActive: 1.5,
      euglenaScale: 2.8,
      euglenaGravitaxis: 0.2,
      euglenaPhototaxis: 0.6,
      euglenaRotDiffusion: 0.12,
      vorticellaCount: 0,
      ...userParams,
    },
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return {
    unmount() {
      unsubscribe();
      renderer.destroy();
    },
  };
}
