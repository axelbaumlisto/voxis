/**
 * Radiolarian — a luminous marine microorganism with a glass silica skeleton.
 *
 * A radially symmetric "test": a stiff bumpy cyan shell, radial spikes that
 * extend with voice, and a concentric hexagonal-ish pore lattice. The whole
 * crown rotates slowly; during recording the spikes shoot out and the rim
 * glows. Built on the shared FBM/spline/form-memory primitives.
 */
import { createRadiolarianRenderer } from "../../renderers/radiolarian";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const userParams = (api.params && typeof api.params === "object"
    ? api.params : {}) as Record<string, unknown>;

  const renderer = createRadiolarianRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: 190, // luminous glass cyan
    params: {
      symmetry: 6,
      radiusFraction: 0.34,
      octaves: 2,
      lacunarity: 2.0,
      gain: 0.5,
      shellAmplitude: 0.12,
      timeScale: 0.25,
      idle: 0.12,
      levelGain: 0.8,
      spikeLength: 0.5,
      spikePulse: 0.45,
      poreRings: 2,
      poreRadius: 1.2,
      spinSpeed: 0.15,
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
