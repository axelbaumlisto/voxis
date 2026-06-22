// src/theme-engine/builtin/vorticella_bloom/index.ts
/**
 * Vorticella Bloom — a single Vorticella as the sole organism.
 *
 * Hides the paramecium hero (`enableHero: false`) and promotes one large
 * Vorticella from the aquarium layer: an inverted-bell zooid on a contractile
 * stalk anchored to the floor, its oral ciliary wreath beating, the stalk
 * spasmoneme coiling on the periodic fast contraction.
 */
import { createCellRenderer } from "../../renderers/cell";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const userParams = (api.params && typeof api.params === "object" ? api.params : {}) as Record<string, unknown>;

  const renderer = createCellRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: 50,
    params: {
      enableHero: false,
      enableAquarium: true,
      aquariumSeed: 3,
      aquariumAlpha: 0.92,
      aquariumActivityBoost: 0.6,
      diatomCount: 0,
      euglenaCount: 0,
      vorticellaCount: 1,
      vorticellaContractRate: 1.2,        // metabolic contraction cadence (not audio-coupled)
      vorticellaScale: 3.6,        // fills the 240x240 overlay (crown near the top, no clip) without being oversized
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
