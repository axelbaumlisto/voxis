import { afterEach, describe, expect, it, vi } from "vitest";
import { CELL_DEFAULTS } from "../cell/defaults";
import { aquariumParamsView } from "../cell/aquarium/params";
import { seedAquarium, updateAquarium, drawAquariumBackground } from "../cell/aquarium/layer";
import type { AquariumFrame, AquariumLayerState } from "../cell/aquarium/types";
import type { CellParams } from "../cell/types";

function installNoopCanvasContext(): void {
  const gradient = { addColorStop: vi.fn() };
  const ctx = new Proxy({}, {
    get(_target, prop) {
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => gradient;
      if (prop === "measureText") return () => ({ width: 0 });
      return () => undefined;
    },
    set() {
      return true;
    },
  }) as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
}

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
      vorticellaCount: 1,
      vorticellaContractRate: 0.6,
      vorticellaContractRateActive: 1.8,
      vorticellaScale: 1.2,
    };

    expect(aquariumParamsView(params)).toEqual({
      enabled: true,
      seed: 42,
      alpha: 0.25,
      activityBoost: 0.7,
      diatoms: { count: 3, alpha: 0.2, driftSpeed: 0.8 },
      euglena: { count: 2, speed: 1.1, speedActive: 2.4, scale: 0.9 },
      vorticella: { count: 1, contractRate: 0.6, contractRateActive: 1.8, scale: 1.2 },
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

describe("aquarium layer Phase 1 no-ops", () => {
  it("updateAquarium returns the same state object", () => {
    const state = seedAquarium(frame(), {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      diatomCount: 1,
    });

    expect(updateAquarium(state, frame({ dt: 0.05 }), CELL_DEFAULTS)).toBe(state);
  });

  it("drawAquariumBackground is a no-op", () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const state: AquariumLayerState = { seed: 1, diatoms: [], euglena: [], vorticella: [] };

    drawAquariumBackground(ctx, state, frame(), CELL_DEFAULTS);

    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
  });
});

describe("createCellRenderer aquarium gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not allocate, update, or draw the aquarium layer when disabled", async () => {
    installNoopCanvasContext();
    const seed = vi.fn();
    const update = vi.fn();
    const draw = vi.fn();
    vi.doMock("../cell/aquarium/layer", () => ({
      seedAquarium: seed,
      updateAquarium: update,
      drawAquariumBackground: draw,
    }));
    const rafCalls: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { createCellRenderer } = await import("../cell/renderer");
    const renderer = createCellRenderer(document.createElement("div"), {
      width: 172,
      height: 36,
      params: { enableAquarium: false, diatomCount: 5, euglenaCount: 5, vorticellaCount: 5 },
    });
    rafCalls.shift()?.();
    renderer.destroy();

    expect(seed).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it("builds a finite aquarium frame when enabled", async () => {
    installNoopCanvasContext();
    const state: AquariumLayerState = { seed: 5, diatoms: [], euglena: [], vorticella: [] };
    const seed = vi.fn(() => state);
    const update = vi.fn((aquarium: AquariumLayerState) => aquarium);
    const draw = vi.fn();
    vi.doMock("../cell/aquarium/layer", () => ({
      seedAquarium: seed,
      updateAquarium: update,
      drawAquariumBackground: draw,
    }));
    const rafCalls: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { createCellRenderer } = await import("../cell/renderer");
    const renderer = createCellRenderer(document.createElement("div"), {
      width: 172,
      height: 36,
      baseHue: 50,
      params: { enableAquarium: true },
    });
    rafCalls.shift()?.();
    renderer.destroy();

    const builtFrame = seed.mock.calls[0]?.[0] as AquariumFrame;
    expect(builtFrame).toMatchObject({ width: 172, height: 36, mode: "idle", baseHue: 50 });
    for (const value of [
      builtFrame.t,
      builtFrame.dt,
      builtFrame.activity,
      builtFrame.audioLevel,
      builtFrame.startle,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(update).toHaveBeenCalledWith(state, builtFrame, expect.objectContaining({ enableAquarium: true }));
    expect(draw).toHaveBeenCalledWith(expect.anything(), state, builtFrame, expect.objectContaining({ enableAquarium: true }));
  });
});
