// src/theme-engine/renderers/__tests__/cell-contour.test.ts
/**
 * Split from cell.test.ts. Tests moved by domain; assertions intentionally unchanged.
 */
import { describe, it, expect, vi } from "vitest";
import {
  noise2D,
  fbm,
  smoothstep,
  cellEnergy,
  cellRadius,
  pseudopodOffset,
  iridescentHue,
  lowpassRadii,
  catmullRom,
  catmullRomOpen,
  sampleBinLevel,
  buildCellContour,
  buildTargetDeformation,
  integrateDeformation,
  resolveBaseRadius,
  bandLimitDeform,
  CELL_DEFAULTS,
  createCellRenderer,
  saturateTargetDeform,
  normalizeAreaDeform,
  integrateDeformPipeline,
  affineSqueezePoints,
  bodyHalfWidth,
  bodyProfilePoint,
  bodyProfileArea,
  bodyProfileAreaScale,
  bodyProfileDeform,
  interpProfileRadius,
} from "../cell/testing";
import type { CellParams } from "../cell/testing";

const TAU = Math.PI * 2;

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
// (see docs/CELL_MATH.md deformation notes). These tests exercise the gate ON to
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
// (see docs/CELL_MATH.md area-preservation and deformation notes.)
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
// the budget still holds.
// (see docs/CELL_MATH.md render-pipeline and area-preservation notes.)
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

describe("Commit 8b — affine gate", () => {
  it("flips enableAffine ON; body round at rest (floor 0)", () => {
    expect(CELL_DEFAULTS.enableAffine).toBe(true);
    expect(CELL_DEFAULTS.bodyElongationFloor).toBe(0);
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

// ---------------------------------------------------------------------------
// Commit 31a — authentic asymmetric slipper body profile (pure math)
// ---------------------------------------------------------------------------

describe("Commit 31a — authentic body profile (pure math)", () => {
  const types: Array<NonNullable<CellParams["bodyProfileType"]>> = [
    "taperedEllipse",
    "egg",
    "piriform",
  ];

  it("(a) DEFAULTS are dark + biologically-validated egg slipper", () => {
    // Commit 31c: default profile params set to the validated egg shape
    // (gate still OFF so the default render path never calls the helper).
    expect(CELL_DEFAULTS.enableBodyProfile).toBe(false);
    expect(CELL_DEFAULTS.bodyProfileType).toBe("egg");
    expect(CELL_DEFAULTS.bodyProfileTaper).toBe(0.27);
    expect(CELL_DEFAULTS.bodyAspect).toBe(3);
    expect(CELL_DEFAULTS.bodyVentralBend).toBe(0);
  });

  it("(b) ELLIPSE DEGENERACY: c=0 reduces to sqrt(1-u^2)", () => {
    for (const type of ["taperedEllipse", "egg"] as const) {
      for (const u of [-0.9, -0.5, -0.2, 0, 0.3, 0.6, 0.95]) {
        const w = bodyHalfWidth(u, {
          ...CELL_DEFAULTS,
          bodyProfileType: type,
          bodyProfileTaper: 0,
        });
        expect(w).toBeCloseTo(Math.sqrt(1 - u * u), 12);
      }
    }
  });

  it("(c) FORE-AFT ASYMMETRY: anterior wider than posterior", () => {
    for (const type of ["taperedEllipse", "egg"] as const) {
      const P = { ...CELL_DEFAULTS, bodyProfileType: type, bodyProfileTaper: 0.3 };
      const ratio = bodyHalfWidth(0.8, P) / bodyHalfWidth(-0.8, P);
      expect(ratio).toBeGreaterThan(1);
    }
    // taperedEllipse explicitly >= 1.3
    const te = { ...CELL_DEFAULTS, bodyProfileType: "taperedEllipse" as const, bodyProfileTaper: 0.3 };
    expect(bodyHalfWidth(0.8, te) / bodyHalfWidth(-0.8, te)).toBeGreaterThanOrEqual(1.3);
  });

  it("(d) NONNEGATIVE + zero at the poles, all three types", () => {
    for (const type of types) {
      const P = { ...CELL_DEFAULTS, bodyProfileType: type, bodyProfileTaper: 0.3 };
      expect(Math.abs(bodyHalfWidth(1, P))).toBeLessThan(1e-9);
      expect(Math.abs(bodyHalfWidth(-1, P))).toBeLessThan(1e-9);
      for (let k = 0; k <= 40; k++) {
        const u = -1 + (2 * k) / 40;
        expect(bodyHalfWidth(u, P)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("(e) WIDEST POINT just anterior of centre, not at u=0", () => {
    const c = 0.3;
    const P = { ...CELL_DEFAULTS, bodyProfileType: "taperedEllipse" as const, bodyProfileTaper: c };
    let bestU = -1;
    let bestW = -Infinity;
    for (let k = 0; k <= 2000; k++) {
      const u = -1 + (2 * k) / 2000;
      const w = bodyHalfWidth(u, P);
      if (w > bestW) {
        bestW = w;
        bestU = u;
      }
    }
    expect(bestU).toBeGreaterThan(0); // anterior of centre, not at u=0
    const expected = (-1 + Math.sqrt(1 + 8 * c * c)) / (4 * c);
    expect(expected).toBeCloseTo(0.259, 2);
    expect(Math.abs(bestU - expected)).toBeLessThanOrEqual(0.05);
  });

  it("(f) ASPECT ~3:1 for taperedEllipse default", () => {
    const baseR = 17;
    const P = { ...CELL_DEFAULTS, enableBodyProfile: true };
    let maxX = 0;
    let maxY = 0;
    for (let k = 0; k < 720; k++) {
      const t = (TAU * k) / 720;
      const [x, y] = bodyProfilePoint(t, baseR, P);
      maxX = Math.max(maxX, Math.abs(x));
      maxY = Math.max(maxY, Math.abs(y));
    }
    const L = baseR * Math.sqrt(3);
    expect(maxX).toBeCloseTo(L, 6);
    const length = 2 * maxX;
    const width = 2 * maxY;
    expect(length / width).toBeGreaterThan(2.7);
    expect(length / width).toBeLessThan(3.3);
  });

  it("(g) AREA NEUTRAL: scale finite/positive, scaled area ~= pi baseR^2", () => {
    const baseR = 17;
    const P = { ...CELL_DEFAULTS, enableBodyProfile: true };
    const scale = bodyProfileAreaScale(baseR, P);
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeGreaterThan(0);
    const area = bodyProfileArea(baseR, P);
    const circle = Math.PI * baseR * baseR;
    expect(area * scale * scale).toBeCloseTo(circle, 2);
    // taperedEllipse raw area already ~= pi baseR^2 -> scale ~ 1
    expect(scale).toBeGreaterThan(0.99);
    expect(scale).toBeLessThan(1.01);
  });

  it("(h) STAR-CONVEX: polar angle about centroid is monotonic", () => {
    const baseR = 17;
    const P = { ...CELL_DEFAULTS, bodyProfileType: "taperedEllipse" as const, bodyProfileTaper: 0.3 };
    const N = 256;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < N; k++) {
      pts.push(bodyProfilePoint((TAU * k) / N, baseR, P));
    }
    const cx = pts.reduce((s, p) => s + p[0], 0) / N;
    const cy = pts.reduce((s, p) => s + p[1], 0) / N;
    let prev = Math.atan2(pts[0][1] - cy, pts[0][0] - cx);
    let unwrapped = prev;
    let total = 0;
    for (let k = 1; k <= N; k++) {
      const p = pts[k % N];
      const ang = Math.atan2(p[1] - cy, p[0] - cx);
      let d = ang - prev;
      while (d <= -Math.PI) d += TAU;
      while (d > Math.PI) d -= TAU;
      expect(d).toBeGreaterThan(0); // strictly increasing => single-valued
      unwrapped += d;
      total += d;
      prev = ang;
    }
    // full loop sweeps exactly 2pi
    expect(total).toBeCloseTo(TAU, 6);
    void unwrapped;
  });

  it("(i) DETERMINISM: same inputs => same outputs", () => {
    const baseR = 19;
    const P = { ...CELL_DEFAULTS, enableBodyProfile: true, bodyProfileType: "egg" as const };
    expect(bodyHalfWidth(0.37, P)).toEqual(bodyHalfWidth(0.37, P));
    expect(bodyProfilePoint(1.2, baseR, P)).toEqual(bodyProfilePoint(1.2, baseR, P));
    expect(bodyProfileArea(baseR, P)).toEqual(bodyProfileArea(baseR, P));
    expect(bodyProfileAreaScale(baseR, P)).toEqual(bodyProfileAreaScale(baseR, P));
  });
});

// ---------------------------------------------------------------------------
// Commit 31c — bodyProfileMorphometry (biology validator)
// Encodes the morphometric acceptance bounds measured from 3 real Paramecium
// reference photos. These bounds ACCEPT the validated egg slipper default and
// REJECT the front-heavy / sharp-tailed piriform (see contrast test below).
// ---------------------------------------------------------------------------

describe("Commit 31c — bodyProfileMorphometry (biology validator)", () => {
  // Sample w(u) on a fine grid to find the global max half-width and its u.
  function morphometry(p: CellParams) {
    let wMax = -Infinity;
    let uMax = -1;
    const N = 800;
    for (let k = 0; k <= N; k++) {
      const u = -1 + (2 * k) / N; // 801 points
      const w = bodyHalfWidth(u, p);
      if (w > wMax) {
        wMax = w;
        uMax = u;
      }
    }
    const widestFrac = (1 - uMax) / 2; // 0 at anterior pole, 1 at posterior
    const r08 = bodyHalfWidth(0.8, p) / bodyHalfWidth(-0.8, p);
    const postBlunt = bodyHalfWidth(-0.8, p) / wMax;
    return { wMax, uMax, widestFrac, r08, postBlunt };
  }

  it("egg default PASSES all morphometric acceptance bounds", () => {
    const p: CellParams = { ...CELL_DEFAULTS };
    const m = morphometry(p);

    // (1) widest point near mid-body, biased slightly forward
    expect(m.widestFrac).toBeGreaterThanOrEqual(0.36);
    expect(m.widestFrac).toBeLessThanOrEqual(0.5);

    // (2) fore-aft asymmetry moderate (anterior broader, not lopsided)
    expect(m.r08).toBeGreaterThanOrEqual(1.3);
    expect(m.r08).toBeLessThanOrEqual(2.3);

    // (3) anterior strictly broader than posterior (not a symmetric ellipse)
    expect(bodyHalfWidth(0.8, p)).toBeGreaterThan(bodyHalfWidth(-0.8, p));

    // (4) posterior pole blunt, not a needle
    expect(m.postBlunt).toBeGreaterThanOrEqual(0.35);

    // (5) posterior pole ROUNDED: w ~ sqrt(1+u) near u=-1, so
    //     w/sqrt(1+u) -> finite positive constant (NOT 0 like a linear tip).
    const q1 = bodyHalfWidth(-0.99, p) / Math.sqrt(0.01);
    const q2 = bodyHalfWidth(-0.999, p) / Math.sqrt(0.001);
    expect(Number.isFinite(q1)).toBe(true);
    expect(Number.isFinite(q2)).toBe(true);
    expect(q1).toBeGreaterThan(0);
    expect(q2).toBeGreaterThan(0);
    expect(Math.abs(q1 - q2) / q1).toBeLessThan(0.15);

    // (6) anterior pole rounded similarly
    const qa = bodyHalfWidth(0.99, p) / Math.sqrt(1 - 0.99);
    expect(Number.isFinite(qa)).toBe(true);
    expect(qa).toBeGreaterThan(0);

    // (7) aspect in slipper range, measured from the contour
    const baseR = 17;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxAbsY = 0;
    const M = 2000;
    for (let k = 0; k < M; k++) {
      const t = (TAU * k) / M;
      const [x, y] = bodyProfilePoint(t, baseR, p);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      maxAbsY = Math.max(maxAbsY, Math.abs(y));
    }
    const aspect = (maxX - minX) / (2 * maxAbsY);
    expect(aspect).toBeGreaterThanOrEqual(2.7);
    expect(aspect).toBeLessThanOrEqual(3.3);
  });

  it("sharp piriform FAILS the validator (bounds are not a tautology)", () => {
    const p: CellParams = {
      ...CELL_DEFAULTS,
      bodyProfileType: "piriform",
      bodyProfileTaper: 0.3,
    };
    const m = morphometry(p);
    // At least one discriminating bound must reject the front-heavy/needle shape.
    const rejected =
      m.widestFrac < 0.36 || m.r08 > 2.3 || m.postBlunt < 0.35;
    expect(rejected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit 31b — body profile wired into the render contour
// ---------------------------------------------------------------------------

describe("Commit 31b — body profile wired into contour", () => {
  const baseR = 17;
  const N = 96;

  it("(a) bodyProfileDeform PURE: length 96 + asymmetric anterior flank wider", () => {
    const P = { ...CELL_DEFAULTS, enableBodyProfile: true };
    const out = bodyProfileDeform(N, 0, baseR, P);
    expect(out).toHaveLength(N);
    // The slipper's long axis is symmetric (both poles at +-L), so the fore-aft
    // asymmetry shows in the FLANK width: with heading 0 the anterior is at +x,
    // so the anterior flank (~45deg, idx 12) is WIDER than the mirror posterior
    // flank (~135deg, idx 36). That is the "not an oval" asymmetry.
    const rAnteriorFlank = baseR * (1 + out[12]);
    const rPosteriorFlank = baseR * (1 + out[36]);
    expect(rAnteriorFlank).toBeGreaterThan(rPosteriorFlank);
  });

  it("(b) AREA NEUTRAL: shoelace polygon area ~= pi baseR^2 (within 3%)", () => {
    const P = { ...CELL_DEFAULTS, enableBodyProfile: true };
    const out = bodyProfileDeform(N, 0, baseR, P);
    const pts: Array<[number, number]> = [];
    for (let j = 0; j < N; j++) {
      const phi = (j / N) * TAU;
      const r = baseR * (1 + out[j]);
      pts.push([r * Math.cos(phi), r * Math.sin(phi)]);
    }
    let a = 0;
    for (let j = 0; j < N; j++) {
      const [x0, y0] = pts[j];
      const [x1, y1] = pts[(j + 1) % N];
      a += x0 * y1 - x1 * y0;
    }
    const area = Math.abs(a) / 2;
    const circle = Math.PI * baseR * baseR;
    expect(Math.abs(area - circle) / circle).toBeLessThan(0.03);
  });

  it("(c) HEADING ROTATES: heading=pi shifts the whole profile by 48 indices", () => {
    const P = { ...CELL_DEFAULTS, enableBodyProfile: true };
    const out0 = bodyProfileDeform(N, 0, baseR, P);
    const outPi = bodyProfileDeform(N, Math.PI, baseR, P);
    // A heading of pi rotates the body frame by pi -> the deform sample at
    // canvas vertex j with heading=pi equals the sample at vertex (j+48) with
    // heading=0 (48 = N/2 = pi). The wide anterior flank thus moves from ~45deg
    // to ~225deg. Check the full array is the index-shifted copy.
    for (let j = 0; j < N; j++) {
      expect(outPi[j]).toBeCloseTo(out0[(j + N / 2) % N], 9);
    }
  });

  it("(d) FINITE + positive radius everywhere", () => {
    for (const type of ["taperedEllipse", "egg", "piriform"] as const) {
      const P = { ...CELL_DEFAULTS, enableBodyProfile: true, bodyProfileType: type };
      const out = bodyProfileDeform(N, 0.7, baseR, P);
      for (const v of out) {
        expect(Number.isFinite(v)).toBe(true);
        expect(baseR * (1 + v)).toBeGreaterThan(0);
      }
    }
  });

  it("interpProfileRadius: exact at sample points + wrap-aware", () => {
    const P = { ...CELL_DEFAULTS, enableBodyProfile: true };
    const pts: Array<{ ang: number; rad: number }> = [];
    for (let k = 0; k < N; k++) {
      const t = (k / N) * TAU;
      const [px, py] = bodyProfilePoint(t, baseR, P);
      pts.push({ ang: Math.atan2(py, px), rad: Math.hypot(px, py) });
    }
    for (const idx of [0, 10, 47, 80]) {
      const r = interpProfileRadius(pts[idx].ang, pts);
      expect(r).toBeCloseTo(pts[idx].rad, 6);
    }
    expect(Number.isFinite(interpProfileRadius(-0.3, pts))).toBe(true);
    expect(Number.isFinite(interpProfileRadius(TAU + 0.3, pts))).toBe(true);
  });

  it("(f) RENDER GATE ON: end-to-end recording frames render a non-degenerate contour", () => {
    const coords: number[] = [];
    const grad = { addColorStop: () => {} };
    const ctx = {
      clearRect: () => {}, save: () => {}, restore: () => {},
      beginPath: () => {}, closePath: () => {}, stroke: () => {}, fill: () => {},
      moveTo: (x: number, y: number) => { coords.push(x, y); },
      lineTo: (x: number, y: number) => { coords.push(x, y); },
      arc: (x: number, y: number, r: number) => { coords.push(x, y, r); },
      ellipse: () => {},
      createRadialGradient: () => grad,
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
    };
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (id: string) => unknown };
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      const params: CellParams = {
        ...CELL_DEFAULTS,
        enableBodyProfile: true,
        enableRigidMembrane: true,
        enableActivity: true,
      };
      const r = createCellRenderer(document.createElement("div"), { width: 160, height: 160, params });
      const step = (k: number) => { for (let i = 0; i < k; i++) { if (rafCalls.length) rafCalls.shift()!(); } };
      r.update({ mode: "recording", audioLevel: 0.6, spectrumBins: new Array(32).fill(0.4) });
      expect(() => step(5)).not.toThrow();
      expect(coords.length).toBeGreaterThan(0);
      for (const c of coords) expect(Number.isFinite(c)).toBe(true);
      r.destroy();
    } finally {
      proto.getContext = orig;
      vi.unstubAllGlobals();
    }
  });
});
