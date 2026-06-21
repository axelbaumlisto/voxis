// src/theme-engine/renderers/__tests__/cell-cilia.test.ts
/**
 * Split from cell.test.ts. Tests moved by domain; assertions intentionally unchanged.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  noise2D,
  smoothstep,
  swimSpeed,
  ciliaBeatHzEff,
  strokeAxisStrength,
  metachronalIndex,
  ciliaStrokeAngle,
  catmullRomOpen,
  ciliaEndpoints,
  ciliaPath,
  ciliaBeatPhase,
  perimeterCiliaCount,
  cellReach,
  CELL_DEFAULTS,
  createCellRenderer,
  affineSqueezePoints,
  somaticCiliaParams,
  ciliaStructureMod,
} from "../cell/testing";
import { deformAt, wrapPi } from "../shared";
import type { CellParams, CiliaMotion } from "../cell/testing";

const TAU = Math.PI * 2;

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

  it("(d) RECORDING SHORT FUR: mex cilia do not grow into long whiskers", () => {
    const params = somaticCiliaParams({
      ...CELL_DEFAULTS,
      enableSomaticCilia: true,
      somaticCiliaCount: 104,
      ciliaGrowthBoost: 0,
      ciliaLengthVar: 0.35,
    });
    const crown = ciliaPath(cx, cy, baseR, t, 1.0, 1.0, params);
    const lengths = crown.map(hairLen);

    expect(crown.length).toBe(104);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(baseR * 0.15 * 1.35 + 1e-9);
  });

  it("(e) POINT-ON-CONTOUR: every mex base lies on the deformed+squeezed contour", () => {
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
      ellipse: () => {},
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
// Commit 23 — ciliature structure: oral-groove density dip + caudal tuft
// ---------------------------------------------------------------------------
describe("Commit 23 — ciliature structure", () => {
  const cx = 100;
  const cy = 100;
  const baseR = 30;
  const t = 1.0;
  const energy = 0.6;
  const growth = 0.8;
  const hairLen = (h: { points: Array<[number, number]> }): number => {
    const [bx, by] = h.points[0];
    const [tx, ty] = h.points[h.points.length - 1];
    return Math.hypot(tx - bx, ty - by);
  };

  // ---- (a) GATE OFF: pure no-op + byte-identical ciliaPath --------------------
  it("(a) GATE OFF: ciliaStructureMod returns {lengthScale:1, keep:true}", () => {
    expect(CELL_DEFAULTS.enableCiliaStructure).toBe(false);
    const off = { ...CELL_DEFAULTS };
    for (const psi of [-Math.PI, -1.2, 0, 0.5, 1.2, 2.5, Math.PI]) {
      for (const noise of [0, 0.15, 0.5, 0.9, 1]) {
        expect(ciliaStructureMod(psi, noise, off)).toEqual({ lengthScale: 1, keep: true });
      }
    }
  });

  it("(a) GATE OFF: ciliaPath byte-identical with the field absent vs false", () => {
    const motion: CiliaMotion = { tx: 0.6, ty: 0.8, speedNorm: 0.7, axisStrength: 0.5 };
    const absent = ciliaPath(cx, cy, baseR, t, energy, growth, { ...CELL_DEFAULTS }, motion);
    const explicitFalse = ciliaPath(
      cx, cy, baseR, t, energy, growth,
      { ...CELL_DEFAULTS, enableCiliaStructure: false }, motion,
    );
    expect(explicitFalse).toEqual(absent);
    // same hair count + identical first/last hair coordinates
    expect(explicitFalse.length).toBe(absent.length);
    expect(explicitFalse[0].points).toEqual(absent[0].points);
    expect(explicitFalse[absent.length - 1].points).toEqual(absent[absent.length - 1].points);
  });

  // ---- (b) CAUDAL TUFT -------------------------------------------------------
  it("(b) CAUDAL TUFT: lengthScale ~caudalTuftLength at the pole, 1 at anterior, monotone & continuous", () => {
    const params: CellParams = { ...CELL_DEFAULTS, enableCiliaStructure: true };
    const tuftLen = params.caudalTuftLength ?? 1.7;
    const tuftW = params.caudalTuftWidth ?? 0.6;
    // at the posterior pole psi=±π => lengthScale ≈ caudalTuftLength
    expect(ciliaStructureMod(Math.PI, 0.5, params).lengthScale).toBeCloseTo(tuftLen, 10);
    expect(ciliaStructureMod(-Math.PI, 0.5, params).lengthScale).toBeCloseTo(tuftLen, 10);
    // at the anterior psi=0 => no lengthening
    expect(ciliaStructureMod(0, 0.5, params).lengthScale).toBe(1);
    // monotone decreasing from π inward over the tuft window
    let prev = Infinity;
    for (let d = 0; d <= tuftW; d += tuftW / 20) {
      const ls = ciliaStructureMod(Math.PI - d, 0.5, params).lengthScale;
      expect(ls).toBeLessThanOrEqual(prev + 1e-12);
      prev = ls;
    }
    // C0-continuous at the window edge: lengthScale → 1
    const atEdge = ciliaStructureMod(Math.PI - tuftW + 1e-6, 0.5, params).lengthScale;
    expect(atEdge).toBeCloseTo(1, 4);
  });

  // ---- (c) ORAL DIP: drops only in window, fraction ~ dip at centre ----------
  it("(c) ORAL DIP: drops occur ONLY within the oral window, none at poles/anterior", () => {
    const params: CellParams = { ...CELL_DEFAULTS, enableCiliaStructure: true };
    const center = params.oralGapCenter ?? 1.2;
    const width = params.oralGapWidth ?? 0.75;
    const noiseGrid = Array.from({ length: 20 }, (_, i) => i / 20); // [0,1)
    for (let psi = -Math.PI; psi <= Math.PI; psi += Math.PI / 90) {
      const inWindow = Math.abs(wrapPi(psi - center)) < width;
      for (const noise of noiseGrid) {
        const dropped = !ciliaStructureMod(psi, noise, params).keep;
        if (dropped) expect(inWindow).toBe(true);
      }
    }
    // No drops at the posterior pole or the anterior.
    for (const psi of [Math.PI, -Math.PI, 0]) {
      for (const noise of noiseGrid) {
        expect(ciliaStructureMod(psi, noise, params).keep).toBe(true);
      }
    }
    // Drop fraction near the centre ≈ oralGapDip.
    const dip = params.oralGapDip ?? 0.3;
    let dropped = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      if (!ciliaStructureMod(center, i / N, params).keep) dropped++;
    }
    expect(dropped / N).toBeCloseTo(dip, 1);
  });

  // ---- (d) DENSITY DIP NOT BALD ---------------------------------------------
  it("(d) DENSITY DIP NOT BALD: at the oral centre, ≥(1-dip) of hairs are kept", () => {
    const params: CellParams = { ...CELL_DEFAULTS, enableCiliaStructure: true };
    const center = params.oralGapCenter ?? 1.2;
    let kept = 0;
    for (let i = 0; i < 100; i++) {
      if (ciliaStructureMod(center, i / 100, params).keep) kept++;
    }
    expect(kept).toBeGreaterThanOrEqual(65);
  });

  // ---- (e) RENDER ON --------------------------------------------------------
  it("(e) RENDER ON: fewer hairs (oral thinning) + longest near posterior pole + finite", () => {
    const motion: CiliaMotion = { tx: 1, ty: 0, speedNorm: 0.8, axisStrength: 0.7 };
    const base = somaticCiliaParams({ ...CELL_DEFAULTS, enableSomaticCilia: true });
    const off = ciliaPath(cx, cy, baseR, t, energy, growth, base, motion);
    const on = ciliaPath(
      cx, cy, baseR, t, energy, growth,
      { ...base, enableCiliaStructure: true }, motion,
    );
    // (i) oral thinning removed some hairs
    expect(on.length).toBeLessThan(off.length);
    // (ii) the longest hairs are near the posterior pole (strokeAxis + π).
    // heading is +x => posterior pole points to -x.
    let longest = -1;
    let longestAngle = 0;
    for (const h of on) {
      const L = hairLen(h);
      if (L > longest) {
        longest = L;
        const [bx, by] = h.points[0];
        longestAngle = Math.atan2(by - cy, bx - cx);
      }
    }
    // posterior pole = π (i.e. pointing -x); |angle| should be near π.
    expect(Math.abs(longestAngle)).toBeGreaterThan(Math.PI - 0.6);
    // (iii) finite coords, no NaN
    for (const h of on) {
      for (const [px, py] of h.points) {
        expect(Number.isFinite(px)).toBe(true);
        expect(Number.isFinite(py)).toBe(true);
      }
    }
  });

  // ---- (f) DETERMINISM ------------------------------------------------------
  it("(f) DETERMINISM: identical args ⇒ identical output", () => {
    const params: CellParams = { ...CELL_DEFAULTS, enableCiliaStructure: true };
    expect(ciliaStructureMod(1.0, 0.4, params)).toEqual(ciliaStructureMod(1.0, 0.4, params));
    const motion: CiliaMotion = { tx: 0.6, ty: 0.8, speedNorm: 0.7, axisStrength: 0.5 };
    const on = somaticCiliaParams({ ...CELL_DEFAULTS, enableSomaticCilia: true, enableCiliaStructure: true });
    expect(ciliaPath(cx, cy, baseR, t, energy, growth, on, motion)).toEqual(
      ciliaPath(cx, cy, baseR, t, energy, growth, on, motion),
    );
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

// ---------------------------------------------------------------------------
// Metachronal length wave (v3.9D)
// ---------------------------------------------------------------------------
describe("metachronal length wave (v3.9D)", () => {
  const cx = 80, cy = 80, baseR = 16;
  const BASE: CellParams = {
    ...CELL_DEFAULTS,
    ciliaCount: 40,
    ciliaLength: 0.45,
    ciliaLengthVar: 0,
    ciliaGrowthBoost: 0,
    ciliaCurl: 0,
    ciliaAngleJitter: 0,
    ciliaWaveSpeed: 0,
    ciliaWave: 0,
  };

  it("enableMetachronal=false (default) => all cilia same length (golden frozen)", () => {
    const off = ciliaPath(cx, cy, baseR, 1.0, 0.5, 0.0, { ...BASE, enableMetachronal: false });
    const dists = off.map(h => {
      const tip = h.points[h.points.length - 1];
      return Math.hypot(tip[0] - cx, tip[1] - cy);
    });
    const minD = Math.min(...dists);
    const maxD = Math.max(...dists);
    expect(maxD - minD).toBeLessThan(2);
  });

  it("enableMetachronal=true => cilia lengths vary along the contour", () => {
    const on = ciliaPath(cx, cy, baseR, 1.0, 0.5, 0.0, {
      ...BASE,
      enableMetachronal: true,
      metachronalWavelength: 10,
      metachronalSpeed: 4.0,
    });
    const dists = on.map(h => {
      const tip = h.points[h.points.length - 1];
      return Math.hypot(tip[0] - cx, tip[1] - cy);
    });
    const minD = Math.min(...dists);
    const maxD = Math.max(...dists);
    expect(maxD - minD).toBeGreaterThan(1.5);
  });

  it("wave propagates: different simTime => different length pattern", () => {
    const params: CellParams = {
      ...BASE,
      enableMetachronal: true,
      metachronalWavelength: 10,
      metachronalSpeed: 4.0,
    };
    const t1 = ciliaPath(cx, cy, baseR, 1.0, 0.5, 0.0, params);
    const t2 = ciliaPath(cx, cy, baseR, 2.0, 0.5, 0.0, params);
    const tipDist = (h: { points: Array<[number, number]> }) =>
      Math.hypot(h.points[h.points.length - 1][0] - cx, h.points[h.points.length - 1][1] - cy);
    const dists1 = t1.map(tipDist);
    const dists2 = t2.map(tipDist);
    let changed = 0;
    for (let i = 0; i < dists1.length; i++) {
      if (Math.abs(dists1[i] - dists2[i]) > 0.1) changed++;
    }
    expect(changed).toBeGreaterThan(dists1.length * 0.3);
  });

  it("wavelength controls spatial frequency", () => {
    const mkParams = (wl: number): CellParams => ({
      ...BASE,
      enableMetachronal: true,
      metachronalWavelength: wl,
      metachronalSpeed: 0,
    });
    const tipDist = (h: { points: Array<[number, number]> }) =>
      Math.hypot(h.points[h.points.length - 1][0] - cx, h.points[h.points.length - 1][1] - cy);
    const short = ciliaPath(cx, cy, baseR, 0, 0.5, 0.0, mkParams(5)).map(tipDist);
    const long = ciliaPath(cx, cy, baseR, 0, 0.5, 0.0, mkParams(20)).map(tipDist);
    function zeroCrossings(d: number[]): number {
      const mean = d.reduce((s, v) => s + v, 0) / d.length;
      let crossings = 0;
      for (let i = 1; i < d.length; i++) {
        if ((d[i] - mean) * (d[i - 1] - mean) < 0) crossings++;
      }
      return crossings;
    }
    expect(zeroCrossings(short)).toBeGreaterThan(zeroCrossings(long));
  });

  it("modulation range stays within [0.6, 1.0] multiplier (default depth 0.4)", () => {
    const params: CellParams = {
      ...BASE,
      enableMetachronal: true,
      metachronalWavelength: 10,
      metachronalSpeed: 0,
    };
    const lenMean = baseR * 0.45 * (0.55 + 0.45 * 0.5);
    for (let t = 0; t < 10; t += 0.7) {
      const paths = ciliaPath(cx, cy, baseR, t, 0.5, 0.0, params);
      const dists = paths.map(h =>
        Math.hypot(h.points[h.points.length - 1][0] - cx, h.points[h.points.length - 1][1] - cy)
      );
      const minExpected = baseR + lenMean * 0.6 - 2;
      const maxExpected = baseR + lenMean * 1.0 + 2;
      for (const d of dists) {
        expect(d).toBeGreaterThan(minExpected);
        expect(d).toBeLessThan(maxExpected);
      }
    }
  });

  it("metachronalDepth=0.4 (default) matches legacy range [0.6, 1.0]", () => {
    const paramsDefault: CellParams = {
      ...BASE,
      enableMetachronal: true,
      metachronalWavelength: 10,
      metachronalSpeed: 0,
    };
    const paramsExplicit: CellParams = {
      ...paramsDefault,
      metachronalDepth: 0.4,
    };
    const tipDist = (h: { points: Array<[number, number]> }) =>
      Math.hypot(h.points[h.points.length - 1][0] - cx, h.points[h.points.length - 1][1] - cy);
    const d1 = ciliaPath(cx, cy, baseR, 0, 0.5, 0.0, paramsDefault).map(tipDist);
    const d2 = ciliaPath(cx, cy, baseR, 0, 0.5, 0.0, paramsExplicit).map(tipDist);
    for (let i = 0; i < d1.length; i++) {
      expect(d2[i]).toBeCloseTo(d1[i], 10);
    }
  });

  it("metachronalDepth=0.6 widens range to [0.4, 1.0]", () => {
    const params: CellParams = {
      ...BASE,
      enableMetachronal: true,
      metachronalWavelength: 10,
      metachronalSpeed: 0,
      metachronalDepth: 0.6,
    };
    const lenMean = baseR * 0.45 * (0.55 + 0.45 * 0.5);
    const allDists: number[] = [];
    for (let t = 0; t < 10; t += 0.7) {
      const paths = ciliaPath(cx, cy, baseR, t, 0.5, 0.0, params);
      const dists = paths.map(h =>
        Math.hypot(h.points[h.points.length - 1][0] - cx, h.points[h.points.length - 1][1] - cy)
      );
      allDists.push(...dists);
      const minExpected = baseR + lenMean * 0.4 - 2;
      const maxExpected = baseR + lenMean * 1.0 + 2;
      for (const d of dists) {
        expect(d).toBeGreaterThan(minExpected);
        expect(d).toBeLessThan(maxExpected);
      }
    }
    // With depth=0.6, some values should be shorter than depth=0.4 allows
    const minDist = Math.min(...allDists);
    expect(minDist).toBeLessThan(baseR + lenMean * 0.6);
  });

  it("metachronalDepth=0 => all multipliers 1.0 (no modulation)", () => {
    const params: CellParams = {
      ...BASE,
      enableMetachronal: true,
      metachronalWavelength: 10,
      metachronalSpeed: 4.0,
      metachronalDepth: 0,
    };
    const paramsOff: CellParams = {
      ...BASE,
      enableMetachronal: false,
    };
    const tipDist = (h: { points: Array<[number, number]> }) =>
      Math.hypot(h.points[h.points.length - 1][0] - cx, h.points[h.points.length - 1][1] - cy);
    const withDepthZero = ciliaPath(cx, cy, baseR, 3.0, 0.5, 0.0, params).map(tipDist);
    const withOff = ciliaPath(cx, cy, baseR, 3.0, 0.5, 0.0, paramsOff).map(tipDist);
    for (let i = 0; i < withDepthZero.length; i++) {
      expect(withDepthZero[i]).toBeCloseTo(withOff[i], 10);
    }
  });
});
