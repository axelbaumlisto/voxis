/**
 * Radiolarian — a luminous marine microorganism with a glass silica skeleton.
 *
 * A radially symmetric "test": a stiff bumpy cyan shell, radial spikes that
 * extend with voice and biological growth, and a concentric hexagonal-ish pore
 * lattice. The whole crown rotates slowly; during recording the spikes shoot
 * out, the organism swells, and the rim glows. Per-spike organic jitter keeps
 * the crown alive and non-mechanical. Built on the shared FBM/spline/form-memory
 * primitives.
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
      radiusFraction: 0.28,
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
      // per-spike organic jitter
      angleJitter: 0.10,
      lengthJitter: 0.22,
      jitterSpeed: 0.4,
      // biological growth
      growthAttack: 0.06,
      growthRelease: 0.012,
      growthSpikeBoost: 0.5,
      growthShellSwell: 0.18,
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