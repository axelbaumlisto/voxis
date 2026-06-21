import { afterEach, describe, expect, it, vi } from "vitest";
import { CELL_DEFAULTS } from "../cell/defaults";
import { aquariumParamsView } from "../cell/aquarium/params";
import { seedAquarium, updateAquarium, drawAquariumBackground } from "../cell/aquarium/layer";
import { diatomGeometry } from "../cell/aquarium/diatoms";
import { euglenaPose } from "../cell/aquarium/euglena";
import { vorticellaGeometry } from "../cell/aquarium/vorticella";
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

function installCountingCanvasContext(): { readonly ops: string[] } {
  const ops: string[] = [];
  const gradient = { addColorStop: () => ops.push("addColorStop") };
  const ctx = new Proxy({}, {
    get(_target, prop) {
      if (prop === "canvas") return document.createElement("canvas");
      if (prop === "createRadialGradient" || prop === "createLinearGradient") {
        return () => {
          ops.push(String(prop));
          return gradient;
        };
      }
      if (prop === "measureText") return () => ({ width: 0 });
      return (..._args: unknown[]) => ops.push(String(prop));
    },
    set(_target, prop) {
      ops.push(String(prop));
      return true;
    },
  }) as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  return { ops };
}

async function renderAquariumOpCount(enableAquarium: boolean): Promise<number> {
  vi.resetModules();
  vi.doUnmock("../cell/aquarium/layer");
  const { ops } = installCountingCanvasContext();
  const rafCalls: Array<() => void> = [];
  let now = 1000;
  vi.stubGlobal("performance", { ["now"]: () => now });
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
    params: {
      enableAquarium,
      aquariumSeed: 17,
      aquariumAlpha: 0.28,
      diatomCount: 6,
      diatomAlpha: 0.35,
      euglenaCount: 0,
      vorticellaCount: 0,
    },
  });
  now += 1000 / 60;
  rafCalls.shift()?.();
  renderer.destroy();
  return ops.length;
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

describe("aquarium biology geometry contracts", () => {
  it("vorticellaGeometry clamps contraction and moves the bell toward the anchor", () => {
    const extended = vorticellaGeometry(-1, { anchorX: 10, anchorY: 4, restLength: 12, directionAngle: 0 });
    const contracted = vorticellaGeometry(2, { anchorX: 10, anchorY: 4, restLength: 12, directionAngle: 0 });

    expect(extended.contractPhase).toBe(0);
    expect(contracted.contractPhase).toBe(1);
    expect(contracted.stalkLength).toBeLessThan(extended.stalkLength);
    expect(contracted.coilTurns).toBeGreaterThan(extended.coilTurns);
    expect(contracted.bellCenter.x).toBeLessThan(extended.bellCenter.x);
    expect(contracted.bellCenter.y).toBeCloseTo(extended.bellCenter.y, 6);
    expect(contracted.stalkPath.length).toBeGreaterThanOrEqual(2);
    for (const point of contracted.stalkPath) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it("euglenaPose keeps a tapered spindle with anterior eyespot near the flagellum end", () => {
    const pose = euglenaPose(0.1, 0.25, { length: 9, baseWidth: 2.4, heading: 0, flagellumLength: 4 });
    const centerSample = pose.bodySamples.find((sample) => sample.u === 0);
    const anteriorTip = pose.bodySamples.find((sample) => sample.u === 1);
    const posteriorTip = pose.bodySamples.find((sample) => sample.u === -1);

    expect(centerSample?.halfWidth).toBeGreaterThan(0.8);
    expect(anteriorTip?.halfWidth).toBeCloseTo(0, 6);
    expect(posteriorTip?.halfWidth).toBeCloseTo(0, 6);
    expect(pose.eyespot.x).toBeGreaterThan(pose.center.x);
    expect(pose.flagellumEnd.x).toBeGreaterThan(pose.eyespot.x);
    expect(pose.flagellumEnd.x - pose.eyespot.x).toBeLessThan(5);
  });

  it("euglenaPose roll changes apparent width and stripe phase without moving the anterior anchor", () => {
    const a = euglenaPose(0, 0.2, { centerX: 2, centerY: 3, length: 8, baseWidth: 2, heading: 0 });
    const b = euglenaPose(0.25, 0.2, { centerX: 2, centerY: 3, length: 8, baseWidth: 2, heading: 0 });

    expect(b.apparentWidth).toBeLessThan(a.apparentWidth);
    expect(b.stripePhase).not.toBe(a.stripePhase);
    expect(b.eyespot.x).toBeCloseTo(a.eyespot.x, 6);
    expect(b.flagellumEnd.x).toBeCloseTo(a.flagellumEnd.x, 6);
  });

  it("diatomGeometry keeps navicula bilateral symmetry with finite scale-aware striae", () => {
    const small = diatomGeometry("navicula", { length: 4, width: 1.4 });
    const large = diatomGeometry("navicula", { length: 8, width: 2.8 });

    expect(small.striae.length).toBeGreaterThan(0);
    expect(large.striae.length).toBeGreaterThan(small.striae.length);
    for (const stria of large.striae) {
      expect(Number.isFinite(stria.from.x)).toBe(true);
      expect(Number.isFinite(stria.from.y)).toBe(true);
      expect(Number.isFinite(stria.to.x)).toBe(true);
      expect(Number.isFinite(stria.to.y)).toBe(true);
      const mirrored = large.striae.find((candidate) =>
        Math.abs(candidate.from.x + stria.from.x) < 1e-6 && Math.abs(candidate.to.x + stria.to.x) < 1e-6,
      );
      expect(mirrored).toBeTruthy();
    }
  });

  it("diatomGeometry keeps oval centric symmetry with finite scale-aware radial striae", () => {
    const tiny = diatomGeometry("ovalCentric", { length: 3, width: 2 });
    const larger = diatomGeometry("ovalCentric", { length: 8, width: 5 });

    expect(tiny.striae.length).toBeGreaterThanOrEqual(4);
    expect(larger.striae.length).toBeGreaterThan(tiny.striae.length);
    for (const point of larger.outline) {
      const opposite = larger.outline.find((candidate) =>
        Math.abs(candidate.x + point.x) < 1e-6 && Math.abs(candidate.y + point.y) < 1e-6,
      );
      expect(opposite).toBeTruthy();
    }
    for (const stria of larger.striae) {
      expect(Number.isFinite(stria.from.x)).toBe(true);
      expect(Number.isFinite(stria.from.y)).toBe(true);
      expect(Number.isFinite(stria.to.x)).toBe(true);
      expect(Number.isFinite(stria.to.y)).toBe(true);
    }
  });
});

describe("aquarium layer Phase 2 diatoms", () => {
  it("updateAquarium drifts diatoms deterministically, finitely, and keeps them in bounds", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 11,
      diatomCount: 3,
      diatomDriftSpeed: 1.25,
      euglenaCount: 1,
      vorticellaCount: 1,
    };
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params);
    const updated = updateAquarium(initial, frame({ dt: 0.5, width: 172, height: 36 }), params);
    const repeat = updateAquarium(initial, frame({ dt: 0.5, width: 172, height: 36 }), params);

    expect(updated).toEqual(repeat);
    expect(updated).not.toBe(initial);
    expect(updated.euglena).toBe(initial.euglena);
    expect(updated.vorticella).toBe(initial.vorticella);
    for (const diatom of updated.diatoms) {
      expect(Number.isFinite(diatom.x)).toBe(true);
      expect(Number.isFinite(diatom.y)).toBe(true);
      expect(Number.isFinite(diatom.heading)).toBe(true);
      expect(diatom.x).toBeGreaterThanOrEqual(0);
      expect(diatom.x).toBeLessThan(172);
      expect(diatom.y).toBeGreaterThanOrEqual(0);
      expect(diatom.y).toBeLessThan(36);
    }
  });

  it("updateAquarium is dt-partition invariant within numeric tolerance", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 21,
      diatomCount: 4,
      diatomDriftSpeed: 0.8,
    };
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params);
    const oneStep = updateAquarium(initial, frame({ dt: 0.12, width: 172, height: 36 }), params);
    const halfStep = updateAquarium(initial, frame({ dt: 0.06, width: 172, height: 36 }), params);
    const twoSteps = updateAquarium(halfStep, frame({ dt: 0.06, width: 172, height: 36 }), params);

    for (let i = 0; i < oneStep.diatoms.length; i++) {
      expect(twoSteps.diatoms[i].x).toBeCloseTo(oneStep.diatoms[i].x, 10);
      expect(twoSteps.diatoms[i].y).toBeCloseTo(oneStep.diatoms[i].y, 10);
      expect(twoSteps.diatoms[i].heading).toBeCloseTo(oneStep.diatoms[i].heading, 10);
    }
  });

  it("wraps diatom heading to a bounded finite angle over long runtime", () => {
    const tau = Math.PI * 2;
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      diatomCount: 1,
      diatomDriftSpeed: 0,
    };
    const initial: AquariumLayerState = {
      seed: 1,
      euglena: [],
      vorticella: [],
      diatoms: [{
        x: 20,
        y: 10,
        phase: 0,
        size: 1,
        shape: "navicula",
        heading: tau - 0.01,
        driftX: 0,
        driftY: 0,
        rotationRate: 0.063,
      }],
    };
    const oneStep = updateAquarium(initial, frame({ dt: 100_000, width: 172, height: 36 }), params);
    let partitioned = initial;
    for (let i = 0; i < 10; i++) {
      partitioned = updateAquarium(partitioned, frame({ dt: 10_000, width: 172, height: 36 }), params);
    }

    expect(oneStep.diatoms[0].heading).toBeGreaterThanOrEqual(0);
    expect(oneStep.diatoms[0].heading).toBeLessThan(tau);
    expect(Number.isFinite(oneStep.diatoms[0].heading)).toBe(true);
    expect(partitioned.diatoms[0].heading).toBeCloseTo(oneStep.diatoms[0].heading, 10);
  });

  it("drawAquariumBackground draws low-alpha diatoms when enabled and counted", () => {
    const calls: string[] = [];
    const ctx = {
      save: vi.fn(() => calls.push("save")),
      restore: vi.fn(() => calls.push("restore")),
      beginPath: vi.fn(() => calls.push("beginPath")),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(() => calls.push("fill")),
      stroke: vi.fn(() => calls.push("stroke")),
      set lineCap(_value: CanvasLineCap) {},
      set lineJoin(_value: CanvasLineJoin) {},
      set fillStyle(value: string | CanvasGradient | CanvasPattern) { calls.push(String(value)); },
      set strokeStyle(value: string | CanvasGradient | CanvasPattern) { calls.push(String(value)); },
      set lineWidth(_value: number) {},
    } as unknown as CanvasRenderingContext2D;
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 31,
      aquariumAlpha: 0.2,
      diatomCount: 2,
      diatomAlpha: 0.3,
    };
    const state = seedAquarium(frame({ width: 172, height: 36 }), params);

    drawAquariumBackground(ctx, state, frame({ width: 172, height: 36 }), params);

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(calls.some((call) => call.includes("hsla(42") && call.includes("0.010"))).toBe(true);
  });

  it("drawAquariumBackground stays a no-op when enabled but diatom count is zero", () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const state: AquariumLayerState = { seed: 1, diatoms: [], euglena: [], vorticella: [] };

    drawAquariumBackground(ctx, state, frame(), { ...CELL_DEFAULTS, enableAquarium: true, diatomCount: 0 });

    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

describe("aquarium layer gate-off no-ops", () => {
  it("updateAquarium returns the same state object when disabled", () => {
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

  it("keeps diatom-only gate-on draw overhead under 1200 ops at 172x36", async () => {
    const offOps = await renderAquariumOpCount(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    const onOps = await renderAquariumOpCount(true);

    expect(onOps - offOps).toBeGreaterThan(0);
    expect(onOps - offOps).toBeLessThan(1200);
  });
});
