import { describe, expect, it } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { seedAquarium } from "../layer";
import { aquariumParamsView } from "../params";
import { noise2D } from "../seeds";
import type { AquariumFrame } from "../types";

function frame(overrides: Partial<AquariumFrame> = {}): AquariumFrame {
  return {
    t: 1.25,
    dt: 1 / 60,
    width: 172,
    height: 36,
    mode: "idle",
    activity: 0.2,
    audioLevel: 0.1,
    startle: 0,
    baseHue: 50,
    ...overrides,
  };
}

describe("aquariumParamsView", () => {
  it("builds euglena steer + medium overrides only when taxis/jitter params are set", () => {
    const none = aquariumParamsView({ ...CELL_DEFAULTS, enableAquarium: true, euglenaCount: 1 });
    expect(none.euglena.steer).toBeUndefined(); // 0 weights => module defaults
    expect(none.medium).toBeUndefined();
    const on = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaGravitaxis: 0.2,
      euglenaPhototaxis: 0.6,
      euglenaSeparation: 0.7,
      euglenaRotDiffusion: 0.12,
    });
    expect(on.euglena.steer).toEqual({ gravitaxis: 0.2, phototaxis: 0.6, separation: 0.7 });
    expect(on.medium).toEqual({ rotDiffusion: 0.12 });
  });

  it("derives an internal grouped view from flat cell params", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 42,
      aquariumAlpha: 0.25,
      aquariumActivityBoost: 0.7,
      diatomCount: 3,
      diatomAlpha: 0.2,
      diatomDriftSpeed: 0.8,
      euglenaCount: 2,
      euglenaSpeed: 1.1,
      euglenaSpeedActive: 2.4,
      euglenaScale: 0.9,
      euglenaSeparation: 0.4,
      vorticellaCount: 1,
      vorticellaContractRate: 0.6,
      vorticellaScale: 1.2,
    };

    expect(aquariumParamsView(params)).toEqual({
      enabled: true,
      seed: 42,
      alpha: 0.25,
      activityBoost: 0.7,
      diatoms: { count: 3, alpha: 0.2, driftSpeed: 0.8 },
      euglena: { count: 2, speed: 1.1, speedActive: 2.4, scale: 0.9, hueOffset: 42, steer: { gravitaxis: 0, phototaxis: 0, separation: 0.4 } },
      vorticella: { count: 1, contractRate: 0.6, scale: 1.2, alongFrac: 0.5 },
      didinium: { count: 0, speed: 1.0, speedActive: 2.0, scale: 1.0, hueOffset: 0 },
    });
  });

  it("clamps counts and non-negative scalars for internal use", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      diatomCount: -2,
      euglenaCount: 2.9,
      vorticellaCount: Number.POSITIVE_INFINITY,
      aquariumAlpha: -1,
    });

    expect(view.enabled).toBe(false);
    expect(view.alpha).toBe(0);
    expect(view.diatoms.count).toBe(0);
    expect(view.euglena.count).toBe(2);
    expect(view.vorticella.count).toBe(0);
  });
});

describe("deterministic aquarium noise", () => {
  it("noise2D is deterministic, smooth, finite, and in [0, 1)", () => {
    const a = noise2D(123, 4.25, -7.75);
    const b = noise2D(123, 4.25, -7.75);
    const c = noise2D(123, 4.26, -7.75);

    expect(a).toBe(b);
    expect(c).not.toBe(a);
    for (const value of [
      a,
      c,
      noise2D(0, 0, 0),
      noise2D(0xffffffff, -100.5, 2048.125),
      noise2D(42, Number.NaN, Number.POSITIVE_INFINITY),
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("seedAquarium", () => {
  it("is deterministic for the same frame and flat params", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 123,
      diatomCount: 3,
      euglenaCount: 2,
      vorticellaCount: 1,
    };

    expect(seedAquarium(frame(), params)).toEqual(seedAquarium(frame(), params));
  });

  it("changes deterministic placement when the seed changes", () => {
    const base: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      diatomCount: 2,
    };

    expect(seedAquarium(frame(), { ...base, aquariumSeed: 1 }).diatoms).not.toEqual(
      seedAquarium(frame(), { ...base, aquariumSeed: 2 }).diatoms,
    );
  });

  it("returns empty species arrays when counts are zero", () => {
    expect(seedAquarium(frame(), { ...CELL_DEFAULTS, enableAquarium: true })).toEqual({
      seed: CELL_DEFAULTS.aquariumSeed,
      diatoms: [],
      euglena: [],
      vorticella: [],
      didinium: [],
    });
  });

  it("constructs finite seed points in a tiny 172×36 overlay", () => {
    const state = seedAquarium(frame({ width: 172, height: 36 }), {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 7,
      diatomCount: 4,
      euglenaCount: 4,
      vorticellaCount: 4,
    });

    for (const point of [...state.diatoms, ...state.euglena, ...state.vorticella]) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(Number.isFinite(point.phase)).toBe(true);
      expect(Number.isFinite(point.size)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(172);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(36);
    }
  });
});
