// src/theme-engine/builtin/didinium_drift/index.ts
/**
 * Didinium Drift — a single Didinium nasutum as the sole organism.
 *
 * Hides the paramecium hero (`enableHero: false`) and promotes one Didinium
 * from the aquarium layer: a stout barrel-bodied ciliate predator with a
 * conical apical snout, two bright transverse ciliary girdles (pectinelles)
 * that shimmer as it rotates on its long axis, a horseshoe macronucleus and a
 * terminal contractile vacuole. It swims erratically (fast cruise with abrupt
 * stop-turns) and does a fixed-side "avoiding reaction" at the walls.
 *
 * v1: SOLO (no prey). The predator↔Vorticella duck is a later phase; Didinium
 * already emits a `motile` field contribution so that seam is ready.
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
      aquariumSeed: 5,
      aquariumAlpha: 0.92,
      aquariumActivityBoost: 0.6,
      diatomCount: 0,
      euglenaCount: 0,
      vorticellaCount: 0,
      didiniumCount: 1,
      didiniumSpeed: 4.5,         // body-lengths/sec cruise (real ~11 BL/s; high so it reads as the fast hunter)
      didiniumSpeedActive: 8.0,   // fast darts while recording/active
      didiniumScale: 3.2,
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
