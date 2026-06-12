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
  cellEnergy,
  cellRadius,
  pseudopodOffset,
  startleOffset,
  iridescentHue,
  lowpassRadii,
  catmullRom,
  buildCellContour,
  buildTargetDeformation,
  integrateDeformation,
  nucleusTransform,
  ciliaEndpoints,
  idleMorph,
  resolveBaseRadius,
  cellReach,
  cellDrift,
  serializeCellState,
  parseCellState,
  restoreSeed,
  CELL_DEFAULTS,
  createCellRenderer,
} from "../cell";
import type { CellParams, CellPersistState } from "../cell";

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
  it("envelope waxes and wanes (overall magnitude varies across a period)", () => {
    const mag = (arr: number[]) => arr.reduce((s, v) => s + Math.abs(v), 0);
    // sample several times across one envelope period; max should exceed min noticeably
    const mags: number[] = [];
    const period = P.idleMorphPeriod;
    for (let k = 0; k < 8; k++) mags.push(mag(idleMorph(64, (k / 8) * period, P)));
    expect(Math.max(...mags)).toBeGreaterThan(Math.min(...mags) * 1.3);
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
    // cilia outer = 16 + 16 * (0.4 + 0.55) * 1.3 = 16 + 16*1.235 = 35.76
    expect(r).toBeGreaterThanOrEqual(35.7);
    // membrane outer = 16 * 1.4 = 22.4 — cilia dominates
    expect(r).toBeCloseTo(35.76, 1);
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
    // membrane = 22.4, cilia = 35.76, +4 = 39.76
    expect(r).toBeGreaterThanOrEqual(39.7);
    expect(r).toBeCloseTo(39.76, 1);
  });

  it("defaults missing cilia/growth/startle to 0", () => {
    const p = { ...CELL_DEFAULTS };
    // remove cilia + startle fields so only the membrane headroom remains
    const pPartial = { ...CELL_DEFAULTS, ciliaLength: 0 as unknown as number };
    delete (pPartial as any).ciliaLength;
    delete (pPartial as any).ciliaGrowthBoost;
    delete (pPartial as any).startleMaxPx;
    const r = cellReach(10, pPartial as CellParams);
    // membrane = 10 * 1.4 = 14, cilia = 10 + 10*0*1.3 = 10, max=14, +0 startle
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
    // reach ≈ 39.76, inset = max(30, 39.76) = 39.76
    expect(reach).toBeCloseTo(39.76, 1);
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

  it("handles zero-sized window gracefully (no crash, returns finite)", () => {
    const d = cellDrift(0, 0, 0, 0, P);
    expect(Number.isFinite(d.cx)).toBe(true);
    expect(Number.isFinite(d.cy)).toBe(true);
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
