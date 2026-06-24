import { describe, expect, it, vi } from "vitest";
import { CELL_DEFAULTS } from "../cell/defaults";
import { aquariumParamsView } from "../cell/aquarium/params";
import { buildAquariumInteractionField, seedAquarium, updateAquarium, drawAquariumBackground } from "../cell/aquarium/layer";
import { diatomGeometry } from "../cell/aquarium/diatoms";
import { euglenaPose, updateEuglena } from "../cell/aquarium/euglena";
import { updateVorticella, vorticellaGeometry } from "../cell/aquarium/vorticella";
import type { AquariumFrame, AquariumLayerState } from "../cell/aquarium/types";
import type { CellParams } from "../cell/types";

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

  it("keeps the multi-organism update next-state byte-identical through per-instance cfg dispatch", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 67,
      aquariumAlpha: 0.55,
      aquariumActivityBoost: 0.8,
      diatomCount: 3,
      diatomAlpha: 0.35,
      diatomDriftSpeed: 0.42,
      euglenaCount: 1,
      euglenaSpeed: 0.2,
      euglenaSpeedActive: 1.5,
      euglenaScale: 1.4,
      euglenaGravitaxis: 0.2,
      euglenaPhototaxis: 0.6,
      euglenaRotDiffusion: 0.12,
      vorticellaCount: 1,
      vorticellaContractRate: 1.2,
      vorticellaScale: 1.2,
      vorticellaAlongFrac: 0.16,
    };
    const hero = { x: 118, y: 42, radius: 11, heading: 0.35, halfLen: 18, halfWid: 7 };
    const seedFrame = frame({ t: 4, dt: 1 / 60, width: 240, height: 80, mode: "recording", activity: 0.6, audioLevel: 0.4, hero });
    const initial = seedAquarium(seedFrame, params);
    const next = updateAquarium(initial, { ...seedFrame, t: 4.25, dt: 0.05 }, params);

    expect(next).toEqual({
      seed: 67,
      diatoms: [
        {
          x: 185.5590404548048,
          y: 71.91272966605092,
          phase: 3.3116758177791366,
          size: 0.798184517538175,
          shape: "ovalCentric",
          heading: 3.313995455629913,
          driftX: -0.6381902297387546,
          driftY: 0.09783944755539821,
          rotationRate: 0.04639275701553561,
        },
        {
          x: 189.72959523552748,
          y: 10.456023962897893,
          phase: 6.047110503842159,
          size: 1.0322810034267604,
          shape: "navicula",
          heading: 6.0451511322203455,
          driftX: -0.5807144400180535,
          driftY: -0.36358825730730027,
          rotationRate: -0.0391874324362725,
        },
        {
          x: 60.09761353741906,
          y: 45.63280887641962,
          phase: 6.272857107002878,
          size: 1.0896277173887938,
          shape: "navicula",
          heading: 6.271424933518547,
          driftX: -0.25499799619505475,
          driftY: 0.32631667996941766,
          rotationRate: -0.028643469686619936,
        },
      ],
      euglena: [
        {
          x: 229.73473092317582,
          y: 10.26526907682419,
          phase: 0.20868502645176024,
          size: 1.2283867616206408,
          heading: 0.20868502645176024,
          swimSpeed: 1.0744810068747028,
          rollPhase: 0.38560447917176877,
          metabolyPhase: 0.16642074462644874,
          flagellumPhase: 0.9470856113824992,
          rollRate: 0.47428053175099194,
          metabolyRate: 0.10880362844560296,
          flagellumRate: 13.644410272594541,
          spiralAmplitude: 0.13494399678893387,
          cvPhase: 0.3587615130166184,
          cvRate: 0.03837136438582093,
          burstPhase: 0.15361223071124552,
          burstRate: 0.0806029460579157,
          turnProgress: 2,
          turnFrom: -0.02407782175578177,
          turnTo: -0.02407782175578177,
          tumbleIndex: 0,
          tumbleFrom: -0.02407782175578177,
          tumbleTo: -0.02407782175578177,
          tumbleProgress: 1,
          startle: 0,
          noiseSeed: 1649603361,
        },
      ],
      vorticella: [
        {
          x: 38.4,
          y: 79.5,
          phase: 0.4531427220983897,
          size: 1.3921901939902455,
          anchorX: 38.4,
          anchorY: 79.5,
          directionAngle: -1.2207963267948965,
          restLength: 8.697909643291496,
          contractPhase: 0,
          contractCyclePhase: 0.4531427220983897,
          oralWreathPhase: 0.3982852140907198,
          contractRate: 0.10650784630794077,
          oralRate: 0.5634912510495633,
          swayPhase: 0.9713883993529016,
          swayRate: 0.10676003030734138,
          contractLeg: 0,
          contractTimer: 0.6783055094536394,
          voiceEnv: 0.09211096506563159,
          migrateState: 0,
          attach: 1,
          migrateTimer: 3.4162731326185165,
          migrateInterval: 540,
          migrateTargetX: 38.4,
          migrateCount: 0,
        },
      ],
      didinium: [],
    });
  });
});



describe("aquarium layer Phase 4.5 combined perf/golden", () => {
  it("2-phase euglena/vorticella updates are order-independent to 1e-10", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 67,
      aquariumAlpha: 0.55,
      aquariumActivityBoost: 0.8,
      diatomCount: 0,
      euglenaCount: 1,
      euglenaSpeed: 0.7,
      euglenaSpeedActive: 1.1,
      euglenaScale: 1.4,
      vorticellaCount: 1,
      vorticellaContractRate: 0.8,
      vorticellaScale: 1.2,
      vorticellaAlongFrac: 0.16,
    };
    const view = aquariumParamsView(params);
    const hero = { x: 120, y: 40, radius: 14, heading: 0.2, halfLen: 18, halfWid: 11 };
    const f0 = frame({ t: 2, dt: 1 / 60, width: 240, height: 80, activity: 0.5, audioLevel: 0.25, hero });
    const initial = seedAquarium(f0, params);
    const interaction = buildAquariumInteractionField(initial.euglena, initial.vorticella, f0.hero, view.vorticella.scale, f0.height);
    const snapshotFrame = { ...f0, interaction };

    const production = updateAquarium(initial, f0, params);
    const reverse = {
      ...initial,
      vorticella: updateVorticella(initial.vorticella, snapshotFrame, view),
      euglena: updateEuglena(initial.euglena, snapshotFrame, view),
    };

    for (const species of ["euglena", "vorticella"] as const) {
      expect(production[species]).toHaveLength(reverse[species].length);
      for (let i = 0; i < production[species].length; i++) {
        for (const key of Object.keys(production[species][i]) as Array<keyof typeof production[typeof species][number]>) {
          const actual = production[species][i][key];
          const expected = reverse[species][i][key];
          if (typeof actual === "number" && typeof expected === "number") {
            expect(actual, `${species}[${i}].${String(key)}`).toBeCloseTo(expected, 10);
          } else {
            expect(actual, `${species}[${i}].${String(key)}`).toEqual(expected);
          }
        }
      }
    }
  });

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
