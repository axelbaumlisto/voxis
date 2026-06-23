// src/theme-engine/builtin/all_aquarium/index.ts
/**
 * All Aquarium — every main organism in one micro-aquarium.
 *
 * Paramecium hero + Euglena swimmer + Vorticella stalked zooid + Didinium predator.
 * Diatoms stay off here to keep the overlay readable; this theme is about the four
 * named hero organisms sharing the same 320×160 pond.
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
      radiusFraction: 0.24,
      enableAquarium: true,
      aquariumSeed: 23,
      aquariumAlpha: 0.72,
      aquariumActivityBoost: 0.85,
      diatomCount: 0,

      // free swimmer: Euglena
      euglenaCount: 1,
      euglenaSpeed: 0.18,
      euglenaSpeedActive: 1.15,
      euglenaScale: 2.45,
      euglenaGravitaxis: 0.15,
      euglenaPhototaxis: 0.45,
      euglenaRotDiffusion: 0.08,

      // sessile stalked organism: Vorticella
      vorticellaCount: 1,
      vorticellaAlongFrac: 0.14,
      vorticellaScale: 2.1,
      vorticellaContractRate: 1.0,

      // predator swimmer: Didinium
      didiniumCount: 1,
      didiniumSpeed: 0.65,
      didiniumSpeedActive: 1.15,
      didiniumScale: 2.1,

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
