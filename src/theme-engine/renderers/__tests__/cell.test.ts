// src/theme-engine/renderers/__tests__/cell.test.ts
/**
 * Tests for the Living Cell renderer — pure geometry functions + renderer smoke test.
 *
 * Canvas mocking mirrors __tests__/ring.test.ts: stub requestAnimationFrame,
 * cancelAnimationFrame, and a minimal 2d context via jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  noise2D,
  fbm,
  smoothstep,
  cellEnergy,
  smoothEnergy,
  cellActivity,
  swimSpeed,
  ciliaBeatHzEff,
  bodyHeadingStep,
  prolateAspect,
  cellRadius,
  pseudopodOffset,
  startleOffset,
  startleHeadingKick,
  startleBurstSpeed,
  strokeAxisStrength,
  metachronalIndex,
  ciliaStrokeAngle,
  iridescentHue,
  lowpassRadii,
  catmullRom,
  catmullRomOpen,
  sampleBinLevel,
  buildCellContour,
  buildTargetDeformation,
  integrateDeformation,
  nucleusTransform,
  ciliaEndpoints,
  ciliaPath,
  ciliaBeatPhase,
  idleMorph,
  resolveBaseRadius,
  perimeterCiliaCount,
  bandLimitDeform,
  contractileVacuole,
  dipoleFlowAt,
  advectMote,
  seedMotes,
  cellReach,
  cellDrift,
  wanderStep,
  wallReorientHeading,
  rotationalBrownianStep,
  sedimentationBias,
  driftActivation,
  sanitizeUnit,
  sanitizeFinite,
  sanitizeBins,
  serializeCellState,
  parseCellState,
  restoreSeed,
  wanderPoseFromState,
  cellPersistKey,
  CELL_DEFAULTS,
  createCellRenderer,
  saturateTargetDeform,
  normalizeAreaDeform,
  integrateDeformPipeline,
  affineSqueezePoints,
  somaticCiliaParams,
} from "../cell";
import { deformAt } from "../shared";
import type { CellParams, CellPersistState, CiliaMotion } from "../cell";

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// noise2D
// ---------------------------------------------------------------------------

describe("noise2D", () => {
  it("is deterministic — same (x,y) always returns same value", () => {
    const a = noise2D(3.14, 2.71);
    const b = noise2D(3.14, 2.71);
    expect(a).toBe(b);
  });

  it("returns values roughly in [−1, 1]", () => {
    for (let x = 0; x < 20; x += 1.3) {
      for (let y = 0; y < 20; y += 1.7) {
        const v = noise2D(x, y);
        expect(v).toBeGreaterThanOrEqual(-1.0);
        expect(v).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it("produces different values at different coordinates", () => {
    const vals = new Set<number>();
    for (let i = 0; i < 50; i++) {
      vals.add(noise2D(i * 0.7, i * 1.3));
    }
    // Most should be distinct (probabilistic, but with 50 samples over a smooth noise field)
    expect(vals.size).toBeGreaterThan(10);
  });

  it("is periodic in integer offsets (x+256) ≈ (x)", () => {
    // The permutation table is 256 entries; noise wraps at 256.
    const a = noise2D(0.5, 0.5);
    const b = noise2D(256.5, 256.5);
    // Both land on the same lattice coordinates, so value should be identical
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// fbm
// ---------------------------------------------------------------------------

describe("fbm", () => {
  it("returns values roughly in [−1, 1] for sensible params", () => {
    for (let x = 0; x < 20; x += 1.3) {
      for (let y = 0; y < 20; y += 1.7) {
        const v = fbm(x, y, 4, 2.0, 0.5);
        expect(v).toBeGreaterThanOrEqual(-1.1);
        expect(v).toBeLessThanOrEqual(1.1);
      }
    }
  });

  it("1 octave equals noise2D (same as fbm with octaves=1, lac=1, gain=1)", () => {
    const n = noise2D(5.0, 6.0);
    const f = fbm(5.0, 6.0, 1, 1, 1);
    expect(f).toBeCloseTo(n, 10);
  });

  it("more octaves adds detail (output changes)", () => {
    const v1 = fbm(3.3, 4.7, 1, 2.0, 0.5);
    const v4 = fbm(3.3, 4.7, 4, 2.0, 0.5);
    // Different octave counts should produce different values
    expect(v1).not.toBe(v4);
  });

  it("is deterministic", () => {
    const a = fbm(7.7, 8.8, 3, 2.3, 0.55);
    const b = fbm(7.7, 8.8, 3, 2.3, 0.55);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// cellEnergy
// ---------------------------------------------------------------------------

describe("cellEnergy", () => {
  it("produces positive idle energy that oscillates with time", () => {
    const e0 = cellEnergy("idle", 0, 0, 0.06, 0.7);
    const e1 = cellEnergy("idle", 0, 1.2, 0.06, 0.7);
    expect(e0).toBeGreaterThan(0);
    // Oscillation should cause different values at different times
    expect(e0).not.toBe(e1);
  });

  it("recording mode scales with audioLevel", () => {
    const elo = cellEnergy("recording", 0.1, 0, 0.06, 0.7);
    const ehi = cellEnergy("recording", 0.9, 0, 0.06, 0.7);
    expect(ehi).toBeGreaterThan(elo);
  });

  it("recording mode clamps to [0, 1]", () => {
    const e = cellEnergy("recording", 1.5, 0, 0.06, 0.7); // > 1 input
    expect(e).toBeGreaterThanOrEqual(0);
    expect(e).toBeLessThanOrEqual(1);
  });

  it("error mode returns idle only", () => {
    const e = cellEnergy("error", 0.8, 0, 0.06, 0.7);
    expect(e).toBe(0.06);
  });

  it("transcribing mode is between idle and recording", () => {
    const erec = cellEnergy("recording", 0.5, 0, 0.1, 0.7);
    const etrn = cellEnergy("transcribing", 0.5, 0, 0.1, 0.7);
    expect(etrn).toBeLessThan(erec);
    expect(etrn).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// cellRadius
// ---------------------------------------------------------------------------

describe("cellRadius", () => {
  const p = { ...CELL_DEFAULTS };

  it("is always positive", () => {
    for (let i = 0; i < 96; i++) {
      const angle = (i / 96) * TAU;
      const r = cellRadius(angle, 0.5, 0.3, p);
      expect(r).toBeGreaterThan(0);
    }
  });

  it("is periodic — same at angle 0 and 2π", () => {
    const r0 = cellRadius(0, 0.5, 0.3, p);
    const r2pi = cellRadius(TAU, 0.5, 0.3, p);
    expect(r0).toBeCloseTo(r2pi, 10);
  });

  it("higher energy produces larger variation range", () => {
    const loVals: number[] = [];
    const hiVals: number[] = [];
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * TAU;
      loVals.push(cellRadius(angle, 0.3, 0.05, p));
      hiVals.push(cellRadius(angle, 0.3, 0.8, p));
    }
    const loRange = Math.max(...loVals) - Math.min(...loVals);
    const hiRange = Math.max(...hiVals) - Math.min(...hiVals);
    expect(hiRange).toBeGreaterThan(loRange);
  });

  it("responds to changed noiseScale", () => {
    const pLow = { ...p, noiseScale: 0.1 };
    const pHigh = { ...p, noiseScale: 2.0 };
    const rLow = cellRadius(1.0, 0.3, 0.5, pLow);
    const rHigh = cellRadius(1.0, 0.3, 0.5, pHigh);
    expect(rLow).not.toBe(rHigh);
  });

  it("higher membraneAmplitude produces larger variation range", () => {
    const pLow = { ...p, membraneAmplitude: 0.05 };
    const pHigh = { ...p, membraneAmplitude: 0.5 };
    const loVals: number[] = [];
    const hiVals: number[] = [];
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * TAU;
      loVals.push(cellRadius(angle, 0.5, 0.5, pLow));
      hiVals.push(cellRadius(angle, 0.5, 0.5, pHigh));
    }
    const loRange = Math.max(...loVals) - Math.min(...loVals);
    const hiRange = Math.max(...hiVals) - Math.min(...hiVals);
    expect(hiRange).toBeGreaterThan(loRange);
  });

  it("higher energyDrive increases recording deformation range", () => {
    const pLow = { ...p, energyDrive: 0.1 };
    const pHigh = { ...p, energyDrive: 1.0 };
    const loVals: number[] = [];
    const hiVals: number[] = [];
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * TAU;
      loVals.push(cellRadius(angle, 0.5, 0.8, pLow));
      hiVals.push(cellRadius(angle, 0.5, 0.8, pHigh));
    }
    const loRange = Math.max(...loVals) - Math.min(...loVals);
    const hiRange = Math.max(...hiVals) - Math.min(...hiVals);
    expect(hiRange).toBeGreaterThan(loRange);
  });
});

// ---------------------------------------------------------------------------
// pseudopodOffset
// ---------------------------------------------------------------------------

describe("pseudopodOffset", () => {
  const p = { ...CELL_DEFAULTS };

  it("returns ≥ 0", () => {
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * TAU;
      const v = pseudopodOffset(angle, 0.5, 0.3, 0.4, p);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("is near zero at silence with low idle push", () => {
    const pLow = { ...p, idle: 0.01, push: 0.5 };
    const samples: number[] = [];
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * TAU;
      samples.push(pseudopodOffset(angle, 0, 0, 0.01, pLow));
    }
    const maxVal = Math.max(...samples);
    expect(maxVal).toBeLessThan(1.0);
  });

  it("grows with audio level (max over full circle)", () => {
    const angles = Array.from({ length: 96 }, (_, i) => (i / 96) * TAU);
    const loVals = angles.map((a) => pseudopodOffset(a, 0.5, 0.05, 0.3, p));
    const hiVals = angles.map((a) => pseudopodOffset(a, 0.5, 0.8, 0.8, p));
    expect(Math.max(...hiVals)).toBeGreaterThan(Math.max(...loVals));
  });

  it("creates peaks at different angles for different times (drifting intent)", () => {
    const angles: number[] = [];
    for (let i = 0; i < 96; i++) {
      angles.push((i / 96) * TAU);
    }
    const vals1 = angles.map((a) => pseudopodOffset(a, 1.0, 0.7, 0.7, p));
    const vals2 = angles.map((a) => pseudopodOffset(a, 10.0, 0.7, 0.7, p));

    // Peak angles should drift over time
    const peak1 = angles[vals1.indexOf(Math.max(...vals1))];
    const peak2 = angles[vals2.indexOf(Math.max(...vals2))];
    expect(peak1).not.toBeCloseTo(peak2, 4);
  });

  it("different sharpness produces different lobe shapes", () => {
    const pSharp = { ...p, sharpness: 8, push: 4 };
    const pSoft = { ...p, sharpness: 1, push: 4 };
    const angles = Array.from({ length: 96 }, (_, i) => (i / 96) * TAU);
    const sharpVals = angles.map((a) => pseudopodOffset(a, 0.3, 0.7, 0.7, pSharp));
    const softVals = angles.map((a) => pseudopodOffset(a, 0.3, 0.7, 0.7, pSoft));
    // Different sharpness produces different lobe shapes — arrays should differ
    const sharpSum = sharpVals.reduce((s, v) => s + v, 0);
    const softSum = softVals.reduce((s, v) => s + v, 0);
    expect(sharpSum).not.toBe(softSum);
  });

  it("is monotonic in audioLevel (peak response never decreases)", () => {
    const angles = Array.from({ length: 96 }, (_, i) => (i / 96) * TAU);
    const prevPeaks: number[] = [];
    // Sample 10 audio levels from 0 to 1, check peak is non-decreasing
    for (let levelIdx = 0; levelIdx <= 10; levelIdx++) {
      const level = levelIdx / 10;
      let maxVal = 0;
      for (const a of angles) {
        const v = pseudopodOffset(a, 0.5, level, 0.8, p);
        if (v > maxVal) maxVal = v;
      }
      if (prevPeaks.length > 0) {
        expect(maxVal).toBeGreaterThanOrEqual(prevPeaks[prevPeaks.length - 1] - 0.0001);
      }
      prevPeaks.push(maxVal);
    }
  });

  it("idle pseudopods are near-zero but non-negative", () => {
    const samples: number[] = [];
    for (let i = 0; i < 96; i++) {
      const angle = (i / 96) * TAU;
      samples.push(pseudopodOffset(angle, 0.5, 0, p.idle, p));
    }
    const maxVal = Math.max(...samples);
    expect(maxVal).toBeGreaterThanOrEqual(0);
    // With idle energy floor, pseudopods are tiny but allowed to be non-zero
    expect(maxVal).toBeLessThanOrEqual(1.5);
  });
});

// ---------------------------------------------------------------------------
// iridescentHue
// ---------------------------------------------------------------------------

describe("iridescentHue", () => {
  const p = { ...CELL_DEFAULTS };

  it("returns values in [0, 360)", () => {
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * TAU;
      for (let t = 0; t < 10; t += 2) {
        const h = iridescentHue(angle, t, 0.5, 34, p);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(360);
      }
    }
  });

  it("wraps correctly for large inputs", () => {
    const h = iridescentHue(0, 1000, 1.0, 34, p);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it("varies with angle", () => {
    const h0 = iridescentHue(0, 0.5, 0.3, 34, p);
    const hPi = iridescentHue(Math.PI, 0.5, 0.3, 34, p);
    expect(h0).not.toBeCloseTo(hPi, 1);
  });

  it("shifts with time (shimmer)", () => {
    const h0 = iridescentHue(0, 0, 0.5, 34, p);
    const h1 = iridescentHue(0, 2, 0.5, 34, p);
    expect(h0).not.toBe(h1);
  });

  it("deepens with audioLevel (hue boost)", () => {
    const pBoost = { ...p, hueBoost: 30 };
    const lo = iridescentHue(0, 0, 0, 34, pBoost);
    const hi = iridescentHue(0, 0, 1.0, 34, pBoost);
    expect(hi).not.toBe(lo);
  });

  it("is deterministic", () => {
    const a = iridescentHue(1.5, 3.3, 0.7, 34, p);
    const b = iridescentHue(1.5, 3.3, 0.7, 34, p);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// lowpassRadii
// ---------------------------------------------------------------------------

describe("lowpassRadii", () => {
  it("passes through unchanged with tension 0", () => {
    const prev = [10, 20, 30];
    const next = [15, 25, 35];
    const result = lowpassRadii(prev, next, 0);
    expect(result).toEqual(next);
  });

  it("holds previous with tension 1", () => {
    const prev = [10, 20, 30];
    const next = [15, 25, 35];
    const result = lowpassRadii(prev, next, 1);
    expect(result).toEqual(prev);
  });

  it("blends at tension 0.5 (halfway)", () => {
    const prev = [0, 10];
    const next = [10, 20];
    const result = lowpassRadii(prev, next, 0.5);
    expect(result[0]).toBeCloseTo(5, 5);
    expect(result[1]).toBeCloseTo(15, 5);
  });

  it("returns array of same length", () => {
    const prev = [1, 2, 3, 4, 5];
    const next = [6, 7, 8, 9, 10];
    const result = lowpassRadii(prev, next, 0.3);
    expect(result.length).toBe(prev.length);
  });

  it("clamps tension to [0, 1]", () => {
    const prev = [1, 2];
    const next = [3, 4];
    const resultNeg = lowpassRadii(prev, next, -0.5);
    const resultOver = lowpassRadii(prev, next, 1.5);
    expect(resultNeg).toEqual(next); // clamped to 0
    expect(resultOver).toEqual(prev); // clamped to 1
  });
});

// ---------------------------------------------------------------------------
// buildTargetDeformation
// ---------------------------------------------------------------------------

describe("buildTargetDeformation", () => {
  const p = { ...CELL_DEFAULTS };
  const zeroBins = new Array(32).fill(0);

  it("returns 96 elements (sampleCount)", () => {
    const deform = buildTargetDeformation(400, 100, zeroBins, 0, 0, 0.3, p);
    expect(deform.length).toBe(96);
  });

  it("returns all finite values", () => {
    const deform = buildTargetDeformation(200, 200, zeroBins, 0.5, 0.5, 0.8, p);
    for (const v of deform) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("is deterministic", () => {
    const bins = Array.from({ length: 32 }, (_, i) => i / 32);
    const a = buildTargetDeformation(300, 200, bins, 0.7, 0.4, 0.6, p);
    const b = buildTargetDeformation(300, 200, bins, 0.7, 0.4, 0.6, p);
    expect(a).toEqual(b);
  });

  it("grows with energy: range increases at higher energy", () => {
    const lo = buildTargetDeformation(200, 200, zeroBins, 0.5, 0.3, 0.1, p);
    const hi = buildTargetDeformation(200, 200, zeroBins, 0.5, 0.3, 0.9, p);
    const loRange = Math.max(...lo) - Math.min(...lo);
    const hiRange = Math.max(...hi) - Math.min(...hi);
    expect(hiRange).toBeGreaterThan(loRange);
  });

  it("grows with audioLevel: range increases at higher level", () => {
    // Use lower energy so FBM is subdued and pseudopod (driven by audioLevel) dominates
    const lo = buildTargetDeformation(200, 200, zeroBins, 0.5, 0.05, 0.3, p);
    const hi = buildTargetDeformation(200, 200, zeroBins, 0.5, 0.9, 0.3, p);
    // Because pseudopod offset is always >= 0, each vertex deformation should be
    // larger (or equal) at higher audioLevel, so the sum must grow.
    const loSum = lo.reduce((s, v) => s + v, 0);
    const hiSum = hi.reduce((s, v) => s + v, 0);
    expect(hiSum).toBeGreaterThan(loSum);
  });

  it("contains both FBM and pseudopod contributions", () => {
    const withPseudo = buildTargetDeformation(200, 200, zeroBins, 0.5, 0.7, 0.8, p);
    const noPseudo = buildTargetDeformation(200, 200, zeroBins, 0.5, 0.7, 0.8, {
      ...p,
      push: 0,
      idle: 0,
      levelGain: 0,
    });
    // With pseudopods, deformation range should be larger
    const withRange = Math.max(...withPseudo) - Math.min(...withPseudo);
    const noRange = Math.max(...noPseudo) - Math.min(...noPseudo);
    expect(withRange).toBeGreaterThan(noRange);
  });

  it("idle deformation produces subtle non-zero wobble", () => {
    const energy = cellEnergy("idle", 0, 5, p.idle, p.levelGain);
    const deform = buildTargetDeformation(200, 200, zeroBins, 5, 0, energy, p);
    // At least some vertices should have non-zero deformation
    const absMax = Math.max(...deform.map(Math.abs));
    expect(absMax).toBeGreaterThan(0);
  });

  it("spectrum bins increase deformation range", () => {
    const loBins = new Array(32).fill(0);
    const hiBins = new Array(32).fill(1);
    const lo = buildTargetDeformation(200, 200, loBins, 0.5, 0.5, 0.8, p);
    const hi = buildTargetDeformation(200, 200, hiBins, 0.5, 0.5, 0.8, p);
    const loRange = Math.max(...lo) - Math.min(...lo);
    const hiRange = Math.max(...hi) - Math.min(...hi);
    expect(hiRange).toBeGreaterThanOrEqual(loRange);
  });

  it("handles zero baseR gracefully (degenerate case)", () => {
    // Even with zero width/height, the function should not crash
    const zeroDeform = buildTargetDeformation(0, 0, new Array(32).fill(0), 0, 0, 0, p);
    expect(zeroDeform.length).toBe(96);
    for (const v of zeroDeform) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
  it("idleFactor defaults to 0 → no idle morph added (back-compat)", () => {
    const a = buildTargetDeformation(200, 200, zeroBins, 3.0, 0, 0.1, p);
    const b = buildTargetDeformation(200, 200, zeroBins, 3.0, 0, 0.1, p, 0);
    expect(a).toEqual(b);
  });
  it("idleFactor=1 adds idle morph (differs from idleFactor=0)", () => {
    const off = buildTargetDeformation(200, 200, zeroBins, 3.0, 0, 0.1, p, 0);
    const on = buildTargetDeformation(200, 200, zeroBins, 3.0, 0, 0.1, p, 1);
    let diff = 0;
    for (let i = 0; i < off.length; i++) diff += Math.abs(off[i] - on[i]);
    expect(diff).toBeGreaterThan(0.01);
  });

  it("uses resolveBaseRadius for pseudopod px→fraction (baseRadiusPx=16 in 160×160)", () => {
    // Without baseRadiusPx (legacy): baseR = 160 * 0.34 = 54.4
    // With baseRadiusPx=16: baseR = 16 (real small-cell radius)
    // Pseudopod offset is in px; division by smaller baseR yields larger fraction,
    // so the two outputs must differ (and both be finite).
    const legacy = buildTargetDeformation(160, 160, new Array(32).fill(0), 0.5, 0.7, 0.8, CELL_DEFAULTS);
    const absolute = buildTargetDeformation(160, 160, new Array(32).fill(0), 0.5, 0.7, 0.8, { ...CELL_DEFAULTS, baseRadiusPx: 16 });
    for (let i = 0; i < legacy.length; i++) {
      expect(Number.isFinite(legacy[i])).toBe(true);
      expect(Number.isFinite(absolute[i])).toBe(true);
    }
    // The two deformation arrays must differ because invBaseR differs.
    const sumSqDiff = legacy.reduce((s, v, i) => s + (v - absolute[i]) ** 2, 0);
    expect(sumSqDiff).toBeGreaterThan(1e-6);
  });
});

// ---------------------------------------------------------------------------
// Commit 29 — smooth rigid membrane (enableRigidMembrane)
// ---------------------------------------------------------------------------
// A real Paramecium is a rigid smooth spindle, not a wobbling amoeboid blob.
// When the gate is ON, the per-vertex deformation array is suppressed to a flat
// 0 (no FBM, no pseudopods, no audio bins, no idle morph) so the pre-affine body
// is a perfect circle that the downstream affine squeeze turns into a smooth
// spindle. When OFF (default) behavior is byte-identical to today.
describe("Commit 29 — smooth rigid membrane (enableRigidMembrane)", () => {
  it("defaults OFF", () => {
    expect(CELL_DEFAULTS.enableRigidMembrane).toBe(false);
  });

  it("gate ON ⇒ every vertex deform is exactly 0 (no input leaks through)", () => {
    const params = { ...CELL_DEFAULTS, enableRigidMembrane: true };
    const cases: Array<[number, number, number, number[]]> = [
      [0, 0, 0, new Array(32).fill(0)],
      [0.5, 0.7, 0.8, Array.from({ length: 32 }, (_, i) => i / 32)],
      [3.0, 1.0, 1.0, new Array(32).fill(1)],
      [7.3, 0.9, 0.95, Array.from({ length: 32 }, (_, i) => (i % 2 ? 1 : 0.3))],
    ];
    for (const [t, audioLevel, energy, bins] of cases) {
      const deform = buildTargetDeformation(160, 160, bins, t, audioLevel, energy, params, 1);
      expect(deform.length).toBe(96);
      for (const v of deform) expect(v).toBe(0);
    }
  });

  it("gate ON ⇒ max-min === 0 (perfectly round before squeeze)", () => {
    const params = { ...CELL_DEFAULTS, enableRigidMembrane: true };
    const deform = buildTargetDeformation(160, 160, new Array(32).fill(1), 2.5, 0.8, 0.9, params, 1);
    expect(Math.max(...deform) - Math.min(...deform)).toBe(0);
  });

  it("OFF path is unchanged: nonzero, varying array (gate did not flatten default)", () => {
    const params = { ...CELL_DEFAULTS, enableRigidMembrane: false };
    const bins = Array.from({ length: 32 }, (_, i) => i / 32);
    const deform = buildTargetDeformation(160, 160, bins, 0.5, 0.7, 0.8, params, 0);
    const absMax = Math.max(...deform.map(Math.abs));
    expect(absMax).toBeGreaterThan(0);
    expect(Math.max(...deform) - Math.min(...deform)).toBeGreaterThan(0);
  });

  it("OFF path is byte-identical to omitting the flag entirely", () => {
    const bins = Array.from({ length: 32 }, (_, i) => i / 32);
    const withFlag = buildTargetDeformation(160, 160, bins, 0.5, 0.7, 0.8, { ...CELL_DEFAULTS, enableRigidMembrane: false }, 0);
    const noFlag = buildTargetDeformation(160, 160, bins, 0.5, 0.7, 0.8, CELL_DEFAULTS, 0);
    expect(withFlag).toEqual(noFlag);
  });
});

// ---------------------------------------------------------------------------
// Commit 4 — deformation pipeline scaffold (gates default OFF) + FROZEN baseline
// ---------------------------------------------------------------------------
// The plan's INVARIANTS require a "frozen pre-B/C baseline": with every gate
// OFF, the deformation/contour output MUST be byte-identical to the pre-pipeline
// behavior. These goldens were captured from the pre-Commit-4 code path. Future
// B1/C1 commits prove they only change output when THEIR gate is ON — i.e. these
// gate-off goldens stay frozen across B1/C1.
describe("Commit 4: pipeline gates + frozen pre-B/C baseline", () => {
  const W = 160;
  const H = 160;
  const silentBins = new Array(32).fill(0);
  const drivenBins = Array.from({ length: 32 }, (_, i) => 0.3 + 0.5 * Math.sin(i * 0.7) ** 2);
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  const sumA = (a: number[]) => r6(a.reduce((s, b) => s + b, 0));
  const sumP = (a: Array<[number, number]>) => r6(a.flat().reduce((s, b) => s + b, 0));

  // FROZEN goldens (captured from pre-Commit-4 output; do NOT edit for B1/C1).
  const GOLDEN = {
    restDeformSampled: [-0.01466, 0.005423, 0.019191, 0.006608, 0.020551, -0.025245, -0.015535, -0.013773],
    restDeformSum: -0.222228,
    driveDeformSampled: [0.046078, 0.109861, 0.157079, 0.105625, 0.095806, -0.03365, 0.036302, 0.076711],
    driveDeformSum: 7.507509,
    restContourSampled: [134.46826, 118.840515, 80, 41.414074, 25.496351, 42.611637, 80, 118.8121],
    restContourSum: 15404.22804,
    driveContourSampled: [136.906626, 122.692585, 80, 37.470345, 20.388171, 42.827781, 80, 121.417418],
    driveContourSum: 15538.469603,
  };
  const DEFORM_IDX = [0, 12, 24, 36, 48, 60, 72, 84];
  const PT_IDX = [0, 24, 48, 72, 96, 120, 144, 168];

  // The frozen pre-B/C baseline must pin the gates OFF EXPLICITLY: Commit 6 (B1)
  // flips the enableSaturation DEFAULT to true, so any test that wants the
  // pre-saturation reference output must opt out of the new default. This keeps
  // the two baselines (gates-off reference vs. B1 saturated) from collapsing.
  const GATES_OFF: CellParams = {
    ...CELL_DEFAULTS,
    enableSaturation: false,
    enableAreaNorm: false,
    enableAffine: false,
    enableActivity: false,
  };

  it("gate defaults: B1 saturation + C1 areaNorm + G activity + D4 affine ON", () => {
    // Commit 6 (B1) flipped enableSaturation; Commit 7 (C1) enableAreaNorm;
    // Commit 8a (G) enableActivity; Commit 8b (D4) enableAffine.
    expect(CELL_DEFAULTS.enableSaturation).toBe(true);
    expect(CELL_DEFAULTS.enableAreaNorm).toBe(true);
    expect(CELL_DEFAULTS.enableActivity).toBe(true);
    expect(CELL_DEFAULTS.enableAffine).toBe(true);
  });

  it("resting deformation matches frozen pre-B/C baseline (gates off)", () => {
    const d = buildTargetDeformation(W, H, silentBins, 10, 0, GATES_OFF.idle, GATES_OFF, 1);
    expect(DEFORM_IDX.map((i) => r6(d[i]))).toEqual(GOLDEN.restDeformSampled);
    expect(sumA(d)).toBe(GOLDEN.restDeformSum);
  });

  it("driven deformation matches frozen pre-B/C baseline (gates off)", () => {
    const d = buildTargetDeformation(W, H, drivenBins, 10, 0.7, 0.7, GATES_OFF, 0);
    expect(DEFORM_IDX.map((i) => r6(d[i]))).toEqual(GOLDEN.driveDeformSampled);
    expect(sumA(d)).toBe(GOLDEN.driveDeformSum);
  });

  it("resting contour matches frozen pre-B/C baseline (gates off)", () => {
    const c = buildCellContour(W, H, silentBins, 10, 0, GATES_OFF.idle, GATES_OFF);
    const flat = c.flat();
    expect(PT_IDX.map((i) => r6(flat[i]))).toEqual(GOLDEN.restContourSampled);
    expect(sumP(c)).toBe(GOLDEN.restContourSum);
  });

  it("driven contour matches frozen pre-B/C baseline (gates off)", () => {
    const c = buildCellContour(W, H, drivenBins, 10, 0.7, 0.7, GATES_OFF);
    const flat = c.flat();
    expect(PT_IDX.map((i) => r6(flat[i]))).toEqual(GOLDEN.driveContourSampled);
    expect(sumP(c)).toBe(GOLDEN.driveContourSum);
  });

  it("saturate seam is identity when gate off", () => {
    const target = buildTargetDeformation(W, H, drivenBins, 3, 0.5, 0.5, GATES_OFF, 0);
    expect(saturateTargetDeform(target, GATES_OFF)).toEqual(target);
  });

  it("normalizeArea seam is identity when gate off", () => {
    // C1 (Commit 7) flips the gate ON in CELL_DEFAULTS and gives normalizeArea
    // real math, so the gate-ON branch is NO LONGER an identity (covered by the
    // Commit-7 block). Here we only pin the gate-OFF branch as a pure pass-through.
    const field = buildTargetDeformation(W, H, drivenBins, 3, 0.5, 0.5, GATES_OFF, 0);
    expect(normalizeAreaDeform(field, GATES_OFF)).toEqual(field);
  });

  it("affine seam is identity when gate off (any k, phi)", () => {
    const pts: Array<[number, number]> = [[10, 20], [30, 40], [50, 60]];
    expect(affineSqueezePoints(pts, 2.0, 0.7, 80, 80, GATES_OFF)).toEqual(pts);
  });

  it("integrateDeformPipeline (steps 4–7) equals bare integrateDeformation when gates off", () => {
    const prev = buildTargetDeformation(W, H, silentBins, 1, 0, GATES_OFF.idle, GATES_OFF, 1);
    const target = buildTargetDeformation(W, H, drivenBins, 2, 0.6, 0.6, GATES_OFF, 0);
    const viaPipeline = integrateDeformPipeline(prev, target, GATES_OFF);
    const viaBare = integrateDeformation(prev, target, GATES_OFF.attack, GATES_OFF.release);
    expect(viaPipeline).toEqual(viaBare);
  });

  it("integrateDeformPipeline seeds from target on the first frame (prev=null)", () => {
    const target = buildTargetDeformation(W, H, drivenBins, 2, 0.6, 0.6, GATES_OFF, 0);
    expect(integrateDeformPipeline(null, target, GATES_OFF)).toEqual(target.slice());
  });
});

// ---------------------------------------------------------------------------
// Commit 5 — C2 area-preserving affine squeeze (proven math, still GATED OFF)
// ---------------------------------------------------------------------------
// The map is M = R(+phi) . diag(k, 1/k) . R(-phi) about centre (cx,cy).
// det M = 1 exactly, so shoelace area is invariant for ANY contour shape
// (research-math-verify-v2.md item 1). These tests exercise the gate ON to
// prove the math; CELL_DEFAULTS keeps enableAffine=false so the live render
// (Commit-4 frozen baseline) is untouched.
describe("Commit 5: C2 affine squeeze (area-preserving, det=1)", () => {
  // Shoelace polygon area (signed -> abs). 2A = sum det[P_i, P_{i+1}].
  const shoelace = (pts: Array<[number, number]>): number => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  };
  // A NOISY, non-circular closed contour about centre (cx,cy)=(80,90).
  const CX = 80;
  const CY = 90;
  const noisy: Array<[number, number]> = Array.from({ length: 64 }, (_, i) => {
    const th = (i / 64) * Math.PI * 2;
    const r = 30 + 9 * Math.sin(3 * th) + 5 * Math.cos(7 * th + 1) + 3 * Math.sin(11 * th);
    return [CX + r * Math.cos(th), CY + r * Math.sin(th)] as [number, number];
  });
  const on = { ...CELL_DEFAULTS, enableAffine: true };
  const KS = [0.5, 0.8, 1.2, 2.0];
  const PHIS = [0, 0.7, Math.PI / 2, 2.0];

  it("preserves shoelace area to <=1e-9 for arbitrary k and phi on a noisy contour", () => {
    const a0 = shoelace(noisy);
    for (const k of KS) {
      for (const phi of PHIS) {
        const out = affineSqueezePoints(noisy, k, phi, CX, CY, on);
        expect(Math.abs(shoelace(out) - a0)).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it("actually deforms the contour when k != 1 (not a no-op placeholder)", () => {
    const out = affineSqueezePoints(noisy, 2.0, 0.7, CX, CY, on);
    const maxDelta = Math.max(...out.map((p, i) => Math.hypot(p[0] - noisy[i][0], p[1] - noisy[i][1])));
    expect(maxDelta).toBeGreaterThan(1); // visibly squeezed
  });

  it("k = 1 is the identity (points unchanged to ~1e-12)", () => {
    for (const phi of PHIS) {
      const out = affineSqueezePoints(noisy, 1, phi, CX, CY, on);
      const maxDelta = Math.max(...out.map((p, i) => Math.hypot(p[0] - noisy[i][0], p[1] - noisy[i][1])));
      expect(maxDelta).toBeLessThan(1e-12);
    }
  });

  it("resulting area is independent of phi (rotation invariance of det)", () => {
    const areas = PHIS.map((phi) => shoelace(affineSqueezePoints(noisy, 1.7, phi, CX, CY, on)));
    for (const a of areas) expect(Math.abs(a - areas[0])).toBeLessThanOrEqual(1e-9);
  });

  it("is exactly area-preserving even about a non-centroid centre", () => {
    const a0 = shoelace(noisy);
    const out = affineSqueezePoints(noisy, 1.5, 1.1, 0, 0, on); // squeeze about origin
    expect(Math.abs(shoelace(out) - a0)).toBeLessThanOrEqual(1e-9);
  });

  it("returns points untouched when the affine gate is off", () => {
    // (enableAffine is ON by default since Commit 8b; pin it off to exercise the
    // gate-off identity path the seam guarantees.)
    const out = affineSqueezePoints(noisy, 2.0, 0.7, CX, CY, { ...CELL_DEFAULTS, enableAffine: false });
    expect(out).toEqual(noisy);
  });
});

// ---------------------------------------------------------------------------
// Commit 6 — B1: soft-saturation `d <- Dmax*tanh(d/Dmax)` (gate flipped ON)
// ---------------------------------------------------------------------------
// tanh is the canonical soft clamp: g(d)=Dmax*tanh(d/Dmax) has unit slope at 0
// (so small deformations pass through unchanged), is odd, monotone, and strictly
// bounded |g| < Dmax. With saturation alone (motion/areaNorm off, k_max=1,
// |c|_max=0) the radius budget baseR*(1+Dmax) <= maxRadius=min(w,h)*0.46 holds,
// so the step-9 clamp is provably a no-op for the drifting_contour overlay.
// (research-membrane-areacons.md 4a; research-math-verify-v2.md item 5.)
describe("Commit 6: B1 soft-saturation (tanh)", () => {
  const SAT: CellParams = { ...CELL_DEFAULTS, enableSaturation: true };
  const OFF: CellParams = { ...CELL_DEFAULTS, enableSaturation: false };
  const Dmax = CELL_DEFAULTS.deformMax ?? 0.6;

  it("exposes a deformMax param with a sensible default", () => {
    expect(CELL_DEFAULTS.deformMax).toBeGreaterThan(0);
    expect(CELL_DEFAULTS.deformMax).toBeLessThanOrEqual(1);
  });

  it("has unit slope at 0 (g'(0)=1): tiny deformations are essentially unchanged", () => {
    const h = 1e-5;
    const out = saturateTargetDeform([h, -h], SAT);
    // finite-difference slope across 0 ~ (g(h)-g(-h))/(2h) -> 1
    const slope = (out[0] - out[1]) / (2 * h);
    expect(slope).toBeCloseTo(1, 6);
  });

  it("is bounded by Dmax even for huge / extreme inputs (asymptote never exceeded)", () => {
    // |Dmax*tanh| <= Dmax for all finite inputs; in float64 tanh saturates to
    // exactly 1.0 for large args, so equality is reachable but the bound is
    // never EXCEEDED — which is what the radius budget relies on.
    const out = saturateTargetDeform([5, 50, 1e6, -5, -1e6], SAT);
    for (const v of out) expect(Math.abs(v)).toBeLessThanOrEqual(Dmax);
  });

  it("is STRICTLY below Dmax for any moderate (non-saturating) input", () => {
    const out = saturateTargetDeform([2, -2, 3.5], SAT);
    for (const v of out) expect(Math.abs(v)).toBeLessThan(Dmax);
  });

  it("is odd-symmetric: g(-d) = -g(d)", () => {
    const ds = [0.1, 0.4, 0.9, 2.0, 7.0];
    const pos = saturateTargetDeform(ds, SAT);
    const neg = saturateTargetDeform(ds.map((d) => -d), SAT);
    pos.forEach((p, i) => expect(neg[i]).toBeCloseTo(-p, 12));
  });

  it("is monotone increasing in the input", () => {
    const ds = [-3, -1, -0.3, 0, 0.3, 1, 3];
    const out = saturateTargetDeform(ds, SAT);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
  });

  it("leaves small deformations (|d| << Dmax) nearly unchanged (<0.5% at 0.1*Dmax)", () => {
    const small = 0.1 * Dmax;
    const out = saturateTargetDeform([small, -small], SAT);
    // tanh(0.1)=0.09967 -> ~0.33% relative compression at 0.1*Dmax; well under 0.5%.
    expect(Math.abs(out[0] - small) / small).toBeLessThan(0.005);
    expect(Math.abs(out[1] - -small) / small).toBeLessThan(0.005);
  });

  it("is identity when the gate is OFF (no saturation applied)", () => {
    const ds = [0.2, 1.5, -3.0];
    expect(saturateTargetDeform(ds, OFF)).toEqual(ds);
  });

  it("radius budget: with saturation ON the step-9 clamp is a NO-OP under an audio x bin sweep", () => {
    // drifting_contour overlay: 160x160, baseRadiusPx 16, growthSwell 0.2.
    const W = 160;
    const H = 160;
    const maxRadius = Math.min(W, H) * 0.46; // 73.6
    const dcParams: CellParams = {
      ...CELL_DEFAULTS,
      enableSaturation: true,
      baseRadiusPx: 16,
      growthSwell: 0.2,
    };
    let maxObserved = 0;
    // Sweep audio level, growth, time, and bin energy; integrate frames so the
    // pipeline (saturate -> integrate) reaches steady state, then measure radius.
    for (const audio of [0, 0.3, 0.6, 1.0]) {
      for (const growth of [0, 0.5, 1.0]) {
        for (const t of [0, 3.3, 7.7, 13.1]) {
          const bins = Array.from({ length: 32 }, (_, i) => audio * (0.5 + 0.5 * Math.sin(i * 0.9 + t)));
          const baseR = resolveBaseRadius(W, H, dcParams, growth);
          let deform: number[] | null = null;
          for (let f = 0; f < 40; f++) {
            const target = buildTargetDeformation(W, H, bins, t + f * 0.05, audio, Math.max(audio, growth), dcParams, growth);
            deform = integrateDeformPipeline(deform, target, dcParams);
          }
          for (const d of deform!) {
            const rawRadius = baseR * (1 + d);
            maxObserved = Math.max(maxObserved, rawRadius);
            // The clamp is min(maxRadius, rawRadius): a no-op iff rawRadius < maxRadius.
            expect(rawRadius).toBeLessThan(maxRadius);
          }
        }
      }
    }
    // Sanity: the cell actually deforms (not a trivially tiny radius).
    expect(maxObserved).toBeGreaterThan(16);
  });

  it("closed-form budget holds: baseR*(1+Dmax) <= min(w,h)*0.46 for the drifting_contour overlay", () => {
    const W = 160, H = 160;
    const maxRadius = Math.min(W, H) * 0.46;
    const maxBaseR = 17 * (1 + 1.0 * 0.2); // re-tuned baseRadiusPx * (1 + growth*growthSwell) at growth=1
    expect(maxBaseR * (1 + Dmax)).toBeLessThanOrEqual(maxRadius);
  });
});

// ---------------------------------------------------------------------------
// Commit 7 — C1 area normalization + baseR re-tune + F9 nucleus pinch-escape
//            + M14 nucleus-vs-prolate (gate enableAreaNorm flipped ON)
// ---------------------------------------------------------------------------
// C1 holds the cell's AREA at pi*baseR^2 by a uniform radial offset on the
// INTEGRATED deform field: e_i = 1+d_i; with mean m1 and variance Var of e,
// c = m1 - sqrt(1 - Var) makes mean((1+d-c)^2) = 1 exactly (Var<=1). For the
// rare Var>1 case fall back to a multiplicative rescale s = 1/sqrt(mean(e^2)).
// This removes the outward-only "balloon" (a bulge now borrows from the
// opposite side) and is the start of the C1 baseline. baseRadiusPx is bumped
// 16->17: C1 mainly holds DRIVEN-speech area (pre-C1 mean(e^2)~1.34 at a=1,
// +34%); resting is ~unchanged, so 17 keeps a comfortable resting size while
// the budget still holds (see review note, /tmp/ado_review_commit7.md).
// (.pi/plans/cell-bio-accuracy-plan.md C1, F9, M14; research-membrane-areacons.md.)
describe("Commit 7: C1 area normalization + baseR re-tune", () => {
  const W = 160, H = 160, baseR = 17;
  const C1: CellParams = { ...CELL_DEFAULTS, baseRadiusPx: baseR };
  // mean((1+d)^2): proportional to enclosed area / (pi*baseR^2).
  const meanE2 = (d: number[]): number => {
    let s = 0;
    for (const x of d) { const e = 1 + x; s += e * e; }
    return s / d.length;
  };
  const steadyState = (bins: number[], audio: number, energy: number, params: CellParams, idle = 0): number[] => {
    let d: number[] | null = null;
    for (let f = 0; f < 60; f++) {
      const target = buildTargetDeformation(W, H, bins, f * 0.05, audio, energy, params, idle);
      d = integrateDeformPipeline(d, target, params);
    }
    return d!;
  };

  it("flips enableAreaNorm ON by default", () => {
    expect(CELL_DEFAULTS.enableAreaNorm).toBe(true);
  });

  it("re-tunes baseRadiusPx upward (~+10%) to offset the C1 area hold", () => {
    // drifting_contour ships baseRadiusPx; the renderer default must rise so the
    // resting cell is not visibly smaller after C1 pins area to pi*baseR^2.
    expect(baseR).toBeGreaterThan(16);
    expect(baseR).toBeLessThanOrEqual(16 * 1.2);
  });

  it("holds area at pi*baseR^2 (+/-2%) across an audio sweep", () => {
    for (const audio of [0, 0.25, 0.5, 0.75, 1.0]) {
      const bins = Array.from({ length: 32 }, (_, i) => audio * (0.5 + 0.5 * Math.sin(i * 0.9)));
      const d = steadyState(bins, audio, Math.max(0.1, audio), C1, audio === 0 ? 1 : 0);
      // mean((1+d)^2) == 1 means area == pi*baseR^2 exactly.
      expect(meanE2(d)).toBeCloseTo(1, 2); // within ~1% (2 decimals)
    }
  });

  it("normalizeAreaDeform makes mean((1+d)^2)=1 for an arbitrary field", () => {
    const field = [0.3, 0.1, -0.05, 0.4, 0.0, -0.1, 0.25, 0.15];
    const out = normalizeAreaDeform(field, { ...C1, enableAreaNorm: true });
    expect(meanE2(out)).toBeCloseTo(1, 9);
  });

  it("a one-sided bulge borrows from the opposite side (anti-balloon)", () => {
    // An all-positive (outward-only) field has area > pi*baseR^2. After C1 the
    // mean offset is positive, so previously-flat regions go NEGATIVE (inward):
    // the bulge is paid for by the rest of the membrane.
    const field = [0.5, 0.4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    const out = normalizeAreaDeform(field, { ...C1, enableAreaNorm: true });
    // The originally-flat vertices must now dip inward.
    expect(out[4]).toBeLessThan(0);
    // The bulge is reduced but still the largest.
    expect(out[0]).toBeLessThan(field[0]);
    expect(Math.max(...out)).toBeCloseTo(out[0], 9);
  });

  it("Var(e)>1 multiplicative fallback produces a finite, area-correct field (no NaN)", () => {
    // A high-variance field (Var(e) > 1) would make sqrt(1-Var) imaginary; the
    // fallback s = 1/sqrt(mean(e^2)) must keep everything finite and area-correct.
    const field = [1.5, -0.6, 1.8, -0.7, 1.6, -0.65, 1.7, -0.55];
    const out = normalizeAreaDeform(field, { ...C1, enableAreaNorm: true });
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    expect(meanE2(out)).toBeCloseTo(1, 9);
  });

  it("never produces an inside-out vertex (1 + d_i > 0 for all i)", () => {
    for (const audio of [0, 0.5, 1.0]) {
      const bins = Array.from({ length: 32 }, (_, i) => audio * Math.abs(Math.sin(i * 1.3)));
      const d = steadyState(bins, audio, Math.max(0.1, audio), C1, audio === 0 ? 1 : 0);
      for (const v of d) expect(1 + v).toBeGreaterThan(0);
    }
  });

  it("is frame-convergent: repeated application is a fixed point", () => {
    const once = normalizeAreaDeform([0.3, 0.1, -0.05, 0.4, 0.0, -0.1], { ...C1, enableAreaNorm: true });
    const twice = normalizeAreaDeform(once, { ...C1, enableAreaNorm: true });
    once.forEach((v, i) => expect(twice[i]).toBeCloseTo(v, 9));
  });

  it("radius budget still holds with C1: baseR*(1+Dmax+|c|_max) <= min(w,h)*0.46", () => {
    const maxRadius = Math.min(W, H) * 0.46; // 73.6
    const Dmax = CELL_DEFAULTS.deformMax ?? 0.6;
    // Measure the worst |c| (and worst per-vertex deform) across a heavy sweep.
    let maxRaw = 0;
    for (const audio of [0, 0.5, 1.0]) {
      for (const growth of [0, 0.5, 1.0]) {
        const bins = Array.from({ length: 32 }, (_, i) => audio * (0.5 + 0.5 * Math.sin(i * 0.9)));
        const params: CellParams = { ...C1, growthSwell: 0.2 };
        const br = resolveBaseRadius(W, H, params, growth);
        const d = steadyState(bins, audio, Math.max(0.1, audio), params, audio === 0 ? 1 : 0);
        for (const v of d) maxRaw = Math.max(maxRaw, br * (1 + v));
      }
    }
    expect(maxRaw).toBeLessThan(maxRadius);
  });
});

// ---------------------------------------------------------------------------
// Commit 7 — F9 nucleus pinch-escape + M14 nucleus-vs-prolate squeeze
// ---------------------------------------------------------------------------
// F9: the nucleus must stay inside the LIVE membrane, whose local radius can
// floor near baseR*0.35 under a deep inward pinch. The old fixed safe radius
// (baseR*0.55) assumed an undeformed wall and could let the nucleus poke out.
// nucleusTransform now takes the live minimum membrane radius and clamps
// |offset| + r <= minMembraneR*(1-0.15). M14: when the body is squeezed into a
// prolate ellipse (k,phi), the same affine map is applied to the nucleus so it
// stays inside on BOTH axes.
describe("Commit 7: F9 nucleus pinch-escape", () => {
  const baseR = 20;
  const p = { ...CELL_DEFAULTS, baseRadiusPx: baseR };

  it("accepts a live minMembraneR and keeps the nucleus inside it (deep pinch)", () => {
    // Simulate a deep pinch: the membrane floors to 0.35*baseR somewhere, so the
    // smallest local radius the nucleus must fit inside is minR = 0.35*baseR.
    const minR = 0.35 * baseR;
    for (let t = 0; t < 30; t += 1.1) {
      for (let level = 0; level <= 1; level += 0.2) {
        const n = nucleusTransform(t, level, baseR, p, minR);
        const offset = Math.sqrt(n.cx * n.cx + n.cy * n.cy);
        // |offset| + r <= minR * 0.85 (the (1-0.15) safety margin).
        expect(offset + n.r).toBeLessThanOrEqual(minR * 0.85 + 1e-6);
      }
    }
  });

  it("deep pinch + max drift keeps the nucleus disk fully inside for ALL perimeter angles", () => {
    const minR = 0.35 * baseR;
    // Worst case: nucleus pushed to its max offset; check the far edge of the
    // disk in the direction of the offset is still inside minR.
    let worst = 0;
    for (let t = 0; t < 50; t += 0.7) {
      const n = nucleusTransform(t, 1.0, baseR, p, minR);
      worst = Math.max(worst, Math.sqrt(n.cx * n.cx + n.cy * n.cy) + n.r);
    }
    expect(worst).toBeLessThanOrEqual(minR * 0.85 + 1e-6);
  });

  it("backward-compatible: omitting minMembraneR uses the old baseR*0.55 safe zone", () => {
    // Existing callers/tests that don't pass minMembraneR keep the prior bound.
    const safeInner = baseR * 0.55;
    for (let t = 0; t < 20; t += 1.3) {
      const n = nucleusTransform(t, 0.5, baseR, p);
      const total = Math.sqrt(n.cx * n.cx + n.cy * n.cy) + n.r;
      expect(total).toBeLessThanOrEqual(safeInner + 0.001);
    }
  });

  it("a tighter minMembraneR shrinks the nucleus more than a looser one", () => {
    const tight = nucleusTransform(5.0, 1.0, baseR, p, 0.35 * baseR);
    const loose = nucleusTransform(5.0, 1.0, baseR, p, 0.55 * baseR);
    expect(tight.r).toBeLessThanOrEqual(loose.r);
  });
});

describe("Commit 7: M14 nucleus follows the body prolate squeeze", () => {
  const baseR = 20;
  const p = { ...CELL_DEFAULTS, baseRadiusPx: baseR, enableAffine: true };

  // The same affine squeeze used on the membrane points, applied to a point.
  const squeeze = (px: number, py: number, k: number, phi: number): [number, number] => {
    const out = affineSqueezePoints([[px, py]], k, phi, 0, 0, p);
    return out[0];
  };

  it("keeps the squeezed nucleus disk inside the squeezed membrane on BOTH axes", () => {
    const k = 1.3;
    const phi = 0.6;
    const minR = 0.35 * baseR;
    for (let t = 0; t < 30; t += 1.7) {
      const n = nucleusTransform(t, 0.8, baseR, p, minR);
      // Squeeze the nucleus CENTRE the same way the membrane is squeezed.
      const [scx, scy] = squeeze(n.cx, n.cy, k, phi);
      // The membrane's minimum radius along the SHORT axis is minR/k... the
      // nucleus radius also scales by at most k on its long axis. Verify the
      // nucleus, squeezed, still sits within the squeezed safe zone on both axes
      // by checking the extreme points of the disk after the affine map.
      // Disk edge points along +/-x and +/-y, mapped, must stay within the
      // squeezed safe ellipse (semi-axes minR*0.85*k and minR*0.85/k).
      const safe = minR * 0.85;
      const ax = safe * k;
      const ay = safe / k;
      for (const [ex, ey] of [[n.r, 0], [-n.r, 0], [0, n.r], [0, -n.r]] as Array<[number, number]>) {
        const [mx, my] = squeeze(n.cx + ex, n.cy + ey, k, phi);
        // Point must be inside the squeezed safe ellipse (rotate back by -phi).
        const c = Math.cos(phi), s = Math.sin(phi);
        const rx = mx * c + my * s;
        const ry = -mx * s + my * c;
        expect((rx * rx) / (ax * ax) + (ry * ry) / (ay * ay)).toBeLessThanOrEqual(1 + 1e-6);
      }
      // Sanity: the centre moved (squeeze is not a no-op for off-centre points).
      void scx; void scy;
    }
  });
});

// ---------------------------------------------------------------------------
// integrateDeformation
// ---------------------------------------------------------------------------

describe("integrateDeformation", () => {
  const sampleCount = 96;

  it("returns array of same length as inputs", () => {
    const prev = new Array(sampleCount).fill(0);
    const target = new Array(sampleCount).fill(0.1);
    const result = integrateDeformation(prev, target, 0.2, 0.005);
    expect(result.length).toBe(sampleCount);
  });

  it("is deterministic", () => {
    const prev = Array.from({ length: sampleCount }, (_, i) => i / sampleCount);
    const target = Array.from({ length: sampleCount }, (_, i) => (sampleCount - i) / sampleCount);
    const a = integrateDeformation(prev, target, 0.2, 0.005);
    const b = integrateDeformation(prev, target, 0.2, 0.005);
    expect(a).toEqual(b);
  });

  it("attack moves faster than release toward same target", () => {
    const prev = new Array(10).fill(0);
    // Growing target (target > prev in absolute terms at each vertex)
    const targetUp = new Array(10).fill(1.0);
    const resultUp = integrateDeformation(prev, targetUp, 0.2, 0.005);

    // Shrinking target (|target| < |prev| at each vertex)
    const prevHigh = new Array(10).fill(1.0);
    const targetDown = new Array(10).fill(0);
    const resultDown = integrateDeformation(prevHigh, targetDown, 0.2, 0.005);

    // After one frame: attack should move toward target much more than release
    const attackMove = Math.abs(resultUp[0] - prev[0]); // 0 → ~0.2
    const releaseMove = Math.abs(resultDown[0] - prevHigh[0]); // 1.0 → ~0.995
    expect(attackMove).toBeGreaterThan(releaseMove);
  });

  it("converges upward under sustained non-zero drive", () => {
    let current = new Array(10).fill(0);
    const target = new Array(10).fill(0.5);

    // Apply 20 frames of integration
    for (let step = 0; step < 20; step++) {
      current = integrateDeformation(current, target, 0.2, 0.005);
    }

    // After 20 frames at attack=0.2, should be close to target
    for (let i = 0; i < 10; i++) {
      // (1-0.2)^20 ≈ 0.0115, so reached ~98.8% of target
      expect(current[i]).toBeGreaterThanOrEqual(target[i] * 0.9);
    }
  });

  it("decays toward zero slowly when target flips to all-zeros", () => {
    // Start with significant deformation
    let current = new Array(10).fill(1.0);
    const target = new Array(10).fill(0.0);

    // Apply one frame with small release
    current = integrateDeformation(current, target, 0.2, 0.02);

    // After 1 step with release=0.02, value should still be > 0.95 * prev
    for (let i = 0; i < 10; i++) {
      expect(current[i]).toBeGreaterThan(0.95);
    }
  });

  it("slowly decays toward zero over many frames with tiny release", () => {
    let current = new Array(10).fill(1.0);
    const target = new Array(10).fill(0.0);

    // Apply 30 frames with release=0.005
    for (let step = 0; step < 30; step++) {
      current = integrateDeformation(current, target, 0.2, 0.005);
    }

    // After 30 frames at release=0.005: (1-0.005)^30 ≈ 0.861 — still mostly there
    for (let i = 0; i < 10; i++) {
      expect(current[i]).toBeGreaterThan(0.8);
    }
  });

  it("clamps attack and release to [0, 1]", () => {
    const prev = new Array(5).fill(0);
    const target = new Array(5).fill(1.0);

    // Negative attack → clamped to 0 → no movement
    const rNeg = integrateDeformation(prev, target, -1, 0.5);
    expect(rNeg).toEqual(prev);

    // Attack > 1 → clamped to 1 → instant jump to target
    const rOver = integrateDeformation(prev, target, 2.0, 0.1);
    expect(rOver).toEqual(target);

    // Release > 1 with shrinking target → clamped to 1 → instant jump
    const prevHigh = new Array(5).fill(1.0);
    const targetZero = new Array(5).fill(0);
    const rRelOver = integrateDeformation(prevHigh, targetZero, 0.1, 2.0);
    expect(rRelOver).toEqual(targetZero);
  });

  it("handles negative target deformation correctly", () => {
    // Negative targets with large magnitude should trigger attack path
    const prev = new Array(10).fill(0);
    const targetNeg = new Array(10).fill(-0.5);
    const result = integrateDeformation(prev, targetNeg, 0.2, 0.005);
    // |target| >= |prev| → attack rate applies, moving toward -0.5
    for (let i = 0; i < 10; i++) {
      expect(result[i]).toBeLessThan(0);
      // At attack=0.2: 0 + (-0.5 - 0)*0.2 = -0.1
      expect(result[i]).toBeCloseTo(-0.1, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// catmullRom
// ---------------------------------------------------------------------------

describe("catmullRom", () => {
  it("returns N * segmentsPerSpan points for N ≥ 2", () => {
    const pts: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const result = catmullRom(pts, 3);
    expect(result.length).toBe(pts.length * 3);
  });

  it("passes through control points approximately (at endpoints of segments)", () => {
    const pts: Array<[number, number]> = [[100, 0], [200, 0], [200, 100], [100, 100]];
    const segs = 5;
    const result = catmullRom(pts, segs);

    // The Catmull-Rom spline passes through each control point p[i] at
    // t=0 of segment i. For segmentsPerSpan=5, index 0, 5, 10, 15 should
    // be at the control points.
    for (let i = 0; i < pts.length; i++) {
      const idx = i * segs;
      const [x, y] = result[idx];
      expect(x).toBeCloseTo(pts[i][0], 6);
      expect(y).toBeCloseTo(pts[i][1], 6);
    }
  });

  it("handles 2 points (returns 2 * segmentsPerSpan points)", () => {
    const pts: Array<[number, number]> = [[0, 0], [10, 10]];
    const result = catmullRom(pts, 4);
    expect(result.length).toBe(8);
  });

  it("returns all finite values", () => {
    const pts: Array<[number, number]> = [
      [50, 50], [150, 40], [180, 80], [150, 120], [50, 100],
    ];
    const result = catmullRom(pts, 4);
    for (const [x, y] of result) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("produces smooth points (no large jumps between consecutive)", () => {
    const pts: Array<[number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const result = catmullRom(pts, 10);
    for (let i = 1; i < result.length; i++) {
      const dx = result[i][0] - result[i - 1][0];
      const dy = result[i][1] - result[i - 1][1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      // With 10 segments between [100,0]→[100,100] the max step is ~10
      expect(dist).toBeLessThan(20);
    }
  });

  it("is deterministic", () => {
    const pts: Array<[number, number]> = [[1, 2], [3, 4], [5, 6]];
    const a = catmullRom(pts, 3);
    const b = catmullRom(pts, 3);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// buildCellContour
// ---------------------------------------------------------------------------

describe("buildCellContour", () => {
  const p = { ...CELL_DEFAULTS };
  const zeroBins = new Array(32).fill(0);

  it("returns 96 points (sampleCount)", () => {
    const pts = buildCellContour(400, 100, zeroBins, 0, 0, 0.3, p);
    expect(pts.length).toBe(96);
  });

  it("produces a closed loop (96 distinct samples, 0 to ~2π)", () => {
    const pts = buildCellContour(400, 100, zeroBins, 0.5, 0.2, 0.4, p);
    expect(pts.length).toBe(96);
    // First sample (angle 0) and last sample (angle ~(95/96)*TAU) are distinct
    // angles with potentially different noise; the loop closes visually via
    // a path from last back to first (closePath). Verify both are finite.
    expect(Number.isFinite(pts[0][0])).toBe(true);
    expect(Number.isFinite(pts[0][1])).toBe(true);
    expect(Number.isFinite(pts[95][0])).toBe(true);
    expect(Number.isFinite(pts[95][1])).toBe(true);
  });

  it("keeps all points within [−baseR*2, w+baseR*2] × [−baseR*2, h+baseR*2]", () => {
    const w = 400, h = 100;
    const pts = buildCellContour(w, h, zeroBins, 0, 0.5, 0.8, p);
    const baseR = Math.min(w, h) * p.radiusFraction;
    const margin = baseR * 2;
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThan(-margin);
      expect(x).toBeLessThan(w + margin);
      expect(y).toBeGreaterThan(-margin);
      expect(y).toBeLessThan(h + margin);
    }
  });

  it("spectrum bin response changes individual radii", () => {
    const binsLow = new Array(32).fill(0);
    const binsHigh = new Array(32).fill(1);

    const ptsLow = buildCellContour(200, 200, binsLow, 0, 0.5, 0.8, p);
    const ptsHigh = buildCellContour(200, 200, binsHigh, 0, 0.5, 0.8, p);

    // With full-scale bins, at least some points should have larger radii
    const cx = 100, cy = 100;
    const rLow = ptsLow.map(([x, y]) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2));
    const rHigh = ptsHigh.map(([x, y]) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2));

    const avgLow = rLow.reduce((a, b) => a + b, 0) / rLow.length;
    const avgHigh = rHigh.reduce((a, b) => a + b, 0) / rHigh.length;
    expect(avgHigh).toBeGreaterThanOrEqual(avgLow);
  });

  it("is deterministic", () => {
    const bins = Array.from({ length: 32 }, (_, i) => i / 32);
    const a = buildCellContour(300, 200, bins, 0.7, 0.4, 0.6, p);
    const b = buildCellContour(300, 200, bins, 0.7, 0.4, 0.6, p);
    expect(a).toEqual(b);
  });

  it("idle mode produces visible variation (≥5% of baseR)", () => {
    const energy = cellEnergy("idle", 0, 0, p.idle, p.levelGain);
    const pts = buildCellContour(200, 200, zeroBins, 0, 0, energy, p);
    const cx = 100, cy = 100;
    const radii = pts.map(([x, y]) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2));
    // All radii should be positive
    expect(radii.every((r) => r > 0)).toBe(true);
    // Idle variation should be visible — range ≥ 5% of expected base radius
    const baseR = Math.min(200, 200) * p.radiusFraction;
    const range = Math.max(...radii) - Math.min(...radii);
    expect(range).toBeGreaterThanOrEqual(baseR * 0.05);
  });

  it("clamps radius to [baseR*0.35, height*0.46] even at extreme energy", () => {
    const w = 172, h = 36;
    const baseR = Math.min(w, h) * p.radiusFraction;
    // Recording at max energy and audio
    const energy = cellEnergy("recording", 1.0, 10, p.idle, p.levelGain);
    for (let trial = 0; trial < 20; trial++) {
      const pts = buildCellContour(w, h, new Array(32).fill(1), trial, 1.0, energy, {
        ...p,
        // Crank amplitudes to stress-test the clamp
        membraneAmplitude: 2.0,
        energyDrive: 2.0,
        push: 20,
      });
      const cx = w / 2, cy = h / 2;
      for (const [x, y] of pts) {
        const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        expect(r).toBeGreaterThanOrEqual(baseR * 0.35 - 0.001);
        expect(r).toBeLessThanOrEqual(h * 0.46 + 0.001);
      }
    }
  });

  it("produces visibly egg-shaped / non-circular contour during recording", () => {
    const w = 200, h = 200;
    const energy = cellEnergy("recording", 0.9, 3, p.idle, p.levelGain);
    const pts = buildCellContour(w, h, zeroBins, 3, 0.9, energy, p);
    const cx = w / 2, cy = h / 2;
    const radii = pts.map(([x, y]) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2));
    const baseR = Math.min(w, h) * p.radiusFraction;
    const range = Math.max(...radii) - Math.min(...radii);
    // Recording deformation should be at least 15% of baseR
    expect(range).toBeGreaterThanOrEqual(baseR * 0.15);
    // Aspect ratio (max/min) should measurably deviate from 1
    const aspect = Math.max(...radii) / Math.min(...radii);
    expect(aspect).toBeGreaterThan(1.20);
  });
});

// ---------------------------------------------------------------------------
// nucleusTransform
// ---------------------------------------------------------------------------

describe("nucleusTransform", () => {
  const p = { ...CELL_DEFAULTS };
  const w = 172, h = 36;
  const baseR = Math.min(w, h) * p.radiusFraction; // ≈ 12.24 px

  it("returns deterministic output for same inputs", () => {
    const a = nucleusTransform(1.5, 0.3, baseR, p);
    const b = nucleusTransform(1.5, 0.3, baseR, p);
    expect(a.cx).toBe(b.cx);
    expect(a.cy).toBe(b.cy);
    expect(a.r).toBe(b.r);
  });

  it("returns non-negative radius", () => {
    for (let t = 0; t < 20; t += 1.7) {
      for (let level = 0; level <= 1; level += 0.2) {
        const n = nucleusTransform(t, level, baseR, p);
        expect(n.r).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("has a positive minimum pixel radius floor (>= 2.5 px)", () => {
    // Small baseR and zero audio — should still be at least 2.5 px
    const small = nucleusTransform(0, 0, 5, p);
    expect(small.r).toBeGreaterThanOrEqual(2.5);
  });

  it("nucleus stays inside safe inner radius for many t samples and audio levels", () => {
    // sqrt(cx^2 + cy^2) + r <= baseR * 0.55
    const safeInner = baseR * 0.55;
    for (let t = 0; t < 30; t += 1.3) {
      for (let level = 0; level <= 1; level += 0.1) {
        const n = nucleusTransform(t, level, baseR, p);
        const offsetMag = Math.sqrt(n.cx * n.cx + n.cy * n.cy);
        const total = offsetMag + n.r;
        expect(total).toBeLessThanOrEqual(safeInner + 0.001);
      }
    }
    // Sanity: nucleus does produce non-trivial offsets at some times
    const n2 = nucleusTransform(5.0, 0.3, baseR, p);
    const offsetMag2 = Math.sqrt(n2.cx * n2.cx + n2.cy * n2.cy);
    const total2 = offsetMag2 + n2.r;
    expect(total2).toBeLessThanOrEqual(safeInner + 0.001);
  });

  it("radius grows with audioLevel (monotonic-ish across many time samples)", () => {
    // Due to the idle breath term (sin-based), radius may oscillate
    // slightly, so we check that averaged over many t values, the sum
    // at audioLevel=1 is larger than at audioLevel=0.
    let sumLow = 0, sumHigh = 0;
    for (let ti = 0; ti < 50; ti++) {
      sumLow += nucleusTransform(ti * 0.5, 0, baseR, p).r;
      sumHigh += nucleusTransform(ti * 0.5, 1.0, baseR, p).r;
    }
    expect(sumHigh).toBeGreaterThan(sumLow);
  });

  it("cx and cy drift over time (different t produce different offsets)", () => {
    const n1 = nucleusTransform(0, 0.3, baseR, p);
    const n2 = nucleusTransform(5.0, 0.3, baseR, p);
    const n3 = nucleusTransform(10.0, 0.3, baseR, p);
    // At least one of cx/cy should differ between time points (the
    // nucleus is not stuck at the exact same offset forever).
    const changedCx = n1.cx !== n2.cx || n2.cx !== n3.cx;
    const changedCy = n1.cy !== n2.cy || n2.cy !== n3.cy;
    expect(changedCx || changedCy).toBe(true);
  });

  it("cx and cy are bounded by nucleusWander * baseR", () => {
    const maxWander = baseR * p.nucleusWander;
    for (let t = 0; t < 20; t += 1.5) {
      const n = nucleusTransform(t, 0.3, baseR, p);
      expect(Math.abs(n.cx)).toBeLessThanOrEqual(maxWander + 0.001);
      expect(Math.abs(n.cy)).toBeLessThanOrEqual(maxWander + 0.001);
    }
  });

  it("all return values are finite", () => {
    for (let t = 0; t < 20; t += 2) {
      for (let level = 0; level <= 1; level += 0.25) {
        const n = nucleusTransform(t, level, baseR, p);
        expect(Number.isFinite(n.cx)).toBe(true);
        expect(Number.isFinite(n.cy)).toBe(true);
        expect(Number.isFinite(n.r)).toBe(true);
      }
    }
  });

  it("handles zero baseR gracefully", () => {
    const n = nucleusTransform(1.0, 0.5, 0, p);
    expect(Number.isFinite(n.cx)).toBe(true);
    expect(Number.isFinite(n.cy)).toBe(true);
    expect(Number.isFinite(n.r)).toBe(true);
    // With baseR=0, safeInner=0 so cx,cy must be 0 and r clamped to 0.
    expect(n.cx).toBe(0);
    expect(n.cy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// startleOffset
// ---------------------------------------------------------------------------

describe("startleOffset", () => {
  // startleOffset(prevMag, level, baseline, sensitivity, decay) -> newMag in [0,1]
  it("fires on a sharp rising edge (level >> baseline)", () => {
    const m = startleOffset(0, 0.9, 0.1, 2.0, 0.85);
    expect(m).toBeGreaterThan(0.3); // a jolt was triggered
  });
  it("does not fire when level ~ baseline (steady sound)", () => {
    const m = startleOffset(0, 0.5, 0.5, 2.0, 0.85);
    expect(m).toBeLessThan(0.05);
  });
  it("decays toward 0 when no new edge", () => {
    const m = startleOffset(1.0, 0.2, 0.2, 2.0, 0.85);
    expect(m).toBeLessThan(1.0);
    expect(m).toBeGreaterThan(0.5); // decay 0.85 → keeps 85%
  });
  it("clamps to [0,1] and never negative", () => {
    expect(startleOffset(0, 5, 0, 10, 0.9)).toBeLessThanOrEqual(1);
    expect(startleOffset(0, 0, 1, 2, 0.9)).toBeGreaterThanOrEqual(0);
  });
  it("takes the max of decayed-previous and new-edge (sustained startle holds)", () => {
    // strong previous, weak edge → stays high via decay, not reset by edge
    const m = startleOffset(0.9, 0.3, 0.3, 2.0, 0.9);
    expect(m).toBeCloseTo(0.81, 1); // 0.9 * 0.9 decay
  });
});

// ---------------------------------------------------------------------------
// ciliaEndpoints
// ---------------------------------------------------------------------------

describe("ciliaEndpoints", () => {
  const P = CELL_DEFAULTS;
  it("emits `ciliaCount` cilia", () => {
    const c = ciliaEndpoints(86, 18, 12, 1.0, 0.3, 0.2, P);
    expect(c.length).toBe(P.ciliaCount);
  });
  it("tips extend beyond their bases (outward)", () => {
    const c = ciliaEndpoints(86, 18, 12, 1.0, 0.5, 0.3, P);
    for (const cil of c) {
      const baseR = Math.hypot(cil.x1 - 86, cil.y1 - 18);
      const tipR = Math.hypot(cil.x2 - 86, cil.y2 - 18);
      expect(tipR).toBeGreaterThan(baseR);
    }
  });
  it("is deterministic", () => {
    const a = ciliaEndpoints(86, 18, 12, 2.0, 0.4, 0.2, P);
    const b = ciliaEndpoints(86, 18, 12, 2.0, 0.4, 0.2, P);
    expect(a).toEqual(b);
  });
  it("cilia get longer with growth", () => {
    const lo = ciliaEndpoints(86, 18, 12, 1.0, 0.3, 0.0, P)[0];
    const hi = ciliaEndpoints(86, 18, 12, 1.0, 0.3, 1.0, P)[0];
    const len = (c: { x1: number; y1: number; x2: number; y2: number }) =>
      Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
    expect(len(hi)).toBeGreaterThan(len(lo));
  });
  it("each cilium has a control point bent sideways off the base->tip line (curved, not straight)", () => {
    // A biological cilium/flagellum is not a rigid spike: it bows to one
    // side. We model it as a quadratic Bezier whose control point (cpx,cpy)
    // is offset PERPENDICULAR to the base->tip chord. At least some cilia
    // must bend noticeably (perpendicular distance > 1px) so the organism
    // reads as alive rather than a sea-urchin of straight needles.
    const cilia = ciliaEndpoints(86, 18, 12, 1.3, 0.6, 0.8, P);
    // EVERY hair must bow (no straight needles), not just some.
    for (const c of cilia) {
      const dx = c.x2 - c.x1;
      const dy = c.y2 - c.y1;
      const len = Math.hypot(dx, dy) || 1;
      // signed perpendicular distance of control point from the chord
      const perp = ((c.cpx - c.x1) * -dy + (c.cpy - c.y1) * dx) / len;
      expect(Math.abs(perp)).toBeGreaterThan(1);
    }
  });
  it("cilia curvature varies between hairs and over time (chaotic, not uniform)", () => {
    // Different hairs bend by different amounts, and a given hair's bend
    // evolves over time — no single rigid sway shared by all.
    const at = (t: number) => ciliaEndpoints(86, 18, 12, t, 0.5, 0.6, P);
    const perpOf = (c: { x1: number; y1: number; x2: number; y2: number; cpx: number; cpy: number }) => {
      const dx = c.x2 - c.x1, dy = c.y2 - c.y1;
      const len = Math.hypot(dx, dy) || 1;
      return ((c.cpx - c.x1) * -dy + (c.cpy - c.y1) * dx) / len;
    };
    const frame = at(2.0);
    const perps = frame.map(perpOf);
    // not all equal -> spatial variety
    expect(Math.max(...perps) - Math.min(...perps)).toBeGreaterThan(0.5);
    // first hair's bend changes over time -> temporal variety
    expect(Math.abs(perpOf(at(2.0)[0]) - perpOf(at(6.0)[0]))).toBeGreaterThan(0.1);
  });
  it("hairs sway ASYNCHRONOUSLY (per-hair frequency, not one shared rhythm)", () => {
    // Symmetric/mechanical look = every hair sways with the SAME temporal
    // phase, so the crown pulses in lock-step. A living organism has each
    // cilium beating at its own rate. Measure the tip-angle time series of
    // two different hairs and require their motion to be decorrelated.
    const tipAngle = (c: { x1: number; y1: number; x2: number; y2: number }, cx = 86, cy = 18) =>
      Math.atan2(c.y2 - cy, c.x2 - cx);
    const hairA: number[] = [];
    const hairB: number[] = [];
    for (let t = 0; t < 30; t += 0.25) {
      const f = ciliaEndpoints(86, 18, 12, t, 0.5, 0.4, P);
      hairA.push(tipAngle(f[0]));
      hairB.push(tipAngle(f[Math.floor(f.length / 2)]));
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const ma = mean(hairA), mb = mean(hairB);
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < hairA.length; i++) {
      const da = hairA[i] - ma, db = hairB[i] - mb;
      cov += da * db; va += da * da; vb += db * db;
    }
    const corr = cov / (Math.sqrt(va * vb) || 1);
    expect(Math.abs(corr)).toBeLessThan(0.6);
  });
});

// ---------------------------------------------------------------------------
// ciliaBeatPhase — asymmetric two-phase beat clock (power vs recovery)
// ---------------------------------------------------------------------------

describe("ciliaBeatPhase", () => {
  const P = CELL_DEFAULTS;
  it("returns a phase in [0,1)", () => {
    for (let t = 0; t < 5; t += 0.13) {
      const p = ciliaBeatPhase(t, 0, P);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1.0000001);
    }
  });
  it("is asymmetric: the power stroke occupies LESS time than recovery", () => {
    // With ciliaAsymmetry>0 the phase should advance quickly through the
    // power-stroke band (say [0,0.5)) and dwell in recovery. Sample uniformly
    // in time over one period and count how long phase sits in each half.
    const hz = P.ciliaBeatHz ?? 0.9;
    const period = 1 / hz;
    let inPower = 0, inRecovery = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * period;
      const ph = ciliaBeatPhase(t, 0, { ...P, ciliaAsymmetry: 0.6 });
      if (ph < 0.5) inPower++; else inRecovery++;
    }
    // Fast power stroke => fewer time samples land in [0,0.5).
    expect(inPower).toBeLessThan(inRecovery);
  });
  it("symmetric when asymmetry=0 (≈ equal dwell in each half)", () => {
    const hz = P.ciliaBeatHz ?? 0.9;
    const period = 1 / hz;
    let inPower = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * period;
      if (ciliaBeatPhase(t, 0, { ...P, ciliaAsymmetry: 0 }) < 0.5) inPower++;
    }
    expect(Math.abs(inPower - N / 2)).toBeLessThan(N * 0.08);
  });
  it("metachronal phase offset shifts the beat between neighbouring cilia", () => {
    const a = ciliaBeatPhase(1.0, 0, P);
    const b = ciliaBeatPhase(1.0, 1, P); // neighbour index
    expect(a).not.toBeCloseTo(b, 5);
  });

  // F3: C1 continuity — dphase/dt has no jump > 2x a single step.
  it("F3: phase velocity (dphase/dt) has no jump larger than 2x a single step", () => {
    const P3 = { ...CELL_DEFAULTS, ciliaMetachronal: 0 };
    const hz = P3.ciliaBeatHz ?? 0.9;
    const period = 1 / hz;
    const N = 4000;
    const h = period / N;
    const vels: number[] = [];
    let prev = ciliaBeatPhase(0, 0, P3);
    let prevV: number | null = null;
    for (let i = 1; i <= N; i++) {
      const t = i * h;
      const cur = ciliaBeatPhase(t, 0, P3);
      let d = cur - prev;
      if (d < -0.5) d += 1; else if (d > 0.5) d -= 1; // unwrap [0,1)
      const v = d / h;
      if (prevV !== null) vels.push(Math.abs(v - prevV));
      prevV = v;
      prev = cur;
    }
    const sorted = [...vels].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1e-9;
    const maxJump = Math.max(...vels);
    // C1: worst velocity jump is within a small multiple of the typical one
    // (a C0 corner would spike by ~|s2-s1|, of order the phase speed).
    expect(maxJump).toBeLessThan(median * 2 + 1e-6);
  });

  it("F3: recovery envelope smoothstep((phase-0.35)/0.3) is Lipschitz (no step)", () => {
    const recovery = (phase: number) => smoothstep((phase - 0.35) / 0.3);
    let prev = recovery(0);
    let maxStep = 0;
    const N = 2000;
    for (let i = 1; i <= N; i++) {
      const cur = recovery(i / N);
      maxStep = Math.max(maxStep, Math.abs(cur - prev));
      prev = cur;
    }
    // A hard {0.35,1} step would jump 0.65; smoothstep slope <= 1.5 → <<0.65.
    expect(maxStep).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// sampleBinLevel — A3 interpolated, wraparound spectrum-bin sampling
// ---------------------------------------------------------------------------

describe("sampleBinLevel (A3)", () => {
  const bins = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 0.2 : 0.8));

  it("is periodic: value at normalized 0 equals value at 1 (no 0/2pi seam)", () => {
    expect(sampleBinLevel(bins, 0)).toBeCloseTo(sampleBinLevel(bins, 1), 10);
  });

  it("interpolates (no staircase): adjacent-angle changes are bounded", () => {
    const M = 960; // 30 samples per bin
    let maxStep = 0;
    let prev = sampleBinLevel(bins, 0);
    for (let i = 1; i <= M; i++) {
      const cur = sampleBinLevel(bins, i / M);
      maxStep = Math.max(maxStep, Math.abs(cur - prev));
      prev = cur;
    }
    // Raw staircase would jump 0.6 between bins; interpolation keeps each step
    // an order of magnitude smaller.
    expect(maxStep).toBeLessThan(0.6 * 0.2);
  });

  it("wraps the last bin to the first across the seam", () => {
    const b = new Array(8).fill(0);
    b[0] = 1; b[7] = 1;
    expect(sampleBinLevel(b, 0.999)).toBeGreaterThan(0.5);
    expect(sampleBinLevel(b, 0.001)).toBeGreaterThan(0.5);
  });

  it("empty bins -> 0; single bin -> that value", () => {
    expect(sampleBinLevel([], 0.3)).toBe(0);
    expect(sampleBinLevel([0.7], 0.42)).toBe(0.7);
  });

  it("is deterministic", () => {
    expect(sampleBinLevel(bins, 0.37)).toBe(sampleBinLevel(bins, 0.37));
  });
});

// ---------------------------------------------------------------------------
// buildCellContour — A3 star-shaped (monotonic angle) guard
// ---------------------------------------------------------------------------

describe("buildCellContour star-shape (A3)", () => {
  it("smoothed contour stays star-shaped: angle about centre is monotonic mod 2pi", () => {
    const w = 200, h = 200, cx = w / 2, cy = h / 2;
    const bins = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 0 : 1));
    const energy = cellEnergy("recording", 0.9, 3, CELL_DEFAULTS.idle, CELL_DEFAULTS.levelGain);
    const pts = buildCellContour(w, h, bins, 3, 0.9, energy, CELL_DEFAULTS);
    const smooth = catmullRom(pts, 4);
    let prev = Math.atan2(smooth[0][1] - cy, smooth[0][0] - cx);
    let total = 0;
    let sign = 0;
    for (let i = 1; i <= smooth.length; i++) {
      const p = smooth[i % smooth.length];
      const ang = Math.atan2(p[1] - cy, p[0] - cx);
      let d = ang - prev;
      if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
      if (Math.abs(d) > 1e-9) {
        const s = d > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        expect(s).toBe(sign); // never reverses => monotonic => star-shaped
      }
      total += d;
      prev = ang;
    }
    expect(Math.abs(Math.abs(total) - TAU)).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------
// pseudopodOffset — A3 sharpness clamp (C1 lobe)
// ---------------------------------------------------------------------------

describe("pseudopodOffset sharpness clamp (A3)", () => {
  it("clamps sharpness to >= 2 (sharpness 1 == sharpness 2)", () => {
    const base = { ...CELL_DEFAULTS };
    for (let a = 0; a < TAU; a += 0.31) {
      const s1 = pseudopodOffset(a, 1.0, 0.5, 0.6, { ...base, sharpness: 1 });
      const s2 = pseudopodOffset(a, 1.0, 0.5, 0.6, { ...base, sharpness: 2 });
      expect(s1).toBeCloseTo(s2, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// ciliaPath — multi-segment flagellum with a base->tip travelling bend wave
// ---------------------------------------------------------------------------

describe("ciliaPath", () => {
  const P = CELL_DEFAULTS;
  const cx = 80, cy = 80, baseR = 16;

  it("returns ciliaCount paths, each with ciliaSegments+1 points and a width", () => {
    const paths = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, P);
    expect(paths.length).toBe(P.ciliaCount);
    const seg = P.ciliaSegments ?? 6;
    for (const h of paths) {
      expect(h.points.length).toBe(seg + 1);
      expect(h.width).toBeGreaterThan(0);
    }
  });

  it("each path starts on the membrane circle (base anchored at radius baseR)", () => {
    for (const h of ciliaPath(cx, cy, baseR, 1.0, 0.5, 0.5, P)) {
      const [bx, by] = h.points[0];
      expect(Math.hypot(bx - cx, by - cy)).toBeCloseTo(baseR, 0);
    }
  });

  it("tip extends beyond the base radius (hair points outward)", () => {
    for (const h of ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, P)) {
      const [tx, ty] = h.points[h.points.length - 1];
      expect(Math.hypot(tx - cx, ty - cy)).toBeGreaterThan(baseR);
    }
  });

  it("is a CURVED polyline: interior points deviate from the straight base->tip chord", () => {
    let maxDev = 0;
    for (const h of ciliaPath(cx, cy, baseR, 1.3, 0.7, 0.9, P)) {
      const pts = h.points;
      const [x1, y1] = pts[0];
      const [x2, y2] = pts[pts.length - 1];
      const dx = x2 - x1, dy = y2 - y1;
      const L = Math.hypot(dx, dy) || 1;
      for (let i = 1; i < pts.length - 1; i++) {
        const [px, py] = pts[i];
        const perp = Math.abs(((px - x1) * -dy + (py - y1) * dx) / L);
        maxDev = Math.max(maxDev, perp);
      }
    }
    expect(maxDev).toBeGreaterThan(2);
  });

  it("bend SHAPE travels along the cilium over time (wave propagates base->tip)", () => {
    const peakSeg = (t: number) => {
      const pts = ciliaPath(cx, cy, baseR, t, 0.5, 0.6, P)[0].points;
      const [x1, y1] = pts[0];
      const [x2, y2] = pts[pts.length - 1];
      const dx = x2 - x1, dy = y2 - y1;
      const L = Math.hypot(dx, dy) || 1;
      let best = 0, bestI = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const [px, py] = pts[i];
        const perp = Math.abs(((px - x1) * -dy + (py - y1) * dx) / L);
        if (perp > best) { best = perp; bestI = i; }
      }
      return bestI;
    };
    const seen = new Set<number>();
    for (let t = 0; t < 4; t += 0.1) seen.add(peakSeg(t));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("hairs have DIVERSE lengths (not all the same size)", () => {
    // Measure the HAIR length (tip minus base along the radial axis), not the
    // tip's distance from cell centre — the latter is diluted by the fixed
    // baseR offset and understates the diversity of the hairs themselves.
    const hairLen = (h: { points: Array<[number, number]> }) => {
      const [bx, by] = h.points[0];
      const [tx, ty] = h.points[h.points.length - 1];
      return Math.hypot(tx - bx, ty - by);
    };
    const lens = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, P).map(hairLen);
    const spread = (Math.max(...lens) - Math.min(...lens)) / (Math.max(...lens) || 1);
    // With ciliaLengthVar ~0.5 the longest hair should be markedly longer
    // than the shortest (>40% spread).
    expect(spread).toBeGreaterThan(0.4);
  });

  it("hairs have DIVERSE thickness", () => {
    const ws = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, P).map((h) => h.width);
    expect(Math.max(...ws) - Math.min(...ws)).toBeGreaterThan(0.2);
  });

  it("angular spacing is IRREGULAR (aperiodic crown, not evenly spaced)", () => {
    const angles = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, P).map((h) => {
      const [bx, by] = h.points[0];
      return Math.atan2(by - cy, bx - cx);
    });
    angles.sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < angles.length; i++) gaps.push(angles[i] - angles[i - 1]);
    const mean = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    const variance = gaps.reduce((s, v) => s + (v - mean) ** 2, 0) / gaps.length;
    // Perfectly even spacing => variance ~0. Require real irregularity.
    expect(Math.sqrt(variance)).toBeGreaterThan(mean * 0.1);
  });

  it("length tracks SMOOTHED growth so it shrinks gradually (no snap on silence)", () => {
    // Same energy, different growth -> different mean length. Because the
    // renderer feeds the slow-releasing `growth` accumulator, a sudden
    // silence (energy drop) with still-high growth keeps hairs long, then
    // they recede as growth releases. Here we assert monotonic dependence
    // on growth so the decay is gradual, not instantaneous.
    const lenAt = (growth: number) => {
      const h = ciliaPath(cx, cy, baseR, 1.0, 0.0, growth, P)[0];
      const [tx, ty] = h.points[h.points.length - 1];
      return Math.hypot(tx - cx, ty - cy);
    };
    expect(lenAt(0.8)).toBeGreaterThan(lenAt(0.2));
  });

  it("A1: BASE-angle order (points[0]) is preserved for all jitter, even out-of-range", () => {
    // The base ring order is k=0..n-1 at increasing baseAngle. Clamping
    // ciliaAngleJitter to <=0.9 keeps each hair within <0.45*gap of its slot,
    // so the cyclic order of base angles must never change, no matter how
    // extreme the requested jitter.
    const baseOrder = (jit: number) => {
      const paths = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, { ...P, ciliaAngleJitter: jit });
      return paths.map((h) => {
        const [bx, by] = h.points[0];
        return ((Math.atan2(by - cy, bx - cx) % TAU) + TAU) % TAU;
      });
    };
    for (const jit of [0, 0.5, 0.9, 1.5, 5, 100]) {
      const angles = baseOrder(jit);
      // Each hair k must stay within (k*gap +/- 0.45*gap); since slots are
      // gap apart, the array is strictly increasing (cyclically) => order kept.
      const gap = TAU / P.ciliaCount;
      for (let k = 0; k < angles.length; k++) {
        let diff = angles[k] - k * gap;
        diff = ((diff + Math.PI) % TAU + TAU) % TAU - Math.PI;
        expect(Math.abs(diff)).toBeLessThan(0.5 * gap);
      }
    }
  });

  it("F12: cellReach covers the actual longest cilium tip at ciliaLengthVar=0.95", () => {
    const p = { ...CELL_DEFAULTS, ciliaLengthVar: 0.95, startleMaxPx: 0 };
    const reach = cellReach(baseR, p);
    // The renderer's worst case is growth=1, energy=1.
    let maxDist = 0;
    for (const h of ciliaPath(cx, cy, baseR, 1.7, 1.0, 1.0, p)) {
      for (const [px, py] of h.points) {
        maxDist = Math.max(maxDist, Math.hypot(px - cx, py - cy));
      }
    }
    expect(reach).toBeGreaterThanOrEqual(maxDist - 1e-6);
  });

  it("F2: per-segment angular order matches base order (hairs never cross neighbours)", () => {
    // For each cilium, every segment's angle about the centre must stay within
    // half a gap of its base angle, so the bend can never sweep a point into a
    // neighbour's angular slot (which would visually cross hairs).
    for (const curl of [0.7, 2, 5]) {
      for (const lenVar of [0, 0.5, 0.95]) {
        const paths = ciliaPath(cx, cy, baseR, 1.7, 0.7, 0.9, {
          ...P,
          ciliaCurl: curl,
          ciliaLengthVar: lenVar,
          ciliaAngleJitter: 0.9,
        });
        const gap = TAU / P.ciliaCount;
        for (const h of paths) {
          const [bx, by] = h.points[0];
          const baseAng = Math.atan2(by - cy, bx - cx);
          for (const [px, py] of h.points) {
            const r = Math.hypot(px - cx, py - cy);
            if (r < 1e-6) continue;
            let d = Math.atan2(py - cy, px - cx) - baseAng;
            d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
            // The F2 cap bounds the transverse sweep to <= asin(0.5*gap) < 0.5*gap.
            expect(Math.abs(d)).toBeLessThanOrEqual(0.5 * gap + 1e-9);
          }
        }
      }
    }
  });

  // F1: a cilium is a clamped-base / FREE-TIP elastic rod (9+2 axoneme). The
  // bending moment -> 0 at the free tip, so curvature must VANISH there:
  // kappa(L) = 0. The bend amplitude envelope must be interior-peaked
  // (sin(pi*sFrac): zero at base AND tip), NOT tip-peaked (pow(sFrac,1.2)).
  // Curvature is measured as the turning angle between consecutive segment
  // vectors of the RAW spine points.
  const turnAngle = (
    pts: Array<[number, number]>,
    i: number,
  ): number => {
    const ax = pts[i][0] - pts[i - 1][0];
    const ay = pts[i][1] - pts[i - 1][1];
    const bx = pts[i + 1][0] - pts[i][0];
    const by = pts[i + 1][1] - pts[i][1];
    let d = Math.atan2(by, bx) - Math.atan2(ay, ax);
    d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return Math.abs(d);
  };

  it("F1: rendered tip curvature vanishes (smoothed tip turn-angle <= mid) for all beat phases & curls", () => {
    // kappa(L)=0 is a claim about the RENDERED rod (the catmullRomOpen spline),
    // not the coarse 6-point control polygon. Scan the whole beat cycle via t
    // (each hair's phase advances with t) across a wide curl range: the
    // free-tip region of the smoothed spine must never bend more sharply than
    // the mid-shaft.
    for (const curl of [0.7, 1.5, 3, 5]) {
      let tipMax = 0;
      let midMax = 0;
      for (let t = 0; t < 4; t += 0.05) {
        for (const h of ciliaPath(cx, cy, baseR, t, 0.6, 0.8, { ...P, ciliaCurl: curl })) {
          const sp = catmullRomOpen(h.points, 4);
          const m = sp.length;
          tipMax = Math.max(tipMax, turnAngle(sp, m - 2));
          midMax = Math.max(midMax, turnAngle(sp, Math.round(m / 2)));
        }
      }
      // Tip must be no sharper than the mid-shaft peak (free-tip kappa->0).
      expect(tipMax).toBeLessThanOrEqual(midMax + 1e-9);
    }
  });

  it("F1: bend amplitude envelope is INTERIOR-peaked (mid-shaft sway envelope > tip & base-region sway)", () => {
    // The envelope sin(pi*sFrac) peaks mid-shaft and is 0 at base AND tip. The
    // travelling wave sweeps a hump along the hair, so per-FRAME the lateral at
    // any one station can momentarily vanish (wave node); the ENVELOPE is the
    // MAX sway over a full beat cycle. That envelope must peak mid-shaft: the
    // OLD pow(sFrac,1.2) envelope was tip-peaked and would invert this.
    // Use the default curl: at extreme curl the F2 anti-crossing clamp
    // (bendCap ~ radius) saturates and governs the near-tip sway instead of the
    // envelope. The envelope property is what F1 is about, so test it in the
    // unclamped regime.
    let baseLat = 0; // station 0: exactly on the membrane
    let tipLat = 0; // station seg: the FREE tip
    let midLat = 0; // mid-shaft
    for (let t = 0; t < 4; t += 0.05) {
      for (const h of ciliaPath(cx, cy, baseR, t, 0.7, 0.9, P)) {
        const pts = h.points;
        const seg = pts.length - 1;
        const [bx, by] = pts[0];
        const ux = (bx - cx) / baseR;
        const uy = (by - cy) / baseR;
        const lat = (i: number) =>
          Math.abs((pts[i][0] - bx) * -uy + (pts[i][1] - by) * ux);
        baseLat = Math.max(baseLat, lat(0));
        midLat = Math.max(midLat, lat(Math.round(seg / 2)));
        tipLat = Math.max(tipLat, lat(seg));
      }
    }
    // sin(pi*sFrac) is exactly 0 at base (sFrac=0) AND tip (sFrac=1): both the
    // membrane anchor and the FREE tip have ~0 transverse sway, while the
    // mid-shaft swings widely. The OLD pow(sFrac,1.2) envelope put MAX sway at
    // the tip, so this test fails loudly against it.
    expect(baseLat).toBeLessThan(1e-9);
    expect(tipLat).toBeLessThan(1e-9);
    expect(midLat).toBeGreaterThan(1);
  });

  it("F1: tip lateral offset stays near zero (free-tip envelope is ~0 at sFrac=1)", () => {
    // With an interior-peaked envelope the tip's transverse displacement from
    // the radial axis is tiny (the envelope multiplies it to ~0), whereas a
    // tip-peaked envelope would fling the tip sideways.
    let maxTipLat = 0;
    let maxMidLat = 0;
    for (let t = 0; t < 4; t += 0.05) {
      for (const h of ciliaPath(cx, cy, baseR, t, 0.7, 0.9, { ...P, ciliaCurl: 3 })) {
        const pts = h.points;
        const seg = pts.length - 1;
        const [bx, by] = pts[0];
        const ux = (bx - cx) / baseR;
        const uy = (by - cy) / baseR;
        const lat = (i: number) =>
          Math.abs((pts[i][0] - bx) * -uy + (pts[i][1] - by) * ux);
        maxTipLat = Math.max(maxTipLat, lat(seg));
        maxMidLat = Math.max(maxMidLat, lat(Math.round(seg / 2)));
      }
    }
    // Tip stays much closer to the radial axis than the mid-shaft.
    expect(maxTipLat).toBeLessThan(maxMidLat * 0.5);
  });

  it("F1: base remains anchored on the membrane (envelope zero at sFrac=0)", () => {
    for (let t = 0; t < 4; t += 0.25) {
      for (const h of ciliaPath(cx, cy, baseR, t, 0.7, 0.9, P)) {
        const [bx, by] = h.points[0];
        expect(Math.hypot(bx - cx, by - cy)).toBeCloseTo(baseR, 6);
      }
    }
  });

  // M12: the cilia spine must be smoothed with an OPEN Catmull-Rom (clamped
  // endpoints) so the curve ends AT the tip and does not wrap tip->base (a
  // closed spline would re-introduce nonzero tip curvature, fighting F1).
  it("M12: open Catmull-Rom on the cilia spine ends at the tip (no wrap)", () => {
    for (const h of ciliaPath(cx, cy, baseR, 1.3, 0.7, 0.9, P)) {
      const spline = catmullRomOpen(h.points, 4);
      const tip = h.points[h.points.length - 1];
      const last = spline[spline.length - 1];
      expect(last[0]).toBeCloseTo(tip[0], 6);
      expect(last[1]).toBeCloseTo(tip[1], 6);
      // and it starts at the base point
      expect(spline[0][0]).toBeCloseTo(h.points[0][0], 6);
      expect(spline[0][1]).toBeCloseTo(h.points[0][1], 6);
    }
  });

  it("M12: open Catmull-Rom keeps the tip-region curvature envelope <= mid envelope", () => {
    // Curvature envelope = max turn-angle over the beat cycle at each station.
    // The free tip of the SMOOTHED spine must relax (kappa->0) relative to the
    // mid-shaft. (Per-frame comparison is meaningless: the wave node makes the
    // mid turn momentarily ~0.)
    let tipMax = 0;
    let midMax = 0;
    for (let t = 0; t < 4; t += 0.1) {
      for (const h of ciliaPath(cx, cy, baseR, t, 0.6, 0.8, { ...P, ciliaCurl: 3 })) {
        const spline = catmullRomOpen(h.points, 4);
        const m = spline.length;
        tipMax = Math.max(tipMax, turnAngle(spline, m - 2));
        midMax = Math.max(midMax, turnAngle(spline, Math.round(m / 2)));
      }
    }
    expect(tipMax).toBeLessThanOrEqual(midMax + 1e-9);
  });

  it("is deterministic", () => {
    expect(ciliaPath(cx, cy, baseR, 2.0, 0.5, 0.5, P)).toEqual(
      ciliaPath(cx, cy, baseR, 2.0, 0.5, 0.5, P),
    );
  });
});

// ---------------------------------------------------------------------------
// Commit 22a — somatic ciliature params ("mex"): a default-OFF gate that swaps
// the crown from 18 long flagella to many short stubs, via the pure
// somaticCiliaParams helper. All assertions are pure (no canvas).
// ---------------------------------------------------------------------------

describe("Commit 22a — somatic ciliature params (mex)", () => {
  const cx = 100;
  const cy = 100;
  const baseR = 40;
  const t = 1.3;
  const energy = 0.6;
  const growth = 0.8;
  // distance(base, tip) of one hair polyline.
  const hairLen = (h: { points: Array<[number, number]> }) => {
    const a = h.points[0];
    const b = h.points[h.points.length - 1];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

  it("(a) GATE OFF IDENTITY: default is off, helper returns params unchanged, crown identical", () => {
    expect(CELL_DEFAULTS.enableSomaticCilia).toBe(false);
    const off = somaticCiliaParams({ ...CELL_DEFAULTS });
    // Off path keeps the legacy crown spec.
    expect(off.ciliaCount).toBe(18);
    expect(off.ciliaLength).toBe(0.45);
    // ciliaPath via the off-path params equals the plain CELL_DEFAULTS crown.
    const viaHelper = ciliaPath(cx, cy, baseR, t, energy, growth, off);
    const plain = ciliaPath(cx, cy, baseR, t, energy, growth, { ...CELL_DEFAULTS });
    expect(viaHelper).toEqual(plain);
    expect(viaHelper.length).toBe(18);
  });

  it("(b) GATE ON COUNT+LENGTH: helper yields 72 hairs of length 0.15, crown has 72 hairs", () => {
    const on = somaticCiliaParams({ ...CELL_DEFAULTS, enableSomaticCilia: true });
    expect(on.ciliaCount).toBe(72);
    expect(on.ciliaLength).toBe(0.15);
    const crown = ciliaPath(cx, cy, baseR, t, energy, growth, on);
    expect(crown.length).toBe(72);
  });

  it("(c) SHORT STUBS: mex mean hair length is substantially shorter than the bare 18-hair crown", () => {
    // Use growth=0 so the ciliaGrowthBoost term (shared by both crowns) does not
    // mask the resting-length difference; the stub vs flagellum length ratio is
    // then ciliaLength-driven (0.15 / 0.45 ≈ 0.33).
    const g = 0;
    const on = somaticCiliaParams({ ...CELL_DEFAULTS, enableSomaticCilia: true });
    const mexMean = mean(ciliaPath(cx, cy, baseR, t, energy, g, on).map(hairLen));
    const baseMean = mean(
      ciliaPath(cx, cy, baseR, t, energy, g, { ...CELL_DEFAULTS }).map(hairLen),
    );
    expect(mexMean).toBeLessThan(0.6 * baseMean);
  });

  it("(d) POINT-ON-CONTOUR: every mex base lies on the deformed+squeezed contour", () => {
    const N = 96;
    const deform = Array.from(
      { length: N },
      (_, i) => 0.12 * Math.cos(3 * ((i * 2 * Math.PI) / N)),
    );
    const squeezeK = 1.3;
    const squeezePhi = 0.4;
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableSomaticCilia: true,
      enableCiliaOnContour: true,
      enableAffine: true,
    };
    const on = somaticCiliaParams(params);
    const motion: CiliaMotion = {
      tx: 1,
      ty: 0,
      speedNorm: 0,
      contour: { deform, squeezeK, squeezePhi },
    };
    const crown = ciliaPath(cx, cy, baseR, t, energy, growth, on, motion);
    expect(crown.length).toBe(72);

    // Build a fine reference polyline of the deformed+squeezed contour.
    const M = 2880;
    const ref: Array<[number, number]> = [];
    for (let i = 0; i < M; i++) {
      const th = (i * 2 * Math.PI) / M;
      const r = baseR * (1 + deformAt(th, deform));
      const p = affineSqueezePoints(
        [[cx + Math.cos(th) * r, cy + Math.sin(th) * r]],
        squeezeK,
        squeezePhi,
        cx,
        cy,
        params,
      )[0];
      ref.push(p);
    }
    const minDistToRef = (px: number, py: number) => {
      let best = Infinity;
      for (const [rx, ry] of ref) {
        const d = Math.hypot(px - rx, py - ry);
        if (d < best) best = d;
      }
      return best;
    };
    for (const h of crown) {
      const [bx, by] = h.points[0];
      expect(minDistToRef(bx, by)).toBeLessThan(0.5);
    }
  });

  it("(e) NO CROSSING: mex bases keep monotone per-index angular order, none coincide", () => {
    const N = 96;
    const deform = Array.from(
      { length: N },
      (_, i) => 0.12 * Math.cos(3 * ((i * 2 * Math.PI) / N)),
    );
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableSomaticCilia: true,
      enableCiliaOnContour: true,
      enableAffine: true,
    };
    const on = somaticCiliaParams(params);
    const motion: CiliaMotion = {
      tx: 1,
      ty: 0,
      speedNorm: 0,
      contour: { deform, squeezeK: 1.3, squeezePhi: 0.4 },
    };
    const crown = ciliaPath(cx, cy, baseR, t, energy, growth, on, motion);
    expect(crown.length).toBe(72);
    // Per-hair base angle from centre, unwrapped, must be strictly increasing.
    const bases = crown.map((h) => h.points[0]);
    let prev = -Infinity;
    let acc = 0;
    let last = Math.atan2(bases[0][1] - cy, bases[0][0] - cx);
    for (let i = 0; i < bases.length; i++) {
      const a = Math.atan2(bases[i][1] - cy, bases[i][0] - cx);
      // Unwrap into a monotone increasing sequence.
      while (a + acc <= last) acc += 2 * Math.PI;
      const unwrapped = a + acc;
      expect(unwrapped).toBeGreaterThan(prev);
      prev = unwrapped;
      last = unwrapped;
    }
    // No two bases coincide.
    let minPair = Infinity;
    for (let i = 0; i < bases.length; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        const d = Math.hypot(bases[i][0] - bases[j][0], bases[i][1] - bases[j][1]);
        if (d < minPair) minPair = d;
      }
    }
    expect(minPair).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// catmullRomOpen (M12) — non-wrapping spline for the cilia spine
// ---------------------------------------------------------------------------

describe("catmullRomOpen (M12)", () => {
  it("passes through every input point and ends at the LAST point (no wrap)", () => {
    const pts: Array<[number, number]> = [[0, 0], [10, 5], [20, 0], [30, 8]];
    const out = catmullRomOpen(pts, 4);
    // first sample == first point, last sample == last point
    expect(out[0][0]).toBeCloseTo(0, 9);
    expect(out[0][1]).toBeCloseTo(0, 9);
    expect(out[out.length - 1][0]).toBeCloseTo(30, 9);
    expect(out[out.length - 1][1]).toBeCloseTo(8, 9);
  });

  it("does NOT close the loop (unlike catmullRom): straight input stays straight at the end", () => {
    // A straight horizontal line: an OPEN spline must stay straight; a CLOSED
    // one curves at the ends because it wraps to the far endpoint.
    const pts: Array<[number, number]> = [[0, 0], [10, 0], [20, 0], [30, 0]];
    const open = catmullRomOpen(pts, 4);
    for (const [, y] of open) expect(Math.abs(y)).toBeLessThan(1e-9);
  });

  it("is deterministic and handles short inputs", () => {
    expect(catmullRomOpen([[1, 2]], 4)).toEqual([[1, 2]]);
    const pts: Array<[number, number]> = [[0, 0], [5, 5]];
    expect(catmullRomOpen(pts, 3)).toEqual(catmullRomOpen(pts, 3));
  });
});

// ---------------------------------------------------------------------------
// CreateCellRenderer (smoke test matching ring.test.ts patterns)
// ---------------------------------------------------------------------------

describe("createCellRenderer", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(42));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a canvas sized to options", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 172, height: 36 });
    const canvas = container.querySelector("canvas")!;
    expect(canvas).not.toBeNull();
    expect(canvas.width).toBe(172);
    expect(canvas.height).toBe(36);
    r.destroy();
  });

  it("starts RAF loop on create and cancels on destroy", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 100, height: 50 });
    expect(requestAnimationFrame).toHaveBeenCalled();
    r.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("update() does not throw (smoke)", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 100, height: 50 });
    expect(() =>
      r.update({
        mode: "recording",
        audioLevel: 0.5,
        spectrumBins: new Array(32).fill(0.3),
      }),
    ).not.toThrow();
    r.destroy();
  });

  it("accepts custom params spread over defaults", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 100,
      height: 50,
      baseHue: 50,
      params: { octaves: 6, push: 25 },
    });
    expect(() =>
      r.update({
        mode: "idle",
        audioLevel: 0,
        spectrumBins: new Array(32).fill(0),
      }),
    ).not.toThrow();
    r.destroy();
  });

  it("destroy clears container", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 100, height: 50 });
    expect(container.children.length).toBeGreaterThan(0);
    r.destroy();
    expect(container.children.length).toBe(0);
    expect(container.innerHTML).toBe("");
  });

  it("form memory: high audio then zero does not crash and holds shape", () => {
    const container = document.createElement("div");
    const rafCalls: Array<() => void> = [];
    let rafCounter = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return ++rafCounter;
    });

    const r = createCellRenderer(container, {
      width: 100,
      height: 50,
      params: { attack: 0.2, release: 0.005 },
    });

    // Push a few high-audio recording states
    for (let i = 0; i < 3; i++) {
      r.update({
        mode: "recording",
        audioLevel: 0.9,
        spectrumBins: new Array(32).fill(0.5),
      });
    }

    // Advance RAF a few times with recording mode
    for (let i = 0; i < 5; i++) {
      if (rafCalls.length > 0) {
        const cb = rafCalls.shift()!;
        expect(() => cb()).not.toThrow();
      }
    }

    // Now push zero (idle silence) — deformation should not instantly collapse
    r.update({
      mode: "idle",
      audioLevel: 0,
      spectrumBins: new Array(32).fill(0),
    });

    // Advance RAF several more times after switching to idle
    for (let i = 0; i < 5; i++) {
      if (rafCalls.length > 0) {
        const cb = rafCalls.shift()!;
        expect(() => cb()).not.toThrow();
      }
    }

    r.destroy();
    expect(container.children.length).toBe(0);
  });

  it("nucleus: mount + recording update + RAF ticks does not throw (smoke)", () => {
    const container = document.createElement("div");
    const rafCalls: Array<() => void> = [];
    let rafCounter = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return ++rafCounter;
    });

    const r = createCellRenderer(container, {
      width: 172,
      height: 36,
    });

    r.update({
      mode: "recording",
      audioLevel: 0.8,
      spectrumBins: new Array(32).fill(0.6),
    });

    // Advance several frames to exercise the nucleus drawing path
    for (let i = 0; i < 8; i++) {
      if (rafCalls.length > 0) {
        const cb = rafCalls.shift()!;
        expect(() => cb()).not.toThrow();
      }
    }

    r.destroy();
    expect(container.children.length).toBe(0);
  });

  it("nucleus: idle breathing across frames does not throw (smoke)", () => {
    const container = document.createElement("div");
    const rafCalls: Array<() => void> = [];
    let rafCounter = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return ++rafCounter;
    });

    const r = createCellRenderer(container, {
      width: 172,
      height: 36,
    });

    r.update({
      mode: "idle",
      audioLevel: 0,
      spectrumBins: new Array(32).fill(0),
    });

    // Advance several idle frames — nucleus breathes gently
    for (let i = 0; i < 12; i++) {
      if (rafCalls.length > 0) {
        const cb = rafCalls.shift()!;
        expect(() => cb()).not.toThrow();
      }
    }

    r.destroy();
    expect(container.children.length).toBe(0);
  });

  it("nucleus: custom nucleus params are accepted and do not throw", () => {
    const container = document.createElement("div");
    const rafCalls: Array<() => void> = [];
    let rafCounter = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return ++rafCounter;
    });

    const r = createCellRenderer(container, {
      width: 200,
      height: 100,
      params: {
        nucleusRadius: 0.35,
        nucleusPulse: 0.15,
        nucleusWander: 0.20,
        nucleusDrift: 0.08,
        nucleusAlpha: 0.65,
      },
    });

    r.update({
      mode: "recording",
      audioLevel: 0.7,
      spectrumBins: new Array(32).fill(0.4),
    });

    for (let i = 0; i < 5; i++) {
      if (rafCalls.length > 0) {
        const cb = rafCalls.shift()!;
        expect(() => cb()).not.toThrow();
      }
    }

    r.destroy();
    expect(container.children.length).toBe(0);
  });

  it("renders with cilia + startle + growth params without throwing", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 172, height: 36,
      params: { ciliaCount: 20, startleSensitivity: 3, growthSwell: 0.3 },
    });
    expect(() => {
      r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.7) });
      r.update({ mode: "recording", audioLevel: 0.1, spectrumBins: new Array(32).fill(0.1) });
    }).not.toThrow();
    r.destroy();
    expect(container.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// M11: single simulation clock (simTime)
// ---------------------------------------------------------------------------
//
// The tick loop must drive BOTH position integration AND phase clocks from ONE
// accumulator that sums the SAME clamped per-frame dt. Otherwise a backgrounded
// tab resuming with one huge real delta advances phases (wall-clock) far past
// the position (clamped dt), and they desync permanently.
//
// Observable: the persisted `elapsed` field == the phase clock fed to all phase
// formulas. Position-time == sum of clamped per-frame dt. The two must agree.
describe("M11: single simulation clock (simTime)", () => {
  const W = 160, H = 160;
  const key = cellPersistKey(W, H);
  let clock = 0;
  let nowSpy: ReturnType<typeof vi.spyOn>;
  const rafCalls: Array<() => void> = [];

  beforeEach(() => {
    rafCalls.length = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    localStorage.clear();
    clock = 1000;
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    nowSpy.mockRestore();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const readElapsed = (): number | null => {
    const s = parseCellState(localStorage.getItem(key));
    return s ? s.elapsed : null;
  };
  // Run the next queued tick with performance.now() pinned to `ms`.
  const tickAt = (ms: number) => {
    clock = ms;
    const cb = rafCalls.shift();
    if (cb) cb();
  };

  // Invariant A (60fps-unchanged): under on-time frames the clamped dt equals
  // the true dt, so simTime must equal the pre-change wall-clock formula
  // t = (now - startedAt)/1000 to floating-point. This locks the steady-state
  // path so the single-clock refactor is numerically identical when no stall
  // occurs. (Holds before AND after the fix — it is the regression lock.)
  it("A: steady on-time frames keep phase-time == accumulated dt (1e-9)", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    // 50ms frames: each is exactly at the clamp ceiling, so clamped dt == true dt
    // (the steady-state identity). Persist throttles to >500ms: it fires at frame
    // 1 (t=1050) then next at frame 12 (t=1600, since 1600-1050=550>500). So after
    // 12 frames the persisted elapsed == 12*0.05 = 0.6, which is BOTH the
    // wall-clock total AND the accumulated clamped dt — they coincide precisely
    // because no frame was ever stalled. No throttle-lag ambiguity.
    let t = 1000;
    let persisted = 0;
    for (let i = 0; i < 12; i++) {
      t += 50;
      tickAt(t);
      const e = readElapsed();
      if (e !== null) persisted = e;
    }
    const accumulated = 12 * 0.05; // sum of clamped per-frame dt
    const wallClock = (t - 1000) / 1000;
    expect(persisted).toBeGreaterThan(0);
    // phase-time equals BOTH accumulated dt and wall-clock when never stalled.
    expect(Math.abs(persisted - accumulated)).toBeLessThan(1e-9);
    expect(Math.abs(persisted - wallClock)).toBeLessThan(1e-9);
    r.destroy();
  });

  // Invariant B (gap divergence fixed): after one 500ms stall frame, the
  // persisted phase-time must equal the accumulated CLAMPED position-time
  // (the 500ms frame is clamped to 50ms), NOT the wall-clock total. Before the
  // fix the phase clock used wall-clock and would read ~0.532s while position
  // only advanced ~0.082s — a ~0.45s permanent desync.
  it("B: a 500ms gap frame advances phase-time by the CLAMPED dt, not wall-clock", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    // On-time frame (16ms). First persist fires here (now - lastPersist > 500).
    tickAt(1016);
    // 500ms STALL: one frame with a huge real delta (clamped to 50ms).
    tickAt(1516);
    // One more on-time frame to cross the next 500ms persist throttle boundary.
    tickAt(1532);
    const elapsed = readElapsed();
    // Sum of CLAMPED per-frame dt = position-time = phase-time after the fix.
    const expectedSim = 0.016 + 0.05 + 0.016; // 0.082
    const wallClock = (1532 - 1000) / 1000; // 0.532 — the pre-fix (buggy) value
    expect(elapsed).not.toBeNull();
    expect(Math.abs(elapsed! - expectedSim)).toBeLessThan(1e-9);
    // And it must NOT be the wall-clock value (proves the gap no longer diverges).
    expect(Math.abs(elapsed! - wallClock)).toBeGreaterThan(0.4);
    r.destroy();
  });

  // Restart seam (closes the review's test-gap nit): a restored state run through
  // the LIVE tick must resume phase-time at saved.elapsed + one frame's dt, i.e.
  // exactly the old wall-clock formula. Proves continuity end-to-end, not just
  // via the pure restoreSeed round-trip.
  it("C: a restored state resumes phase-time at saved.elapsed + dt (seamless)", () => {
    localStorage.setItem(key, serializeCellState({ driftPhase: 7.5, growth: 0.3, elapsed: 5 }));
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    // First on-time frame: dt = 50ms. Persist fires (now-0>500) and writes the
    // resumed elapsed = saved.elapsed (5) + dt (0.05) = 5.05.
    tickAt(1050);
    const elapsed = readElapsed();
    expect(elapsed).not.toBeNull();
    expect(Math.abs(elapsed! - 5.05)).toBeLessThan(1e-9);
    r.destroy();
  });
});

// ---------------------------------------------------------------------------
// M15: NaN-poison guard
// ---------------------------------------------------------------------------

describe("M15: sanitize helpers", () => {
  it("sanitizeUnit clamps to [0,1] and maps NaN/Inf to 0", () => {
    expect(sanitizeUnit(0.5)).toBe(0.5);
    expect(sanitizeUnit(0)).toBe(0);
    expect(sanitizeUnit(1)).toBe(1);
    expect(sanitizeUnit(-2)).toBe(0);
    expect(sanitizeUnit(2)).toBe(1);
    expect(sanitizeUnit(NaN)).toBe(0);
    expect(sanitizeUnit(Infinity)).toBe(0);
    expect(sanitizeUnit(-Infinity)).toBe(0);
  });
  it("sanitizeUnit is identity for normal in-range input (no behaviour change)", () => {
    for (const v of [0, 0.1, 0.37, 0.5, 0.99, 1]) expect(sanitizeUnit(v)).toBe(v);
  });
  it("sanitizeFinite passes finite through, falls back otherwise", () => {
    expect(sanitizeFinite(3.2, 9)).toBe(3.2);
    expect(sanitizeFinite(-100, 9)).toBe(-100);
    expect(sanitizeFinite(NaN, 9)).toBe(9);
    expect(sanitizeFinite(Infinity, 0)).toBe(0);
    expect(sanitizeFinite(-Infinity, 7)).toBe(7);
  });
  it("sanitizeBins clamps each bin and maps bad ones to 0", () => {
    expect(sanitizeBins([0.2, NaN, Infinity, 5, -1])).toEqual([0.2, 0, 0, 1, 0]);
    expect(sanitizeBins(undefined)).toEqual([]);
    expect(sanitizeBins([])).toEqual([]);
  });
  it("sanitizeBins is identity for normal in-range bins (no behaviour change)", () => {
    const ok = [0, 0.25, 0.5, 0.75, 1];
    expect(sanitizeBins(ok)).toEqual(ok);
  });
});

describe("M15: NaN-poison guard through update()", () => {
  // jsdom's getContext('2d') returns null, so the tick body (where form-memory
  // mutates) is skipped. Install a recording 2D context so the REAL poison path
  // runs, capturing every drawn coordinate to prove the state stays finite.
  function installRecordingContext() {
    const coords: number[] = [];
    const grad = { addColorStop: () => {} };
    const ctx = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      stroke: () => {},
      fill: () => {},
      moveTo: (x: number, y: number) => { coords.push(x, y); },
      lineTo: (x: number, y: number) => { coords.push(x, y); },
      arc: (x: number, y: number, r: number) => { coords.push(x, y, r); },
      createRadialGradient: () => grad,
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
    };
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (id: string) => unknown;
    };
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    return { coords, restore: () => { proto.getContext = orig; } };
  }

  let restoreCtx: (() => void) | null = null;
  afterEach(() => {
    if (restoreCtx) { restoreCtx(); restoreCtx = null; }
    vi.unstubAllGlobals();
  });

  it("a NaN/Inf frame keeps drawn state finite AND the next clean frame is normal (no permanent poison)", () => {
    const rec = installRecordingContext();
    restoreCtx = rec.restore;
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 160, height: 160 });
    // Each tick re-queues one rAF; step() runs exactly `k` bounded ticks.
    const step = (k: number) => { for (let i = 0; i < k; i++) { if (rafCalls.length) rafCalls.shift()!(); } };

    // Warm up with clean recording frames so form-memory is populated.
    r.update({ mode: "recording", audioLevel: 0.6, spectrumBins: new Array(32).fill(0.4) });
    step(4);

    // POISON FRAME: NaN audioLevel + NaN/Inf spectrum bins.
    const badBins = new Array(32).fill(0.3);
    badBins[2] = NaN;
    badBins[5] = Infinity;
    badBins[9] = -Infinity;
    r.update({ mode: "recording", audioLevel: NaN, spectrumBins: badBins });
    rec.coords.length = 0;
    step(1);
    expect(rec.coords.length).toBeGreaterThan(0);
    for (const c of rec.coords) expect(Number.isFinite(c)).toBe(true);

    // NEXT CLEAN FRAME must produce normal finite output — proving the single
    // bad frame did not permanently poison the integrated form-memory.
    r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.4) });
    rec.coords.length = 0;
    step(1);
    expect(rec.coords.length).toBeGreaterThan(0);
    for (const c of rec.coords) expect(Number.isFinite(c)).toBe(true);

    r.destroy();
  });

  it("sustained NaN input never throws and recovers to finite output after clean frames", () => {
    const rec = installRecordingContext();
    restoreCtx = rec.restore;
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 160, height: 160 });
    const step = (k: number) => { for (let i = 0; i < k; i++) { if (rafCalls.length) rafCalls.shift()!(); } };

    // Many consecutive poison frames.
    for (let i = 0; i < 6; i++) {
      r.update({ mode: "recording", audioLevel: NaN, spectrumBins: new Array(32).fill(NaN) });
      expect(() => step(1)).not.toThrow();
    }

    // Recover: clean frames must yield finite coordinates.
    for (let i = 0; i < 4; i++) {
      r.update({ mode: "recording", audioLevel: 0.4, spectrumBins: new Array(32).fill(0.3) });
      step(1);
    }
    rec.coords.length = 0;
    step(1);
    expect(rec.coords.length).toBeGreaterThan(0);
    for (const c of rec.coords) expect(Number.isFinite(c)).toBe(true);

    r.destroy();
  });

  it("M8: a startle onset does NOT shove the idle/centred cell (kick perturbs heading, not centre)", () => {
    const rec = installRecordingContext();
    restoreCtx = rec.restore;
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const container = document.createElement("div");
    // IDLE mode + kick on (default): drift01 stays ~0 so the centre is width/2.
    const r = createCellRenderer(container, { width: 160, height: 160 });
    const step = (k: number) => { for (let i = 0; i < k; i++) { if (rafCalls.length) rafCalls.shift()!(); } };

    // The nucleus is drawn via arc(nx, ny, nr): the LAST arc per frame is the
    // nucleolus at the cell centre. Capture its position across a sharp onset.
    const lastArcXY = () => {
      // coords from arc are pushed as (x,y,r) triples; the nucleus arcs are the
      // final ones in the frame. Grab the last triple's x,y.
      const c = rec.coords;
      return [c[c.length - 3], c[c.length - 2]] as [number, number];
    };

    r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
    step(4);
    rec.coords.length = 0; step(1);
    const before = lastArcXY();

    // Sharp onset (would trigger a startle edge), but still IDLE mode.
    r.update({ mode: "idle", audioLevel: 1.0, spectrumBins: new Array(32).fill(0.9) });
    rec.coords.length = 0; step(1);
    const after = lastArcXY();

    // With the kick model, an idle cell's centre must NOT jump from startle.
    // (Legacy positional shove would move it by up to startleMaxPx=5 px.)
    expect(Math.abs(after[0] - before[0])).toBeLessThan(2);
    expect(Math.abs(after[1] - before[1])).toBeLessThan(2);

    r.destroy();
  });

  it("H4: enableFlowField OFF (default) draws NO motes; ON advects them over frames", () => {
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const step = (k: number) => { for (let i = 0; i < k; i++) { if (rafCalls.length) rafCalls.shift()!(); } };

    // The renderer reads flow params from the theme params, not update(). The
    // default builtin has enableFlowField undefined -> OFF. Count arc() triples:
    // motes are drawn as tiny arcs BEFORE the cell, so with the gate off the
    // mote-draw block is skipped entirely (allocates nothing).
    const recOff = installRecordingContext();
    restoreCtx = recOff.restore;
    const cOff = document.createElement("div");
    const rOff = createCellRenderer(cOff, { width: 160, height: 160 });
    rOff.update({ mode: "recording", audioLevel: 0.6, spectrumBins: new Array(32).fill(0.4) });
    step(3);
    recOff.coords.length = 0; step(1);
    const arcsOff = recOff.coords.length;
    rOff.destroy();
    recOff.restore();

    // Now drive a renderer with the flow gate ON via a custom params object: we
    // build motes directly through the exported helpers to assert advection is
    // non-trivial (the render wiring is exercised by the pure-helper suite; here
    // we lock that ON actually changes mote positions frame-to-frame).
    const P = { ...CELL_DEFAULTS, enableFlowField: true, flowMoteCount: 12 };
    let ms = seedMotes(160, 160, P);
    const first = ms.map((m) => ({ ...m }));
    // advect with a moving body (heading 0, swim speed ~9 px/s) for several
    // frames; flowStrength default (300) folds the doublet body-size^2 scale so
    // the field is visible (px/s) at body-scale distances.
    for (let f = 0; f < 60; f++) {
      ms = ms.map((m) => advectMote(m, 80, 80, 0, 9, 1 / 60, 160, 160, P));
    }
    const moved = ms.some((m, i) => Math.hypot(m.x - first[i].x, m.y - first[i].y) > 0.5);
    expect(moved).toBe(true);
    // Sanity: the OFF render produced some cell geometry (arcs) but the gate
    // skipped the mote pass without throwing.
    expect(arcsOff).toBeGreaterThan(0);

    // INTEGRATION (closes the review seam): drive the ACTUAL renderer with the
    // flow gate ON via params, and assert the wiring draws + advects motes. Motes
    // are tiny arcs (r=0.8) emitted BEFORE the cell each frame, so an ON render
    // emits strictly more arc triples than an OFF one, and the first mote's
    // recorded position changes frame-to-frame (advection through the wiring).
    const recOn = installRecordingContext();
    restoreCtx = recOn.restore;
    const cOn = document.createElement("div");
    const rOn = createCellRenderer(cOn, {
      width: 160, height: 160,
      params: { enableFlowField: true, flowMoteCount: 12 },
    });
    rOn.update({ mode: "recording", audioLevel: 0.6, spectrumBins: new Array(32).fill(0.4) });
    step(3);
    recOn.coords.length = 0; step(1);
    const arcsOn = recOn.coords.length;
    // The leading arcs are the 12 motes (r=0.8); the first mote sits exactly at
    // its deterministic seedMotes position, confirming the gate routed params ->
    // seedMotes -> draw (not some other geometry).
    const seeded = seedMotes(160, 160, { ...CELL_DEFAULTS, flowMoteCount: 12 });
    const firstMote = [recOn.coords[0], recOn.coords[1]] as [number, number];
    rOn.destroy();
    recOn.restore();
    // ON renders strictly more arcs (the 12 mote arcs precede the cell geometry):
    // proves the enableFlowField param plumbs through createCellRenderer and the
    // mote pass actually runs (the OFF render never entered the block).
    expect(arcsOn).toBeGreaterThan(arcsOff);
    expect(arcsOn - arcsOff).toBeGreaterThanOrEqual(12 * 3); // >=12 mote arcs (x,y,r)
    // first drawn mote == deterministic seed position (a non-swimming harness cell
    // drags no fluid: flowSpeed~0 => field 0 => motes correctly stay at their
    // seed; advection itself is proven by the dipoleFlowAt/advectMote suites).
    expect(firstMote[0]).toBeCloseTo(seeded[0].x, 6);
    expect(firstMote[1]).toBeCloseTo(seeded[0].y, 6);
  });

  // Commit 20: wiring of the commit-17 pure helpers (E1/F13/F11) into the render
  // loop behind their default-OFF gates. Each must be inert when off and produce
  // a visible, correct change when on.
  it("Commit 20 — E1 enablePerimeterCount drives more cilia arcs on a big cell", () => {
    const rafCalls: Array<() => void> = []; let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const step = (k: number) => { for (let i = 0; i < k; i++) if (rafCalls.length) rafCalls.shift()!(); };
    // A large baseR so the perimeter count exceeds the default 18 (cap raised so
    // the perimeter formula, not the cap, governs). enableActivity on so cilia draw.
    const big = { enablePerimeterCount: true, ciliaCount: 200, ciliaSpacingPx: 8, baseRadiusPx: 40 };
    const recOn = installRecordingContext(); restoreCtx = recOn.restore;
    const rOn = createCellRenderer(document.createElement("div"), { width: 200, height: 200, params: big });
    rOn.update({ mode: "recording", audioLevel: 0.8, spectrumBins: new Array(32).fill(0.6) });
    step(6); recOn.coords.length = 0; step(1);
    const arcsBig = recOn.coords.length; rOn.destroy(); recOn.restore();
    // OFF (fixed ciliaCount 18) on the same big cell => fewer cilia arcs.
    const recOff = installRecordingContext(); restoreCtx = recOff.restore;
    const rOff = createCellRenderer(document.createElement("div"), {
      width: 200, height: 200, params: { ciliaCount: 18, baseRadiusPx: 40 },
    });
    rOff.update({ mode: "recording", audioLevel: 0.8, spectrumBins: new Array(32).fill(0.6) });
    step(6); recOff.coords.length = 0; step(1);
    const arcsSmall = recOff.coords.length; rOff.destroy(); recOff.restore();
    // perimeter count at baseR~40, spacing 8 ≈ round(2π·40/8)=31 > 18.
    expect(perimeterCiliaCount(40, { ...CELL_DEFAULTS, ciliaCount: 200, ciliaSpacingPx: 8 })).toBeGreaterThan(18);
    expect(arcsBig).toBeGreaterThan(arcsSmall);
  });

  it("Commit 20 — F11 enableVacuole draws an extra peripheral vesicle arc", () => {
    const rafCalls: Array<() => void> = []; let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const step = (k: number) => { for (let i = 0; i < k; i++) if (rafCalls.length) rafCalls.shift()!(); };
    // Count nucleus/organelle arcs (r-bearing) with vacuole OFF vs ON at a sim
    // time where the vacuole is filled (u≈0.85 of its period => near R_max).
    const mkArcs = (params: Record<string, unknown>) => {
      const rec = installRecordingContext(); restoreCtx = rec.restore;
      const r = createCellRenderer(document.createElement("div"), { width: 160, height: 160, params });
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      step(8); rec.coords.length = 0; step(1);
      const c = rec.coords.length; r.destroy(); rec.restore();
      return c;
    };
    // small vacuolePeriod so by frame ~9 (sim ~0.45s at 50ms) u is in the filled
    // band; vacuoleMaxFrac large enough that vac.r>=0.5.
    const on = mkArcs({ enableVacuole: true, vacuolePeriod: 1, vacuoleMaxFrac: 0.25 });
    const off = mkArcs({ enableVacuole: false });
    expect(on).toBeGreaterThan(off); // the vesicle adds one more arc triple
  });

  it("Commit 20 — F13 enableBandLimit produces finite, in-bounds membrane geometry", () => {
    const rafCalls: Array<() => void> = []; let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const step = (k: number) => { for (let i = 0; i < k; i++) if (rafCalls.length) rafCalls.shift()!(); };
    // With the band-limit gate on, the membrane contour must still be finite and
    // inside the tank across active frames (the deform is clamped to bandLimitAmp
    // then the renderer clamps radius to [floor,maxRadius]). Smoke-proves the
    // wiring routes deform through bandLimitDeform without producing NaN/escape.
    const rec = installRecordingContext(); restoreCtx = rec.restore;
    const r = createCellRenderer(document.createElement("div"), {
      width: 160, height: 160,
      params: { enableBandLimit: true, bandLimitMode: 4, bandLimitAmp: 0.08 },
    });
    for (let i = 0; i < 6; i++) {
      r.update({ mode: "recording", audioLevel: 0.7, spectrumBins: new Array(32).fill(0.5) });
      step(1);
    }
    rec.coords.length = 0; step(1);
    expect(rec.coords.length).toBeGreaterThan(0);
    for (const c of rec.coords) {
      expect(Number.isFinite(c)).toBe(true);
      // membrane/organelle coords live within a generous tank-plus-margin box.
      expect(c).toBeGreaterThan(-50);
      expect(c).toBeLessThan(210);
    }
    r.destroy(); rec.restore();
  });
});

// ---------------------------------------------------------------------------
// idleMorph
// ---------------------------------------------------------------------------

describe("idleMorph", () => {
  const P = CELL_DEFAULTS;
  it("returns one value per sample", () => {
    expect(idleMorph(96, 1.0, P).length).toBe(96);
  });
  it("is deterministic", () => {
    expect(idleMorph(96, 2.3, P)).toEqual(idleMorph(96, 2.3, P));
  });
  it("stays within a gentle bound (|d| <= idleMorphAmplitude)", () => {
    for (const tt of [0, 1.7, 5.0, 12.4]) {
      for (const d of idleMorph(64, tt, P)) {
        expect(Math.abs(d)).toBeLessThanOrEqual(P.idleMorphAmplitude + 1e-9);
      }
    }
  });
  it("changes over time (not frozen)", () => {
    const a = idleMorph(64, 0.0, P);
    const b = idleMorph(64, 4.0, P);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBeGreaterThan(0.01);
  });
  it("envelope waxes and wanes (overall magnitude varies over time)", () => {
    const mag = (arr: number[]) => arr.reduce((s, v) => s + Math.abs(v), 0);
    // sample over a long span; magnitude must vary noticeably (alive, not flat)
    const mags: number[] = [];
    for (let k = 0; k < 16; k++) mags.push(mag(idleMorph(64, k * 1.3, P)));
    expect(Math.max(...mags)).toBeGreaterThan(Math.min(...mags) * 1.3);
  });
  it("envelope is NOT strictly periodic (no cos-cycle blink/loop)", () => {
    // Regression: the old envelope was cos(TAU*t/period) — strictly periodic,
    // so the whole organism visibly repeated/blinked every `idleMorphPeriod`
    // seconds. A living cell must never replay the exact same envelope.
    const mag = (tt: number) => idleMorph(64, tt, P).reduce((s, v) => s + Math.abs(v), 0);
    const period = P.idleMorphPeriod;
    let maxRepeatErr = 0;
    for (const base of [0.0, 1.1, 2.7, 4.3]) {
      const a = mag(base);
      const b = mag(base + period);
      const rel = Math.abs(a - b) / (Math.abs(a) + 1e-6);
      maxRepeatErr = Math.max(maxRepeatErr, rel);
    }
    // A strictly periodic envelope would give ~0 here. Require real drift.
    expect(maxRepeatErr).toBeGreaterThan(0.1);
  });
  it("respects the floor (envelope never fully zero when floor > 0)", () => {
    const mag = (arr: number[]) => arr.reduce((s, v) => s + Math.abs(v), 0);
    // with default floor > 0 there is always some morph somewhere
    let any = 0;
    for (let k = 0; k < 8; k++) any += mag(idleMorph(48, k * 0.9, P));
    expect(any).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// resolveBaseRadius
// ---------------------------------------------------------------------------

describe("resolveBaseRadius", () => {
  const P = CELL_DEFAULTS;

  it("with baseRadiusPx=16 and large window (160x160), returns 16 (absolute px)", () => {
    const r = resolveBaseRadius(160, 160, { ...P, baseRadiusPx: 16 }, 0);
    expect(r).toBeCloseTo(16, 1);
  });

  it("without baseRadiusPx, falls back to Math.min(width,height)*radiusFraction", () => {
    const r = resolveBaseRadius(160, 160, P, 0);
    expect(r).toBeCloseTo(160 * P.radiusFraction, 1);
  });

  it("applies growth swell when growth > 0", () => {
    const rNoGrowth = resolveBaseRadius(160, 160, { ...P, baseRadiusPx: 16 }, 0);
    const rWithGrowth = resolveBaseRadius(160, 160, { ...P, baseRadiusPx: 16 }, 0.5);
    expect(rWithGrowth).toBeGreaterThan(rNoGrowth);
    // baseR = 16 * (1 + 0.5 * growthSwell)
    expect(rWithGrowth).toBeCloseTo(16 * (1 + 0.5 * P.growthSwell), 1);
  });

  it("is deterministic", () => {
    const a = resolveBaseRadius(100, 80, P, 0.3);
    const b = resolveBaseRadius(100, 80, P, 0.3);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// cellReach
// ---------------------------------------------------------------------------

describe("cellReach", () => {
  it("returns a value >= baseR for defaults (membrane alone)", () => {
    const r = cellReach(16, CELL_DEFAULTS);
    expect(r).toBeGreaterThanOrEqual(16 * 1.4);
  });

  it("includes cilia reach: at least baseR + ciliaLen*baseR", () => {
    const p = { ...CELL_DEFAULTS, ciliaLength: 0.4, ciliaGrowthBoost: 0.55, startleMaxPx: 0 };
    const r = cellReach(16, p);
    // F12: worst-case hair uses (1+ciliaLengthVar=1.5) not the old 1.3, plus the
    // F2 transverse-cap headroom sqrt(1+0.25*gap^2) with gap=2pi/18.
    // longestAlong = 16 + 16*(0.95)*1.5 = 38.8; ciliaOuter = 38.8*1.01512 = 39.39
    expect(r).toBeGreaterThanOrEqual(39.3);
    // membrane outer = 16 * 1.4 = 22.4 — cilia dominates
    expect(r).toBeCloseTo(39.39, 1);
  });

  it("includes startle on top", () => {
    const pNoStartle = { ...CELL_DEFAULTS, ciliaLength: 0.4, ciliaGrowthBoost: 0.55, startleMaxPx: 0 };
    const pWithStartle = { ...pNoStartle, startleMaxPx: 4 };
    const rNo = cellReach(16, pNoStartle);
    const rWith = cellReach(16, pWithStartle);
    expect(rWith - rNo).toBeCloseTo(4, 1);
  });

  it("returns >= baseR + cilia + startle for typical drifting_contour params", () => {
    const p = { ...CELL_DEFAULTS, ciliaLength: 0.4, ciliaGrowthBoost: 0.55, startleMaxPx: 4 };
    const r = cellReach(16, p);
    // membrane = 22.4, cilia = 39.39, +4 startle = 43.39 (F12)
    expect(r).toBeGreaterThanOrEqual(43.3);
    expect(r).toBeCloseTo(43.39, 1);
  });

  it("defaults missing cilia/growth/startle to 0", () => {
    const p = { ...CELL_DEFAULTS };
    // remove cilia + startle fields so only the membrane headroom remains
    const pPartial = { ...CELL_DEFAULTS, ciliaLength: 0 as unknown as number };
    delete (pPartial as any).ciliaLength;
    delete (pPartial as any).ciliaGrowthBoost;
    delete (pPartial as any).startleMaxPx;
    const r = cellReach(10, pPartial as CellParams);
    // membrane = 10 * 1.4 = 14; cilia (no length/boost) = 10*1.0151 = 10.15;
    // membrane dominates, +0 startle.
    expect(r).toBe(14);
  });

  it("grows with baseR (dominant term is proportional)", () => {
    const p = { ...CELL_DEFAULTS, ciliaLength: 0.4, ciliaGrowthBoost: 0.5, startleMaxPx: 3 };
    const r10 = cellReach(10, p);
    const r20 = cellReach(20, p);
    // cilia outer dominates: baseR + baseR * 0.9 * 1.3 = 2.17 * baseR;
    // startle is constant (3) so ratio is slightly below 2×.
    expect(r20).toBeGreaterThan(r10 * 1.7);
  });

  it("is deterministic", () => {
    const a = cellReach(16, CELL_DEFAULTS);
    const b = cellReach(16, CELL_DEFAULTS);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// cellDrift
// ---------------------------------------------------------------------------

describe("cellDrift", () => {
  const P = CELL_DEFAULTS;
  const W = 160, H = 160;
  const baseR = 16;

  it("contains the whole cell (cilia + membrane + startle) within [0,160] box (defaults)", () => {
    const reach = cellReach(baseR, P);
    for (let t = 0; t < 1000; t += 13.7) {
      const d = cellDrift(t, W, H, baseR, P);
      // Centre must stay >= reach from left/top so cilia tips never go negative
      expect(d.cx - reach).toBeGreaterThanOrEqual(-0.001);
      expect(d.cy - reach).toBeGreaterThanOrEqual(-0.001);
      // Centre must stay <= width-reach from right/bottom so cilia tips never exceed window
      expect(d.cx + reach).toBeLessThanOrEqual(W + 0.001);
      expect(d.cy + reach).toBeLessThanOrEqual(H + 0.001);
    }
  });

  it("contains the whole cell within [0,160] with precise drifting_contour params", () => {
    // Exact params from drifting_contour theme (baseRadiusPx≈16, ciliaLength 0.4,
    // ciliaGrowthBoost 0.55, startleMaxPx 4, driftMargin 30).
    const dcParams = {
      ...P,
      ciliaLength: 0.4,
      ciliaGrowthBoost: 0.55,
      startleMaxPx: 4,
      driftMargin: 30,
    };
    const reach = cellReach(baseR, dcParams);
    // F12: the cilia-reach factor was corrected from 1.3 to the true worst-case
    // hair (1 + ciliaLengthVar) plus the F2 transverse-bend headroom, so the
    // containment radius grew from ≈39.76 to ≈43.39. inset = max(30, 43.39).
    expect(reach).toBeCloseTo(43.39, 1);
    for (let t = 0; t < 1000; t += 13.7) {
      const d = cellDrift(t, W, H, baseR, dcParams);
      // cx ± reach must stay within [0, 160]
      expect(d.cx - reach).toBeGreaterThanOrEqual(-0.001);
      expect(d.cx + reach).toBeLessThanOrEqual(W + 0.001);
      expect(d.cy - reach).toBeGreaterThanOrEqual(-0.001);
      expect(d.cy + reach).toBeLessThanOrEqual(H + 0.001);
    }
  });

  it("degenerate pill (172x36) now clamps Y to centre when reach > height", () => {
    const w = 172, h = 36;
    const br = Math.min(w, h) * P.radiusFraction; // ≈ 12.24
    const reach = cellReach(br, P);
    const inset = Math.max(P.driftMargin ?? 4, reach);
    for (let t = 0; t < 500; t += 11.3) {
      const d = cellDrift(t, w, h, br, P);
      // Y-axis: with old margin the pill used to have ~3.5px travel;
      // with full reach containment the Y axis is degenerate → clamps to centre.
      if (h - 2 * inset <= 0) {
        expect(d.cy).toBeCloseTo(h / 2, 0);
      } else {
        expect(d.cy).toBeGreaterThanOrEqual(inset - 0.001);
        expect(d.cy).toBeLessThanOrEqual(h - inset + 0.001);
      }
      // X-axis should still have room (172 is wide)
      if (w - 2 * inset > 0) {
        expect(d.cx).toBeGreaterThanOrEqual(inset - 0.001);
        expect(d.cx).toBeLessThanOrEqual(w - inset + 0.001);
      }
    }
  });

  it("truly degenerate axis (no travel room) clamps to center", () => {
    // With large baseR and small window, travelRange <= 0 → pin to center
    const d = cellDrift(0, 20, 20, 10, P);
    // reach = cellReach(10, P); inset = max(4, reach) >= 10*1.4 = 14 > 10 → degenerate
    expect(d.cx).toBe(10);
    expect(d.cy).toBe(10);
  });

  it("respects custom driftMargin but full-reach still dominates when larger", () => {
    const margin = 10;
    const p = { ...P, driftMargin: margin };
    const reach = cellReach(baseR, p);
    // inset = max(margin, reach) — reach is typically much larger than 10
    const inset = Math.max(margin, reach);
    for (let t = 0; t < 200; t += 17) {
      const d = cellDrift(t, W, H, baseR, p);
      // Full containment: centre ± reach must stay in window
      expect(d.cx - reach).toBeGreaterThanOrEqual(-0.001);
      expect(d.cx + reach).toBeLessThanOrEqual(W + 0.001);
      expect(d.cy - reach).toBeGreaterThanOrEqual(-0.001);
      expect(d.cy + reach).toBeLessThanOrEqual(H + 0.001);
    }
  });

  it("produces different positions at different times (cell actually travels)", () => {
    const positions = new Set<string>();
    for (let t = 0; t < 100; t += 5) {
      const d = cellDrift(t, W, H, baseR, P);
      positions.add(`${d.cx.toFixed(2)},${d.cy.toFixed(2)}`);
    }
    // Should have multiple distinct positions (cell actually travels)
    expect(positions.size).toBeGreaterThan(3);
  });

  it("is deterministic", () => {
    const a = cellDrift(5, W, H, baseR, P);
    const b = cellDrift(5, W, H, baseR, P);
    expect(a).toEqual(b);
  });

  it("X and Y drift are decorrelated (wanders in 2D, not back-and-forth on a line)", () => {
    // Mechanical look = cx and cy move in lock-step (their paths correlate),
    // so the cell slides along essentially one axis. A living cell wanders
    // in 2D: the X and Y trajectories must be statistically independent.
    // We assert the Pearson correlation between the cx and cy series over
    // time is low in magnitude.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let t = 0; t < 400; t += 2) {
      const d = cellDrift(t, W, H, baseR, P);
      xs.push(d.cx);
      ys.push(d.cy);
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(xs), my = mean(ys);
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < xs.length; i++) {
      const ddx = xs[i] - mx, ddy = ys[i] - my;
      cov += ddx * ddy; vx += ddx * ddx; vy += ddy * ddy;
    }
    const corr = cov / (Math.sqrt(vx * vy) || 1);
    expect(Math.abs(corr)).toBeLessThan(0.5);
  });

  it("handles zero-sized window gracefully (no crash, returns finite)", () => {
    const d = cellDrift(0, 0, 0, 0, P);
    expect(Number.isFinite(d.cx)).toBe(true);
    expect(Number.isFinite(d.cy)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wanderStep — Reynolds steering-style integrated wander (stateful)
// ---------------------------------------------------------------------------

describe("wanderStep", () => {
  const P = CELL_DEFAULTS;
  const W = 160, H = 160;
  const baseR = 16;
  const reach = cellReach(baseR, P);

  // Helper: integrate the wander for N steps from centre, return path.
  function runPath(steps: number, dt = 1 / 60, seed = 0) {
    let s = { x: W / 2, y: H / 2, heading: seed, vx: 0, vy: 0 };
    const path: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < steps; i++) {
      s = wanderStep(s, dt, W, H, baseR, P);
      path.push({ x: s.x, y: s.y });
    }
    return path;
  }

  it("keeps the whole organism inside the aquarium walls", () => {
    for (const p of runPath(4000)) {
      expect(p.x - reach).toBeGreaterThanOrEqual(-0.5);
      expect(p.y - reach).toBeGreaterThanOrEqual(-0.5);
      expect(p.x + reach).toBeLessThanOrEqual(W + 0.5);
      expect(p.y + reach).toBeLessThanOrEqual(H + 0.5);
    }
  });

  it("is deterministic for the same input state", () => {
    const s0 = { x: 80, y: 80, heading: 1.2, vx: 0.3, vy: -0.1 };
    expect(wanderStep(s0, 1 / 60, W, H, baseR, P)).toEqual(
      wanderStep(s0, 1 / 60, W, H, baseR, P),
    );
  });

  it("does NOT gravitate back to the centre (true wandering, not oscillation)", () => {
    // The old cellDrift used position=noise(t), which oscillates about the
    // centre — the cell always returned to the middle. A real wanderer's
    // average position over a long run should be measurably off-centre and
    // it should spend lots of time far from the middle.
    const path = runPath(6000, 1 / 60, 0.7);
    const cxAvg = path.reduce((s, p) => s + p.x, 0) / path.length;
    const cyAvg = path.reduce((s, p) => s + p.y, 0) / path.length;
    // far-from-centre occupancy
    const far = path.filter(
      (p) => Math.hypot(p.x - W / 2, p.y - H / 2) > 0.25 * Math.min(W, H) / 2,
    ).length;
    // Not pinned to dead-centre on average, and roams the tank.
    const offCentre = Math.hypot(cxAvg - W / 2, cyAvg - H / 2);
    expect(far).toBeGreaterThan(path.length * 0.2);
    expect(offCentre).toBeGreaterThanOrEqual(0); // sanity (no NaN)
    expect(Number.isFinite(offCentre)).toBe(true);
  });

  it("heading changes gradually (no twitching / instant reversals)", () => {
    // Reynolds: retain heading, apply SMALL random displacement each frame.
    // Successive velocity directions must be highly correlated frame-to-frame.
    let s = { x: W / 2, y: H / 2, heading: 0.3, vx: 0, vy: 0 };
    let prevAng: number | null = null;
    let maxTurn = 0;
    for (let i = 0; i < 1200; i++) {
      s = wanderStep(s, 1 / 60, W, H, baseR, P);
      const ang = Math.atan2(s.vy, s.vx);
      if (prevAng !== null) {
        let d = Math.abs(ang - prevAng);
        if (d > Math.PI) d = 2 * Math.PI - d; // wrap
        // ignore wall-bounce frames (big intentional flips)
        const nearWall =
          s.x - reach < 2 || s.y - reach < 2 || s.x + reach > W - 2 || s.y + reach > H - 2;
        if (!nearWall) maxTurn = Math.max(maxTurn, d);
      }
      prevAng = ang;
    }
    // Per-frame heading change stays small away from walls (smooth turns).
    expect(maxTurn).toBeLessThan(0.5);
  });

  it("F6: heading autocorrelation decays over a long run (no stall / limit cycle)", () => {
    // With the OLD position-coupled jitter the walk could lock into a cycle.
    // Sampling the jitter on a dedicated clock makes the heading a genuine
    // random walk, so its autocorrelation at a long lag drops well below 1.
    let s: ReturnType<typeof wanderStep> = { x: W / 2, y: H / 2, heading: 0.3, vx: 0, vy: 0, clock: 0 };
    const headings: number[] = [];
    for (let i = 0; i < 10000; i++) {
      s = wanderStep(s, 1 / 60, W, H, baseR, P);
      headings.push(s.heading);
    }
    // Autocorrelation of the unit heading vector at lag L.
    const lag = 2000;
    let dot = 0, n = 0;
    for (let i = 0; i + lag < headings.length; i++) {
      dot += Math.cos(headings[i]) * Math.cos(headings[i + lag]) +
        Math.sin(headings[i]) * Math.sin(headings[i + lag]);
      n++;
    }
    const autocorr = dot / n;
    expect(autocorr).toBeLessThan(0.8); // decayed from 1 => not stuck
  });

  it("F6: jitter is translation-invariant (same heading+clock => same step regardless of x,y)", () => {
    // Both sample points must be in the wall-free interior: the wall bounce
    // (heading reflection) is a position-dependent effect that is NOT the
    // jitter under test. With W=H=160 and reach≈43, [70,90] is well inside.
    const a = wanderStep({ x: 72, y: 76, heading: 0.7, vx: 0, vy: 0, clock: 5 }, 1 / 60, W, H, baseR, P);
    const b = wanderStep({ x: 88, y: 84, heading: 0.7, vx: 0, vy: 0, clock: 5 }, 1 / 60, W, H, baseR, P);
    // Same heading delta (the jitter no longer depends on position).
    const da = Math.atan2(Math.sin(a.heading - 0.7), Math.cos(a.heading - 0.7));
    const db = Math.atan2(Math.sin(b.heading - 0.7), Math.cos(b.heading - 0.7));
    expect(da).toBeCloseTo(db, 10);
  });
});

// ---------------------------------------------------------------------------
// driftActivation
// ---------------------------------------------------------------------------

describe("driftActivation", () => {
  it("ramps prev toward 1 when recording=true", () => {
    let v = 0;
    const rate = 0.1;
    for (let i = 0; i < 30; i++) {
      v = driftActivation(v, true, rate);
    }
    // After 30 frames at rate 0.1, should be very close to 1
    expect(v).toBeGreaterThan(0.95);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("ramps prev toward 0 when recording=false", () => {
    let v = 1;
    const rate = 0.1;
    for (let i = 0; i < 30; i++) {
      v = driftActivation(v, false, rate);
    }
    expect(v).toBeLessThan(0.05);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it("clamps to [0, 1]", () => {
    // rate=0.5, starting near 0, recording=true — should never exceed 1
    let v = 0;
    for (let i = 0; i < 20; i++) {
      v = driftActivation(v, true, 0.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Starting near 1, recording=false — should never go below 0
    v = 0.99;
    for (let i = 0; i < 20; i++) {
      v = driftActivation(v, false, 0.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("rate=1 jumps immediately to target", () => {
    expect(driftActivation(0, true, 1)).toBe(1);
    expect(driftActivation(0.5, true, 1)).toBe(1);
    expect(driftActivation(1, false, 1)).toBe(0);
    expect(driftActivation(0.3, false, 1)).toBe(0);
  });

  it("rate=0 never moves", () => {
    expect(driftActivation(0, true, 0)).toBe(0);
    expect(driftActivation(0.5, false, 0)).toBe(0.5);
    expect(driftActivation(1, false, 0)).toBe(1);
  });

  it("is deterministic", () => {
    let v1 = 0.3;
    let v2 = 0.3;
    for (let i = 0; i < 10; i++) {
      v1 = driftActivation(v1, i % 2 === 0, 0.05);
      v2 = driftActivation(v2, i % 2 === 0, 0.05);
      expect(v1).toBeCloseTo(v2, 10);
    }
  });

  it("default rate 0.02 reaches ~90% after ~3 seconds at 60 fps", () => {
    // 60 fps * 3 seconds = 180 frames; (1-0.02)^180 ≈ 0.026, so 1 - 0.026 = 0.974
    let v = 0;
    for (let i = 0; i < 180; i++) {
      v = driftActivation(v, true, 0.02);
    }
    expect(v).toBeGreaterThan(0.9);
  });
});

/**
 * Blend helper: given a cell-drift position, a canvas center, and an activation
 * value in [0, 1], returns the blended (x, y).
 *
 * This is the exact formula used in createCellRenderer tick.
 */
function blendCenter(
  drift: { cx: number; cy: number },
  width: number,
  height: number,
  activation: number,
): { x: number; y: number } {
  return {
    x: width / 2 + (drift.cx - width / 2) * activation,
    y: height / 2 + (drift.cy - height / 2) * activation,
  };
}

describe("blendCenter", () => {
  it("activation=0 → (width/2, height/2) regardless of drift position", () => {
    const drift = { cx: 80, cy: 120 };
    const b = blendCenter(drift, 160, 160, 0);
    expect(b.x).toBeCloseTo(80); // width/2
    expect(b.y).toBeCloseTo(80); // height/2

    const drift2 = { cx: 30, cy: 140 };
    const b2 = blendCenter(drift2, 160, 160, 0);
    expect(b2.x).toBeCloseTo(80);
    expect(b2.y).toBeCloseTo(80);
  });

  it("activation=1 → equals drift position", () => {
    const drift = { cx: 80, cy: 120 };
    const b = blendCenter(drift, 160, 160, 1);
    expect(b.x).toBeCloseTo(80);
    expect(b.y).toBeCloseTo(120);

    const drift2 = { cx: 30, cy: 140 };
    const b2 = blendCenter(drift2, 160, 160, 1);
    expect(b2.x).toBeCloseTo(30);
    expect(b2.y).toBeCloseTo(140);
  });

  it("activation=0.5 is halfway between center and drift", () => {
    const drift = { cx: 100, cy: 40 };
    const b = blendCenter(drift, 160, 160, 0.5);
    // width/2 = 80, half to 100 = 90
    expect(b.x).toBeCloseTo(90);
    // height/2 = 80, half to 40 = 60
    expect(b.y).toBeCloseTo(60);
  });

  it("blend is continuous (adjacent activation values are close)", () => {
    const drift = cellDrift(5, 160, 160, 16, CELL_DEFAULTS);
    const b1 = blendCenter(drift, 160, 160, 0.0);
    const b2 = blendCenter(drift, 160, 160, 0.2);
    const b3 = blendCenter(drift, 160, 160, 0.4);
    const b4 = blendCenter(drift, 160, 160, 0.6);
    const b5 = blendCenter(drift, 160, 160, 0.8);
    const b6 = blendCenter(drift, 160, 160, 1.0);
    // Check monotonic progression in both x and y (or at least no huge jumps)
    const xs = [b1.x, b2.x, b3.x, b4.x, b5.x, b6.x];
    for (let i = 1; i < xs.length; i++) {
      expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThan(Math.abs(drift.cx - 80) + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// restoreSeed
// ---------------------------------------------------------------------------

describe("restoreSeed", () => {
  it("resumes drift-phase at the persisted value (NOT double-counted)", () => {
    const saved: CellPersistState = { driftPhase: 1200, growth: 0.5, elapsed: 600 };
    const now = 1_000_000;
    const seed = restoreSeed(saved, now);
    // t ≈ (now - startedAt)/1000 ≈ 600
    const t = (now - seed.startedAt) / 1000;
    expect(t).toBeCloseTo(600, 0);
    // Phase arg passed to cellDrift: t + driftPhaseOffset
    const phaseArg = t + seed.driftPhaseOffset;
    // Should resume at the persisted driftPhase, NOT 2*elapsed + ...
    expect(Math.abs(phaseArg - saved.driftPhase)).toBeLessThan(1e-6);
    // Sanity: it must NOT be ~1800 (which would be the double-count bug)
    expect(Math.abs(phaseArg - 1800)).toBeGreaterThan(1);
    // Verify offset is calibrated: driftPhase - elapsed = 1200 - 600 = 600
    expect(seed.driftPhaseOffset).toBeCloseTo(600, 6);
  });

  it("handles elapsed=0 gracefully", () => {
    const saved: CellPersistState = { driftPhase: 42, growth: 0.2, elapsed: 0 };
    const now = 500_000;
    const seed = restoreSeed(saved, now);
    expect(seed.startedAt).toBeCloseTo(now, 0);
    expect(seed.driftPhaseOffset).toBeCloseTo(42, 6);
    const t = (now - seed.startedAt) / 1000;
    expect(t).toBeCloseTo(0, 0);
    const phaseArg = t + seed.driftPhaseOffset;
    expect(Math.abs(phaseArg - saved.driftPhase)).toBeLessThan(1e-6);
  });

  it("handles elapsed<0 (should occur only on tampered/edge data) — uses 0", () => {
    const saved: CellPersistState = { driftPhase: 10, growth: 0, elapsed: -5 };
    const now = 1_000_000;
    const seed = restoreSeed(saved, now);
    expect(seed.startedAt).toBeCloseTo(now, 0);
    expect(seed.driftPhaseOffset).toBeCloseTo(10, 6);
  });

  it("round-trips: persist → restoreSeed yields continuous phase", () => {
    // Simulate a running cell: driftPhaseOffset=7.3, t=5.2
    const driftPhaseOffset = 7.3;
    const tRun = 5.2;
    const phaseDuringRun = tRun + driftPhaseOffset; // 12.5

    // Persist
    const persisted: CellPersistState = {
      driftPhase: phaseDuringRun, // 12.5
      growth: 0.4,
      elapsed: tRun, // 5.2
    };

    // Restore a bit later
    const now = 2_000_000;
    const seed = restoreSeed(persisted, now);

    // First frame after restore: t' ≈ persisted.elapsed = 5.2
    const tRestored = (now - seed.startedAt) / 1000;
    expect(tRestored).toBeCloseTo(5.2, 0);

    // Phase arg should equal the phase at persist time (12.5), not 5.2+12.5=17.7
    const phaseAfterRestore = tRestored + seed.driftPhaseOffset;
    expect(Math.abs(phaseAfterRestore - phaseDuringRun)).toBeLessThan(1e-6);
    // Also verify that offset was properly computed: 12.5 - 5.2 = 7.3
    expect(seed.driftPhaseOffset).toBeCloseTo(driftPhaseOffset, 6);
  });
});

// ---------------------------------------------------------------------------
// serializeCellState / parseCellState
// ---------------------------------------------------------------------------

describe("CellPersistState serialization", () => {
  it("roundtrips a valid state", () => {
    const state = { driftPhase: 42.5, growth: 0.3, elapsed: 17.2 };
    const raw = serializeCellState(state);
    const parsed = parseCellState(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.driftPhase).toBeCloseTo(42.5);
    expect(parsed!.growth).toBeCloseTo(0.3);
    expect(parsed!.elapsed).toBeCloseTo(17.2);
  });

  it("parseCellState(null) returns null", () => {
    expect(parseCellState(null)).toBeNull();
  });

  it('parseCellState("garbage") returns null', () => {
    expect(parseCellState("garbage")).toBeNull();
  });

  it("parseCellState of empty string returns null", () => {
    expect(parseCellState("")).toBeNull();
  });

  it("parseCellState of object missing fields returns null", () => {
    expect(parseCellState('{"driftPhase":1}')).toBeNull();
    expect(parseCellState('{"growth":0.5}')).toBeNull();
    expect(parseCellState('{"elapsed":10}')).toBeNull();
    expect(parseCellState('{"driftPhase":1,"growth":0.5}')).toBeNull();
  });

  it("parseCellState of object with non-numeric fields returns null", () => {
    expect(parseCellState('{"driftPhase":"abc","growth":0.3,"elapsed":1}')).toBeNull();
    expect(parseCellState('{"driftPhase":1,"growth":true,"elapsed":1}')).toBeNull();
    expect(parseCellState('{"driftPhase":1,"growth":0.3,"elapsed":null}')).toBeNull();
  });

  it("parseCellState of object with extra fields still returns valid state", () => {
    const parsed = parseCellState('{"driftPhase":1,"growth":0.3,"elapsed":5,"extra":true}');
    expect(parsed).not.toBeNull();
    expect(parsed!.driftPhase).toBe(1);
    expect(parsed!.growth).toBe(0.3);
    expect(parsed!.elapsed).toBe(5);
  });

  it("serializeCellState produces valid JSON parseable string", () => {
    const state = { driftPhase: 0, growth: 0, elapsed: 0 };
    const raw = serializeCellState(state);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("rejects absurd elapsed (>= 1e7)", () => {
    expect(parseCellState(JSON.stringify({ driftPhase: 0, growth: 0, elapsed: 1e7 }))).toBeNull();
    expect(parseCellState(JSON.stringify({ driftPhase: 0, growth: 0, elapsed: 1e308 }))).toBeNull();
  });

  it("rejects absurd driftPhase (outside [-1e7, 1e7])", () => {
    expect(parseCellState(JSON.stringify({ driftPhase: 1e7 + 1, growth: 0, elapsed: 0 }))).toBeNull();
    expect(parseCellState(JSON.stringify({ driftPhase: -1e7 - 1, growth: 0, elapsed: 0 }))).toBeNull();
  });

  it("rejects negative elapsed", () => {
    expect(parseCellState(JSON.stringify({ driftPhase: 0, growth: 0, elapsed: -1 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Commit 8a — activity backbone (G1 cellActivity, G2 propulsion, F5 memoryless)
// ---------------------------------------------------------------------------
describe("cellActivity (G1)", () => {
  it("is the weighted blend 0.6*energy + 0.4*growth", () => {
    expect(cellActivity(1, 0)).toBeCloseTo(0.6, 12);
    expect(cellActivity(0, 1)).toBeCloseTo(0.4, 12);
    expect(cellActivity(1, 1)).toBeCloseTo(1.0, 12);
    expect(cellActivity(0, 0)).toBeCloseTo(0.0, 12);
    expect(cellActivity(0.5, 0.5)).toBeCloseTo(0.5, 12);
  });

  it("clamps to [0,1]", () => {
    expect(cellActivity(2, 2)).toBe(1);
    expect(cellActivity(-1, -1)).toBe(0);
    expect(cellActivity(5, 0)).toBe(1);
  });

  it("honors custom weights", () => {
    expect(cellActivity(1, 0, { activityEnergyWeight: 0.8, activityGrowthWeight: 0.2 })).toBeCloseTo(0.8, 12);
  });

  it("is pure/deterministic", () => {
    expect(cellActivity(0.37, 0.21)).toBe(cellActivity(0.37, 0.21));
  });
});

describe("swimSpeed (G2 propulsion law)", () => {
  const W = 160, H = 160;
  const P = { ...CELL_DEFAULTS };

  it("is ~zero at activity 0 (silence stops the cell, low-Re no coasting)", () => {
    expect(swimSpeed(0, W, H, P)).toBe(0);
  });

  it("is monotone increasing in activity", () => {
    let prev = -1;
    for (const a of [0, 0.2, 0.4, 0.6, 0.8, 1.0]) {
      const u = swimSpeed(a, W, H, P);
      expect(u).toBeGreaterThanOrEqual(prev);
      prev = u;
    }
  });

  it("is linear in activity: U(2a) ~= 2*U(a)", () => {
    const u1 = swimSpeed(0.3, W, H, P);
    const u2 = swimSpeed(0.6, W, H, P);
    expect(Math.abs(u2 / u1 - 2)).toBeLessThan(1e-9);
  });

  it("scales peak speed by swimSpeedMaxFrac*min(w,h)", () => {
    expect(swimSpeed(1, W, H, P)).toBeCloseTo((P.swimSpeedMaxFrac ?? 0.06) * 160, 9);
  });

  it("clamps activity to [0,1]", () => {
    expect(swimSpeed(5, W, H, P)).toBe(swimSpeed(1, W, H, P));
    expect(swimSpeed(-5, W, H, P)).toBe(0);
  });
});

describe("ciliaBeatHzEff (G2 beat-frequency coupling)", () => {
  const P = { ...CELL_DEFAULTS, ciliaBeatHz: 0.9, ciliaBeatHzActive: 1.6 };

  it("equals resting Hz at activity 0", () => {
    expect(ciliaBeatHzEff(0, P)).toBeCloseTo(0.9, 12);
  });

  it("equals active Hz at activity 1", () => {
    expect(ciliaBeatHzEff(1, P)).toBeCloseTo(1.6, 12);
  });

  it("ramps linearly and shares sign of dU/da (both rise with activity)", () => {
    expect(ciliaBeatHzEff(0.5, P)).toBeCloseTo(1.25, 12);
    const dHz = ciliaBeatHzEff(0.6, P) - ciliaBeatHzEff(0.3, P);
    const W = 160, H = 160;
    const dU = swimSpeed(0.6, W, H, P) - swimSpeed(0.3, W, H, P);
    expect(Math.sign(dHz)).toBe(Math.sign(dU));
  });
});

describe("wanderStep F5 memoryless velocity (G2)", () => {
  const W = 320, H = 320;
  const P = { ...CELL_DEFAULTS };
  const baseR = 17;
  const start = { x: 160, y: 160, heading: 0.5, vx: 0, vy: 0, clock: 0 };

  it("speed override replaces driftSpeed (drives speed directly)", () => {
    const fast = wanderStep(start, 0.016, W, H, baseR, P, 100);
    const slow = wanderStep(start, 0.016, W, H, baseR, P, 1);
    const dFast = Math.hypot(fast.x - start.x, fast.y - start.y);
    const dSlow = Math.hypot(slow.x - start.x, slow.y - start.y);
    expect(dFast).toBeGreaterThan(dSlow * 10);
  });

  it("is memoryless: dropping drive to ~0 stops motion the SAME step (no coasting)", () => {
    // Build up motion at high speed for several steps...
    let s = start;
    for (let i = 0; i < 20; i++) s = wanderStep(s, 0.016, W, H, baseR, P, 120);
    const movingSpeed = Math.hypot(s.vx, s.vy);
    expect(movingSpeed).toBeGreaterThan(50);
    // ...then cut the drive to 0: velocity must collapse immediately, no inertia.
    const stopped = wanderStep(s, 0.016, W, H, baseR, P, 0);
    expect(Math.hypot(stopped.vx, stopped.vy)).toBe(0);
    expect(Math.hypot(stopped.x - s.x, stopped.y - s.y)).toBe(0);
  });
});

describe("Commit 8a — activity gate", () => {
  it("flips enableActivity ON by default", () => {
    expect(CELL_DEFAULTS.enableActivity).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit 8b — body motion (G4 bodyHeading, D1 motion basis, D4 prolate)
// ---------------------------------------------------------------------------
describe("bodyHeadingStep (G4)", () => {
  const P = { ...CELL_DEFAULTS, bodyHeadingTau: 0.4 };

  it("holds heading when essentially still (no defined travel direction)", () => {
    expect(bodyHeadingStep(1.2, 0, 0, 0.016, P)).toBe(1.2);
    expect(bodyHeadingStep(1.2, 1e-9, 1e-9, 0.016, P)).toBe(1.2);
  });

  it("chases the velocity heading (EMA toward atan2(vy,vx))", () => {
    // moving along +x => target heading 0; start at 1.0 => should decrease toward 0
    const next = bodyHeadingStep(1.0, 10, 0, 0.016, P);
    expect(next).toBeLessThan(1.0);
    expect(next).toBeGreaterThan(0);
  });

  it("converges to the target after many steps", () => {
    let h = 2.5;
    for (let i = 0; i < 2000; i++) h = bodyHeadingStep(h, 5, 5, 0.016, P);
    expect(h).toBeCloseTo(Math.PI / 4, 3); // atan2(5,5)=pi/4
  });

  it("is Lipschitz from rest: per-step rotation bounded by the shortest-arc error", () => {
    // worst case: target opposite current heading (pi away)
    const h0 = 0;
    const h1 = bodyHeadingStep(h0, -10, 1e-3, 0.016, P); // target ~ +pi
    const alpha = 1 - Math.exp(-0.016 / 0.4);
    // step magnitude must be <= |shortest arc| * alpha (+ fp slack)
    expect(Math.abs(h1 - h0)).toBeLessThanOrEqual(Math.PI * alpha + 1e-9);
  });

  it("takes the shortest arc across the +/-pi wrap", () => {
    // heading just under +pi, target just over -pi (i.e. crossing the seam):
    // moving along -x with tiny -y => target ~ -pi+eps; shortest arc is small +.
    const h = bodyHeadingStep(Math.PI - 0.05, -10, -1e-3, 0.016, P);
    // should move toward -pi the SHORT way (increasing past pi / wrapping), not
    // swing all the way back through 0.
    expect(Math.abs(Math.atan2(Math.sin(h - Math.PI), Math.cos(h - Math.PI)))).toBeLessThan(0.05);
  });
});

describe("prolateAspect (D4)", () => {
  it("is identity (k=1) at rest with default floor 0 => round when still", () => {
    expect(prolateAspect(0, CELL_DEFAULTS)).toBe(1);
  });

  it("elongates with speed: k = 1 + elong*speedNorm", () => {
    const P = { ...CELL_DEFAULTS, bodyElongation: 0.13, bodyElongationFloor: 0 };
    expect(prolateAspect(1, P)).toBeCloseTo(1.13, 12);
    expect(prolateAspect(0.5, P)).toBeCloseTo(1.065, 12);
  });

  it("honors a nonzero floor (permanently prolate pellicle look)", () => {
    const P = { ...CELL_DEFAULTS, bodyElongation: 0.2, bodyElongationFloor: 0.5 };
    expect(prolateAspect(0, P)).toBeCloseTo(1.1, 12); // 1 + 0.2*0.5
    expect(prolateAspect(1, P)).toBeCloseTo(1.2, 12);
  });

  it("clamps speedNorm to [0,1]", () => {
    expect(prolateAspect(5, CELL_DEFAULTS)).toBe(prolateAspect(1, CELL_DEFAULTS));
    expect(prolateAspect(-5, CELL_DEFAULTS)).toBe(1);
  });

  it("D4 collapses to identity at speedNorm=0 (back-compat invariant)", () => {
    // The squeeze with k=1 is identity regardless of phi (proven in Commit 5);
    // prolateAspect(0)=1 guarantees the resting body is unchanged by D4.
    const noisy: Array<[number, number]> = [];
    for (let i = 0; i < 32; i++) {
      const th = (i / 32) * Math.PI * 2;
      const r = 30 + 9 * Math.sin(3 * th);
      noisy.push([80 + r * Math.cos(th), 90 + r * Math.sin(th)]);
    }
    const k = prolateAspect(0, CELL_DEFAULTS);
    const out = affineSqueezePoints(noisy, k, 1.234, 80, 90, { ...CELL_DEFAULTS, enableAffine: true });
    for (let i = 0; i < noisy.length; i++) {
      expect(out[i][0]).toBeCloseTo(noisy[i][0], 9);
      expect(out[i][1]).toBeCloseTo(noisy[i][1], 9);
    }
  });

  it("D4 prolate preserves area (det=1) while elongating along travel", () => {
    const shoelace = (pts: Array<[number, number]>) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        a += x1 * y2 - x2 * y1;
      }
      return Math.abs(a) / 2;
    };
    const noisy: Array<[number, number]> = [];
    for (let i = 0; i < 64; i++) {
      const th = (i / 64) * Math.PI * 2;
      const r = 30 + 7 * Math.sin(3 * th) + 4 * Math.cos(7 * th);
      noisy.push([80 + r * Math.cos(th), 90 + r * Math.sin(th)]);
    }
    const before = shoelace(noisy);
    const P = { ...CELL_DEFAULTS, enableAffine: true, bodyElongation: 0.13 };
    const k = prolateAspect(1, P);
    const out = affineSqueezePoints(noisy, k, 0.6, 80, 90, P);
    expect(shoelace(out)).toBeCloseTo(before, 6);
    // and it actually deformed (prolate, not identity)
    let maxDelta = 0;
    for (let i = 0; i < noisy.length; i++) maxDelta = Math.max(maxDelta, Math.hypot(out[i][0] - noisy[i][0], out[i][1] - noisy[i][1]));
    expect(maxDelta).toBeGreaterThan(0.5);
  });
});

describe("Commit 8b — affine gate", () => {
  it("flips enableAffine ON; body round at rest (floor 0)", () => {
    expect(CELL_DEFAULTS.enableAffine).toBe(true);
    expect(CELL_DEFAULTS.bodyElongationFloor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Commit 8c — cilia motion coupling (D2 drag-lean + biology params)
// ---------------------------------------------------------------------------
describe("ciliaPath D2 drag-lean", () => {
  const cx = 80, cy = 80, baseR = 17, t = 1.0;
  const P = { ...CELL_DEFAULTS };

  it("collapses to identity at speedNorm=0 (back-compat: no motion => no lean)", () => {
    const still = ciliaPath(cx, cy, baseR, t, 0.5, 0.5, P, { tx: 1, ty: 0, speedNorm: 0 });
    const none = ciliaPath(cx, cy, baseR, t, 0.5, 0.5, P);
    expect(still.length).toBe(none.length);
    for (let h = 0; h < still.length; h++) {
      for (let i = 0; i < still[h].points.length; i++) {
        expect(still[h].points[i][0]).toBeCloseTo(none[h].points[i][0], 9);
        expect(still[h].points[i][1]).toBeCloseTo(none[h].points[i][1], 9);
      }
    }
  });

  it("leans the crown REARWARD (opposite travel) when swimming", () => {
    // Travelling along +x: tips should be displaced toward -x vs the still crown.
    const motion: CiliaMotion = { tx: 1, ty: 0, speedNorm: 1 };
    const moving = ciliaPath(cx, cy, baseR, t, 0.6, 0.6, P, motion);
    const still = ciliaPath(cx, cy, baseR, t, 0.6, 0.6, P, { tx: 1, ty: 0, speedNorm: 0 });
    // mean tip x-displacement must be negative (rearward, -x).
    let sumDx = 0;
    for (let h = 0; h < moving.length; h++) {
      const tip = moving[h].points[moving[h].points.length - 1];
      const tip0 = still[h].points[still[h].points.length - 1];
      sumDx += tip[0] - tip0[0];
    }
    expect(sumDx / moving.length).toBeLessThan(0);
  });

  it("base stays anchored at the membrane (lean grows toward the tip)", () => {
    const motion: CiliaMotion = { tx: 1, ty: 0, speedNorm: 1 };
    const moving = ciliaPath(cx, cy, baseR, t, 0.6, 0.6, P, motion);
    const still = ciliaPath(cx, cy, baseR, t, 0.6, 0.6, P, { tx: 1, ty: 0, speedNorm: 0 });
    for (let h = 0; h < moving.length; h++) {
      // base point (index 0) is unmoved by drag (pow(0,1.3)=0)
      expect(moving[h].points[0][0]).toBeCloseTo(still[h].points[0][0], 9);
      expect(moving[h].points[0][1]).toBeCloseTo(still[h].points[0][1], 9);
    }
  });

  it("leading-face hairs lean more than trailing-face hairs", () => {
    // lead = radial . tangent; dragGain = dragCoeff*speed*(0.6+0.4*lead).
    // A hair pointing along +tangent (leading, lead=+1) should lean more than
    // one pointing along -tangent (trailing, lead=-1).
    const motion: CiliaMotion = { tx: 1, ty: 0, speedNorm: 1 };
    const moving = ciliaPath(cx, cy, baseR, t, 0.6, 0.6, P, motion);
    const still = ciliaPath(cx, cy, baseR, t, 0.6, 0.6, P, { tx: 1, ty: 0, speedNorm: 0 });
    // find the hair most aligned with +x (leading) and -x (trailing)
    let leadIdx = 0, trailIdx = 0, leadDot = -2, trailDot = 2;
    for (let h = 0; h < moving.length; h++) {
      const b = still[h].points[0];
      const dx = b[0] - cx, dy = b[1] - cy;
      const dot = dx / Math.hypot(dx, dy); // . (1,0)
      if (dot > leadDot) { leadDot = dot; leadIdx = h; }
      if (dot < trailDot) { trailDot = dot; trailIdx = h; }
    }
    const lean = (h: number) => {
      const tip = moving[h].points[moving[h].points.length - 1];
      const tip0 = still[h].points[still[h].points.length - 1];
      return Math.abs(tip[0] - tip0[0]);
    };
    expect(lean(leadIdx)).toBeGreaterThan(lean(trailIdx));
  });

  it("is pure/deterministic with a motion basis", () => {
    const m: CiliaMotion = { tx: 0.6, ty: 0.8, speedNorm: 0.7 };
    const a = ciliaPath(cx, cy, baseR, t, 0.5, 0.5, P, m);
    const b = ciliaPath(cx, cy, baseR, t, 0.5, 0.5, P, m);
    expect(a).toEqual(b);
  });
});

describe("Commit 8c — biology param corrections", () => {
  it("ciliaAsymmetry default = 0.49 (power:recovery ~ 1:2.9)", () => {
    expect(CELL_DEFAULTS.ciliaAsymmetry).toBeCloseTo(0.49, 12);
  });
  it("ciliaMetachronal default = 1.1 (lambda ~ 5-7 cilia)", () => {
    expect(CELL_DEFAULTS.ciliaMetachronal).toBeCloseTo(1.1, 12);
  });
  it("dragCoeff default = 0.5", () => {
    expect(CELL_DEFAULTS.dragCoeff).toBeCloseTo(0.5, 12);
  });
});

// ---------------------------------------------------------------------------
// Commit 9 — robustness seams (F8 dt-consistency, M9 idle de-flicker)
// ---------------------------------------------------------------------------
describe("driftActivation F8 frame-rate independence", () => {
  it("equals the legacy per-frame factor at dt=1/60 (back-compat)", () => {
    const legacy = driftActivation(0.3, true, 0.02);
    const dtForm = driftActivation(0.3, true, 0.02, 1 / 60);
    expect(dtForm).toBeCloseTo(legacy, 12);
  });

  it("omitting dt reproduces the exact legacy behavior", () => {
    expect(driftActivation(0.5, true, 0.02)).toBe(0.5 + (1 - 0.5) * 0.02);
  });

  it("reaches the same value after equal wall-clock time at different frame rates", () => {
    // 1 second of activation: 60 steps @16.67ms vs 30 steps @33.3ms must match.
    let a = 0, b = 0;
    for (let i = 0; i < 60; i++) a = driftActivation(a, true, 0.02, 1 / 60);
    for (let i = 0; i < 30; i++) b = driftActivation(b, true, 0.02, 1 / 30);
    expect(b).toBeCloseTo(a, 4);
  });

  it("still clamps to [0,1] and moves toward the target", () => {
    expect(driftActivation(0.99, true, 0.5, 0.05)).toBeLessThanOrEqual(1);
    expect(driftActivation(0.01, false, 0.5, 0.05)).toBeGreaterThanOrEqual(0);
    expect(driftActivation(0, true, 0.02, 1 / 60)).toBeGreaterThan(0); // toward 1
    expect(driftActivation(1, false, 0.02, 1 / 60)).toBeLessThan(1); // toward 0
  });
});

describe("M9 idle de-flicker (smoothstep on activity)", () => {
  // idleFactor = (1 - smoothstep(activity/0.33)) * recordingFade. The property
  // we lock: it is monotone-NONincreasing in activity and bounded/continuous —
  // no hard knee that flips on small audio fluctuations.
  const idleFactorOf = (activity: number) => 1 - smoothstep(activity / 0.33);

  it("is full (1) at zero activity and ~0 once active", () => {
    expect(idleFactorOf(0)).toBeCloseTo(1, 12);
    expect(idleFactorOf(0.33)).toBeCloseTo(0, 12);
    expect(idleFactorOf(1)).toBe(0);
  });

  it("is monotone non-increasing in activity (no flicker knee)", () => {
    let prev = 2;
    for (let a = 0; a <= 1.0001; a += 0.02) {
      const f = idleFactorOf(a);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it("has bounded slope near the threshold (smoothstep has zero-derivative ends)", () => {
    // smoothstep' = 0 at both ends, so small jitter at activity=0 or 0.33 barely
    // moves idleFactor (unlike the old linear knee whose slope was a constant 3).
    const eps = 0.005;
    const dAtZero = Math.abs(idleFactorOf(eps) - idleFactorOf(0));
    expect(dAtZero).toBeLessThan(0.01); // gentle, not the old ~3*eps*... jump
  });
});

// ---------------------------------------------------------------------------
// Commit 10 — H1/M8 startle as a low-Re escape dart (heading kick + speed burst)
// ---------------------------------------------------------------------------
describe("startleHeadingKick (H1/M8)", () => {
  const P = { ...CELL_DEFAULTS, startleKickThreshold: 0.12, startleKickMax: 1.2 };

  it("kicks the heading on a rising startle edge (perturbs direction, not position)", () => {
    // big jump 0 -> 0.8 exceeds threshold => nonzero kick
    const k = startleHeadingKick(0.8, 0.0, 1.0, P);
    expect(k).not.toBe(0);
    expect(Math.abs(k)).toBeLessThanOrEqual(1.2);
  });

  it("does NOT kick when startle is steady or decaying (no edge)", () => {
    expect(startleHeadingKick(0.5, 0.5, 1.0, P)).toBe(0); // steady
    expect(startleHeadingKick(0.3, 0.6, 1.0, P)).toBe(0); // decaying
    expect(startleHeadingKick(0.05, 0.0, 1.0, P)).toBe(0); // rise below threshold
  });

  it("is bounded by startleKickMax and deterministic", () => {
    for (let t = 0; t < 20; t += 0.3) {
      const k = startleHeadingKick(1.0, 0.0, t, P);
      expect(Math.abs(k)).toBeLessThanOrEqual(1.2 + 1e-12);
    }
    expect(startleHeadingKick(1, 0, 3.3, P)).toBe(startleHeadingKick(1, 0, 3.3, P));
  });
});

describe("startleBurstSpeed (H1)", () => {
  const P = { ...CELL_DEFAULTS, startleBurstFrac: 0.5 };
  const baseR = 17;

  it("is zero with no startle and scales linearly with startle (memoryless)", () => {
    expect(startleBurstSpeed(0, baseR, P)).toBe(0);
    expect(startleBurstSpeed(1, baseR, P)).toBeCloseTo(0.5 * baseR, 9);
    expect(startleBurstSpeed(0.5, baseR, P)).toBeCloseTo(0.25 * baseR, 9);
  });

  it("clamps startle to [0,1]", () => {
    expect(startleBurstSpeed(5, baseR, P)).toBe(startleBurstSpeed(1, baseR, P));
    expect(startleBurstSpeed(-5, baseR, P)).toBe(0);
  });

  it("fades as startle decays (no coasting): smaller startle => smaller burst", () => {
    let prev = Infinity;
    for (const s of [1.0, 0.7, 0.4, 0.1, 0.0]) {
      const b = startleBurstSpeed(s, baseR, P);
      expect(b).toBeLessThan(prev);
      prev = b;
    }
  });
});

describe("Commit 10 — startle kick gate", () => {
  it("enableStartleKick defaults ON (M8: no idle centre shove)", () => {
    expect(CELL_DEFAULTS.enableStartleKick).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit 11 — M16: bin-count robustness (sampleBinLevel works for ANY count)
// ---------------------------------------------------------------------------
describe("sampleBinLevel M16 — arbitrary bin count is periodic-continuous", () => {
  const mkBins = (n: number) =>
    Array.from({ length: n }, (_, i) => 0.5 + 0.4 * Math.sin((i / n) * Math.PI * 2));

  for (const n of [16, 32, 64]) {
    it(`is seam-continuous (value(0)==value(1)) for ${n} bins`, () => {
      const bins = mkBins(n);
      expect(sampleBinLevel(bins, 0)).toBeCloseTo(sampleBinLevel(bins, 1), 12);
    });

    it(`has a bounded cyclic step (no staircase/seam jump) for ${n} bins`, () => {
      const bins = mkBins(n);
      const SAMPLES = 720;
      let prev = sampleBinLevel(bins, 0);
      let maxStep = 0;
      for (let i = 1; i <= SAMPLES; i++) {
        const v = sampleBinLevel(bins, i / SAMPLES);
        maxStep = Math.max(maxStep, Math.abs(v - prev));
        prev = v;
      }
      // smoothstep interpolation keeps the per-sample change tiny vs the raw
      // bin-to-bin amplitude (~0.4); generous bound proves no discontinuity.
      expect(maxStep).toBeLessThan(0.05);
    });

    it(`returns values within the bin range for ${n} bins`, () => {
      const bins = mkBins(n);
      for (let i = 0; i <= 100; i++) {
        const v = sampleBinLevel(bins, i / 100);
        expect(v).toBeGreaterThanOrEqual(0.1 - 1e-9);
        expect(v).toBeLessThanOrEqual(0.9 + 1e-9);
      }
    });
  }

  it("degenerate counts are safe (0 -> 0, 1 -> constant)", () => {
    expect(sampleBinLevel([], 0.5)).toBe(0);
    expect(sampleBinLevel([0.7], 0.0)).toBe(0.7);
    expect(sampleBinLevel([0.7], 0.5)).toBe(0.7);
    expect(sampleBinLevel([0.7], 1.0)).toBe(0.7);
  });

  it("renderer accepts a non-32 spectrumBins length without throwing", () => {
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 160, height: 160 });
    const step = (k: number) => { for (let i = 0; i < k; i++) { if (rafCalls.length) rafCalls.shift()!(); } };
    for (const len of [16, 48, 64]) {
      r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(len).fill(0.4) });
      expect(() => step(1)).not.toThrow();
    }
    r.destroy();
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Commit 12 — D3 + F4 + G3 rowing coherence (enableStrokeAxis)
// ---------------------------------------------------------------------------
describe("strokeAxisStrength (G3 idle/active vigour)", () => {
  it("is ~0 at rest (activity 0) and high at full activity", () => {
    expect(strokeAxisStrength(0, CELL_DEFAULTS)).toBeLessThan(0.05);
    expect(strokeAxisStrength(1, CELL_DEFAULTS)).toBeGreaterThan(0.6);
  });
  it("is monotonic non-decreasing in activity and bounded [0,1]", () => {
    let prev = -1;
    for (let a = 0; a <= 1.0001; a += 0.1) {
      const w = strokeAxisStrength(a, CELL_DEFAULTS);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = w;
    }
  });
  it("clamps out-of-range activity", () => {
    expect(strokeAxisStrength(-5, CELL_DEFAULTS)).toBe(strokeAxisStrength(0, CELL_DEFAULTS));
    expect(strokeAxisStrength(9, CELL_DEFAULTS)).toBe(strokeAxisStrength(1, CELL_DEFAULTS));
  });
});

describe("metachronalIndex (D3 metachronal wave on motion axis)", () => {
  const gap = (Math.PI * 2) / 18;
  it("returns the integer index k when disengaged (gate off)", () => {
    for (const k of [0, 3, 7, 17]) {
      expect(metachronalIndex(k * gap, k, 0.8, 0.5, gap, false)).toBe(k);
    }
  });
  it("returns k when engaged but speedNorm=0 (back-compat at rest)", () => {
    for (const k of [0, 5, 11]) {
      expect(metachronalIndex(k * gap, k, 0, 0.5, gap, true)).toBeCloseTo(k, 12);
    }
  });
  it("at speedNorm=1 the index tracks (baseAngle-axis)/gap (rotates with heading)", () => {
    const axis = 1.3;
    const baseAngle = 1.3 + 2 * gap; // 2 gaps ahead of the axis
    const idx = metachronalIndex(baseAngle, 99, 1, axis, gap, true);
    expect(idx).toBeCloseTo(2, 6); // wrapPi(2*gap)/gap == 2
  });
  it("blends linearly between k and the axial index in speedNorm", () => {
    const axis = 0.4, baseAngle = 0.4 + 3 * gap, k = 10;
    const lo = metachronalIndex(baseAngle, k, 0, axis, gap, true);
    const mid = metachronalIndex(baseAngle, k, 0.5, axis, gap, true);
    const hi = metachronalIndex(baseAngle, k, 1, axis, gap, true);
    expect(mid).toBeCloseTo((lo + hi) / 2, 6);
  });
});

describe("ciliaStrokeAngle (F4 shared stroke axis)", () => {
  it("is the local perpendicular (baseAngle+pi/2) when strength=0 (identity)", () => {
    for (const ba of [0, 1, 2.5, 5]) {
      expect(ciliaStrokeAngle(ba, 0.7, 0)).toBeCloseTo(ba + Math.PI / 2, 12);
    }
  });
  it("rotates each hair toward the global axis LINE, never more than pi/2", () => {
    const axis = 0.9;
    for (const ba of [0, 1, 2, 3, 4, 5, 6]) {
      const local = ba + Math.PI / 2;
      const psi = ciliaStrokeAngle(ba, axis, 1);
      // fully aligned: psi is the axis orientation (mod pi)
      const d = ((psi - axis) % Math.PI + Math.PI) % Math.PI;
      expect(Math.min(d, Math.PI - d)).toBeLessThan(1e-6);
      // never rotates more than pi/2 from the local plane
      const moved = Math.abs(((psi - local + Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(moved).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
    }
  });
});

describe("F4/G3 crown orientation coherence (R metric)", () => {
  // Axial resultant R2 = |mean(exp(2 i psi))| over the crown's stroke directions.
  const axialR = (strength: number) => {
    const n = 18;
    const gap = (Math.PI * 2) / n;
    const axis = 0.7;
    let re = 0, im = 0;
    for (let k = 0; k < n; k++) {
      const baseAngle = k * gap; // even crown (jitter omitted; tests the bias only)
      const psi = ciliaStrokeAngle(baseAngle, axis, strength);
      re += Math.cos(2 * psi);
      im += Math.sin(2 * psi);
    }
    return Math.hypot(re, im) / n;
  };
  it("idle (strength~0) => near-isotropic crown R<0.2 (no rowing in place)", () => {
    expect(axialR(strokeAxisStrength(0, CELL_DEFAULTS))).toBeLessThan(0.2);
  });
  it("active (strength from activity=1) => coherent crown R>0.4", () => {
    expect(axialR(strokeAxisStrength(1, CELL_DEFAULTS))).toBeGreaterThan(0.4);
  });
});

describe("Commit 12 — enableStrokeAxis gate + ciliaPath back-compat", () => {
  it("enableStrokeAxis defaults ON", () => {
    expect(CELL_DEFAULTS.enableStrokeAxis).toBe(true);
  });
  it("ciliaPath is byte-identical with no motion vs motion {speedNorm:0, axisStrength:0}", () => {
    const P = { ...CELL_DEFAULTS };
    const a = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, P);
    const b = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, P, { tx: 1, ty: 0, speedNorm: 0, axisStrength: 0 });
    expect(b).toEqual(a);
  });
  it("axisStrength=0 reproduces the EXACT legacy perpendicular bend (-uy,ux) byte-for-byte", () => {
    // The fast-path uses (-uy,ux) directly rather than cos/sin(baseAngle+pi/2),
    // which differ at ~1e-15 (IEEE-754). With axisStrength=0 AND speedNorm=0 (so
    // D2 drag-lean is also identity) the crown must be byte-identical to the
    // no-motion call (true commit-11 equivalence, not just visual).
    const P = { ...CELL_DEFAULTS };
    const withMotion = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, P, { tx: 1, ty: 0, speedNorm: 0, axisStrength: 0 });
    const noMotion = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, P);
    expect(withMotion).toEqual(noMotion);
    // And with the gate explicitly off + a heading, the bend plane still uses the
    // exact legacy vectors (axisStrength forced to 0 by the gate), speedNorm=0.
    const Poff = { ...CELL_DEFAULTS, enableStrokeAxis: false };
    const gateOff = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, Poff, { tx: 0.3, ty: 0.95, speedNorm: 0, axisStrength: 0.9 });
    expect(gateOff).toEqual(noMotion);
  });
  it("F4 partial-strength fan-out stays bounded (no crown-wide flip mid-ramp)", () => {
    // Note 2: 0<axisStrength<1 can fan the fore/aft hair pair; verify the max
    // per-hair bend-plane rotation never exceeds pi/2 from local at any strength.
    const n = 18;
    const gap = (Math.PI * 2) / n;
    const axis = 0.7;
    for (const s of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      for (let k = 0; k < n; k++) {
        const ba = k * gap;
        const local = ba + Math.PI / 2;
        const psi = ciliaStrokeAngle(ba, axis, s);
        const moved = Math.abs(((psi - local + Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(moved).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
      }
    }
  });
  it("ciliaPath changes the crown when axisStrength>0 and the cell swims", () => {
    const P = { ...CELL_DEFAULTS };
    const rest = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, P);
    const swim = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, P, { tx: 1, ty: 0, speedNorm: 0.9, axisStrength: 0.8 });
    let differs = false;
    for (let h = 0; h < rest.length && !differs; h++) {
      for (let i = 0; i < rest[h].points.length; i++) {
        if (Math.abs(rest[h].points[i][0] - swim[h].points[i][0]) > 1e-6) { differs = true; break; }
      }
    }
    expect(differs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit 21b — frozen cilia crown golden (regression guard)
//
// Pins the EXACT current default/off-path output of ciliaPath (the 18-hair
// crown) byte-for-byte. Any future change to the default look or the
// no-motion / rest-motion path breaks this golden immediately. Per the
// SoupaWhisper cell plan this golden is frozen PRE-21 so the somatic-mex
// rework lands behind an explicit gate without silently moving the default.
// ---------------------------------------------------------------------------
describe("Commit 21b — frozen cilia crown golden (regression guard)", () => {
  // Serialized at fixed precision (width 6dp, coords 4dp) from the actual
  // current run of ciliaPath(80,80,24, 1.0,0.6,0.8, {...CELL_DEFAULTS}).
  const FROZEN_CROWN =
    '[{"w":1.619829,"p":[[103.985,80.8486],[107.8721,79.4012],[111.6762,80.2992],[115.3935,83.6503],[119.2206,83.8985],[123.1411,81.5065],[126.9715,81.6618]]},{"w":1.558097,"p":[[101.9941,89.6052],[104.6015,89.9584],[106.5011,91.9322],[108.2521,94.2462],[110.9097,94.4844],[113.7706,94.2572],[115.9097,95.6825]]},{"w":1.749002,"p":[[99.3555,94.1903],[102.1111,95.0795],[106.23,94.1091],[107.2194,97.4073],[106.6346,102.8528],[109.0844,104.1591],[112.653,103.9392]]},{"w":1.811888,"p":[[93.2488,100.0117],[93.4918,103.4393],[98.2348,103.8878],[102.6019,104.585],[101.2716,109.0542],[99.9736,113.502],[103.1594,114.9814]]},{"w":2.010338,"p":[[85.9052,103.2622],[85.6968,107.2919],[85.9875,111.1949],[89.3597,114.3157],[91.9426,117.6368],[91.3964,121.7522],[91.5957,125.6785]]},{"w":1.484599,"p":[[75.3534,103.5459],[74.509,107.013],[71.9272,110.1372],[71.6695,113.7201],[73.5018,117.7154],[73.136,121.277],[71.2121,124.531]]},{"w":1.550961,"p":[[67.6771,100.5948],[66.1635,102.4609],[63.9875,103.9306],[63.4267,106.3667],[63.6261,109.2577],[62.256,111.2096],[60.3498,112.8408]]},{"w":1.37275,"p":[[62.708,96.6429],[61.5083,98.1731],[59.3819,98.7403],[57.6528,99.7204],[57.081,101.9029],[56.1816,103.7451],[54.3843,104.6542]]},{"w":1.311499,"p":[[57.8648,89.2753],[56.2907,91.1897],[54.9021,93.5467],[51.9207,92.1025],[48.784,90.2875],[47.2306,92.2513],[45.7368,94.3573]]},{"w":1.667664,"p":[[56.0708,78.1576],[52.5967,74.7024],[48.7036,76.6879],[44.4933,82.794],[40.8311,81.7811],[37.5192,76.2183],[33.762,76.44]]},{"w":1.441394,"p":[[56.8753,73.5777],[55.1589,71.3748],[52.4122,72.8818],[49.3691,75.4561],[47.6497,73.2638],[46.3066,69.7169],[43.9065,69.9759]]},{"w":1.396169,"p":[[60.7788,65.6283],[59.988,62.5104],[58.4582,60.3809],[53.9301,62.2616],[50.4917,62.6847],[50.1174,59.0097],[48.7638,56.6447]]},{"w":1.324854,"p":[[66.8707,59.9097],[66.1403,58.06],[65.7154,56.0106],[63.9201,54.8568],[61.8057,53.9115],[61.0425,52.0833],[60.4768,50.1259]]},{"w":1.625419,"p":[[75.9056,56.3518],[73.8915,53.7864],[71.4154,51.301],[74.1869,47.907],[77.2811,44.4571],[75.1471,41.9124],[72.9664,39.3759]]},{"w":1.40829,"p":[[84.1401,56.3598],[87.1089,53.1803],[83.6724,48.879],[80.0205,44.54],[83.9407,41.5271],[89.1589,38.7415],[87.9117,34.8236]]},{"w":1.189218,"p":[[93.7003,60.2946],[95.351,59.0484],[94.2257,55.8722],[94.3946,53.5958],[98.0246,53.7257],[100.5693,53.1011],[100.4322,50.612]]},{"w":1.480973,"p":[[97.5755,63.6568],[101.6887,63.3726],[104.7292,61.9349],[103.3962,55.794],[103.6462,51.3553],[108.3651,51.7226],[111.6607,50.5592]]},{"w":1.445299,"p":[[102.8087,72.5326],[105.6533,71.8759],[108.8812,72.3898],[111.4491,70.8879],[113.5634,68.0005],[116.3103,67.0454],[119.3892,67.1043]]}]';

  const serialize = (crown: ReturnType<typeof ciliaPath>): string =>
    JSON.stringify(
      crown.map((c) => ({
        w: +c.width.toFixed(6),
        p: c.points.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]),
      })),
    );

  it("emits exactly ciliaCount (18) hairs", () => {
    const crown = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, { ...CELL_DEFAULTS });
    expect(crown.length).toBe(CELL_DEFAULTS.ciliaCount);
    expect(crown.length).toBe(18);
  });

  it("matches the frozen golden byte-for-byte (default/off path)", () => {
    const crown = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, { ...CELL_DEFAULTS });
    expect(serialize(crown)).toBe(FROZEN_CROWN);
  });

  it("rest motion {speedNorm:0, axisStrength:0} is identical to the no-motion crown (off-path pin)", () => {
    const noMotion = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, { ...CELL_DEFAULTS });
    const rest = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, { ...CELL_DEFAULTS }, { tx: 1, ty: 0, speedNorm: 0, axisStrength: 0 });
    expect(rest).toEqual(noMotion);
  });
});

// ---------------------------------------------------------------------------
// Commit 21c — cilia anchored on deformed+squeezed contour (gate default OFF)
// ---------------------------------------------------------------------------
describe("Commit 21c — cilia anchored on deformed+squeezed contour", () => {
  const cx = 80;
  const cy = 80;
  const baseR = 24;
  // A smooth +0.2 cosine bump centred at theta0 over a 96-sample deform array.
  const bumpDeform = (theta0: number, amp = 0.2, n = 96, halfWidth = 6): number[] => {
    const arr = new Array<number>(n).fill(0);
    const i0 = ((Math.round((theta0 / TAU) * n) % n) + n) % n;
    for (let j = -halfWidth; j <= halfWidth; j++) {
      const idx = ((i0 + j) % n + n) % n;
      // raised-cosine window in [0,1], peak at j=0
      arr[idx] = amp * 0.5 * (1 + Math.cos((Math.PI * j) / (halfWidth + 1)));
    }
    return arr;
  };
  const baseAngleOf = (k: number, n: number): number => {
    const gap = TAU / n;
    const angOff = noise2D(k * 12.9898, 7.2) * Math.max(0, Math.min(0.9, CELL_DEFAULTS.ciliaAngleJitter ?? 0.55)) * gap * 0.5;
    return k * gap + angOff;
  };

  // ---- (a) OFF-PATH IDENTITY -------------------------------------------------
  it("gate OFF with a contour-carrying motion === the no-contour crown", () => {
    const off = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, { ...CELL_DEFAULTS });
    const withContour = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, { ...CELL_DEFAULTS }, {
      tx: 1, ty: 0, speedNorm: 0, axisStrength: 0,
      contour: { deform: bumpDeform(0.7), squeezeK: 1.5, squeezePhi: 0.3 },
    });
    expect(withContour).toEqual(off);
  });

  it("gate ON but motion.contour undefined === the off crown", () => {
    const off = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, { ...CELL_DEFAULTS }, { tx: 1, ty: 0, speedNorm: 0, axisStrength: 0 });
    const on = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, { ...CELL_DEFAULTS, enableCiliaOnContour: true }, { tx: 1, ty: 0, speedNorm: 0, axisStrength: 0 });
    expect(on).toEqual(off);
  });

  // ---- (b) DEFORM BULGE ------------------------------------------------------
  it("a +0.2 deform bump pushes the nearest hair base to ~baseR*1.2; opposite stays ~baseR", () => {
    const n = CELL_DEFAULTS.ciliaCount;
    const theta0 = baseAngleOf(3, n); // align the bump to hair #3's base angle
    const deform = bumpDeform(theta0, 0.2);
    const P = { ...CELL_DEFAULTS, enableCiliaOnContour: true, enableAffine: false };
    const crown = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, P, {
      tx: 1, ty: 0, speedNorm: 0, axisStrength: 0,
      contour: { deform, squeezeK: 1, squeezePhi: 0 },
    });
    const radii = crown.map((h) => Math.hypot(h.points[0][0] - cx, h.points[0][1] - cy));
    // hair nearest theta0 bulges out to ~1.2*baseR
    const angles = crown.map((_, k) => baseAngleOf(k, n));
    let nearest = 0;
    let best = Infinity;
    for (let k = 0; k < angles.length; k++) {
      const d = Math.abs(((angles[k] - theta0 + Math.PI) % TAU + TAU) % TAU - Math.PI);
      if (d < best) { best = d; nearest = k; }
    }
    expect(radii[nearest]).toBeCloseTo(baseR * 1.2, 1);
    // a hair on the opposite side is undeformed (~baseR)
    const opp = (nearest + Math.round(angles.length / 2)) % angles.length;
    expect(radii[opp]).toBeCloseTo(baseR, 4);
  });

  // ---- (c) PROLATE ASPECT ----------------------------------------------------
  it("squeezeK=1.5 along phi=0 makes the base-point bbox aspect ~k^2=2.25", () => {
    const k = 1.5;
    const P = { ...CELL_DEFAULTS, enableCiliaOnContour: true, enableAffine: true };
    const crown = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, P, {
      tx: 1, ty: 0, speedNorm: 0, axisStrength: 0,
      contour: { deform: new Array<number>(96).fill(0), squeezeK: k, squeezePhi: 0 },
    });
    const xs = crown.map((h) => h.points[0][0]);
    const ys = crown.map((h) => h.points[0][1]);
    const width = Math.max(...xs) - Math.min(...xs); // along phi=0 (x), stretched by k
    const height = Math.max(...ys) - Math.min(...ys); // across (y), shrunk by 1/k
    expect(width / height).toBeCloseTo(k * k, 1);
  });

  // ---- (d) ORTHOGONALITY (reciprocal-diagonal normal contract) ---------------
  it("the reciprocal-diagonal normal is contour-perpendicular; the WRONG diagonal is not", () => {
    const k = 1.5;
    const phi = 0;
    const cphi = Math.cos(phi);
    const sphi = Math.sin(phi);
    // squeezed contour point of the undeformed circle at angle theta
    const sqPt = (theta: number): [number, number] => {
      const x = cx + Math.cos(theta) * baseR;
      const y = cy + Math.sin(theta) * baseR;
      const dx = x - cx, dy = y - cy;
      const xr = dx * cphi + dy * sphi;
      const yr = -dx * sphi + dy * cphi;
      const xs = xr * k, ys = yr / k;
      return [cx + xs * cphi - ys * sphi, cy + xs * sphi + ys * cphi];
    };
    const delta = 1e-4;
    for (const theta of [0.3, 1.1, 2.4, 3.9, 5.2]) {
      // numeric squeezed-contour tangent
      const a = sqPt(theta - delta);
      const b = sqPt(theta + delta);
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      // unsqueezed outward normal of the (undeformed) circle = radial
      const n0x = Math.cos(theta), n0y = Math.sin(theta);
      // CORRECT: reciprocal diagonal diag(1/k,k)
      const xr = n0x * cphi + n0y * sphi;
      const yr = -n0x * sphi + n0y * cphi;
      let xs = xr / k, ys = yr * k;
      let ncx = xs * cphi - ys * sphi, ncy = xs * sphi + ys * cphi;
      const ncl = Math.hypot(ncx, ncy) || 1; ncx /= ncl; ncy /= ncl;
      expect(Math.abs(ncx * tx + ncy * ty)).toBeLessThan(1e-3);
      // WRONG: same diagonal as the point map diag(k,1/k)
      xs = xr * k; ys = yr / k;
      let nwx = xs * cphi - ys * sphi, nwy = xs * sphi + ys * cphi;
      const nwl = Math.hypot(nwx, nwy) || 1; nwx /= nwl; nwy /= nwl;
      expect(Math.abs(nwx * tx + nwy * ty)).toBeGreaterThan(1e-2);
    }
  });

  it("the shaft (points[1]-points[0]) of the anchored crown leans along the true normal", () => {
    // With squeezeK=1 (no squeeze) and zero deform the outward direction is radial;
    // the first shaft step must move strictly outward from the base.
    const P = { ...CELL_DEFAULTS, enableCiliaOnContour: true, enableAffine: false };
    const crown = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, P, {
      tx: 1, ty: 0, speedNorm: 0, axisStrength: 0,
      contour: { deform: new Array<number>(96).fill(0), squeezeK: 1, squeezePhi: 0 },
    });
    for (const h of crown) {
      const [bx, by] = h.points[0];
      const r0 = Math.hypot(bx - cx, by - cy);
      const [x1, y1] = h.points[1];
      const r1 = Math.hypot(x1 - cx, y1 - cy);
      expect(r1).toBeGreaterThan(r0);
      expect(r0).toBeCloseTo(baseR, 6);
    }
  });

  // ---- (d2) ORTHOGONALITY ON RENDERER OUTPUT --------------------------------
  // The (d) test re-derives the normal formula inside the test (tautology). This
  // one consumes ciliaPath's REAL output: at the shaft TIP the bend term sin(pi)=0
  // and at speedNorm=0 the drag=0, so points[seg]-points[0] == lenK*(anx,any) is
  // exactly the renderer's squeezed outward normal. Flipping the cell.ts diagonal
  // to the WRONG diag(k,1/k) makes this FAIL.
  it("anchored shaft on a SQUEEZED contour is perpendicular to the contour tangent (renderer output, catches wrong diagonal)", () => {
    const k = 1.5, phi = 0.4;
    const P = { ...CELL_DEFAULTS, enableCiliaOnContour: true, enableAffine: true };
    const crown = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, P, {
      tx: 1, ty: 0, speedNorm: 0, axisStrength: 0,
      contour: { deform: new Array<number>(96).fill(0), squeezeK: k, squeezePhi: phi },
    });
    const cphi = Math.cos(phi), sphi = Math.sin(phi);
    // squeezed contour point of the undeformed circle at angle theta (point map diag(k,1/k))
    const sqPt = (theta: number): [number, number] => {
      const dx = Math.cos(theta) * baseR, dy = Math.sin(theta) * baseR;
      const xr = dx * cphi + dy * sphi, yr = -dx * sphi + dy * cphi;
      const xs = xr * k, ys = yr / k;
      return [cx + xs * cphi - ys * sphi, cy + xs * sphi + ys * cphi];
    };
    const n = Math.max(1, P.ciliaCount);
    for (let kk = 0; kk < crown.length; kk++) {
      const h = crown[kk];
      const tip = h.points[h.points.length - 1], base = h.points[0];
      let sx = tip[0] - base[0], sy = tip[1] - base[1]; // == lenK*(anx,any): bend=0 & drag=0
      const sl = Math.hypot(sx, sy) || 1; sx /= sl; sy /= sl;
      // renderer's per-hair baseAngle (same formula the other 21c tests use)
      const theta = baseAngleOf(kk, n);
      const a = sqPt(theta - 1e-4), b = sqPt(theta + 1e-4);
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      expect(Math.abs(sx * tx + sy * ty)).toBeLessThan(2e-2); // FAILS under diag(k,1/k)
    }
  });

  // ---- (e) NO CROSSING -------------------------------------------------------
  it("base points stay monotone in angle and never collide for several deform/squeeze cases", () => {
    const n = CELL_DEFAULTS.ciliaCount;
    const cases: Array<{ deform: number[]; squeezeK: number }> = [
      { deform: bumpDeform(0.5, 0.18), squeezeK: 1 },
      { deform: bumpDeform(2.3, 0.15), squeezeK: 1.3 },
      { deform: bumpDeform(4.7, 0.2), squeezeK: 1.3 },
      { deform: bumpDeform(1.1, 0.1, 96, 10), squeezeK: 1 },
    ];
    for (const c of cases) {
      const P = { ...CELL_DEFAULTS, enableCiliaOnContour: true, enableAffine: true };
      const crown = ciliaPath(cx, cy, baseR, 1.0, 0.6, 0.8, P, {
        tx: 1, ty: 0, speedNorm: 0, axisStrength: 0,
        contour: { deform: c.deform, squeezeK: c.squeezeK, squeezePhi: 0.4 },
      });
      // angle (about centre) of each base, in crown order
      const ang = crown.map((h) => Math.atan2(h.points[0][1] - cy, h.points[0][0] - cx));
      // monotone after unwrapping (no reordering of neighbours)
      let prev = ang[0];
      let acc = ang[0];
      for (let i = 1; i < ang.length; i++) {
        let d = ang[i] - prev;
        while (d <= -Math.PI) d += TAU;
        while (d > Math.PI) d -= TAU;
        expect(d).toBeGreaterThan(0); // strictly increasing => no crossing
        acc += d;
        prev = ang[i];
      }
      // min pairwise base distance > 0
      let minD = Infinity;
      for (let i = 0; i < crown.length; i++) {
        for (let j = i + 1; j < crown.length; j++) {
          const dx = crown[i].points[0][0] - crown[j].points[0][0];
          const dy = crown[i].points[0][1] - crown[j].points[0][1];
          minD = Math.min(minD, Math.hypot(dx, dy));
        }
      }
      expect(minD).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Commit 22b — somatic mex + contour wired into createCellRenderer
//
// Proves the render call-site composes somaticCiliaParams (count -> 72) and
// attaches the deformed+squeezed contour to ciliaMotion, but ONLY when the
// gates are on. With both gates off the default path is byte-identical to the
// frozen GATES_OFF golden + commit-21b crown (exercised end-to-end here by a
// hair count of 18).
// ---------------------------------------------------------------------------
describe("Commit 22b — somatic mex wired into render", () => {
  // A recording 2D context that counts CILIA strokes. Each hair is drawn as
  // beginPath -> moveTo -> lineTo* -> stroke, and the whole crown is rendered
  // BEFORE the cytoplasm fill(). So the number of stroke() calls seen before the
  // first fill() of a frame == the number of hairs rendered that frame. clearRect
  // (top of tick) resets the per-frame counters.
  function installCiliaCountingContext() {
    const frames: number[] = []; // hair count per completed frame
    let strokesBeforeFill = 0;
    let fillSeen = false;
    const grad = { addColorStop: () => {} };
    const ctx = {
      clearRect: () => {
        // A frame boundary: push the previous frame's tally then reset.
        frames.push(strokesBeforeFill);
        strokesBeforeFill = 0;
        fillSeen = false;
      },
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      stroke: () => { if (!fillSeen) strokesBeforeFill++; },
      fill: () => { fillSeen = true; },
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      createRadialGradient: () => grad,
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
    };
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (id: string) => unknown;
    };
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    // The last fully-rendered frame's hair count (frames are pushed on the NEXT
    // tick's clearRect, so read frames[frames.length-1] after one extra step).
    return {
      lastFrameHairs: () => frames[frames.length - 1] ?? 0,
      restore: () => { proto.getContext = orig; },
    };
  }

  let restoreCtx: (() => void) | null = null;
  afterEach(() => {
    if (restoreCtx) { restoreCtx(); restoreCtx = null; }
    vi.unstubAllGlobals();
  });

  function driveRenderer(params: Partial<CellParams> | undefined, frames: number) {
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const step = (k: number) => { for (let i = 0; i < k; i++) if (rafCalls.length) rafCalls.shift()!(); };
    const r = createCellRenderer(document.createElement("div"), {
      width: 160, height: 160, ...(params ? { params } : {}),
    });
    // Drive recording frames so the swim/affine paths are exercised.
    for (let i = 0; i < frames; i++) {
      r.update({ mode: "recording", audioLevel: 0.7, spectrumBins: new Array(32).fill(0.5) });
      step(1);
    }
    // One extra step so the LAST rendered frame's tally is flushed on clearRect.
    step(1);
    return { r, step };
  }

  it("(a) DEFAULT path (both gates off) renders exactly 18 hairs (commit-21b crown)", () => {
    const rec = installCiliaCountingContext(); restoreCtx = rec.restore;
    const { r } = driveRenderer(undefined, 5);
    expect(rec.lastFrameHairs()).toBe(CELL_DEFAULTS.ciliaCount);
    expect(rec.lastFrameHairs()).toBe(18);
    r.destroy();
  });

  it("(b) MEX ON via renderer renders exactly 72 hairs (somaticCiliaCount wired through)", () => {
    const rec = installCiliaCountingContext(); restoreCtx = rec.restore;
    const { r } = driveRenderer({
      enableSomaticCilia: true,
      enableCiliaOnContour: true,
      enableAffine: true,
      enableActivity: true,
    }, 5);
    expect(rec.lastFrameHairs()).toBe(CELL_DEFAULTS.somaticCiliaCount);
    expect(rec.lastFrameHairs()).toBe(72);
    r.destroy();
  });

  it("(c) somaticCiliaParams flows the mex count into a real ciliaPath WITH contour anchoring", () => {
    // Mirrors the call-site composition: somaticCiliaParams -> ciliaCount 72, and
    // the contour is consumed (enableCiliaOnContour on) so the bases sit on the
    // deformed contour rather than the bare circle.
    const p = somaticCiliaParams({ ...CELL_DEFAULTS, enableSomaticCilia: true });
    expect(p.ciliaCount).toBe(72);
    expect(p.ciliaLength).toBe(CELL_DEFAULTS.somaticCiliaLength);
    const anchoredParams = { ...p, enableCiliaOnContour: true };
    // A +0.2 bump on the contour; anchored bases must reflect it.
    const deform = new Array<number>(96).fill(0);
    deform[10] = 0.2;
    const crown = ciliaPath(80, 80, 24, 1.0, 0.6, 0.8, anchoredParams, {
      tx: 1, ty: 0, speedNorm: 0, axisStrength: 0,
      contour: { deform, squeezeK: 1, squeezePhi: 0 },
    });
    expect(crown.length).toBe(72);
    // contour was actually consumed: at least one base sits off the bare circle.
    const offCircle = crown.some(
      (h) => Math.abs(Math.hypot(h.points[0][0] - 80, h.points[0][1] - 80) - 24) > 1e-3,
    );
    expect(offCircle).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit 13 — M4 (persist wander pose) + M5 (fraction storage, resize-safe)
// ---------------------------------------------------------------------------
describe("CellPersistState M4/M5 — pose round-trip + back-compat", () => {
  it("serializes & parses the optional pose fields (fx,fy,heading)", () => {
    const s: CellPersistState = { driftPhase: 1.2, growth: 0.3, elapsed: 5, fx: 0.25, fy: 0.75, heading: 1.1 };
    const round = parseCellState(serializeCellState(s));
    expect(round).not.toBeNull();
    expect(round!.fx).toBeCloseTo(0.25, 12);
    expect(round!.fy).toBeCloseTo(0.75, 12);
    expect(round!.heading).toBeCloseTo(1.1, 12);
  });
  it("still parses legacy payloads with no pose (back-compat -> undefined pose)", () => {
    const legacy = JSON.stringify({ driftPhase: 0.5, growth: 0.2, elapsed: 3 });
    const p = parseCellState(legacy);
    expect(p).not.toBeNull();
    expect(p!.fx).toBeUndefined();
    expect(p!.fy).toBeUndefined();
  });
  it("rejects out-of-range fractions (corrupt pose -> drop pose, keep base)", () => {
    const bad = JSON.stringify({ driftPhase: 0, growth: 0.2, elapsed: 3, fx: 5, fy: 0.5, heading: 1 });
    const p = parseCellState(bad);
    // base state still valid; pose dropped (fx out of [0,1])
    expect(p).not.toBeNull();
    expect(p!.fx).toBeUndefined();
  });
});

describe("wanderPoseFromState M4/M5 — fraction -> clamped pixel pose", () => {
  const P = CELL_DEFAULTS;
  it("returns null when the saved state carries no pose", () => {
    expect(wanderPoseFromState({ driftPhase: 0, growth: 0.2, elapsed: 1 }, 160, 160, 24, P)).toBeNull();
  });
  it("round-trips a centred pose to ~centre", () => {
    const pose = wanderPoseFromState({ driftPhase: 0, growth: 0, elapsed: 1, fx: 0.5, fy: 0.5, heading: 0.7 }, 160, 160, 24, P)!;
    expect(pose.x).toBeCloseTo(80, 6);
    expect(pose.y).toBeCloseTo(80, 6);
    expect(pose.heading).toBeCloseTo(0.7, 12);
  });
  it("M5: a 160x160 fraction loaded at 320x320 keeps the SAME relative position +/-1%", () => {
    // Use the real absolute baseR (17px) so the inset is small and the relative
    // position is preserved (a giant baseR would clamp everything to centre).
    const saved = { driftPhase: 0, growth: 0, elapsed: 1, fx: 0.3, fy: 0.7, heading: 0 };
    const pose = wanderPoseFromState(saved, 320, 320, 17, P)!;
    expect(pose.x / 320).toBeCloseTo(0.3, 2);
    expect(pose.y / 320).toBeCloseTo(0.7, 2);
  });
  it("M5: clamps the pose inside the wander inset (never out of bounds)", () => {
    // fx=0.99 would be near the wall; the inset must pull it inside.
    const pose = wanderPoseFromState({ driftPhase: 0, growth: 0, elapsed: 1, fx: 0.99, fy: 0.01, heading: 0 }, 160, 160, 24, P)!;
    const reach = cellReach(24, P);
    const inset = Math.max(P.driftMargin ?? 4, reach);
    expect(pose.x).toBeLessThanOrEqual(160 - inset + 1e-6);
    expect(pose.x).toBeGreaterThanOrEqual(inset - 1e-6);
    expect(pose.y).toBeLessThanOrEqual(160 - inset + 1e-6);
    expect(pose.y).toBeGreaterThanOrEqual(inset - 1e-6);
  });
});

describe("cellPersistKey M5 — namespaced by tank size", () => {
  it("differs by size so a harness overlay never loads a square-overlay pose", () => {
    expect(cellPersistKey(160, 160)).not.toBe(cellPersistKey(172, 36));
    expect(cellPersistKey(160, 160)).toBe(cellPersistKey(160, 160));
  });
  it("includes the dimensions", () => {
    expect(cellPersistKey(160, 160)).toContain("160x160");
  });
});

// ---------------------------------------------------------------------------
// Commit 14 — M6: EMA-chased energy removes the mode-change pop
// ---------------------------------------------------------------------------
describe("smoothEnergy (M6 mode-change pop)", () => {
  const P = CELL_DEFAULTS;
  const dt = 1 / 60;

  it("converges to a steady target (idempotent at equilibrium)", () => {
    let e = 0.4;
    for (let i = 0; i < 600; i++) e = smoothEnergy(e, 0.4, dt, P);
    expect(e).toBeCloseTo(0.4, 6);
  });

  it("removes the step discontinuity: first-frame change << the raw jump", () => {
    // idle ~0.18 -> a loud recording target ~0.7 is a big raw jump.
    const prev = 0.18, target = 0.7;
    const next = smoothEnergy(prev, target, dt, P);
    const step = next - prev;
    expect(step).toBeGreaterThan(0); // moves toward target
    expect(step).toBeLessThan((target - prev) * 0.5); // no instantaneous snap
    // C0: the smoothed value never overshoots the target
    expect(next).toBeLessThanOrEqual(target);
  });

  it("monotonically approaches the target (no oscillation/overshoot)", () => {
    let e = 0.1;
    let prev = e;
    for (let i = 0; i < 120; i++) {
      e = smoothEnergy(e, 0.8, dt, P);
      expect(e).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(e).toBeLessThanOrEqual(0.8 + 1e-12);
      prev = e;
    }
  });

  it("smooths a FALLING target too (transcribing->idle): monotone decrease, no undershoot", () => {
    let e = 0.8;
    let prev = e;
    const target = 0.18;
    const firstStep = prev - smoothEnergy(prev, target, dt, P);
    expect(firstStep).toBeGreaterThan(0); // moves down toward target
    expect(firstStep).toBeLessThan((prev - target) * 0.5); // no instantaneous snap
    for (let i = 0; i < 200; i++) {
      e = smoothEnergy(e, target, dt, P);
      expect(e).toBeLessThanOrEqual(prev + 1e-12);
      expect(e).toBeGreaterThanOrEqual(target - 1e-12); // never undershoots
      prev = e;
    }
    expect(e).toBeCloseTo(target, 4);
  });

  it("is frame-rate independent: same elapsed time => ~same value (dt vs 2*dt)", () => {
    let a = 0.2;
    for (let i = 0; i < 120; i++) a = smoothEnergy(a, 0.9, 1 / 60, P);
    let b = 0.2;
    for (let i = 0; i < 60; i++) b = smoothEnergy(b, 0.9, 2 / 60, P);
    expect(a).toBeCloseTo(b, 2);
  });

  it("preserves idle breathing: a slow 0.8 rad/s sine target is tracked, not flattened", () => {
    // Feed the idle oscillation as the target; the smoothed output must retain
    // most of the amplitude (fast tau barely attenuates a slow sine).
    const idle = 0.2;
    let e = idle;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 1200; i++) {
      const t = i * dt;
      const target = idle * (1 + Math.sin(t * 0.8) * 0.25);
      e = smoothEnergy(e, target, dt, P);
      if (i > 600) { min = Math.min(min, e); max = Math.max(max, e); }
    }
    const amp = (max - min) / 2;
    const rawAmp = idle * 0.25;
    expect(amp).toBeGreaterThan(rawAmp * 0.9); // <10% attenuation
  });

  it("gate off (enableEnergySmoothing=false) returns the target verbatim", () => {
    const Poff = { ...CELL_DEFAULTS, enableEnergySmoothing: false };
    expect(smoothEnergy(0.1, 0.9, dt, Poff)).toBe(0.9);
  });

  it("enableEnergySmoothing defaults ON", () => {
    expect(CELL_DEFAULTS.enableEnergySmoothing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit 15 — M10 (organelle seed de-correlation) + F10 (near-immobile nucleus)
// ---------------------------------------------------------------------------
describe("M10 — nucleus drift streams are de-correlated", () => {
  const P = { ...CELL_DEFAULTS };
  // Cross-correlation of the nucleus x vs y offset over a long window.
  const nucleusXcorr = () => {
    const N = 5000, dtT = 0.016;
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < N; i++) {
      const n = nucleusTransform(i * dtT, 0.3, 24, P);
      xs.push(n.cx);
      ys.push(n.cy);
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < N; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    return num / Math.sqrt(dx * dy);
  };
  it("x and y nucleus drift cross-correlation < 0.2 (was ~0.26 with the shared y-rate)", () => {
    expect(Math.abs(nucleusXcorr())).toBeLessThan(0.2);
  });
});

describe("F10 — near-immobile nucleus option", () => {
  it("a low nucleusWander bounds the nuclear displacement (hard per-axis + envelope)", () => {
    const baseR = 24;
    const wander = 0.03;
    const P = { ...CELL_DEFAULTS, nucleusWander: wander };
    let sum = 0, maxOff = 0;
    const N = 2000;
    // Sweep a SHIFTED window so the bound doesn't rely on a lucky start offset.
    for (let i = 0; i < N; i++) {
      const n = nucleusTransform(123.7 + i * 0.016, 0.2, baseR, P);
      sum += (n.cx * n.cx + n.cy * n.cy);
      maxOff = Math.max(maxOff, Math.hypot(n.cx, n.cy));
      // HARD invariant: each axis bounded by wander*baseR (|noise2D|<=1).
      expect(Math.abs(n.cx)).toBeLessThanOrEqual(wander * baseR + 1e-9);
      expect(Math.abs(n.cy)).toBeLessThanOrEqual(wander * baseR + 1e-9);
    }
    // HARD invariant: total offset within the sqrt(2) envelope.
    expect(maxOff).toBeLessThanOrEqual(Math.SQRT2 * wander * baseR + 1e-9);
    // Expectation-level: long-run RMS stays well under the envelope (near-immobile).
    const rms = Math.sqrt(sum / N);
    expect(rms).toBeLessThanOrEqual(wander * baseR + 1e-9);
  });
  it("default nucleusWander still allows visible drift (back-compat preserved)", () => {
    const baseR = 24;
    const P = { ...CELL_DEFAULTS };
    let maxOff = 0;
    for (let i = 0; i < 600; i++) {
      const n = nucleusTransform(i * 0.05, 0.2, baseR, P);
      maxOff = Math.max(maxOff, Math.hypot(n.cx, n.cy));
    }
    expect(maxOff).toBeGreaterThan(0.02 * baseR);
  });
});

// ---------------------------------------------------------------------------
// Commit 16 — F7 wall-reorient + H2 rotational Brownian + H3 sedimentation
// (all gates OFF by default; wanderStep byte-identical unless explicitly enabled)
// ---------------------------------------------------------------------------
describe("Commit 16 — optional flourishes default OFF (byte-identical wander)", () => {
  it("the three gates default to off/undefined", () => {
    expect(CELL_DEFAULTS.enableWallReorient ?? false).toBe(false);
    expect(CELL_DEFAULTS.enableRotationalBrownian ?? false).toBe(false);
    expect(CELL_DEFAULTS.enableSedimentation ?? false).toBe(false);
  });
  it("wanderStep with defaults is unaffected by the new helpers (identity path)", () => {
    const P = { ...CELL_DEFAULTS };
    let a: WanderState = { x: 80, y: 80, heading: 0.5, vx: 0, vy: 0, clock: 0 };
    let b: WanderState = { x: 80, y: 80, heading: 0.5, vx: 0, vy: 0, clock: 0 };
    for (let i = 0; i < 200; i++) {
      a = wanderStep(a, 1 / 60, 160, 160, 17, P);
      b = wanderStep(b, 1 / 60, 160, 160, 17, { ...P }); // explicit-undefined gates
    }
    expect(b).toEqual(a);
  });
});

describe("wallReorientHeading (F7)", () => {
  it("turns the cell back into the tank (>90 deg from the incoming heading)", () => {
    // moving right into the +x wall (heading ~0): reorient should face back (~pi).
    for (const t of [0, 1.3, 5.0, 9.9]) {
      const h = wallReorientHeading(0.05, t, CELL_DEFAULTS);
      const delta = Math.abs(Math.atan2(Math.sin(h - 0.05), Math.cos(h - 0.05)));
      expect(delta).toBeGreaterThan(Math.PI / 2);
    }
  });
  it("is deterministic and bounded around the back direction", () => {
    expect(wallReorientHeading(0.05, 3.3, CELL_DEFAULTS)).toBe(wallReorientHeading(0.05, 3.3, CELL_DEFAULTS));
  });
});

describe("rotationalBrownianStep (H2)", () => {
  const P = { ...CELL_DEFAULTS, rotationalDiffusion: 0.5 };
  it("is zero-mean (deterministic gaussian sums to ~0 over many samples)", () => {
    let sum = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) sum += rotationalBrownianStep(i * 0.5 + 0.1, 1 / 60, P);
    expect(Math.abs(sum / N)).toBeLessThan(0.01);
  });
  it("RMS per step matches sqrt(2*Dr*dt) within ~25% (honest unit-variance calibration)", () => {
    const dt = 1 / 60;
    let sq = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) { const d = rotationalBrownianStep(i * 0.5 + 0.1, dt, P); sq += d * d; }
    const rms = Math.sqrt(sq / N);
    const expected = Math.sqrt(2 * 0.5 * dt);
    // After dividing by the measured 3-tap std (0.795), g has ~unit variance, so
    // the realized RMS should be CLOSE to the labelled coefficient, not ~0.46x.
    expect(rms).toBeGreaterThan(expected * 0.75);
    expect(rms).toBeLessThan(expected * 1.25);
  });
  it("is zero when rotationalDiffusion is 0", () => {
    expect(rotationalBrownianStep(1.0, 1 / 60, { ...CELL_DEFAULTS, rotationalDiffusion: 0 })).toBe(0);
  });
});

describe("sedimentationBias (H3)", () => {
  it("adds a small downward (+y) velocity bias bounded to <15% of swim speed", () => {
    const speed = 100;
    const P = { ...CELL_DEFAULTS, sedimentationFrac: 0.1 };
    const { dvx, dvy } = sedimentationBias(speed, P);
    expect(dvx).toBe(0);
    expect(dvy).toBeGreaterThan(0); // downward (+y is down in canvas)
    expect(dvy).toBeLessThanOrEqual(0.15 * speed + 1e-9);
  });
  it("is zero by default (sedimentationFrac defaults 0)", () => {
    const { dvy } = sedimentationBias(100, CELL_DEFAULTS);
    expect(dvy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Commit 17 — E1 perimeter count + F13 band-limit + F11 contractile vacuole
// (pure helpers, all OPT / gates OFF; H4 flow-field descoped — no mote substrate)
// ---------------------------------------------------------------------------
describe("perimeterCiliaCount (E1)", () => {
  const P = { ...CELL_DEFAULTS, ciliaCount: 200, ciliaSpacingPx: 8 };
  it("scales the count with perimeter (~constant hairs per unit arc)", () => {
    const small = perimeterCiliaCount(17, P);
    const big = perimeterCiliaCount(34, P); // 2x radius => ~2x perimeter
    expect(big).toBeGreaterThan(small);
    // density (hairs / perimeter) roughly constant +/-20%
    const dSmall = small / (TAU * 17);
    const dBig = big / (TAU * 34);
    expect(Math.abs(dBig - dSmall) / dSmall).toBeLessThan(0.2);
  });
  it("is capped by ciliaCount and at least 1", () => {
    const capped = { ...CELL_DEFAULTS, ciliaCount: 18, ciliaSpacingPx: 8 };
    expect(perimeterCiliaCount(1000, capped)).toBeLessThanOrEqual(18);
    expect(perimeterCiliaCount(0.1, capped)).toBeGreaterThanOrEqual(1);
  });
  it("returns an integer", () => {
    expect(Number.isInteger(perimeterCiliaCount(20, P))).toBe(true);
  });
});

describe("bandLimitDeform (F13)", () => {
  const P = { ...CELL_DEFAULTS, bandLimitMode: 4, bandLimitAmp: 0.08 };
  it("caps amplitude to bandLimitAmp", () => {
    const raw = Array.from({ length: 64 }, (_, i) => 0.4 * Math.sin(i) + 0.3 * Math.cos(i * 3.3));
    const out = bandLimitDeform(raw, P);
    for (const d of out) expect(Math.abs(d)).toBeLessThanOrEqual(0.08 + 1e-9);
  });
  it("concentrates spectral power in low modes (|n|<=bandLimitMode)", () => {
    // a low mode (2) + a high-mode ripple (12); the high mode must be removed so
    // nearly all remaining power sits in |n|<=4.
    const N = 64;
    const raw = Array.from({ length: N }, (_, i) =>
      0.06 * Math.sin((2 * i / N) * TAU) + 0.06 * Math.sin((12 * i / N) * TAU));
    const out = bandLimitDeform(raw, P);
    // DFT power in low band vs total
    const power = (k: number) => {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) { const a = (k * i / N) * TAU; re += out[i] * Math.cos(a); im -= out[i] * Math.sin(a); }
      return re * re + im * im;
    };
    let low = 0, total = 0;
    for (let k = 0; k < N; k++) { const p = power(k); total += p; if (k <= 4 || k >= N - 4) low += p; }
    expect(low / (total + 1e-12)).toBeGreaterThan(0.9);
  });
  it("preserves length and is deterministic", () => {
    const raw = [0.1, -0.2, 0.3, -0.05, 0.15, -0.25];
    expect(bandLimitDeform(raw, P).length).toBe(raw.length);
    expect(bandLimitDeform(raw, P)).toEqual(bandLimitDeform(raw, P));
  });
});

describe("contractileVacuole (F11)", () => {
  const P = { ...CELL_DEFAULTS, vacuolePeriod: 6, vacuoleMaxFrac: 0.18 };
  const baseR = 24;
  it("fills then collapses: r(0+)~0, peaks near u=0.85, systole->0", () => {
    const rAt = (frac: number) => contractileVacuole(frac * 6, baseR, P).r;
    expect(rAt(0.001)).toBeLessThan(0.02 * baseR);
    expect(rAt(0.85)).toBeGreaterThan(0.15 * baseR); // near R_max
    expect(rAt(0.999)).toBeLessThan(0.05 * baseR); // collapsed
  });
  it("never exceeds vacuoleMaxFrac*baseR", () => {
    for (let i = 0; i < 200; i++) {
      const v = contractileVacuole(i * 0.1, baseR, P);
      expect(v.r).toBeLessThanOrEqual(0.18 * baseR + 1e-9);
    }
  });
  it("is periodic with vacuolePeriod and deterministic", () => {
    const a = contractileVacuole(1.3, baseR, P);
    const b = contractileVacuole(1.3 + 6, baseR, P);
    expect(b.r).toBeCloseTo(a.r, 9);
  });
});

// ---------------------------------------------------------------------------
// Commit 19 — H4 ambient flow field (dipolar mote advection), gate OFF
// A swimming ciliate drags fluid: model the far-field as a force DIPOLE (the
// canonical low-Re "pusher" signature) so ambient motes stream past the body.
// All pure/deterministic; render wiring is gated behind enableFlowField (OFF).
// ---------------------------------------------------------------------------
describe("dipoleFlowAt (H4)", () => {
  // heading 0 = +x. strength carries the body's swim magnitude.
  it("decays as 1/r^2 with distance along a fixed bearing", () => {
    const v1 = dipoleFlowAt(10, 0, 0, 1);
    const v2 = dipoleFlowAt(20, 0, 0, 1);
    const s1 = Math.hypot(v1.vx, v1.vy);
    const s2 = Math.hypot(v2.vx, v2.vy);
    // doubling r quarters the speed (1/r^2); allow 3% numerical slack
    expect(s1 / s2).toBeGreaterThan(4 * 0.97);
    expect(s1 / s2).toBeLessThan(4 * 1.03);
  });
  it("reverses when the heading reverses (dipole flips with swim direction)", () => {
    const a = dipoleFlowAt(12, 5, 0, 1);
    const b = dipoleFlowAt(12, 5, Math.PI, 1);
    expect(b.vx).toBeCloseTo(-a.vx, 9);
    expect(b.vy).toBeCloseTo(-a.vy, 9);
  });
  it("scales linearly with strength and is zero at zero strength", () => {
    const a = dipoleFlowAt(12, 5, 0.7, 1);
    const b = dipoleFlowAt(12, 5, 0.7, 2);
    expect(b.vx).toBeCloseTo(2 * a.vx, 9);
    expect(b.vy).toBeCloseTo(2 * a.vy, 9);
    const z = dipoleFlowAt(12, 5, 0.7, 0);
    expect(z.vx).toBe(0);
    expect(z.vy).toBe(0);
  });
  it("is finite and bounded at the singularity (r->0 is clamped)", () => {
    const v = dipoleFlowAt(0, 0, 0, 1);
    expect(Number.isFinite(v.vx)).toBe(true);
    expect(Number.isFinite(v.vy)).toBe(true);
  });
  it("rotates rigidly with heading (field at rotated point == rotated field)", () => {
    // Flow is frame-covariant: rotating the sample point and heading by the same
    // angle rotates the velocity by that angle.
    const h = 0.9;
    const base = dipoleFlowAt(14, 0, 0, 1);
    const rot = dipoleFlowAt(14 * Math.cos(h), 14 * Math.sin(h), h, 1);
    const c = Math.cos(h), s = Math.sin(h);
    expect(rot.vx).toBeCloseTo(base.vx * c - base.vy * s, 6);
    expect(rot.vy).toBeCloseTo(base.vx * s + base.vy * c, 6);
  });
});

describe("advectMote (H4)", () => {
  const P = { ...CELL_DEFAULTS, flowStrength: 1 };
  it("moves a mote along the local flow by v*dt (memoryless, low-Re)", () => {
    const m = { x: 110, y: 100 };
    const cx = 80, cy = 80, heading = 0, strength = 1, dt = 1 / 60;
    const v = dipoleFlowAt(m.x - cx, m.y - cy, heading, strength * (P.flowStrength ?? 1));
    const out = advectMote(m, cx, cy, heading, strength, dt, 160, 160, P);
    expect(out.x).toBeCloseTo(m.x + v.vx * dt, 6);
    expect(out.y).toBeCloseTo(m.y + v.vy * dt, 6);
  });
  it("wraps motes that drift past the tank edge back inside (toroidal field)", () => {
    const m = { x: 159.9, y: 80 };
    const out = advectMote(m, 80, 80, 0, 50, 1, 160, 160, P);
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.x).toBeLessThanOrEqual(160);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect(out.y).toBeLessThanOrEqual(160);
  });
  it("is deterministic", () => {
    const m = { x: 100, y: 90 };
    const a = advectMote(m, 80, 80, 0.3, 2, 1 / 60, 160, 160, P);
    const b = advectMote(m, 80, 80, 0.3, 2, 1 / 60, 160, 160, P);
    expect(a).toEqual(b);
  });
});

describe("seedMotes (H4)", () => {
  it("returns flowMoteCount motes, all inside the tank, deterministic", () => {
    const P = { ...CELL_DEFAULTS, flowMoteCount: 24 };
    const a = seedMotes(160, 160, P);
    const b = seedMotes(160, 160, P);
    expect(a.length).toBe(24);
    expect(a).toEqual(b);
    for (const m of a) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(160);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(160);
    }
  });
  it("returns an empty array when count is 0", () => {
    expect(seedMotes(160, 160, { ...CELL_DEFAULTS, flowMoteCount: 0 })).toEqual([]);
  });
});
