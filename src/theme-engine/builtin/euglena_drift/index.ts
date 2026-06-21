// src/theme-engine/builtin/euglena_drift/index.ts
/**
 * Euglena Drift — a single Euglena as the sole organism.
 *
 * Unlike `drifting_contour` (a Paramecium hero with an optional micro-aquarium
 * companion), this theme hides the paramecium hero entirely (`enableHero:
 * false`) and promotes one large Euglena from the aquarium layer to centre
 * stage: a spindle body packed with green chloroplasts, a red eyespot, and a
 * whipping anterior flagellum. It swims near-horizontally across the wide
 * overlay so the elongated cell stays readable in the short 36px strip.
 *
 * All paramecium machinery (cilia, oral groove, contractile vacuoles, cyclosis)
 * is gated off; only the euglena draws. The renderer's own default gates stay
 * OFF (golden-frozen) — the euglena lives entirely in this theme config.
 */
import { createCellRenderer } from "../../renderers/cell";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const userParams = (api.params && typeof api.params === "object" ? api.params : {}) as Record<string, unknown>;

  const renderer = createCellRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: 50, // euglena hue = baseHue + 42 ≈ 92° (chlorophyll green)
    params: {
      // No paramecium — the euglena is the whole organism.
      enableHero: false,
      // Single large euglena, prominent, roaming the full aquarium width.
      enableAquarium: true,
      aquariumSeed: 17,
      aquariumAlpha: 0.92,
      aquariumActivityBoost: 0.6,  // calmer active:idle speed contrast (~1.8:1)
      diatomCount: 0,
      euglenaCount: 1,
      euglenaSpeed: 0.16,        // body-lengths/sec (idle) — calm glide
      euglenaSpeedActive: 0.34,  // body-lengths/sec (recording)
      euglenaScale: 7.5,
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
