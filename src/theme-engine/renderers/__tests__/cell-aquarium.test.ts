import { afterEach, describe, expect, it, vi } from "vitest";
import { CELL_DEFAULTS } from "../cell/defaults";
import { aquariumParamsView } from "../cell/aquarium/params";
import { seedAquarium, updateAquarium, drawAquariumBackground } from "../cell/aquarium/layer";
import { diatomGeometry } from "../cell/aquarium/diatoms";
import { euglenaPose, updateEuglena, EUGLENA_STEER, MEDIUM } from "../cell/aquarium/euglena";
import { updateVorticella, vorticellaContractPhase, vorticellaGeometry } from "../cell/aquarium/vorticella";
import { noise2D } from "../cell/aquarium/seeds";
import type { AquariumFrame, AquariumLayerState, EuglenaState } from "../cell/aquarium/types";
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

async function renderAquariumOpCount(
  enableAquarium: boolean,
  euglenaCount = 0,
  vorticellaCount = 0,
  diatomCount = 4,
): Promise<number> {
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
      diatomCount,
      diatomAlpha: 0.35,
      euglenaCount,
      vorticellaCount,
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
      euglenaRotDiffusion: 0.12,
    });
    expect(on.euglena.steer).toEqual({ gravitaxis: 0.2, phototaxis: 0.6 });
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
    // eyespot is lateral, beside the anterior reservoir (not on the tip)
    expect(pose.eyespot.x).toBeGreaterThan(pose.center.x);
    // flagellum emerges from the anterior pole, not the eyespot
    expect(pose.flagellumPoints[0]).toEqual(pose.anterior);
    expect(pose.flagellumEnd.x).toBeGreaterThan(pose.anterior.x);
    expect(pose.flagellumEnd.x - pose.anterior.x).toBeLessThan(4 * 1.2);
  });

  it("keeps every interior organelle AND the eyespot inside the body outline across all roll/metaboly phases", () => {
    function inside(poly: readonly { x: number; y: number }[], px: number, py: number): boolean {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    }
    // small slack for the polyline chord vs the smooth boundary it approximates
    const SLACK = 0.6;
    function insideSlack(poly: readonly { x: number; y: number }[], cx: number, cy: number, p: { x: number; y: number }): boolean {
      if (inside(poly, p.x, p.y)) return true;
      const dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy) || 1;
      return inside(poly, p.x + (dx / d) * SLACK, p.y + (dy / d) * SLACK);
    }
    for (const roll of [0, 0.12, 0.25, 0.37, 0.5, 0.62, 0.75, 0.88]) {
      for (const meta of [0, 0.33, 0.66]) {
        const pose = euglenaPose(roll, meta, {
          centerX: 90, centerY: 18, length: 70, baseWidth: 70 * 0.22, heading: 0,
          metabolyEnvelope: 1, organelleSeed: 12345,
          chloroplastCount: 16, striaeCount: 6, paramylonCount: 2,
          includeNucleus: true, includeReservoir: true, includeCV: true, cvPhase: roll,
        });
        const poly = pose.outline;
        const cx = pose.center.x, cy = pose.center.y;
        const ux = pose.ux, uy = pose.uy, nx = -uy, ny = ux;
        const ellipses = [...pose.chloroplasts, ...pose.paramylon, ...(pose.nucleus ? [pose.nucleus] : [])];
        for (const e of ellipses) {
          for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const px = e.x + ux * e.rx * a + nx * e.ry * b;
            const py = e.y + uy * e.rx * a + ny * e.ry * b;
            expect(insideSlack(poly, cx, cy, { x: px, y: py })).toBe(true);
          }
        }
        for (const c of [pose.reservoir, pose.contractileVacuole]) {
          if (!c) continue;
          for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            expect(insideSlack(poly, cx, cy, { x: c.x + nx * c.r * b + ux * c.r * a, y: c.y + ny * c.r * b + uy * c.r * a })).toBe(true);
          }
        }
        expect(insideSlack(poly, cx, cy, pose.eyespot)).toBe(true);
      }
    }
  });

  it("euglenaPose roll changes apparent width and stripe phase without moving the anterior anchor", () => {
    const a = euglenaPose(0, 0.2, { centerX: 2, centerY: 3, length: 8, baseWidth: 2, heading: 0 });
    const b = euglenaPose(0.25, 0.2, { centerX: 2, centerY: 3, length: 8, baseWidth: 2, heading: 0 });

    expect(b.apparentWidth).toBeLessThan(a.apparentWidth);
    expect(b.stripePhase).not.toBe(a.stripePhase);
    expect(b.eyespot.x).toBeCloseTo(a.eyespot.x, 6);
    // the flagellum ANCHOR (anterior pole) does not move with roll; the tip may
    // shift slightly with phase due to the non-planar lasso curl.
    expect(b.flagellumPoints[0].x).toBeCloseTo(a.flagellumPoints[0].x, 6);
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
      euglenaCount: 0,
      vorticellaCount: 0,
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

describe("aquarium layer Phase 3 euglena", () => {
  function testEuglena(overrides: Partial<EuglenaState> = {}): EuglenaState {
    return {
      x: 20,
      y: 10,
      phase: 0,
      size: 1,
      heading: 0,
      swimSpeed: 1,
      rollPhase: 0.25,
      metabolyPhase: 0.3,
      flagellumPhase: 0.4,
      rollRate: 0.2,
      metabolyRate: 0.05,
      flagellumRate: 1.2,
      spiralAmplitude: 0.4,
      ...overrides,
    };
  }

  function unitDelta(next: number, previous: number): number {
    return ((next - previous) % 1 + 1) % 1;
  }

  function euglenaPolyArea(metabolyPhase: number): number {
    const pose = euglenaPose(0.1, metabolyPhase, { length: 60, baseWidth: 13, heading: 0, metabolyEnvelope: 1 });
    const pts = pose.outline;
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a) / 2;
  }

  function euglenaPeakU(metabolyPhase: number): number {
    const pose = euglenaPose(0.1, metabolyPhase, { length: 60, baseWidth: 13, heading: 0, metabolyEnvelope: 1 });
    let bestU = 0;
    let bestW = -1;
    for (const s of pose.bodySamples) {
      if (s.halfWidth > bestW) { bestW = s.halfWidth; bestU = s.u; }
    }
    return bestU;
  }

  function inspectEuglenaDraw(scale: number): { readonly calls: readonly string[]; readonly state: AquariumLayerState } {
    const calls: string[] = [];
    const ctx = {
      save: vi.fn(() => calls.push("save")),
      restore: vi.fn(() => calls.push("restore")),
      beginPath: vi.fn(() => calls.push("beginPath")),
      moveTo: vi.fn((x: number, y: number) => calls.push(`moveTo:${x.toFixed(2)},${y.toFixed(2)}`)),
      lineTo: vi.fn((x: number, y: number) => calls.push(`lineTo:${x.toFixed(2)},${y.toFixed(2)}`)),
      closePath: vi.fn(() => calls.push("closePath")),
      fill: vi.fn(() => calls.push("fill")),
      stroke: vi.fn(() => calls.push("stroke")),
      ellipse: vi.fn((_x: number, _y: number, rx: number, ry: number) => calls.push(`ellipse:${rx.toFixed(2)},${ry.toFixed(2)}`)),
      arc: vi.fn((_x: number, _y: number, r: number) => calls.push(`arc:${r.toFixed(2)}`)),
      set lineCap(value: CanvasLineCap) { calls.push(`lineCap:${value}`); },
      set lineJoin(value: CanvasLineJoin) { calls.push(`lineJoin:${value}`); },
      set fillStyle(value: string | CanvasGradient | CanvasPattern) { calls.push(`fillStyle:${String(value)}`); },
      set strokeStyle(value: string | CanvasGradient | CanvasPattern) { calls.push(`strokeStyle:${String(value)}`); },
      set lineWidth(value: number) { calls.push(`lineWidth:${value}`); },
    } as unknown as CanvasRenderingContext2D;
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumAlpha: 0.24,
      diatomCount: 0,
      euglenaCount: 1,
      euglenaScale: scale,
      vorticellaCount: 0,
    };
    const state: AquariumLayerState = {
      seed: 1,
      diatoms: [],
      euglena: [testEuglena({ x: 20, y: 10, size: 1, heading: 0 })],
      vorticella: [],
    };

    drawAquariumBackground(ctx, state, frame({ width: 172, height: 36, baseHue: 50 }), params);
    return { calls, state };
  }

  it("updateAquarium moves euglena deterministically with dt-integrated phases", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 41,
      diatomCount: 0,
      euglenaCount: 2,
      euglenaSpeed: 0.9,
      euglenaSpeedActive: 1.3,
      aquariumActivityBoost: 0.5,
    };
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params);
    const updated = updateAquarium(initial, frame({ dt: 0.5, width: 172, height: 36, activity: 0.8 }), params);
    const repeat = updateAquarium(initial, frame({ dt: 0.5, width: 172, height: 36, activity: 0.8 }), params);

    expect(updated).toEqual(repeat);
    expect(updated).not.toBe(initial);
    expect(updated.diatoms).toBe(initial.diatoms);
    expect(updated.vorticella).toBe(initial.vorticella);
    for (const cell of updated.euglena) {
      for (const value of [cell.x, cell.y, cell.heading, cell.rollPhase, cell.metabolyPhase, cell.flagellumPhase]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.x).toBeLessThan(172);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeLessThan(36);
      expect(cell.rollPhase).toBeGreaterThanOrEqual(0);
      expect(cell.rollPhase).toBeLessThan(1);
      expect(cell.metabolyPhase).toBeGreaterThanOrEqual(0);
      expect(cell.metabolyPhase).toBeLessThan(1);
      expect(cell.flagellumPhase).toBeGreaterThanOrEqual(0);
      expect(cell.flagellumPhase).toBeLessThan(1);
    }
  });

  it("updateEuglena smoothly moves away from the hero instead of teleporting", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0,
      euglenaSpeedActive: 0,
    });
    const hero = { x: 86, y: 18, radius: 17 };
    const initial = [testEuglena({ x: 92, y: 18, heading: 0 })];
    const once = updateEuglena(initial, frame({ width: 172, height: 36, dt: 0.016, hero }), view)[0];
    const twice = updateEuglena([once], frame({ width: 172, height: 36, dt: 0.016, hero }), view)[0];

    const d0 = Math.hypot(initial[0].x - hero.x, initial[0].y - hero.y);
    const d1 = Math.hypot(once.x - hero.x, once.y - hero.y);
    const d2 = Math.hypot(twice.x - hero.x, twice.y - hero.y);

    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    // soft exponential push: a small fraction of the penetration per frame
    // (smooth, not a teleport to the boundary)
    expect(d1 - d0).toBeLessThan(3);
    expect(once.y).toBeGreaterThanOrEqual(0);
    expect(once.y).toBeLessThanOrEqual(36);
  });

  it("updateEuglena applies mode multipliers only through dt-integrated phase deltas", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      aquariumActivityBoost: 1,
    });
    const initial = [testEuglena({ rollPhase: 0.2, metabolyPhase: 0.3, flagellumPhase: 0.4 })];
    const idle = updateEuglena(initial, frame({ mode: "idle", dt: 0.5, activity: 0 }), view)[0];
    const recording = updateEuglena(initial, frame({ mode: "recording", dt: 0.5, activity: 0 }), view)[0];
    const transcribing = updateEuglena(initial, frame({ mode: "transcribing", dt: 0.5, activity: 0 }), view)[0];
    const error = updateEuglena(initial, frame({ mode: "error", dt: 0.5, activity: 0 }), view)[0];

    expect(unitDelta(recording.rollPhase, initial[0].rollPhase)).toBeGreaterThan(unitDelta(idle.rollPhase, initial[0].rollPhase));
    expect(unitDelta(transcribing.rollPhase, initial[0].rollPhase)).toBeLessThan(unitDelta(idle.rollPhase, initial[0].rollPhase));
    expect(unitDelta(error.rollPhase, initial[0].rollPhase)).toBeLessThan(unitDelta(idle.rollPhase, initial[0].rollPhase));
    expect(unitDelta(recording.metabolyPhase, initial[0].metabolyPhase)).toBeGreaterThan(unitDelta(idle.metabolyPhase, initial[0].metabolyPhase));
    expect(unitDelta(transcribing.flagellumPhase, initial[0].flagellumPhase)).toBeLessThan(unitDelta(idle.flagellumPhase, initial[0].flagellumPhase));
    expect(recording.size).toBe(initial[0].size);
    expect(recording.swimSpeed).toBe(initial[0].swimSpeed);
  });

  it("euglenaPose metaboly conserves area (no inflation) and travels along the body", () => {
    const areas = [0, 0.2, 0.4, 0.6, 0.8].map(euglenaPolyArea);
    const mean = areas.reduce((sum, value) => sum + value, 0) / areas.length;
    for (const area of areas) {
      // width-only traveling bulge with (1-u^2) damping stays within ~3% of mean
      expect(area / mean).toBeGreaterThan(0.95);
      expect(area / mean).toBeLessThan(1.05);
    }
    // the bulge is a TRAVELING wave: its peak-width location shifts with phase
    const peaks = [0, 0.33, 0.66].map(euglenaPeakU);
    expect(new Set(peaks).size).toBeGreaterThan(1);
  });

  it("higher medium viscosity slows reorientation (less turn per time)", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const run = () => {
      let cell = testEuglena({ x: 295, y: 150, heading: 0, swimSpeed: 1 }); // driving at the right wall
      for (let i = 0; i < 6; i++) {
        cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0 }), view)[0];
      }
      return Math.abs(cell.heading); // how far it turned away from heading 0
    };
    const saved = MEDIUM.viscosity;
    try {
      MEDIUM.viscosity = 1.0;
      const thin = run();
      MEDIUM.viscosity = 4.0;
      const thick = run();
      expect(thick).toBeLessThan(thin); // thicker medium → turned less in the same time
    } finally {
      MEDIUM.viscosity = saved;
    }
  });

  it("negative gravitaxis drifts heading toward screen-up in tall open water", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const saved = EUGLENA_STEER.gravitaxis;
    try {
      EUGLENA_STEER.gravitaxis = 0.6;
      let cell = testEuglena({ x: 150, y: 150, heading: 0, swimSpeed: 0 });
      for (let i = 0; i < 20; i++) {
        cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0 }), view)[0];
      }
      expect(cell.heading).toBeLessThan(0);
      expect(Math.sin(cell.heading)).toBeLessThan(-0.1);
    } finally {
      EUGLENA_STEER.gravitaxis = saved;
    }
  });

  it("short-tank fade disables gravitaxis when height is at most three body lengths", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const saved = EUGLENA_STEER.gravitaxis;
    try {
      EUGLENA_STEER.gravitaxis = 2.0;
      let cell = testEuglena({ x: 150, y: 35, heading: 0, swimSpeed: 0 });
      for (let i = 0; i < 20; i++) {
        cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 70, activity: 0 }), view)[0];
      }
      expect(cell.heading).toBeCloseTo(0, 10);
    } finally {
      EUGLENA_STEER.gravitaxis = saved;
    }
  });

  it("phototaxis at moderate app-light steers toward the fixed +x light without a hero", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const saved = EUGLENA_STEER.phototaxis;
    try {
      EUGLENA_STEER.phototaxis = 2.0;
      let cell = testEuglena({ x: 100, y: 150, heading: Math.PI / 2, swimSpeed: 0 });
      for (let i = 0; i < 20; i++) {
        cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0.4, audioLevel: 0 }), view)[0];
      }
      expect(cell.heading).toBeLessThan(Math.PI / 2);
      expect(Math.cos(cell.heading)).toBeGreaterThan(0.1);
    } finally {
      EUGLENA_STEER.phototaxis = saved;
    }
  });

  it("phototaxis flips to photophobic steering away from the +x light at high app-light", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const saved = EUGLENA_STEER.phototaxis;
    try {
      EUGLENA_STEER.phototaxis = 2.0;
      let cell = testEuglena({ x: 100, y: 150, heading: Math.PI / 2, swimSpeed: 0 });
      for (let i = 0; i < 20; i++) {
        cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0.95, audioLevel: 0.2 }), view)[0];
      }
      expect(cell.heading).toBeGreaterThan(Math.PI / 2);
      expect(Math.cos(cell.heading)).toBeLessThan(-0.1);
    } finally {
      EUGLENA_STEER.phototaxis = saved;
    }
  });

  it("priority steering banks the euglena away from an approaching wall", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    // swimming straight at the right wall, close to it → heading must rotate away
    const initial = [testEuglena({ x: 290, y: 150, heading: 0, swimSpeed: 1 })];
    let cell = initial[0];
    for (let i = 0; i < 30; i++) {
      cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0 }), view)[0];
    }
    // it banked away from the wall (no longer heading straight right) and never crossed it
    expect(Math.cos(cell.heading)).toBeLessThan(0.85);
    expect(cell.x).toBeLessThanOrEqual(300);
  });

  it("a negative hero weight makes the euglena PURSUE the hero instead of avoiding", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const hero = { x: 150, y: 150, radius: 18 };
    // start well outside the startle zone, below the hero, heading up toward it
    const start = testEuglena({ x: 150, y: 220, heading: -Math.PI / 2, swimSpeed: 1 });
    const savedHero = EUGLENA_STEER.hero;
    const savedLoiter = EUGLENA_STEER.loiter;
    try {
      EUGLENA_STEER.hero = -1.2;     // pure pursue
      EUGLENA_STEER.loiter = 0;   // disable the approach-then-retreat spring
      let chase = start;
      for (let i = 0; i < 8; i++) {
        chase = updateEuglena([chase], frame({ dt: 0.05, width: 300, height: 300, hero }), view)[0];
      }
      // pursuing keeps it pointed at the hero (heading stays roughly upward)
      expect(Math.sin(chase.heading)).toBeLessThan(-0.5);
    } finally {
      EUGLENA_STEER.hero = savedHero;
      EUGLENA_STEER.loiter = savedLoiter;
    }
  });

  it("close contact triggers a decaying startle-dart away from the hero", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const hero = { x: 150, y: 150, radius: 18 };
    // placed right on the exclusion rim (q ~ 1) -> inside the startle trigger
    const start = testEuglena({ x: 150, y: 192, heading: -Math.PI / 2, swimSpeed: 1, startle: 0 });
    const d0 = Math.hypot(start.x - hero.x, start.y - hero.y);
    const once = updateEuglena([start], frame({ dt: 0.05, width: 300, height: 300, hero }), view)[0];
    expect(once.startle).toBeGreaterThan(0); // startle engaged on contact
    // over a few frames the dart turns it around and it flees (moves away)
    let cell = once;
    for (let i = 0; i < 10; i++) {
      cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, hero }), view)[0];
    }
    expect(Math.hypot(cell.x - hero.x, cell.y - hero.y)).toBeGreaterThan(d0);
    // and it decays toward zero when contact ends (far away, no trigger)
    const far = updateEuglena([{ ...once, x: 20, y: 20, startle: 1 }], frame({ dt: 0.5, width: 300, height: 300 }), view)[0];
    expect(far.startle).toBeLessThan(1);
  });

  it("discrete tumble reorients deterministically by 30-150 degrees over about 1s", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0,
      euglenaSpeedActive: 0,
      aquariumActivityBoost: 1,
    });
    const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const start = testEuglena({
      x: 150, y: 150, heading: 0, swimSpeed: 0,
      burstPhase: 0.99, burstRate: 1, tumbleIndex: 0, tumbleProgress: 1,
      noiseSeed: 0x12345678,
    });
    const once = updateEuglena([start], frame({ dt: 0.5, width: 300, height: 300, activity: 0 }), view)[0];
    const repeat = updateEuglena([start], frame({ dt: 0.5, width: 300, height: 300, activity: 0 }), view)[0];

    expect(once).toEqual(repeat);
    expect(once.tumbleIndex).toBe(1);
    expect(once.tumbleProgress).toBeGreaterThan(0);
    const targetTurn = Math.abs(wrapPi((once.tumbleTo ?? 0) - (once.tumbleFrom ?? 0)));
    expect(targetTurn).toBeGreaterThanOrEqual(Math.PI / 6);
    expect(targetTurn).toBeLessThanOrEqual((5 * Math.PI) / 6);

    let cell = once;
    for (let i = 0; i < 12; i++) {
      cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0 }), view)[0];
    }
    const actualTurn = Math.abs(wrapPi(cell.heading - start.heading));
    expect(actualTurn).toBeGreaterThanOrEqual(Math.PI / 6);
    expect(actualTurn).toBeLessThanOrEqual((5 * Math.PI) / 6);
  });

  it("heavy-tailed tumble interval modulation is deterministic per noise seed", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0,
      euglenaSpeedActive: 0,
      aquariumActivityBoost: 1,
    });
    const base = testEuglena({ x: 150, y: 150, swimSpeed: 0, burstPhase: 0.1, burstRate: 0.1, tumbleIndex: 3 });
    const a1 = updateEuglena([{ ...base, noiseSeed: 111 }], frame({ dt: 1, width: 300, height: 300, activity: 0 }), view)[0];
    const a2 = updateEuglena([{ ...base, noiseSeed: 111 }], frame({ dt: 1, width: 300, height: 300, activity: 0 }), view)[0];
    const b = updateEuglena([{ ...base, noiseSeed: 222 }], frame({ dt: 1, width: 300, height: 300, activity: 0 }), view)[0];

    expect(a1.burstPhase).toBe(a2.burstPhase);
    expect(b.burstPhase).not.toBe(a1.burstPhase);
  });

  it("rotDiffusion cosmetic jitter is bounded, deterministic, and default-off", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0,
      euglenaSpeedActive: 0,
      aquariumActivityBoost: 1,
    });
    const start = testEuglena({
      x: 150, y: 150, heading: 0.4, swimSpeed: 0,
      rollRate: 0, metabolyRate: 0, flagellumRate: 0, burstRate: 0,
      noiseSeed: 0xabcdef,
    });
    const saved = MEDIUM.rotDiffusion;
    try {
      MEDIUM.rotDiffusion = 0;
      const off = updateEuglena([start], frame({ t: 10, dt: 0.04, width: 300, height: 300, activity: 0 }), view)[0];
      expect(off.heading).toBe(start.heading);

      MEDIUM.rotDiffusion = 0.5;
      const a = updateEuglena([start], frame({ t: 10, dt: 0.04, width: 300, height: 300, activity: 0 }), view)[0];
      const b = updateEuglena([start], frame({ t: 10, dt: 0.04, width: 300, height: 300, activity: 0 }), view)[0];
      expect(a.heading).toBe(b.heading);
      expect(Math.abs(a.heading - start.heading)).toBeLessThanOrEqual(0.5 * Math.sqrt(0.04) + 1e-12);
    } finally {
      MEDIUM.rotDiffusion = saved;
    }
  });

  it("updateEuglena stays dt-partition-exact with all new knobs at default", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      aquariumActivityBoost: 1,
    });
    expect(EUGLENA_STEER.gravitaxis).toBe(0);
    expect(EUGLENA_STEER.phototaxis).toBe(0);
    // open water, no wall/hero/startle pressure; new foundation knobs are default no-op
    const initial = [testEuglena({ x: 150, y: 150, heading: 0, swimSpeed: 1, rollPhase: 0.1, metabolyPhase: 0.2, flagellumPhase: 0.3 })];
    const oneStep = updateEuglena(initial, frame({ dt: 0.24, width: 300, height: 300, activity: 0 }), view);
    const halfStep = updateEuglena(initial, frame({ dt: 0.12, width: 300, height: 300, activity: 0 }), view);
    const twoSteps = updateEuglena(halfStep, frame({ dt: 0.12, width: 300, height: 300, activity: 0 }), view);

    expect(twoSteps[0].x).toBeCloseTo(oneStep[0].x, 10);
    expect(twoSteps[0].y).toBeCloseTo(oneStep[0].y, 10);
    expect(twoSteps[0].heading).toBeCloseTo(oneStep[0].heading, 10);
    expect(twoSteps[0].rollPhase).toBeCloseTo(oneStep[0].rollPhase, 10);
    expect(twoSteps[0].metabolyPhase).toBeCloseTo(oneStep[0].metabolyPhase, 10);
    expect(twoSteps[0].flagellumPhase).toBeCloseTo(oneStep[0].flagellumPhase, 10);
  });

  it("updateEuglena is dt-partition invariant across phase wrap", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      aquariumActivityBoost: 1,
    });
    // far from every wall so no steering engages — isolates the phase-wrap math
    const initial = [testEuglena({ x: 150, y: 150, rollPhase: 0.98, metabolyPhase: 0.99, flagellumPhase: 0.97 })];
    const oneStep = updateEuglena(initial, frame({ dt: 0.4, width: 300, height: 300, activity: 0 }), view);
    const halfStep = updateEuglena(initial, frame({ dt: 0.2, width: 300, height: 300, activity: 0 }), view);
    const twoSteps = updateEuglena(halfStep, frame({ dt: 0.2, width: 300, height: 300, activity: 0 }), view);

    expect(twoSteps[0].x).toBeCloseTo(oneStep[0].x, 10);
    expect(twoSteps[0].y).toBeCloseTo(oneStep[0].y, 10);
    expect(twoSteps[0].rollPhase).toBeCloseTo(oneStep[0].rollPhase, 10);
    expect(twoSteps[0].metabolyPhase).toBeCloseTo(oneStep[0].metabolyPhase, 10);
    expect(twoSteps[0].flagellumPhase).toBeCloseTo(oneStep[0].flagellumPhase, 10);
  });

  it("updateEuglena edge wrapping is dt-partition invariant near overlay bounds", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      aquariumActivityBoost: 1,
    });
    // mid-field, far from every wall (beyond the avoidance lookahead): no wall
    // steering engages, so the path is pure forward + closed-form phase
    // accumulators (partition-exact).
    const initial = [testEuglena({ x: 150, y: 150, heading: Math.PI / 4, rollPhase: 0.9 })];
    const oneStep = updateEuglena(initial, frame({ dt: 0.16, width: 300, height: 300, activity: 0 }), view);
    const halfStep = updateEuglena(initial, frame({ dt: 0.08, width: 300, height: 300, activity: 0 }), view);
    const twoSteps = updateEuglena(halfStep, frame({ dt: 0.08, width: 300, height: 300, activity: 0 }), view);

    expect(twoSteps[0].x).toBeCloseTo(oneStep[0].x, 10);
    expect(twoSteps[0].y).toBeCloseTo(oneStep[0].y, 10);
    expect(oneStep[0].x).toBeGreaterThanOrEqual(0);
    expect(oneStep[0].x).toBeLessThan(300);
    expect(oneStep[0].y).toBeGreaterThanOrEqual(0);
    expect(oneStep[0].y).toBeLessThan(300);
  });

  it("abrupt activity onset after long idle uses current dt instead of elapsed frame time", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0.8,
      euglenaSpeedActive: 1.6,
      aquariumActivityBoost: 1,
    });
    const initial = [testEuglena({ rollPhase: 0.2 })];
    const onset = updateEuglena(initial, frame({ t: 10_000, dt: 1 / 60, activity: 1, mode: "recording" }), view)[0];
    const shortClock = updateEuglena(initial, frame({ t: 1, dt: 1 / 60, activity: 1, mode: "recording" }), view)[0];
    const longDt = updateEuglena(initial, frame({ t: 10_000, dt: 0.5, activity: 1, mode: "recording" }), view)[0];

    expect(onset.rollPhase).toBeCloseTo(shortClock.rollPhase, 12);
    expect(unitDelta(onset.rollPhase, initial[0].rollPhase)).toBeLessThan(unitDelta(longDt.rollPhase, initial[0].rollPhase));
  });

  it("keeps euglena finite and clamped in-bounds over long runtime", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1.2,
    };
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params);
    const updated = updateAquarium(initial, frame({ dt: 100_000, width: 172, height: 36, activity: 1 }), params);
    const cell = updated.euglena[0];

    for (const value of [cell.x, cell.y, cell.heading, cell.rollPhase, cell.metabolyPhase, cell.flagellumPhase]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(cell.x).toBeGreaterThanOrEqual(0);
    expect(cell.x).toBeLessThanOrEqual(172); // clamped (no wrap teleport)
    expect(cell.y).toBeGreaterThanOrEqual(0);
    expect(cell.y).toBeLessThanOrEqual(36);
    expect(cell.rollPhase).toBeGreaterThanOrEqual(0);
    expect(cell.rollPhase).toBeLessThan(1);
    expect(cell.metabolyPhase).toBeGreaterThanOrEqual(0);
    expect(cell.metabolyPhase).toBeLessThan(1);
    expect(cell.flagellumPhase).toBeGreaterThanOrEqual(0);
    expect(cell.flagellumPhase).toBeLessThan(1);
  });

  it("euglenaPose keeps eyespot and flagellum at the anterior end for rotated cells", () => {
    const pose = euglenaPose(0.3, 0.6, {
      centerX: 20,
      centerY: 10,
      length: 8,
      baseWidth: 2,
      heading: Math.PI / 2,
      flagellumLength: 3,
      flagellumPhase: 0.1,
    });

    expect(pose.eyespot.y).toBeGreaterThan(pose.center.y);
    expect(pose.flagellumEnd.y).toBeGreaterThan(pose.anterior.y);
    // flagellum emerges from the anterior pole (on axis), eyespot is lateral
    expect(Math.hypot(pose.flagellumPoints[0].x - pose.anterior.x, pose.flagellumPoints[0].y - pose.anterior.y)).toBeLessThan(1e-9);
    expect(Math.abs(pose.anterior.x - pose.center.x)).toBeLessThan(1e-6);
  });

  it("drawAquariumBackground draws a muted euglena-only identity smoke at 172×36", () => {
    const { calls } = inspectEuglenaDraw(1);

    expect(calls.filter((call) => call === "save")).toHaveLength(1);
    expect(calls.filter((call) => call === "restore")).toHaveLength(1);
    expect(calls.filter((call) => call === "fill").length).toBeGreaterThanOrEqual(4);
    expect(calls.filter((call) => call === "stroke").length).toBeGreaterThanOrEqual(3);
    expect(calls.some((call) => call.startsWith("ellipse:"))).toBe(true);
    expect(calls.some((call) => call.startsWith("arc:0.") || call.startsWith("arc:1."))).toBe(true);
    expect(calls.some((call) => call.startsWith("moveTo:"))).toBe(true);
    expect(calls.some((call) => call.startsWith("lineTo:"))).toBe(true);
    expect(calls.some((call) => call.includes("hsla(92"))).toBe(true);
    expect(calls.some((call) => call.includes("hsla(8,"))).toBe(true);
    expect(calls.some((call) => call.includes("hsla(186"))).toBe(true);

    const reservoirIndex = calls.findIndex((call) => call.includes("hsla(186"));
    const eyespotIndex = calls.findIndex((call) => call.includes("hsla(8,"));
    expect(reservoirIndex).toBeGreaterThan(-1);
    expect(eyespotIndex).toBeGreaterThan(reservoirIndex);
  });

  it("drawAquariumBackground adds euglena reservoir glint only above the 7px body threshold", () => {
    const small = inspectEuglenaDraw(0.74).calls; // L < 7
    const large = inspectEuglenaDraw(0.8).calls;  // L >= 7

    expect(small.some((call) => call.includes("hsla(186"))).toBe(false);
    expect(large.some((call) => call.includes("hsla(186"))).toBe(true);
    expect(large.some((call) => call.startsWith("arc:0.") || call.startsWith("arc:1."))).toBe(true);
  });

  it("drawAquariumBackground scales euglena detail monotonically with body length", () => {
    const small = inspectEuglenaDraw(0.6).calls;  // L < 7: minimal
    const medium = inspectEuglenaDraw(0.8).calls; // L >= 7: chloroplasts + reservoir
    const large = inspectEuglenaDraw(1.03).calls;

    const ell = (c: readonly string[]) => c.filter((x) => x.startsWith("ellipse:")).length;
    const arcs = (c: readonly string[]) => c.filter((x) => x.startsWith("arc:")).length;

    expect(ell(small)).toBe(0);
    expect(ell(medium)).toBeGreaterThan(0);
    expect(ell(large)).toBeGreaterThanOrEqual(ell(medium));
    expect(small.some((x) => x.includes("hsla(186"))).toBe(false);
    expect(medium.some((x) => x.includes("hsla(186"))).toBe(true);
    expect(arcs(large)).toBeGreaterThanOrEqual(arcs(small));
  });
});

describe("aquarium layer Phase 4 vorticella", () => {
  it("vorticellaContractPhase is bounded: ballistic contraction, slow extension, long extended dwell", () => {
    const samples = [0, 0.02, 0.05, 0.1, 0.3, 0.45, 0.7, 0.95].map(vorticellaContractPhase);
    for (const phase of samples) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThanOrEqual(1);
    }
    // ballistic collapse: nearly fully contracted within the first ~5% of the cycle
    expect(vorticellaContractPhase(0.04)).toBeGreaterThan(0.85);
    // slow re-extension: monotonically decreasing through the relax window
    expect(vorticellaContractPhase(0.10)).toBeGreaterThan(vorticellaContractPhase(0.35));
    // long extended/feeding dwell at the end of the cycle (s = 0)
    expect(vorticellaContractPhase(0.7)).toBe(0);
    expect(vorticellaContractPhase(0.95)).toBe(0);
    // contraction is far faster than re-extension (per-phase rate)
    const contractRate = vorticellaContractPhase(0.02) - vorticellaContractPhase(0.0);
    const extendRate = Math.abs(vorticellaContractPhase(0.30) - vorticellaContractPhase(0.25));
    expect(contractRate).toBeGreaterThan(extendRate);
  });

  it("vorticellaGeometry is monotonic from extended to contracted", () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map((contractPhase) =>
      vorticellaGeometry(contractPhase, { anchorX: 4, anchorY: 18, restLength: 10, directionAngle: 0 }),
    );

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].stalkLength).toBeLessThanOrEqual(samples[i - 1].stalkLength);
      expect(samples[i].coilTurns).toBeGreaterThanOrEqual(samples[i - 1].coilTurns);
      expect(samples[i].bellCenter.x).toBeLessThanOrEqual(samples[i - 1].bellCenter.x);
      expect(samples[i].bellCenter.y).toBeCloseTo(samples[0].bellCenter.y, 6);
    }
  });

  it("updateVorticella is deterministic, anchored, finite, and bounded", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 51,
      vorticellaCount: 2,
      vorticellaContractRate: 1.0,
      vorticellaContractRateActive: 1.4,
    };
    const view = aquariumParamsView(params);
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params).vorticella;
    const updated = updateVorticella(initial, frame({ dt: 0.5, activity: 0.7, startle: 0.3 }), view);
    const repeat = updateVorticella(initial, frame({ dt: 0.5, activity: 0.7, startle: 0.3 }), view);

    expect(updated).toEqual(repeat);
    for (let i = 0; i < updated.length; i++) {
      expect(updated[i].anchorX).toBe(initial[i].anchorX);
      expect(updated[i].anchorY).toBe(initial[i].anchorY);
      expect(updated[i].x).toBe(initial[i].anchorX);
      expect(updated[i].y).toBe(initial[i].anchorY);
      for (const value of [updated[i].contractCyclePhase, updated[i].contractPhase, updated[i].oralWreathPhase]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("updateAquarium updates vorticella without moving diatoms/euglena when only vorticella is counted", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 53,
      diatomCount: 0,
      euglenaCount: 0,
      vorticellaCount: 1,
    };
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params);
    const updated = updateAquarium(initial, frame({ dt: 0.25, width: 172, height: 36 }), params);

    expect(updated).not.toBe(initial);
    expect(updated.diatoms).toBe(initial.diatoms);
    expect(updated.euglena).toBe(initial.euglena);
    expect(updated.vorticella).not.toBe(initial.vorticella);
    expect(updated.vorticella[0].anchorX).toBe(initial.vorticella[0].anchorX);
    expect(updated.vorticella[0].anchorY).toBe(initial.vorticella[0].anchorY);
  });

  it("updateVorticella runs an absolute-time ballistic contraction (fast collapse, slow re-extend)", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 51,
      vorticellaCount: 1,
      vorticellaContractRate: 1.0,
      vorticellaContractRateActive: 1.6,
    };
    const view = aquariumParamsView(params);
    let cell = seedAquarium(frame({ width: 240, height: 80 }), params).vorticella;
    const dt = 0.05;
    let peak = 0;
    let collapseSteps = Infinity; // steps from first s>0.5 to s>0.95
    let crossed = -1;
    const phases: number[] = [];
    for (let i = 0; i < 600; i++) {
      cell = updateVorticella(cell, frame({ dt, width: 240, height: 80, activity: 0.6 }), view);
      const s = cell[0].contractPhase;
      phases.push(s);
      peak = Math.max(peak, s);
      if (crossed < 0 && s > 0.5) crossed = i;
      if (crossed >= 0 && s > 0.95 && collapseSteps === Infinity) collapseSteps = i - crossed;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    // a contraction fired and fully collapsed
    expect(peak).toBeGreaterThan(0.95);
    // BALLISTIC: from half to full collapse in <= ~0.15s (<=3 steps) — a snap, not a ramp
    expect(collapseSteps).toBeLessThanOrEqual(3);
    // it spends most of the time extended (long feeding dwell): s≈0 majority of frames
    const extendedFrac = phases.filter((s) => s < 0.05).length / phases.length;
    expect(extendedFrac).toBeGreaterThan(0.6);
    // deterministic
    const again = updateVorticella(
      seedAquarium(frame({ width: 240, height: 80 }), params).vorticella,
      frame({ dt, width: 240, height: 80, activity: 0.6 }),
      view,
    );
    expect(again[0].contractPhase).toBe(phases.length ? updateVorticella(seedAquarium(frame({ width: 240, height: 80 }), params).vorticella, frame({ dt, width: 240, height: 80, activity: 0.6 }), view)[0].contractPhase : 0);
  });

  it("updateVorticella is dt-partition invariant away from event boundaries", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 57,
      vorticellaCount: 1,
      vorticellaContractRate: 0.8,
      vorticellaContractRateActive: 1.0,
    };
    const view = aquariumParamsView(params);
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params).vorticella;
    const oneStep = updateVorticella(initial, frame({ dt: 0.12, activity: 0.2 }), view);
    const halfStep = updateVorticella(initial, frame({ dt: 0.06, activity: 0.2 }), view);
    const twoSteps = updateVorticella(halfStep, frame({ dt: 0.06, activity: 0.2 }), view);

    expect(twoSteps[0].contractCyclePhase).toBeCloseTo(oneStep[0].contractCyclePhase, 10);
    expect(twoSteps[0].contractPhase).toBeCloseTo(oneStep[0].contractPhase, 10);
    expect(twoSteps[0].oralWreathPhase).toBeCloseTo(oneStep[0].oralWreathPhase, 10);
    expect(twoSteps[0].anchorX).toBe(oneStep[0].anchorX);
    expect(twoSteps[0].anchorY).toBe(oneStep[0].anchorY);
  });

  it("drawAquariumBackground draws a low-alpha edge vorticella smoke at 172×36", () => {
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
      ellipse: vi.fn(() => calls.push("ellipse")),
      arc: vi.fn(() => calls.push("arc")),
      set lineCap(_value: CanvasLineCap) {},
      set lineJoin(_value: CanvasLineJoin) {},
      set fillStyle(value: string | CanvasGradient | CanvasPattern) { calls.push(String(value)); },
      set strokeStyle(value: string | CanvasGradient | CanvasPattern) { calls.push(String(value)); },
      set lineWidth(_value: number) {},
    } as unknown as CanvasRenderingContext2D;
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 59,
      aquariumAlpha: 0.24,
      diatomCount: 0,
      euglenaCount: 0,
      vorticellaCount: 1,
    };
    const state = seedAquarium(frame({ width: 172, height: 36 }), params);

    drawAquariumBackground(ctx, state, frame({ width: 172, height: 36 }), params);

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.ellipse).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
    // hyaline blue-grey body palette (hue ~200), not pigmented
    expect(calls.some((call) => /hsla\(20[0-5],/.test(call))).toBe(true);
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

describe("aquarium layer Phase 4.5 combined perf/golden", () => {
  it("retains seeded identities and anchors across combined multi-frame updates", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 67,
      diatomCount: 4,
      euglenaCount: 1,
      vorticellaCount: 1,
      diatomDriftSpeed: 0.9,
      euglenaSpeed: 0.7,
      euglenaSpeedActive: 1.1,
      vorticellaContractRate: 0.8,
      vorticellaContractRateActive: 1.0,
    };
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params);
    let state = initial;

    for (let i = 0; i < 5; i++) {
      state = updateAquarium(
        state,
        frame({ t: 1 + i / 60, dt: 1 / 60, width: 172, height: 36, activity: i % 2 === 0 ? 0.2 : 0.6 }),
        params,
      );
    }

    expect(initial.diatoms).toHaveLength(4);
    expect(initial.euglena).toHaveLength(1);
    expect(initial.vorticella).toHaveLength(1);
    expect(state.diatoms).toHaveLength(initial.diatoms.length);
    expect(state.euglena).toHaveLength(initial.euglena.length);
    expect(state.vorticella).toHaveLength(initial.vorticella.length);
    for (let i = 0; i < initial.diatoms.length; i++) {
      expect(state.diatoms[i]).toMatchObject({
        phase: initial.diatoms[i].phase,
        size: initial.diatoms[i].size,
        shape: initial.diatoms[i].shape,
        driftX: initial.diatoms[i].driftX,
        driftY: initial.diatoms[i].driftY,
        rotationRate: initial.diatoms[i].rotationRate,
      });
    }
    expect(state.euglena[0]).toMatchObject({
      size: initial.euglena[0].size,
      swimSpeed: initial.euglena[0].swimSpeed,
      rollRate: initial.euglena[0].rollRate,
      metabolyRate: initial.euglena[0].metabolyRate,
      flagellumRate: initial.euglena[0].flagellumRate,
      spiralAmplitude: initial.euglena[0].spiralAmplitude,
    });
    expect(state.vorticella[0]).toMatchObject({
      x: initial.vorticella[0].anchorX,
      y: initial.vorticella[0].anchorY,
      anchorX: initial.vorticella[0].anchorX,
      anchorY: initial.vorticella[0].anchorY,
      directionAngle: initial.vorticella[0].directionAngle,
      restLength: initial.vorticella[0].restLength,
      contractRate: initial.vorticella[0].contractRate,
      oralRate: initial.vorticella[0].oralRate,
    });

    const repeat = seedAquarium(frame({ width: 172, height: 36 }), params);
    expect(repeat).toEqual(initial);
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

  it("does not reseed the aquarium layer across renderer frames", async () => {
    installNoopCanvasContext();
    const states: AquariumLayerState[] = [
      { seed: 1, diatoms: [], euglena: [], vorticella: [] },
      { seed: 1, diatoms: [{
        x: 1,
        y: 2,
        phase: 0.1,
        size: 3,
        shape: "navicula",
        heading: 0,
        driftX: 0,
        driftY: 0,
        rotationRate: 0,
      }], euglena: [], vorticella: [] },
      { seed: 1, diatoms: [{
        x: 2,
        y: 2,
        phase: 0.1,
        size: 3,
        shape: "navicula",
        heading: 0,
        driftX: 0,
        driftY: 0,
        rotationRate: 0,
      }], euglena: [], vorticella: [] },
      { seed: 1, diatoms: [{
        x: 3,
        y: 2,
        phase: 0.1,
        size: 3,
        shape: "navicula",
        heading: 0,
        driftX: 0,
        driftY: 0,
        rotationRate: 0,
      }], euglena: [], vorticella: [] },
    ];
    const seed = vi.fn(() => states[0]);
    const update = vi.fn((_aquarium: AquariumLayerState, _frame: AquariumFrame) => states[update.mock.calls.length]);
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
      params: { enableAquarium: true, aquariumSeed: 67, diatomCount: 4, euglenaCount: 1, vorticellaCount: 1 },
    });
    rafCalls.shift()?.();
    rafCalls.shift()?.();
    rafCalls.shift()?.();
    renderer.destroy();

    expect(seed).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(3);
    expect(draw).toHaveBeenCalledTimes(3);
    expect(update.mock.calls[0]?.[0]).toBe(states[0]);
    expect(update.mock.calls[1]?.[0]).toBe(states[1]);
    expect(update.mock.calls[2]?.[0]).toBe(states[2]);
    expect(draw.mock.calls[0]?.[1]).toBe(states[1]);
    expect(draw.mock.calls[1]?.[1]).toBe(states[2]);
    expect(draw.mock.calls[2]?.[1]).toBe(states[3]);
  });

  it("keeps combined diatom/euglena/vorticella gate-on draw overhead under 1200 ops at 172x36", async () => {
    const offOps = await renderAquariumOpCount(false, 1, 1, 4);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    const onOps = await renderAquariumOpCount(true, 1, 1, 4);

    expect(onOps - offOps).toBeGreaterThan(0);
    expect(onOps - offOps).toBeLessThan(1200);
  });
});

describe("enableHero gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function renderHeroOpCount(enableHero: boolean): Promise<number> {
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
      params: { enableHero, enableAquarium: true, euglenaCount: 1, euglenaScale: 6.45 },
    });
    now += 1000 / 60;
    rafCalls.shift()?.();
    renderer.destroy();
    return ops.length;
  }

  it("draws far fewer ops with the paramecium hero hidden than shown", async () => {
    const hidden = await renderHeroOpCount(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    const shown = await renderHeroOpCount(true);

    expect(hidden).toBeGreaterThan(0); // the euglena still draws
    expect(hidden).toBeLessThan(shown); // but the heavy paramecium is gone
  });
});
