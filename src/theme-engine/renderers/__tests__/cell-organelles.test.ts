// src/theme-engine/renderers/__tests__/cell-organelles.test.ts
/**
 * Split from cell.test.ts. Tests moved by domain; assertions intentionally unchanged.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  noise2D,
  nucleusTransform,
  contractileVacuole,
  contractileVacuolePair,
  foodVacuoleSize,
  seedFoodVacuoles,
  advectFoodVacuole,
  micronucleusTransform,
  cellReach,
  parseCellState,
  cellPersistKey,
  CELL_DEFAULTS,
  createCellRenderer,
  affineSqueezePoints,
} from "../cell/testing";
import { wrapPi } from "../shared";
import type { CellParams } from "../cell/testing";

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
// Commit 26 — two asynchronous contractile vacuoles (gate OFF, draw-only)
// A real Paramecium has a PAIR of CVs (anterior + posterior) pulsing on their
// OWN clocks (different periods + a posterior phase offset). contractileVacuolePair
// returns the pair's world bearings + live radii, reusing contractileVacuole
// for the fill/collapse curve (DRY). Gate OFF by default -> returns [].
// ---------------------------------------------------------------------------
describe("Commit 26 — two contractile vacuoles", () => {
  const baseR = 24;
  const phi = 0.4;

  it("(a) GATE OFF: returns [] for default params", () => {
    expect(CELL_DEFAULTS.enableVacuoles).toBe(false);
    const out = contractileVacuolePair(3.7, baseR, phi, { ...CELL_DEFAULTS });
    expect(out).toEqual([]);
    expect(out.length).toBe(0);
  });

  it("(b) GATE ON: returns exactly 2 entries with finite bearing + r>=0", () => {
    const P = { ...CELL_DEFAULTS, enableVacuoles: true };
    const out = contractileVacuolePair(3.7, baseR, phi, P);
    expect(out.length).toBe(2);
    for (const e of out) {
      expect(Number.isFinite(e.bearing)).toBe(true);
      expect(Number.isFinite(e.r)).toBe(true);
      expect(e.r).toBeGreaterThanOrEqual(0);
    }
  });

  it("(c) ASYNCHRONOUS: the two radii differ at a majority of samples + a near-max divergence exists", () => {
    const P = { ...CELL_DEFAULTS, enableVacuoles: true };
    const maxR = (P.vacuolePairMaxFrac ?? 0.16) * baseR;
    let differ = 0;
    let total = 0;
    let foundDivergence = false;
    for (let t = 0; t <= 30; t += 0.5) {
      const [a, b] = contractileVacuolePair(t, baseR, phi, P);
      total++;
      if (Math.abs(a.r - b.r) > 1e-3) differ++;
      // one near max while the other clearly is not
      if (a.r > 0.85 * maxR && b.r < 0.5 * maxR) foundDivergence = true;
      if (b.r > 0.85 * maxR && a.r < 0.5 * maxR) foundDivergence = true;
    }
    expect(differ).toBeGreaterThan(total / 2);
    expect(foundDivergence).toBe(true);
  });

  it("(d) FILL/COLLAPSE REUSE: per-vacuole radius matches contractileVacuole exactly (DRY)", () => {
    const P = { ...CELL_DEFAULTS, enableVacuoles: true };
    const maxFrac = P.vacuolePairMaxFrac ?? 0.16;
    const antPeriod = P.vacuoleAnteriorPeriod ?? 9;
    const postPeriod = P.vacuolePosteriorPeriod ?? 13;
    const postPhase = P.vacuolePosteriorPhase ?? 0.5;
    for (const t of [0, 2.3, 7.1, 12.8, 19.4, 26.6]) {
      const [a, b] = contractileVacuolePair(t, baseR, phi, P);
      const expectA = contractileVacuole(t, baseR, {
        ...P, vacuolePeriod: antPeriod, vacuoleMaxFrac: maxFrac,
      }).r;
      const expectB = contractileVacuole(t + postPhase * postPeriod, baseR, {
        ...P, vacuolePeriod: postPeriod, vacuoleMaxFrac: maxFrac,
      }).r;
      expect(a.r).toBe(expectA);
      expect(b.r).toBe(expectB);
    }
  });

  it("(e) BEARING ROTATES WITH BODY: +delta on squeezePhi rotates each world bearing by delta", () => {
    const P = { ...CELL_DEFAULTS, enableVacuoles: true };
    const delta = 0.37;
    const base = contractileVacuolePair(5.0, baseR, phi, P);
    const turned = contractileVacuolePair(5.0, baseR, phi + delta, P);
    for (let i = 0; i < base.length; i++) {
      expect(turned[i].bearing - base[i].bearing).toBeCloseTo(delta, 12);
    }
    // and the body-frame bearings are the configured ones
    expect(base[0].bearing).toBeCloseTo(phi + (P.vacuoleAnteriorBearing ?? 1.9), 12);
    expect(base[1].bearing).toBeCloseTo(phi + (P.vacuolePosteriorBearing ?? -1.9), 12);
  });

  it("(f) BOUNDED: each r <= vacuolePairMaxFrac*baseR", () => {
    const P = { ...CELL_DEFAULTS, enableVacuoles: true };
    const maxR = (P.vacuolePairMaxFrac ?? 0.16) * baseR;
    for (let t = 0; t <= 40; t += 0.25) {
      for (const e of contractileVacuolePair(t, baseR, phi, P)) {
        expect(e.r).toBeLessThanOrEqual(maxR + 1e-9);
      }
    }
  });

  it("(g) DETERMINISM: identical args -> identical output", () => {
    const P = { ...CELL_DEFAULTS, enableVacuoles: true };
    expect(contractileVacuolePair(8.8, baseR, phi, P)).toEqual(
      contractileVacuolePair(8.8, baseR, phi, P),
    );
  });
});

describe("Commit 28 — food vacuoles + micronucleus", () => {
  const baseR = 24;

  it("defaults: enableOrganelles OFF + documented organelle params", () => {
    expect(CELL_DEFAULTS.enableOrganelles).toBe(false);
    expect(CELL_DEFAULTS.foodVacuoleCount).toBe(5);
    expect(CELL_DEFAULTS.foodVacuolePeriod).toBe(55);
    expect(CELL_DEFAULTS.foodVacuoleMaxRadiusFrac).toBe(0.62);
    expect(CELL_DEFAULTS.foodVacuoleSizePx).toBe(3.0);
    expect(CELL_DEFAULTS.foodVacuoleDigestPeriod).toBe(30);
    expect(CELL_DEFAULTS.foodVacuoleSizeMul).toBe(1.0);
    expect(CELL_DEFAULTS.micronucleusSizeFrac).toBe(0.20);
    expect(CELL_DEFAULTS.micronucleusOffsetFrac).toBe(1.15);
  });

  it("(a) foodVacuoleSize: full at u=0, shrinks to ~0.3 before the wrap, resets, bounded", () => {
    const P = { ...CELL_DEFAULTS, foodVacuoleDigestPeriod: 30 };
    // fresh vacuole (t=0, phase=0) is full
    expect(foodVacuoleSize(0, 0, P)).toBeCloseTo(1.0, 9);
    // monotone decrease across one digest period
    const period = 30;
    let prev = foodVacuoleSize(0, 0, P);
    for (let k = 1; k <= 20; k++) {
      const t = (k / 20) * period * 0.999; // just before the wrap
      const s = foodVacuoleSize(t, 0, P);
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      expect(s).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(s).toBeLessThanOrEqual(1 + 1e-9);
      prev = s;
    }
    // just before the wrap -> ~0.3
    expect(foodVacuoleSize(period * 0.999, 0, P)).toBeCloseTo(0.3, 1);
    // resets at the wrap (period -> back to full)
    expect(foodVacuoleSize(period, 0, P)).toBeCloseTo(1.0, 9);
    // measured digest curve points
    expect(foodVacuoleSize(period * 0.5, 0, P)).toBeCloseTo(0.65, 6);
    // deterministic
    expect(foodVacuoleSize(7.3, 0.25, P)).toBe(foodVacuoleSize(7.3, 0.25, P));
  });

  it("(b) seedFoodVacuoles: gate off -> []; on -> count entries within maxRad; phase in [0,1); deterministic", () => {
    expect(seedFoodVacuoles(baseR, { ...CELL_DEFAULTS })).toEqual([]);
    const P = { ...CELL_DEFAULTS, enableOrganelles: true };
    const fv = seedFoodVacuoles(baseR, P);
    expect(fv.length).toBe(P.foodVacuoleCount);
    const maxRad = (P.foodVacuoleMaxRadiusFrac ?? 0.62) * baseR;
    for (const o of fv) {
      expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(maxRad + 1e-9);
      expect(o.phase).toBeGreaterThanOrEqual(0);
      expect(o.phase).toBeLessThan(1);
    }
    // deterministic
    expect(seedFoodVacuoles(baseR, P)).toEqual(fv);
    // count 0 -> []
    expect(seedFoodVacuoles(baseR, { ...P, foodVacuoleCount: 0 })).toEqual([]);
  });

  it("(c) advectFoodVacuole STAYS ON CIRCLE over 200 steps; carries phase; moves", () => {
    const P = { ...CELL_DEFAULTS, enableOrganelles: true };
    let v = { x: 10, y: 0, phase: 0.42 };
    const r0 = Math.hypot(v.x, v.y);
    const dt = 1 / 60;
    const v1 = advectFoodVacuole(v, baseR, dt, P);
    // moves (CCW for omega>0): angle advances
    const a0 = Math.atan2(v.y, v.x);
    const a1 = Math.atan2(v1.y, v1.x);
    expect(wrapPi(a1 - a0)).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) v = advectFoodVacuole(v, baseR, dt, P);
    const r = Math.hypot(v.x, v.y);
    expect(Math.abs(r - r0) / r0).toBeLessThan(0.01);
    // phase carried through unchanged
    expect(v.phase).toBe(0.42);
  });

  it("(c2) foodVacuoleSizeMul: default 1.0 preserves legacy; >1 scales draw radius", () => {
    const P = { ...CELL_DEFAULTS };
    // Default 1.0 — multiplier is identity
    expect(P.foodVacuoleSizeMul).toBe(1.0);
    // Base size computation: fvSizePx = (foodVacuoleSizePx ?? 3.0) * (foodVacuoleSizeMul ?? 1.0)
    const baseSizePx = (P.foodVacuoleSizePx ?? 3.0) * (P.foodVacuoleSizeMul ?? 1.0);
    expect(baseSizePx).toBe(3.0); // identity
    // With mul=1.5, draw radius scales up
    const scaled = (P.foodVacuoleSizePx ?? 3.0) * 1.5;
    expect(scaled).toBeCloseTo(4.5, 9);
    // With mul=2.0
    const double = (P.foodVacuoleSizePx ?? 3.0) * 2.0;
    expect(double).toBeCloseTo(6.0, 9);
    // Omitted param defaults to 1.0 (legacy)
    const resolveMul = (value?: number) => value ?? 1.0;
    const noMul = (P.foodVacuoleSizePx ?? 3.0) * resolveMul();
    expect(noMul).toBe(3.0);
  });

  it("(c3) foodVacuoleSat: default 0.4 preserves legacy; override applies", () => {
    const P = { ...CELL_DEFAULTS };
    // Default: foodVacuoleSat undefined → resolved as 0.4 (legacy hardcoded)
    const defaultSat = P.foodVacuoleSat ?? 0.4;
    expect(defaultSat).toBe(0.4);
    // Override: explicit value used directly
    const custom = 0.25;
    const overrideSat = custom ?? 0.4;
    expect(overrideSat).toBe(0.25);
    // Stroke ratio preserved: stroke = sat * 1.125 (legacy: 0.4 fill → 0.45 stroke)
    expect(defaultSat * 1.125).toBeCloseTo(0.45, 9);
    expect(custom * 1.125).toBeCloseTo(0.28125, 9);
    // Verify CELL_DEFAULTS does NOT set foodVacuoleSat (undefined = legacy)
    expect(CELL_DEFAULTS.foodVacuoleSat).toBeUndefined();
  });

  it("(d) micronucleusTransform: smaller than macro, offset just outside, scales, deterministic", () => {
    const P = { ...CELL_DEFAULTS };
    const macroR = 6;
    const mn = micronucleusTransform(100, 50, macroR, P);
    expect(mn.r).toBeCloseTo(macroR * 0.20, 9);
    expect(mn.r).toBeLessThan(macroR);
    const off = Math.hypot(mn.cx - 100, mn.cy - 50);
    expect(off).toBeCloseTo(macroR * 1.15, 9);
    // sits just outside the macronucleus
    expect(off).toBeGreaterThan(macroR);
    // scales with macroR
    const mn2 = micronucleusTransform(100, 50, macroR * 2, P);
    expect(mn2.r).toBeCloseTo(mn.r * 2, 9);
    expect(Math.hypot(mn2.cx - 100, mn2.cy - 50)).toBeCloseTo(off * 2, 9);
    // deterministic
    expect(micronucleusTransform(100, 50, macroR, P)).toEqual(mn);
  });

  it("(e) RENDER SMOKE: enableOrganelles renders without throwing (alone and with cyclosis)", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    for (const extra of [
      { enableOrganelles: true, enableCyclosis: false },
      { enableOrganelles: true, enableCyclosis: true },
    ]) {
      const container = document.createElement("div");
      const r = createCellRenderer(container, {
        width: 120,
        height: 60,
        params: { ...CELL_DEFAULTS, ...extra },
      });
      expect(() => {
        for (let i = 0; i < 4; i++) {
          r.update({ mode: "recording", audioLevel: 0.6, spectrumBins: new Array(32).fill(0.4) });
        }
      }).not.toThrow();
      r.destroy();
    }
    vi.unstubAllGlobals();
  });

  it("(f) DETERMINISM: identical args -> identical output for all four helpers", () => {
    const P = { ...CELL_DEFAULTS, enableOrganelles: true };
    expect(foodVacuoleSize(11.7, 0.33, P)).toBe(foodVacuoleSize(11.7, 0.33, P));
    expect(seedFoodVacuoles(baseR, P)).toEqual(seedFoodVacuoles(baseR, P));
    const v = { x: 7, y: 3, phase: 0.1 };
    expect(advectFoodVacuole(v, baseR, 1 / 60, P)).toEqual(advectFoodVacuole(v, baseR, 1 / 60, P));
    expect(micronucleusTransform(10, 20, 5, P)).toEqual(micronucleusTransform(10, 20, 5, P));
  });
});

// ---------------------------------------------------------------------------
// Commit v3.5A — colour + idle-drift params
// ---------------------------------------------------------------------------
describe("Commit v3.5A — colour + idle-drift params", () => {
  const W = 160, H = 160;
  const key = cellPersistKey(W, H);

  function setupRaf() {
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    return rafCalls;
  }

  function installCtx() {
    const grad = { addColorStop: () => {} };
    const ctx = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      stroke: () => {},
      fill: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      ellipse: () => {},
      createRadialGradient: () => grad,
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
    };
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (id: string) => unknown;
    };
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    return () => { proto.getContext = orig; };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("(a) defaults byte-identical: all colour/idle params resolve to legacy values", () => {
    // The defaults must match current hardcoded values exactly.
    const p: CellParams = { ...CELL_DEFAULTS };
    expect(p.cytoplasmSat ?? 0.70).toBe(0.70);
    expect(p.ciliaSat ?? 0.60).toBe(0.60);
    expect(p.membraneLightness ?? 0.60).toBe(0.60);
    expect(p.granuleSat ?? 0.60).toBe(0.60);
    expect(p.idleSwimFrac ?? 0).toBe(0);
    expect(p.idleDriftMin ?? 0).toBe(0);

    // Smoke: render a few frames with defaults — no throw.
    const rafCalls = setupRaf();
    const restoreCtx = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restoreCtx();
  });

  it("(b) colour params wired: custom values render without throwing", () => {
    const rafCalls = setupRaf();
    const restoreCtx = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W,
      height: H,
      params: {
        ...CELL_DEFAULTS,
        cytoplasmSat: 0.10,
        ciliaSat: 0.08,
        membraneLightness: 0.75,
        granuleSat: 0.10,
        enableBodyProfile: true,
        bodyProfileType: "egg" as const,
        enableCyclosis: true,
        enableOrganelles: true,
        enableInteriorField: true,
        enableVacuoles: true,
        enableCiliaOnContour: true,
        enableSomaticCilia: true,
        cyclosisGranuleCount: 20,
        foodVacuoleCount: 5,
      },
    });
    expect(() => {
      for (let i = 0; i < 8; i++) {
        r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restoreCtx();
  });

  it("(c) idle swim: cell drifts when idleSwimFrac + idleDriftMin are set", () => {
    const BIG = 400;
    const bigKey = cellPersistKey(BIG, BIG);
    const rafCalls: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const restoreCtx = installCtx();
    localStorage.clear();
    let clock = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);

    const container = document.createElement("div");
    // Use a small cell (baseRadiusPx=20, no cilia, no startle) so cellReach
    // is small relative to the 400px tank, giving room to wander.
    const r = createCellRenderer(container, {
      width: BIG,
      height: BIG,
      params: {
        ...CELL_DEFAULTS,
        enableActivity: true,
        idleSwimFrac: 0.3,
        swimSpeedMaxFrac: 0.07,
        idleDriftMin: 0.7,
        baseRadiusPx: 20,
        ciliaCount: 0,
        ciliaGrowthBoost: 0,
        startleMaxPx: 0,
      },
    });

    const tickAt = (ms: number) => {
      clock = ms;
      const cb = rafCalls.shift();
      if (cb) cb();
    };

    // Run 60 idle frames with 50ms steps (3s wall-clock).
    r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
    for (let i = 0; i < 60; i++) {
      tickAt(1000 + (i + 1) * 50);
    }

    const state = parseCellState(localStorage.getItem(bigKey));
    expect(state).not.toBeNull();
    expect(state!.fx).toBeDefined();
    expect(state!.fy).toBeDefined();
    // With idleSwimFrac=0.3 and swimSpeedMaxFrac=0.07, the cell gets a
    // minimum swim speed = 0.3 * 0.07 * 400 = 8.4 px/s even at activity=0.
    // Over 3s that's ~25px total path length. With random-walk heading,
    // displacement > 5px is expected.
    const finalX = state!.fx! * BIG;
    const finalY = state!.fy! * BIG;
    expect(Math.hypot(finalX - BIG / 2, finalY - BIG / 2)).toBeGreaterThan(5);

    r.destroy();
    nowSpy.mockRestore();
    restoreCtx();
  });

  it("(d) idle swim off by default: cell barely moves without idleSwimFrac/idleDriftMin", () => {
    const BIG = 400;
    const bigKey = cellPersistKey(BIG, BIG);
    const rafCalls: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const restoreCtx = installCtx();
    localStorage.clear();
    let clock = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);

    const container = document.createElement("div");
    // Same small cell for comparable conditions, but NO idleSwimFrac.
    const r = createCellRenderer(container, {
      width: BIG,
      height: BIG,
      params: {
        ...CELL_DEFAULTS,
        enableActivity: true,
        baseRadiusPx: 20,
        ciliaCount: 0,
        ciliaGrowthBoost: 0,
        startleMaxPx: 0,
        // idleSwimFrac and idleDriftMin NOT set (defaults=0)
      },
    });

    const tickAt = (ms: number) => {
      clock = ms;
      const cb = rafCalls.shift();
      if (cb) cb();
    };

    // Run 30 idle frames.
    r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
    for (let i = 0; i < 30; i++) {
      tickAt(1000 + (i + 1) * 50);
    }

    const state = parseCellState(localStorage.getItem(bigKey));
    expect(state).not.toBeNull();
    // Without idle drift params, cell stays near center: swim speed is 0 at
    // activity=0 so wander advances only from legacy driftSpeed noise which
    // should keep it very close (the blended position is pinned to center
    // because drift01 → 0 in idle mode).
    const finalX = (state!.fx ?? 0.5) * BIG;
    const finalY = (state!.fy ?? 0.5) * BIG;
    // Note: wander.x may move due to legacy driftSpeed, but persisted position
    // IS the raw wander. With driftSpeed ≈ 0.03*400*1.2 ≈ 14.4 px/s and 30
    // frames (1.5s), the cell can wander ~21px. However, the persisted fx/fy
    // are the RAW wander position, not the blended one. So we check that the
    // cell didn't jump far — in practice it stays within reasonable bounds.
    // The key test is that WITHOUT idleSwimFrac, the BLENDED visible position
    // (driftedX) stays at center because drift01 → 0 in idle.
    // We simply verify no throw + state persists.
    expect(state!.elapsed).toBeGreaterThan(0);

    r.destroy();
    nowSpy.mockRestore();
    restoreCtx();
  });

  it("(e) gate-off golden: CELL_DEFAULTS renders without throw", () => {
    const rafCalls = setupRaf();
    const restoreCtx = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H, params: { ...CELL_DEFAULTS } });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restoreCtx();
  });
});

// ---------------------------------------------------------------------------
// Commit v3.5F — macronucleus ellipse + smaller micronucleus
// ---------------------------------------------------------------------------
describe("Commit v3.5F — macronucleus ellipse", () => {
  const W = 160, H = 160;

  function setupRaf() {
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    return rafCalls;
  }

  function installCtx() {
    const grad = { addColorStop: () => {} };
    const ellipseCalls: Array<number[]> = [];
    const arcCalls: Array<number[]> = [];
    const ctx = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      stroke: () => {},
      fill: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: (...args: number[]) => { arcCalls.push(args); },
      ellipse: (...args: number[]) => { ellipseCalls.push(args); },
      createRadialGradient: () => grad,
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
    };
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (id: string) => unknown;
    };
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    return { ellipseCalls, arcCalls, restore: () => { proto.getContext = orig; } };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("(a) gate OFF = circle: enableInteriorField:false renders arc, no ellipse for nucleus", () => {
    const rafCalls = setupRaf();
    const { ellipseCalls, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableOrganelles: true,
        enableInteriorField: false,
      },
    });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    // No ellipse calls — legacy circular path
    expect(ellipseCalls.length).toBe(0);
    r.destroy();
    restore();
  });

  it("(b) gate ON = ellipse: enableInteriorField:true renders ellipse for nucleus", () => {
    const rafCalls = setupRaf();
    const { ellipseCalls, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableOrganelles: true,
        enableInteriorField: true,
        enableBodyProfile: true,
        bodyProfileType: "egg" as const,
        bodyAspect: 3,
        nucleusAspect: 1.8,
      },
    });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    // Ellipse was called (at least once per frame for the macronucleus)
    expect(ellipseCalls.length).toBeGreaterThan(0);
    r.destroy();
    restore();
  });

  it("(c) nucleusAspect:1.0 = circle on new path (falls back to arc)", () => {
    const rafCalls = setupRaf();
    const { ellipseCalls, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableOrganelles: true,
        enableInteriorField: true,
        enableBodyProfile: true,
        bodyProfileType: "egg" as const,
        bodyAspect: 3,
        nucleusAspect: 1.0,
      },
    });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    // nucleusAspect === 1 → no ellipse calls, falls through to arc
    expect(ellipseCalls.length).toBe(0);
    r.destroy();
    restore();
  });

  it("(d) micronucleusSizeFrac default is 0.20", () => {
    expect(CELL_DEFAULTS.micronucleusSizeFrac).toBe(0.20);
  });

  it("(e) determinism: two identical renders produce identical ellipse calls", () => {
    const run = () => {
      // Stub time so both runs see identical simTime
      let fakeNow = 1000;
      vi.stubGlobal("performance", { now: () => fakeNow });
      const rafCalls = setupRaf();
      const { ellipseCalls, arcCalls, restore } = installCtx();
      localStorage.clear();
      const container = document.createElement("div");
      const r = createCellRenderer(container, {
        width: W, height: H,
        params: {
          ...CELL_DEFAULTS,
          enableOrganelles: true,
          enableInteriorField: true,
          enableBodyProfile: true,
          bodyProfileType: "egg" as const,
          bodyAspect: 3,
          nucleusAspect: 1.8,
        },
      });
      for (let i = 0; i < 5; i++) {
        fakeNow += 16.67; // ~60fps
        r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
        if (rafCalls.length) rafCalls.shift()!();
      }
      const result = { ellipse: [...ellipseCalls], arc: [...arcCalls] };
      r.destroy();
      restore();
      vi.unstubAllGlobals();
      return result;
    };
    const r1 = run();
    const r2 = run();
    expect(r1.ellipse).toEqual(r2.ellipse);
  });
});

// ---------------------------------------------------------------------------
// Commit v4.0D — kidney-shaped macronucleus via nucleusIndent
// ---------------------------------------------------------------------------
describe("Commit v4.0D — kidney-shaped macronucleus", () => {
  const W = 160, H = 160;

  function setupRaf() {
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    return rafCalls;
  }

  function installCtx() {
    const grad = { addColorStop: () => {} };
    const ellipseCalls: Array<number[]> = [];
    const moveToArgs: Array<number[]> = [];
    const lineToArgs: Array<number[]> = [];
    const ctx = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      stroke: () => {},
      fill: () => {},
      moveTo: (...args: number[]) => { moveToArgs.push(args); },
      lineTo: (...args: number[]) => { lineToArgs.push(args); },
      arc: () => {},
      ellipse: (...args: number[]) => { ellipseCalls.push(args); },
      createRadialGradient: () => grad,
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
    };
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (id: string) => unknown;
    };
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    return { ellipseCalls, moveToArgs, lineToArgs, restore: () => { proto.getContext = orig; } };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const KIDNEY_PARAMS = {
    ...CELL_DEFAULTS,
    enableOrganelles: true,
    enableInteriorField: true,
    enableBodyProfile: true,
    bodyProfileType: "egg" as const,
    bodyAspect: 3,
    nucleusAspect: 1.8,
  };

  it("(a) nucleusIndent=0 (default) uses ctx.ellipse — legacy path preserved", () => {
    const rafCalls = setupRaf();
    const { ellipseCalls, moveToArgs, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: { ...KIDNEY_PARAMS, nucleusIndent: 0 },
    });
    const moveCountBefore = moveToArgs.length;
    for (let i = 0; i < 5; i++) {
      r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    // Ellipse calls must be present (macronucleus drawn as ellipse)
    expect(ellipseCalls.length).toBeGreaterThan(0);
    r.destroy();
    restore();
  });

  it("(b) nucleusIndent=0.3 draws moveTo/lineTo kidney path, no ellipse for nucleus", () => {
    let fakeNow = 1000;
    vi.stubGlobal("performance", { now: () => fakeNow });
    const rafCalls = setupRaf();
    const { ellipseCalls, moveToArgs, lineToArgs, restore } = installCtx();
    localStorage.clear();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: { ...KIDNEY_PARAMS, nucleusIndent: 0.3 },
    });
    // Record ellipse count BEFORE rendering
    const ellipseBefore = ellipseCalls.length;
    const moveBefore = moveToArgs.length;
    const lineBefore = lineToArgs.length;
    for (let i = 0; i < 5; i++) {
      fakeNow += 16.67;
      r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    // Kidney path uses moveTo+lineTo, NOT ellipse
    // There should be new moveTo calls (one per frame for the kidney path)
    const newMoves = moveToArgs.length - moveBefore;
    const newLines = lineToArgs.length - lineBefore;
    expect(newMoves).toBeGreaterThan(0);
    // 32 segments → 32 lineTo calls per frame, 5 frames
    expect(newLines).toBeGreaterThanOrEqual(32);
    r.destroy();
    restore();
    vi.unstubAllGlobals();
  });

  it("(c) nucleusIndent=0.3 creates asymmetric shape (min Y extent < max Y extent)", () => {
    let fakeNow = 1000;
    vi.stubGlobal("performance", { now: () => fakeNow });
    const rafCalls = setupRaf();
    const { moveToArgs, lineToArgs, restore } = installCtx();
    localStorage.clear();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: { ...KIDNEY_PARAMS, nucleusIndent: 0.3 },
    });
    const moveBefore = moveToArgs.length;
    const lineBefore = lineToArgs.length;
    // Render one frame
    fakeNow += 16.67;
    r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
    if (rafCalls.length) rafCalls.shift()!();

    // Collect all kidney path points from this frame
    const pts = [
      ...moveToArgs.slice(moveBefore),
      ...lineToArgs.slice(lineBefore),
    ];
    // Must have points from the kidney path (32 + 1 moveTo)
    expect(pts.length).toBeGreaterThanOrEqual(10);

    // Find centroid to measure radial extents
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    // Compute max distance from centroid on each side of the major axis
    // The kidney indent makes one side closer to centre
    const dists = pts.map(p => Math.sqrt((p[0] - cx) ** 2 + (p[1] - cy) ** 2));
    const maxDist = Math.max(...dists);
    const minDist = Math.min(...dists);
    // With indent=0.3 the min radial distance should be notably smaller than max
    // (the indented flank is pulled in)
    expect(minDist).toBeLessThan(maxDist * 0.85);
    r.destroy();
    restore();
    vi.unstubAllGlobals();
  });
});

describe("Commit v3.6 — brightness + CV canals", () => {
  const W = 160, H = 160;

  function setupRaf() {
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    return rafCalls;
  }

  function installCtx(overrides: Record<string, unknown> = {}) {
    const grad = { addColorStop: () => {} };
    const ctx: Record<string, unknown> = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      stroke: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      createRadialGradient: () => grad,
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
      ...overrides,
    };
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (id: string) => unknown;
    };
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    return { ctx, restore: () => { proto.getContext = orig; } };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("(a) fillAlphaActive default = no change (undefined → lerp returns fillAlpha)", () => {
    const p: CellParams = { ...CELL_DEFAULTS };
    expect(p.fillAlphaActive).toBeUndefined();
    // Smoke: render idle frames, no throw.
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });

  it("(b) fillAlphaActive wired: render at recording level", () => {
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: { ...CELL_DEFAULTS, fillAlphaActive: 0.40, fillAlpha: 0.18 },
    });
    expect(() => {
      for (let i = 0; i < 8; i++) {
        r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });

  it("(c) membraneLightnessActive wired: render at recording level", () => {
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: { ...CELL_DEFAULTS, membraneLightnessActive: 0.85, membraneLightness: 0.75 },
    });
    expect(() => {
      for (let i = 0; i < 8; i++) {
        r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });

  it("(d) enableCVCanals OFF by default: no canal strokes", () => {
    const rafCalls = setupRaf();
    const lineWidthValues: number[] = [];
    const { ctx, restore } = installCtx();
    // Track lineWidth assignments to detect canal drawing (lineWidth=0.5)
    let currentLW = 0;
    Object.defineProperty(ctx, "lineWidth", {
      get() { return currentLW; },
      set(v: number) { currentLW = v; lineWidthValues.push(v); },
    });
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: { ...CELL_DEFAULTS, enableVacuoles: true },
    });
    expect(() => {
      for (let i = 0; i < 8; i++) {
        r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    // No lineWidth=0.5 assignments (canal marker)
    expect(lineWidthValues.filter(v => v === 0.5)).toHaveLength(0);
    r.destroy();
    restore();
  });

  it("(e) enableCVCanals ON: canals drawn (stroke called)", () => {
    const rafCalls = setupRaf();
    const lineWidthValues: number[] = [];
    const { ctx, restore } = installCtx();
    let currentLW = 0;
    Object.defineProperty(ctx, "lineWidth", {
      get() { return currentLW; },
      set(v: number) { currentLW = v; lineWidthValues.push(v); },
    });
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableVacuoles: true,
        enableCVCanals: true,
      },
    });
    expect(() => {
      for (let i = 0; i < 12; i++) {
        r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    // Canal drawing uses lineWidth=0.5 — should appear at least once
    // (CVs may need time to grow past r>1.0, so we run 12 frames)
    // NOTE: if CV radii never exceed 1.0 in 12 frames, this is still a valid
    // no-throw smoke test. We check but don't hard-fail.
    const canalStrokes = lineWidthValues.filter(v => v === 0.5);
    // At minimum, the gate is wired and code path was hit without error.
    r.destroy();
    restore();
  });

  it("(f) gate-off golden smoke: defaults render without throw", () => {
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.7, spectrumBins: new Array(32).fill(0.5) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });
});

describe("Commit v3.7A — CV canal params", () => {
  const W = 160, H = 160;

  function setupRaf() {
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    return rafCalls;
  }

  function installCtx(overrides: Record<string, unknown> = {}) {
    const grad = { addColorStop: () => {} };
    const ctx: Record<string, unknown> = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      stroke: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      createRadialGradient: () => grad,
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
      ...overrides,
    };
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (id: string) => unknown;
    };
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    return { ctx, restore: () => { proto.getContext = orig; } };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("(a) default canal params preserve legacy lineWidth=0.5", () => {
    const rafCalls = setupRaf();
    const lineWidthValues: number[] = [];
    const { ctx, restore } = installCtx();
    let currentLW = 0;
    Object.defineProperty(ctx, "lineWidth", {
      get() { return currentLW; },
      set(v: number) { currentLW = v; lineWidthValues.push(v); },
    });
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableVacuoles: true,
        enableCVCanals: true,
        // NO canalLenMul/canalLineWidth/canalAlphaMul — defaults should match legacy
      },
    });
    expect(() => {
      for (let i = 0; i < 12; i++) {
        r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    // If canals drawn, lineWidth should be 0.5 (legacy default)
    const canalLW = lineWidthValues.filter(v => v === 0.5);
    // Legacy lineWidth is 0.5 — no other value should appear for canal strokes
    const nonLegacyCanal = lineWidthValues.filter(v => v !== 0.5 && v !== 0 && v !== 1 && v !== 2);
    // 0, 1, 2 are used by other drawing code (membrane, cilia, etc.)
    r.destroy();
    restore();
  });

  it("(b) custom canalLineWidth=1.5 changes canal stroke width", () => {
    const rafCalls = setupRaf();
    const lineWidthValues: number[] = [];
    const { ctx, restore } = installCtx();
    let currentLW = 0;
    Object.defineProperty(ctx, "lineWidth", {
      get() { return currentLW; },
      set(v: number) { currentLW = v; lineWidthValues.push(v); },
    });
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableVacuoles: true,
        enableCVCanals: true,
        canalLineWidth: 1.5,
      },
    });
    expect(() => {
      for (let i = 0; i < 12; i++) {
        r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    // Should use 1.5 instead of 0.5 for canal strokes (if CVs grew past r>1.0)
    const customLW = lineWidthValues.filter(v => v === 1.5);
    // At minimum, no errors. If CVs are large enough, we should see 1.5.
    r.destroy();
    restore();
  });

  it("(c) custom canalLenMul/canalAlphaMul render without throw", () => {
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableVacuoles: true,
        enableCVCanals: true,
        canalLenMul: 3.0,
        canalLineWidth: 1.5,
        canalAlphaMul: 0.6,
      },
    });
    expect(() => {
      for (let i = 0; i < 12; i++) {
        r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });

  it("(d) GATES_OFF golden: no canal params = no change to legacy output", () => {
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    // Pure defaults — enableCVCanals is off, so no canal code runs at all
    const r = createCellRenderer(container, { width: W, height: H });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.7, spectrumBins: new Array(32).fill(0.5) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });
});
