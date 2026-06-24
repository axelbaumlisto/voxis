import { describe, expect, it, vi } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import { drawAquariumBackground, seedAquarium, updateAquarium } from "../layer";
import type { AquariumFrame, AquariumLayerState } from "../types";
import type { CellParams } from "../../types";

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
          x: 221.00925220787525,
          y: 18.990747792124747,
          phase: 2.595226323681209,
          size: 1.2283867616206408,
          heading: 2.595226323681209,
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
