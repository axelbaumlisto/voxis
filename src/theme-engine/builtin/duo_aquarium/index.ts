// src/theme-engine/builtin/duo_aquarium/index.ts
/**
 * Duo Aquarium — two heroes in one tank.
 *
 * The paramecium hero (the deforming ciliated cell) shares the aquarium with a
 * single euglena that swims, runs-and-tumbles, and steers clear of the hero.
 * No sessile vorticella (vorticellaCount 0) — this is the 2-hero counterpart to
 * the 3-hero `drifting_contour`. Same paramecium params + warm amber palette.
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
      aquariumSeed: 2,
      aquariumAlpha: 0.68,
      aquariumActivityBoost: 1.0,
      diatomCount: 0,
      diatomAlpha: 0.16,
      diatomDriftSpeed: 0.35,
      euglenaCount: 1,
      euglenaSpeed: 0.29,
      euglenaSpeedActive: 0.62,
      euglenaScale: 2.7,
      euglenaFlagellumRateScale: 0.55,
      euglenaGravitaxis: 0.02,
      euglenaPhototaxis: 0,
      euglenaPhotoIntent: 0.8,
      euglenaMotorEnabled: true,
      euglenaLoiter: 0,
      euglenaWake: 0,
      euglenaRotDiffusion: 0,
      // 2-hero tank: no sessile vorticella
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
