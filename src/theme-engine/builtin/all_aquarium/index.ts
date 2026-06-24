// src/theme-engine/builtin/all_aquarium/index.ts
/**
 * All Aquarium — every main organism in one micro-aquarium.
 *
 * Paramecium hero + Euglena swimmer + Vorticella stalked zooid + Didinium predator.
 * Diatoms stay off here to keep the overlay readable; this theme is about the four
 * named hero organisms sharing the same 340×170 pond.
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
      // Shrink the paramecium hero so all four organisms are visible at once.
      radiusFraction: 0.19,
      enableAquarium: true,
      aquariumSeed: 13,
      aquariumAlpha: 0.70,
      aquariumActivityBoost: 0.65,
      diatomCount: 0,

      // free swimmer: Euglena
      euglenaCount: 1,
      euglenaSpeed: 0.18,
      euglenaSpeedActive: 0.34,
      euglenaScale: 2.2,
      euglenaGravitaxis: 0.03,
      euglenaPhototaxis: 0.08,
      euglenaLoiter: 0,
      euglenaWake: 0.3,
      euglenaRotDiffusion: 0,

      // sessile stalked organism: Vorticella
      vorticellaCount: 1,
      vorticellaAlongFrac: 0.30,
      vorticellaScale: 1.12,
      vorticellaContractRate: 1.0,

      // predator swimmer: Didinium
      didiniumCount: 1,
      didiniumSpeed: 1.55,
      didiniumSpeedActive: 2.2,
      didiniumScale: 1.60,

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
