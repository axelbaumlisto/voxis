// src/theme-engine/renderers/__tests__/cell-interior.test.ts
/**
 * Split from cell.test.ts. Tests moved by domain; assertions intentionally unchanged.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  dipoleFlowAt,
  advectMote,
  seedMotes,
  cyclosisField,
  seedGranules,
  advectGranule,
  foodVacuoleSize,
  seedInteriorFoodVacuoles,
  CELL_DEFAULTS,
  createCellRenderer,
  bodyHalfWidth,
  bodyProfilePoint,
  bodyProfileDeform,
  helicalOffset,
  interiorPoint,
  seedInteriorGranules,
  profileCDFInv,
  cyclosisLoopPoint,
  buildProfilePts,
  applyOralGroove,
  effectiveCyclosisPeriod,
} from "../cell/testing";
import { wrapPi } from "../shared";
import { membranePolyline, minDistToPolyline, pointInPolygon } from "./helpers/cell-geometry";
import type { CellParams, InteriorCtx } from "../cell/testing";

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Commit 27 — cytoplasmic streaming (cyclosis) + granules. The interior reads
// near-empty ("only the nucleus"); a divergence-free rigid-rotation field
// circulates a field of granules on closed loops tangent to the wall. All
// pure/deterministic; render wiring is gated behind enableCyclosis (OFF).
// ---------------------------------------------------------------------------
describe("Commit 27 — cyclosis + granules", () => {
  const baseR = 24;

  it("(a) cyclosisField is DIVERGENCE-FREE and TANGENT to circles", () => {
    const omega = 0.3;
    const h = 1e-4;
    for (const [dx, dy] of [[0, 0], [3, 0], [0, 5], [-4, 7], [11, -2]]) {
      // finite-difference divergence: dvx/ddx + dvy/ddy
      const vxp = cyclosisField(dx + h, dy, omega).vx;
      const vxm = cyclosisField(dx - h, dy, omega).vx;
      const vyp = cyclosisField(dx, dy + h, omega).vy;
      const vym = cyclosisField(dx, dy - h, omega).vy;
      const div = (vxp - vxm) / (2 * h) + (vyp - vym) / (2 * h);
      expect(Math.abs(div)).toBeLessThan(1e-6);
      // tangent: u . r == 0 exactly
      const u = cyclosisField(dx, dy, omega);
      expect(u.vx * dx + u.vy * dy).toBeCloseTo(0, 12);
    }
  });

  it("(b) cyclosisField ROTATION SENSE: omega>0 is CCW and linear in omega", () => {
    // at (1,0): v = (-omega*0, omega*1) = (0, omega) -> +y (CCW in math frame)
    const v = cyclosisField(1, 0, 0.7);
    expect(v.vx).toBeCloseTo(0, 12);
    expect(v.vy).toBeCloseTo(0.7, 12);
    // linear in omega
    const a = cyclosisField(3, -2, 1);
    const b = cyclosisField(3, -2, 2.5);
    expect(b.vx).toBeCloseTo(2.5 * a.vx, 12);
    expect(b.vy).toBeCloseTo(2.5 * a.vy, 12);
    // zero omega -> zero field
    expect(cyclosisField(3, -2, 0)).toEqual({ vx: 0, vy: 0 });
  });

  it("(c) seedGranules: gate off -> []; gate on -> count entries within maxRad; deterministic", () => {
    expect(seedGranules(baseR, { ...CELL_DEFAULTS })).toEqual([]);
    const P = { ...CELL_DEFAULTS, enableCyclosis: true };
    const g = seedGranules(baseR, P);
    expect(g.length).toBe(P.cyclosisGranuleCount);
    const maxRad = (P.granuleMaxRadiusFrac ?? 0.75) * baseR;
    for (const o of g) {
      expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(maxRad + 1e-9);
    }
    // deterministic (same seeds twice)
    expect(seedGranules(baseR, P)).toEqual(g);
    // count 0 -> []
    expect(seedGranules(baseR, { ...P, cyclosisGranuleCount: 0 })).toEqual([]);
  });

  it("(d) advectGranule STAYS ON CIRCLE over 200 steps (no spiral-out/collapse)", () => {
    const P = { ...CELL_DEFAULTS, enableCyclosis: true };
    let g = { x: 10, y: 0 };
    const r0 = Math.hypot(g.x, g.y);
    const dt = 1 / 60;
    for (let i = 0; i < 200; i++) g = advectGranule(g, baseR, dt, P);
    const r = Math.hypot(g.x, g.y);
    expect(Math.abs(r - r0) / r0).toBeLessThan(0.01);
  });

  it("(e) advectGranule MOVES: angle advances by ~omega*dt for small dt", () => {
    const P = { ...CELL_DEFAULTS, enableCyclosis: true, cyclosisPeriod: 45 };
    const omega = (Math.PI * 2) / 45;
    const g0 = { x: 8, y: 0 };
    const dt = 1 / 60;
    const g1 = advectGranule(g0, baseR, dt, P);
    const a0 = Math.atan2(g0.y, g0.x);
    const a1 = Math.atan2(g1.y, g1.x);
    const dAng = wrapPi(a1 - a0);
    expect(dAng).toBeGreaterThan(0); // circulates (CCW for omega>0)
    expect(dAng).toBeCloseTo(omega * dt, 4);
  });

  it("(f) DETERMINISM: identical args -> identical output for all three helpers", () => {
    const P = { ...CELL_DEFAULTS, enableCyclosis: true };
    expect(cyclosisField(3, -2, 0.5)).toEqual(cyclosisField(3, -2, 0.5));
    expect(seedGranules(baseR, P)).toEqual(seedGranules(baseR, P));
    const g = { x: 7, y: 3 };
    expect(advectGranule(g, baseR, 1 / 60, P)).toEqual(advectGranule(g, baseR, 1 / 60, P));
  });

  it("(g) RENDER SMOKE: enableCyclosis:true renders a few frames without throwing", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 120,
      height: 60,
      params: { enableCyclosis: true },
    });
    expect(() => {
      for (let i = 0; i < 4; i++) {
        r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
      }
    }).not.toThrow();
    r.destroy();
    vi.unstubAllGlobals();
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

describe("v3.8B — helicalOffset (helical swimming path)", () => {
  const baseR = 30;

  it("(a) default amplitude=0: returns [0,0] exactly", () => {
    const p = { ...CELL_DEFAULTS };
    expect(p.helicalAmplitude).toBeUndefined();
    const [dx, dy] = helicalOffset(1.5, 0.7, baseR, p);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  it("(b) explicit amplitude=0: returns [0,0]", () => {
    const [dx, dy] = helicalOffset(1.5, 0.7, baseR, { helicalAmplitude: 0 });
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  it("(c) spinPhi=0 (rest): returns [0,0] even with amplitude>0", () => {
    const [dx, dy] = helicalOffset(0, 0.7, baseR, { helicalAmplitude: 0.5 });
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  it("(d) positive amplitude + non-zero spinPhi: produces non-zero offset", () => {
    const [dx, dy] = helicalOffset(Math.PI / 3, 0.5, baseR, { helicalAmplitude: 0.4 });
    const mag = Math.hypot(dx, dy);
    expect(mag).toBeGreaterThan(0);
    // mag should be exactly |amp * baseR * sin(spinPhi)|
    expect(mag).toBeCloseTo(0.4 * baseR * Math.abs(Math.sin(Math.PI / 3)), 10);
  });

  it("(e) offset is perpendicular to bodyHeading", () => {
    // For several headings, the offset dot heading-vector should be ~0
    for (const heading of [0, Math.PI / 4, Math.PI / 2, Math.PI, 3.7]) {
      const [dx, dy] = helicalOffset(1.2, heading, baseR, { helicalAmplitude: 0.3 });
      if (dx === 0 && dy === 0) continue;
      // heading direction = (cos(heading), sin(heading))
      const dot = dx * Math.cos(heading) + dy * Math.sin(heading);
      expect(Math.abs(dot)).toBeLessThan(1e-10);
    }
  });

  it("(f) amplitude scales linearly with baseR", () => {
    const phi = 1.0;
    const heading = 0.3;
    const [dx1, dy1] = helicalOffset(phi, heading, 20, { helicalAmplitude: 0.5 });
    const [dx2, dy2] = helicalOffset(phi, heading, 40, { helicalAmplitude: 0.5 });
    expect(dx2).toBeCloseTo(dx1 * 2, 10);
    expect(dy2).toBeCloseTo(dy1 * 2, 10);
  });

  it("(g) determinism: identical inputs -> identical outputs", () => {
    const p = { helicalAmplitude: 0.3 };
    expect(helicalOffset(2.1, 0.5, baseR, p)).toEqual(helicalOffset(2.1, 0.5, baseR, p));
  });

  it("(h) magnitude bounded by amplitude * baseR", () => {
    for (const phi of [0.1, 0.5, 1.0, Math.PI, 5.0]) {
      const [dx, dy] = helicalOffset(phi, 0, baseR, { helicalAmplitude: 0.6 });
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(0.6 * baseR + 1e-10);
    }
  });
});

describe("Commit 32a — interiorPoint (interior coupled to wall)", () => {
  const TAU = Math.PI * 2;
  const cx = 100;
  const cy = 100;
  const baseR = 40;
  const bodyHeading = 0.6;


  function makeCtx(
    deform: number[],
    squeezeK: number,
    squeezePhi: number,
    params: CellParams,
  ): InteriorCtx {
    return { cx, cy, baseR, deform, squeezeK, squeezePhi, bodyHeading, params };
  }

  it("(a) WALL-LANDING (profile): interiorPoint(u, +-1) lands on the membrane polyline", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.27,
      bodyAspect: 3,
    };
    const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
    const squeezeK = 1;
    const squeezePhi = bodyHeading;
    const ctx = makeCtx(deform, squeezeK, squeezePhi, params);
    const poly = membranePolyline({ deform, squeezeK, squeezePhi, params, cx, cy, baseR });
    let maxD = 0;
    for (const u of [-0.8, -0.4, 0, 0.4, 0.8]) {
      for (const s of [1, -1]) {
        const pt = interiorPoint(u, s, ctx);
        const d = minDistToPolyline(pt, poly);
        maxD = Math.max(maxD, d);
        expect(d).toBeLessThan(0.5);
      }
    }
    expect(maxD).toBeLessThan(0.5);
  });

  it("(a2) WALL-LANDING with ventral bend: interiorPoint(u, +-1) lands on the bent membrane polyline", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.24,
      bodyAspect: 3,
      bodyVentralBend: 0.18,
    };
    const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
    const squeezeK = 1;
    const squeezePhi = bodyHeading;
    const ctx = makeCtx(deform, squeezeK, squeezePhi, params);
    const poly = membranePolyline({ deform, squeezeK, squeezePhi, params, cx, cy, baseR });
    let maxD = 0;
    for (const u of [-0.8, -0.4, 0, 0.4, 0.8]) {
      for (const s of [1, -1]) {
        const pt = interiorPoint(u, s, ctx);
        const d = minDistToPolyline(pt, poly);
        maxD = Math.max(maxD, d);
        expect(d).toBeLessThan(0.5);
      }
    }
    expect(maxD).toBeLessThan(0.5);
  });

  it("(b) WALL-LANDING (synthetic FBM deform + affine): interiorPoint(u, +-1) lands on the squeezed FBM membrane", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAffine: true,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.27,
      bodyAspect: 3,
    };
    const deform: number[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * TAU;
      deform.push(0.15 * Math.sin(3 * a) + 0.05 * Math.cos(5 * a));
    }
    const squeezeK = 1.3;
    const squeezePhi = 0.4;
    const ctx = makeCtx(deform, squeezeK, squeezePhi, params);
    const poly = membranePolyline({ deform, squeezeK, squeezePhi, params, cx, cy, baseR });
    let maxD = 0;
    for (const u of [-0.8, -0.4, 0, 0.4, 0.8]) {
      for (const s of [1, -1]) {
        const pt = interiorPoint(u, s, ctx);
        const d = minDistToPolyline(pt, poly);
        maxD = Math.max(maxD, d);
        expect(d).toBeLessThan(0.5);
      }
    }
    expect(maxD).toBeLessThan(0.5);
  });

  it("(c) CENTRE: interiorPoint(0, 0) ~= (cx, cy)", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.27,
      bodyAspect: 3,
    };
    const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
    const ctx = makeCtx(deform, 1, bodyHeading, params);
    const [px, py] = interiorPoint(0, 0, ctx);
    expect(Math.abs(px - cx)).toBeLessThan(1e-6);
    expect(Math.abs(py - cy)).toBeLessThan(1e-6);
  });

  it("(d) MONOTONE DEPTH: distance from axis point grows with |s| (0 -> 1)", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.27,
      bodyAspect: 3,
    };
    const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
    const ctx = makeCtx(deform, 1, bodyHeading, params);
    const u = 0.3;
    const axis = interiorPoint(u, 0, ctx);
    let prev = -1;
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const pt = interiorPoint(u, s, ctx);
      const d = Math.hypot(pt[0] - axis[0], pt[1] - axis[1]);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
    expect(prev).toBeGreaterThan(0);
  });

  it("(e) AFFINE COMPOSITION (k != 1): interiorPoint(u, +1) lands on the squeezed membrane", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAffine: true,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.27,
      bodyAspect: 3,
    };
    const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
    const squeezeK = 1.5;
    const squeezePhi = 0.3;
    const ctx = makeCtx(deform, squeezeK, squeezePhi, params);
    const poly = membranePolyline({ deform, squeezeK, squeezePhi, params, cx, cy, baseR });
    for (const u of [-0.8, -0.4, 0, 0.4, 0.8]) {
      const pt = interiorPoint(u, 1, ctx);
      expect(minDistToPolyline(pt, poly)).toBeLessThan(0.5);
    }
  });

  it("(f) DETERMINISM: identical args => identical output", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.27,
      bodyAspect: 3,
    };
    const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
    const ctx = makeCtx(deform, 1, bodyHeading, params);
    const a = interiorPoint(0.3, 0.4, ctx);
    const b = interiorPoint(0.3, 0.4, ctx);
    expect(a[0]).toBe(b[0]);
    expect(a[1]).toBe(b[1]);
  });

  it("(g) FINITE/NO-NAN: all (u, s) on the pole + axis grid are finite", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAffine: true,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.27,
      bodyAspect: 3,
    };
    const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
    const ctx = makeCtx(deform, 1.5, 0.3, params);
    for (const u of [-1, -0.99, 0, 0.99, 1]) {
      for (const s of [-1, 0, 1]) {
        const [px, py] = interiorPoint(u, s, ctx);
        expect(Number.isFinite(px)).toBe(true);
        expect(Number.isFinite(py)).toBe(true);
      }
    }
  });
});

describe("Commit 32b — body-coord granule distribution", () => {
  const TAU = Math.PI * 2;
  const eggParams: CellParams = {
    ...CELL_DEFAULTS,
    enableBodyProfile: true,
    bodyProfileType: "egg",
    bodyProfileTaper: 0.27,
    bodyAspect: 3,
  };

  // Mirror of profileCDFInv's table build, used to compute the analytic area
  // fraction with u>0 the same way the seeding does.
  function areaFractionUPos(params: CellParams): number {
    const M = 128;
    let acc = 0;
    let cdfAt0 = 0;
    let prevW = bodyHalfWidth(-1, params);
    for (let k = 1; k <= M; k++) {
      const u = -1 + (2 * k) / M;
      const w = bodyHalfWidth(u, params);
      acc += (prevW + w) * 0.5 * (2 / M);
      prevW = w;
      if (u <= 0) cdfAt0 = acc;
    }
    const Z = acc || 1;
    return 1 - cdfAt0 / Z;
  }

  it("(a) profileCDFInv MONOTONE + RANGE: u in [-1,1], monotone, endpoints", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const xi = i / 20;
      const u = profileCDFInv(xi, eggParams);
      expect(u).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(u).toBeLessThanOrEqual(1 + 1e-9);
      expect(u).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = u;
    }
    expect(Math.abs(profileCDFInv(0, eggParams) - -1)).toBeLessThan(1e-6);
    expect(Math.abs(profileCDFInv(1, eggParams) - 1)).toBeLessThan(1e-6);
    const mid = profileCDFInv(0.5, eggParams);
    expect(Number.isFinite(mid)).toBe(true);
    expect(mid).toBeGreaterThan(-1);
    expect(mid).toBeLessThan(1);
  });

  it("(b) AREA-UNIFORM: ensemble u>0 fraction ~= analytic area fraction; reaches poles", () => {
    const N = 2000;
    const seeds = seedInteriorGranules(N, 0, eggParams);
    expect(seeds.length).toBe(N);
    const fracUPos = seeds.filter((g) => g.u > 0).length / N;
    const analytic = areaFractionUPos(eggParams);
    expect(Math.abs(fracUPos - analytic)).toBeLessThan(0.05);
    // Granules reach FAR toward the poles, unlike the old central disc. (The
    // ceiling sits below 1.0 because area-uniform density p(u) ∝ w-hat(u) -> 0
    // at the poles, so the inverse-CDF compresses the most extreme samples; the
    // equivalent body-coord max for the old 0.75*baseR disc would be ~0.43.)
    const maxAbsU = seeds.reduce((m, g) => Math.max(m, Math.abs(g.u)), 0);
    expect(maxAbsU).toBeGreaterThan(0.85);
    // s should span the full transverse range too.
    const maxAbsS = seeds.reduce((m, g) => Math.max(m, Math.abs(g.s)), 0);
    expect(maxAbsS).toBeGreaterThan(0.9);
  });

  it("(c) POLE COVERAGE via interiorPoint: elongated cloud, all contained", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.24,
      bodyAspect: 3,
      bodyVentralBend: 0.18,
    };
    const baseR = 40;
    const cx = 100, cy = 100, bodyHeading = 0;
    const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
    const ctx: InteriorCtx = { cx, cy, baseR, deform, squeezeK: 1, squeezePhi: 0, bodyHeading, params };
    const poly: Array<[number, number]> = [];
    for (let i = 0; i < deform.length; i++) {
      const angle = (i / deform.length) * TAU;
      const r = baseR * (1 + deform[i]);
      poly.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
    const N = 2000;
    const seeds = seedInteriorGranules(N, 0, params);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let allContained = true;
    for (const g of seeds) {
      const pt = interiorPoint(g.u, g.s, ctx);
      minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
      minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
      // contained (allow a hair of polyline discretisation slack)
      if (!pointInPolygon(pt, poly) && minDistToPolyline(pt, poly) > 0.5) {
        allContained = false;
      }
    }
    const aspect = (maxX - minX) / Math.max(1e-9, maxY - minY);
    expect(aspect).toBeGreaterThan(1.8);
    expect(allContained).toBe(true);
  });

  it("(d) GATE OFF: legacy disc path renders without throwing (interior gate off)", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 120,
      height: 60,
      params: { enableCyclosis: true, cyclosisGranuleCount: 20 },
    });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
      }
    }).not.toThrow();
    r.destroy();
    vi.unstubAllGlobals();
  });

  it("(e) RENDER ON: interior field path renders finite without throwing", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 120,
      height: 60,
      params: {
        enableInteriorField: true,
        enableCyclosis: true,
        cyclosisGranuleCount: 20,
        enableBodyProfile: true,
        bodyProfileType: "egg",
      },
    });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
      }
    }).not.toThrow();
    r.destroy();
    vi.unstubAllGlobals();
  });

  it("(f) DETERMINISM: identical args => identical seeds", () => {
    const a = seedInteriorGranules(50, 0, eggParams);
    const b = seedInteriorGranules(50, 0, eggParams);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].u).toBe(b[i].u);
      expect(a[i].s).toBe(b[i].s);
      expect(a[i].q).toBe(b[i].q);
      expect(a[i].phi0).toBe(b[i].phi0);
    }
    expect(profileCDFInv(0.37, eggParams)).toBe(profileCDFInv(0.37, eggParams));
  });
});

describe("Commit 32c — streamfunction cyclosis", () => {
  const TAU = Math.PI * 2;
  const eggParams: CellParams = {
    ...CELL_DEFAULTS,
    enableBodyProfile: true,
    bodyProfileType: "egg",
    bodyProfileTaper: 0.27,
    bodyAspect: 3,
    cyclosisPeriod: 45,
  };

  it("(a) ON A CLOSED LOOP: |u|,|s| <= amp < 1; q=1 outer ~0.98, q=0 inner ~0.30", () => {
    for (const q of [0, 0.25, 0.5, 0.75, 1]) {
      const amp = 0.3 + 0.68 * Math.sqrt(q);
      for (let k = 0; k <= 40; k++) {
        const simTime = (k / 40) * eggParams.cyclosisPeriod!;
        const { u, s } = cyclosisLoopPoint({ q, phi0: 0.3 }, simTime, eggParams);
        expect(Math.abs(u)).toBeLessThanOrEqual(amp + 1e-9);
        expect(Math.abs(s)).toBeLessThanOrEqual(amp + 1e-9);
        expect(Math.abs(u)).toBeLessThan(1);
        expect(Math.abs(s)).toBeLessThan(1);
      }
    }
    // outer / inner loop amplitudes from q
    const ampOuter = 0.3 + 0.68 * Math.sqrt(1);
    const ampInner = 0.3 + 0.68 * Math.sqrt(0);
    expect(Math.abs(ampOuter - 0.98)).toBeLessThan(1e-9);
    expect(Math.abs(ampInner - 0.3)).toBeLessThan(1e-9);
    // The actual max excursion over a circuit reaches amp.
    let maxAbsU = 0;
    for (let k = 0; k <= 200; k++) {
      const simTime = (k / 200) * eggParams.cyclosisPeriod!;
      const { u } = cyclosisLoopPoint({ q: 1, phi0: 0 }, simTime, eggParams);
      maxAbsU = Math.max(maxAbsU, Math.abs(u));
    }
    expect(maxAbsU).toBeGreaterThan(0.97);
  });

  it("(b) CIRCULATES: returns near start after exactly cyclosisPeriod", () => {
    const T = eggParams.cyclosisPeriod!;
    const g = { q: 0.6, phi0: 1.1 };
    const start = cyclosisLoopPoint(g, 0, eggParams);
    const end = cyclosisLoopPoint(g, T, eggParams);
    expect(Math.abs(end.u - start.u)).toBeLessThan(1e-6);
    expect(Math.abs(end.s - start.s)).toBeLessThan(1e-6);
    // and at half period it is NOT near the start (genuinely circulating)
    const half = cyclosisLoopPoint(g, T / 2, eggParams);
    expect(Math.hypot(half.u - start.u, half.s - start.s)).toBeGreaterThan(0.1);
  });

  it("(c) FRAME-RATE INDEPENDENT: depends only on simTime; phase linear", () => {
    const g = { q: 0.5, phi0: 0.7 };
    // identical simTime => identical output regardless of how we got there
    const at2a = cyclosisLoopPoint(g, 2.0, eggParams);
    const at2b = cyclosisLoopPoint(g, 2.0, eggParams);
    expect(at2a.u).toBe(at2b.u);
    expect(at2a.s).toBe(at2b.s);
    // phase linear in simTime: phase(2t) - phi0 == 2*(phase(t) - phi0)
    const T = eggParams.cyclosisPeriod!;
    const amp = 0.3 + 0.68 * Math.sqrt(g.q);
    const t = 3.0;
    const ph_t = g.phi0 + (TAU / T) * t;
    const ph_2t = g.phi0 + (TAU / T) * (2 * t);
    const exp_t = { u: amp * Math.sin(ph_t), s: amp * Math.sin(ph_t + Math.PI / 2) };
    const exp_2t = { u: amp * Math.sin(ph_2t), s: amp * Math.sin(ph_2t + Math.PI / 2) };
    const got_t = cyclosisLoopPoint(g, t, eggParams);
    const got_2t = cyclosisLoopPoint(g, 2 * t, eggParams);
    expect(Math.abs(got_t.u - exp_t.u)).toBeLessThan(1e-12);
    expect(Math.abs(got_2t.u - exp_2t.u)).toBeLessThan(1e-12);
    expect(Math.abs(got_t.s - exp_t.s)).toBeLessThan(1e-12);
  });

  it("(d) SENSE FLIP: cyclosisSense=-1 reverses circulation direction", () => {
    const g = { q: 0.5, phi0: 0 };
    const dt = 0.01;
    const pPlus = { ...eggParams, cyclosisSense: 1 };
    const pMinus = { ...eggParams, cyclosisSense: -1 };
    // du/dt at small +simTime
    const a0 = cyclosisLoopPoint(g, 0, pPlus);
    const a1 = cyclosisLoopPoint(g, dt, pPlus);
    const b0 = cyclosisLoopPoint(g, 0, pMinus);
    const b1 = cyclosisLoopPoint(g, dt, pMinus);
    const duPlus = a1.u - a0.u;
    const duMinus = b1.u - b0.u;
    expect(Math.sign(duPlus)).toBe(-Math.sign(duMinus));
    expect(duPlus).not.toBe(0);
  });

  it("(e) DECOUPLED FROM SPEED: period uses cyclosisPeriod only, ignores speedNorm", () => {
    const g = { q: 0.4, phi0: 0.2 };
    // changing a (hypothetical) speed field has no effect; the helper signature
    // does not even take speedNorm. Two different period values change the loop
    // closure time, proving the period is the only clock.
    const slow = { ...eggParams, cyclosisPeriod: 60 };
    const fast = { ...eggParams, cyclosisPeriod: 30 };
    const closeSlow = cyclosisLoopPoint(g, 60, slow);
    const startSlow = cyclosisLoopPoint(g, 0, slow);
    const closeFast = cyclosisLoopPoint(g, 30, fast);
    const startFast = cyclosisLoopPoint(g, 0, fast);
    expect(Math.abs(closeSlow.u - startSlow.u)).toBeLessThan(1e-6);
    expect(Math.abs(closeFast.u - startFast.u)).toBeLessThan(1e-6);
  });

  it("(f) buildProfilePts EQUIVALENCE: cache path === inline path, byte-identical", () => {
    const baseR = 40;
    const cx = 100, cy = 100, bodyHeading = 0.4;
    const deform = bodyProfileDeform(96, bodyHeading, baseR, eggParams);
    const profilePts = buildProfilePts(baseR, eggParams);
    const ctxWith: InteriorCtx = {
      cx, cy, baseR, deform, squeezeK: 1, squeezePhi: 0, bodyHeading, params: eggParams, profilePts,
    };
    const ctxWithout: InteriorCtx = {
      cx, cy, baseR, deform, squeezeK: 1, squeezePhi: 0, bodyHeading, params: eggParams,
    };
    for (let i = 0; i <= 12; i++) {
      const u = -0.9 + (1.8 * i) / 12;
      for (let j = 0; j <= 8; j++) {
        const s = -0.9 + (1.8 * j) / 8;
        const a = interiorPoint(u, s, ctxWith);
        const b = interiorPoint(u, s, ctxWithout);
        expect(a[0]).toBe(b[0]);
        expect(a[1]).toBe(b[1]);
      }
    }
  });

  it("(f2) buildProfilePts matches the inline 96-sample build", () => {
    const baseR = 37;
    const pts = buildProfilePts(baseR, eggParams);
    expect(pts.length).toBe(96);
    for (let k = 0; k < 96; k++) {
      const t = (k / 96) * TAU;
      const [px, py] = bodyProfilePoint(t, baseR, eggParams);
      expect(pts[k].ang).toBe(Math.atan2(py, px));
      expect(pts[k].rad).toBe(Math.hypot(px, py));
    }
  });

  it("(g) POLE REACH IN WORLD: q=1 granule trajectory spans most of body length", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.24,
      bodyAspect: 3,
      cyclosisPeriod: 45,
    };
    const baseR = 40;
    const cx = 0, cy = 0, bodyHeading = 0; // heading 0 => body axis along world +x
    const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
    const profilePts = buildProfilePts(baseR, params);
    const ctx: InteriorCtx = {
      cx, cy, baseR, deform, squeezeK: 1, squeezePhi: 0, bodyHeading, params, profilePts,
    };
    const L = baseR * Math.sqrt(params.bodyAspect ?? 3);
    const g = { q: 1, phi0: 0 };
    let minXb = Infinity, maxXb = -Infinity;
    for (let k = 0; k <= 360; k++) {
      const simTime = (k / 360) * params.cyclosisPeriod!;
      const loop = cyclosisLoopPoint(g, simTime, params);
      const [wx] = interiorPoint(loop.u, loop.s, ctx);
      minXb = Math.min(minXb, wx - cx);
      maxXb = Math.max(maxXb, wx - cx);
    }
    // axial extent of the trajectory vs the half-length L
    expect(maxXb / L).toBeGreaterThan(0.8);
    expect(-minXb / L).toBeGreaterThan(0.8);
  });

  it("(h) DETERMINISM: identical args => identical output", () => {
    const g = { q: 0.42, phi0: 1.3 };
    const a = cyclosisLoopPoint(g, 7.25, eggParams);
    const b = cyclosisLoopPoint(g, 7.25, eggParams);
    expect(a.u).toBe(b.u);
    expect(a.s).toBe(b.s);
    const c = buildProfilePts(40, eggParams);
    const d = buildProfilePts(40, eggParams);
    for (let k = 0; k < c.length; k++) {
      expect(c[k].ang).toBe(d[k].ang);
      expect(c[k].rad).toBe(d[k].rad);
    }
  });
});

describe("v3.7C — effectiveCyclosisPeriod (cyclosis × activity)", () => {
  it("boost=0 (default) returns base period regardless of activity", () => {
    const p = { ...CELL_DEFAULTS, cyclosisPeriod: 38 };
    expect(effectiveCyclosisPeriod(0, p)).toBe(38);
    expect(effectiveCyclosisPeriod(0.5, p)).toBe(38);
    expect(effectiveCyclosisPeriod(1.0, p)).toBe(38);
  });

  it("boost=0 explicitly also preserves base period", () => {
    const p = { ...CELL_DEFAULTS, cyclosisPeriod: 38, cyclosisActivityBoost: 0 };
    expect(effectiveCyclosisPeriod(1.0, p)).toBe(38);
  });

  it("boost=0.4 at activity=1.0 gives period / 1.4", () => {
    const p = { ...CELL_DEFAULTS, cyclosisPeriod: 38, cyclosisActivityBoost: 0.4 };
    const result = effectiveCyclosisPeriod(1.0, p);
    expect(result).toBeCloseTo(38 / 1.4, 10);
  });

  it("activity=0 gives base period regardless of boost value", () => {
    const p = { ...CELL_DEFAULTS, cyclosisPeriod: 38, cyclosisActivityBoost: 0.4 };
    expect(effectiveCyclosisPeriod(0, p)).toBe(38);
  });

  it("activity=0.5 with boost=0.4 gives period / 1.2", () => {
    const p = { ...CELL_DEFAULTS, cyclosisPeriod: 38, cyclosisActivityBoost: 0.4 };
    const result = effectiveCyclosisPeriod(0.5, p);
    expect(result).toBeCloseTo(38 / 1.2, 10);
  });

  it("clamps negative activity to 0", () => {
    const p = { ...CELL_DEFAULTS, cyclosisPeriod: 38, cyclosisActivityBoost: 0.4 };
    expect(effectiveCyclosisPeriod(-0.5, p)).toBe(38);
  });

  it("clamps activity > 1 to 1", () => {
    const p = { ...CELL_DEFAULTS, cyclosisPeriod: 38, cyclosisActivityBoost: 0.4 };
    expect(effectiveCyclosisPeriod(1.5, p)).toBeCloseTo(38 / 1.4, 10);
  });

  it("uses default cyclosisPeriod=45 when not specified", () => {
    const p = { ...CELL_DEFAULTS, cyclosisActivityBoost: 0.4 };
    expect(effectiveCyclosisPeriod(1.0, p)).toBeCloseTo(45 / 1.4, 10);
  });
});

describe("Commit 32d — food vacuoles on cyclosis loop", () => {
  const TAU = Math.PI * 2;
  const eggParams: CellParams = {
    ...CELL_DEFAULTS,
    enableBodyProfile: true,
    bodyProfileType: "egg",
    bodyProfileTaper: 0.24,
    bodyAspect: 3,
    bodyVentralBend: 0.18,
    cyclosisPeriod: 45,
  };

  it("(a) seedInteriorFoodVacuoles: gate-independent pure; count entries in range; 0 -> []; deterministic", () => {
    // gate-independent: works with the interior gate off too (it is just seeding).
    const N = 7;
    const fv = seedInteriorFoodVacuoles(N, eggParams);
    expect(fv.length).toBe(N);
    for (const v of fv) {
      expect(v.q).toBeGreaterThanOrEqual(0);
      expect(v.q).toBeLessThanOrEqual(1);
      expect(v.phi0).toBeGreaterThanOrEqual(0);
      expect(v.phi0).toBeLessThan(TAU);
      expect(v.digestPhase).toBeGreaterThanOrEqual(0);
      expect(v.digestPhase).toBeLessThan(1);
    }
    expect(seedInteriorFoodVacuoles(0, eggParams)).toEqual([]);
    // deterministic + gate-independent (same result regardless of enableInteriorField)
    expect(seedInteriorFoodVacuoles(N, eggParams)).toEqual(fv);
    expect(seedInteriorFoodVacuoles(N, { ...eggParams, enableInteriorField: true })).toEqual(fv);
  });

  it("(b) RIDE THE LOOP: a vacuole circulates and closes after cyclosisPeriod", () => {
    const T = eggParams.cyclosisPeriod!;
    const [fv] = seedInteriorFoodVacuoles(3, eggParams);
    const start = cyclosisLoopPoint(fv, 0, eggParams);
    const end = cyclosisLoopPoint(fv, T, eggParams);
    expect(Math.abs(end.u - start.u)).toBeLessThan(1e-6);
    expect(Math.abs(end.s - start.s)).toBeLessThan(1e-6);
    // genuinely circulating: not near the start at half period
    const half = cyclosisLoopPoint(fv, T / 2, eggParams);
    expect(Math.hypot(half.u - start.u, half.s - start.s)).toBeGreaterThan(0.1);
  });

  it("(c) DIGEST SHRINK preserved: size full at digestPhase=0 then shrinks with t", () => {
    const [fv] = seedInteriorFoodVacuoles(1, { ...eggParams });
    // The vacuole uses foodVacuoleSize for its shrink curve (reused unchanged).
    expect(foodVacuoleSize(0, 0, eggParams)).toBeCloseTo(1.0, 9);
    const period = eggParams.foodVacuoleDigestPeriod ?? 30;
    let prev = foodVacuoleSize(0, 0, eggParams);
    for (let k = 1; k <= 20; k++) {
      const t = (k / 20) * period * 0.999;
      const s = foodVacuoleSize(t, 0, eggParams);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      prev = s;
    }
    // and the seeded vacuole carries a valid digest phase used by foodVacuoleSize
    expect(Number.isFinite(foodVacuoleSize(3.0, fv.digestPhase, eggParams))).toBe(true);
  });

  it("(d) POLE REACH + CONTAINMENT via interiorPoint over a circuit", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.24,
      bodyAspect: 3,
      bodyVentralBend: 0.18,
      cyclosisPeriod: 45,
    };
    const baseR = 40;
    const cx = 0, cy = 0, bodyHeading = 0;
    const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
    const profilePts = buildProfilePts(baseR, params);
    const ctx: InteriorCtx = {
      cx, cy, baseR, deform, squeezeK: 1, squeezePhi: 0, bodyHeading, params, profilePts,
    };
    const poly: Array<[number, number]> = [];
    for (let i = 0; i < deform.length; i++) {
      const angle = (i / deform.length) * TAU;
      const r = baseR * (1 + deform[i]);
      poly.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
    const L = baseR * Math.sqrt(params.bodyAspect ?? 3);
    const fv = { q: 1, phi0: 0, digestPhase: 0 };
    let minXb = Infinity, maxXb = -Infinity;
    let allContained = true;
    for (let k = 0; k <= 360; k++) {
      const simTime = (k / 360) * params.cyclosisPeriod!;
      const loop = cyclosisLoopPoint(fv, simTime, params);
      const pt = interiorPoint(loop.u, loop.s, ctx);
      minXb = Math.min(minXb, pt[0] - cx);
      maxXb = Math.max(maxXb, pt[0] - cx);
      // centres inside the membrane polygon (finite drawR poke out of scope)
      if (!pointInPolygon(pt, poly) && minDistToPolyline(pt, poly) > 0.5) {
        allContained = false;
      }
    }
    expect(maxXb / L).toBeGreaterThan(0.8);
    expect(-minXb / L).toBeGreaterThan(0.8);
    expect(allContained).toBe(true);
  });

  it("(e) GATE OFF: legacy disc food-vacuole path renders without throwing", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 120,
      height: 60,
      params: { enableInteriorField: false, enableOrganelles: true, foodVacuoleCount: 7 },
    });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.2, spectrumBins: new Array(32).fill(0.3) });
      }
    }).not.toThrow();
    r.destroy();
    vi.unstubAllGlobals();
  });

  it("(f) RENDER ON: interior-field food vacuoles render finite without throwing", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 120,
      height: 60,
      params: {
        enableInteriorField: true,
        enableOrganelles: true,
        foodVacuoleCount: 7,
        enableBodyProfile: true,
        bodyProfileType: "egg",
        bodyProfileTaper: 0.24,
        bodyAspect: 3,
      },
    });
    expect(() => {
      for (let i = 0; i < 6; i++) {
        r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.3) });
      }
    }).not.toThrow();
    r.destroy();
    vi.unstubAllGlobals();
  });

  it("(g) DETERMINISM: identical args => identical seeding", () => {
    const a = seedInteriorFoodVacuoles(7, eggParams);
    const b = seedInteriorFoodVacuoles(7, eggParams);
    expect(a).toEqual(b);
  });
});

describe("Commit 32e — wall-anchored nuclei + CVs via interiorPoint", () => {
  const TAU = Math.PI * 2;
  const baseR = 40;
  const cx = 100;
  const cy = 100;
  const bodyHeading = 0.6;
  const eggParams: CellParams = {
    ...CELL_DEFAULTS,
    enableBodyProfile: true,
    bodyProfileType: "egg",
    bodyProfileTaper: 0.24,
    bodyAspect: 3,
    bodyVentralBend: 0.18,
  };

  // along-body-axis coordinate of a world point (projection onto the heading dir)
  function axial(pt: [number, number], ox: number, oy: number, heading: number): number {
    return (pt[0] - ox) * Math.cos(heading) + (pt[1] - oy) * Math.sin(heading);
  }

  it("(a) ANCHOR PLACEMENT: macronucleus near centre, CVs near opposite poles, all contained", () => {
    const deform = bodyProfileDeform(96, bodyHeading, baseR, eggParams);
    const profilePts = buildProfilePts(baseR, eggParams);
    const ctx: InteriorCtx = {
      cx, cy, baseR, deform, squeezeK: 1, squeezePhi: bodyHeading, bodyHeading, params: eggParams, profilePts,
    };
    const L = baseR * Math.sqrt(eggParams.bodyAspect ?? 3);
    const poly = membranePolyline({ deform, squeezeK: 1, squeezePhi: bodyHeading, params: eggParams, cx, cy, baseR });

    const macro = interiorPoint(
      eggParams.macronucleusU ?? -0.05, eggParams.macronucleusS ?? 0.1, ctx,
    );
    expect(Math.hypot(macro[0] - cx, macro[1] - cy)).toBeLessThan(0.5 * baseR);
    expect(pointInPolygon(macro, poly)).toBe(true);

    const ant = interiorPoint(eggParams.cvAnteriorU ?? 0.55, eggParams.cvAnteriorS ?? 0.62, ctx);
    const post = interiorPoint(eggParams.cvPosteriorU ?? -0.55, eggParams.cvPosteriorS ?? 0.62, ctx);
    const antAxial = axial(ant, cx, cy, bodyHeading);
    const postAxial = axial(post, cx, cy, bodyHeading);
    // opposite signs along the body axis, each a large fraction of the half-length
    expect(antAxial).toBeGreaterThan(0);
    expect(postAxial).toBeLessThan(0);
    expect(Math.abs(antAxial) / L).toBeGreaterThan(0.45);
    expect(Math.abs(postAxial) / L).toBeGreaterThan(0.45);
    expect(pointInPolygon(ant, poly)).toBe(true);
    expect(pointInPolygon(post, poly)).toBe(true);
  });

  it("(b) CV ANCHORS DISTINCT + POLAR: anterior +u side, posterior -u side", () => {
    const deform = bodyProfileDeform(96, bodyHeading, baseR, eggParams);
    const profilePts = buildProfilePts(baseR, eggParams);
    const ctx: InteriorCtx = {
      cx, cy, baseR, deform, squeezeK: 1, squeezePhi: bodyHeading, bodyHeading, params: eggParams, profilePts,
    };
    const ant = interiorPoint(eggParams.cvAnteriorU ?? 0.55, eggParams.cvAnteriorS ?? 0.62, ctx);
    const post = interiorPoint(eggParams.cvPosteriorU ?? -0.55, eggParams.cvPosteriorS ?? 0.62, ctx);
    // distinct world points
    expect(Math.hypot(ant[0] - post[0], ant[1] - post[1])).toBeGreaterThan(baseR);
    // straddle the centre along the body axis
    expect(axial(ant, cx, cy, bodyHeading)).toBeGreaterThan(0);
    expect(axial(post, cx, cy, bodyHeading)).toBeLessThan(0);
  });

  it("(c) RIDE THE WALL: rotating bodyHeading rotates the anchored world points by ~delta", () => {
    const delta = 0.5;
    const h0 = bodyHeading;
    const h1 = bodyHeading + delta;
    const deform0 = bodyProfileDeform(96, h0, baseR, eggParams);
    const deform1 = bodyProfileDeform(96, h1, baseR, eggParams);
    const pts0 = buildProfilePts(baseR, eggParams);
    const pts1 = buildProfilePts(baseR, eggParams);
    const ctx0: InteriorCtx = {
      cx, cy, baseR, deform: deform0, squeezeK: 1, squeezePhi: h0, bodyHeading: h0, params: eggParams, profilePts: pts0,
    };
    const ctx1: InteriorCtx = {
      cx, cy, baseR, deform: deform1, squeezeK: 1, squeezePhi: h1, bodyHeading: h1, params: eggParams, profilePts: pts1,
    };
    const anchors: Array<[number, number]> = [
      [eggParams.macronucleusU ?? -0.05, eggParams.macronucleusS ?? 0.1],
      [eggParams.cvAnteriorU ?? 0.55, eggParams.cvAnteriorS ?? 0.62],
      [eggParams.cvPosteriorU ?? -0.55, eggParams.cvPosteriorS ?? 0.62],
    ];
    for (const [u, s] of anchors) {
      const p0 = interiorPoint(u, s, ctx0);
      const p1 = interiorPoint(u, s, ctx1);
      const ang0 = Math.atan2(p0[1] - cy, p0[0] - cx);
      const ang1 = Math.atan2(p1[1] - cy, p1[0] - cx);
      let d = ang1 - ang0;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      expect(d).toBeCloseTo(delta, 1);
    }
  });

  it("(d) CONTAINMENT under spin + bend: all anchors inside membrane over a sweep", () => {
    for (const bend of [0, 0.18]) {
      const params: CellParams = { ...eggParams, bodyVentralBend: bend };
      const deform = bodyProfileDeform(96, bodyHeading, baseR, params);
      const profilePts = buildProfilePts(baseR, params);
      const anchors: Array<[number, number]> = [
        [params.macronucleusU ?? -0.05, params.macronucleusS ?? 0.1],
        [(params.macronucleusU ?? -0.05) + 0.12, (params.macronucleusS ?? 0.1) + 0.3],
        [params.cvAnteriorU ?? 0.55, params.cvAnteriorS ?? 0.62],
        [params.cvPosteriorU ?? -0.55, params.cvPosteriorS ?? 0.62],
      ];
      for (let k = 0; k <= 24; k++) {
        const squeezePhi = (k / 24) * TAU;
        const ctx: InteriorCtx = {
          cx, cy, baseR, deform, squeezeK: 1, squeezePhi, bodyHeading, params, profilePts,
        };
        const poly = membranePolyline({ deform, squeezeK: 1, squeezePhi, params, cx, cy, baseR });
        for (const [u, s] of anchors) {
          const pt = interiorPoint(u, s, ctx);
          const ok = pointInPolygon(pt, poly) || minDistToPolyline(pt, poly) < 0.5;
          expect(ok).toBe(true);
        }
      }
    }
  });

  it("(e) GATE OFF: legacy nucleus + CV placement renders without throwing", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 120,
      height: 60,
      params: { ...CELL_DEFAULTS, enableInteriorField: false, enableOrganelles: true, enableVacuoles: true },
    });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.3, spectrumBins: new Array(32).fill(0.3) });
      }
    }).not.toThrow();
    r.destroy();
    vi.unstubAllGlobals();
  });

  it("(f) RENDER ON: interior-field nuclei + CVs render finite without throwing", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 120,
      height: 60,
      params: {
        ...CELL_DEFAULTS,
        enableInteriorField: true,
        enableOrganelles: true,
        enableVacuoles: true,
        enableBodyProfile: true,
        bodyProfileType: "egg",
      },
    });
    expect(() => {
      for (let i = 0; i < 6; i++) {
        r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.4) });
      }
    }).not.toThrow();
    r.destroy();
    vi.unstubAllGlobals();
  });

  it("(g) DETERMINISM: identical args => identical interiorPoint anchor output", () => {
    const deform = bodyProfileDeform(96, bodyHeading, baseR, eggParams);
    const profilePts = buildProfilePts(baseR, eggParams);
    const ctx: InteriorCtx = {
      cx, cy, baseR, deform, squeezeK: 1, squeezePhi: bodyHeading, bodyHeading, params: eggParams, profilePts,
    };
    const a = interiorPoint(eggParams.cvAnteriorU ?? 0.55, eggParams.cvAnteriorS ?? 0.62, ctx);
    const b = interiorPoint(eggParams.cvAnteriorU ?? 0.55, eggParams.cvAnteriorS ?? 0.62, ctx);
    expect(a[0]).toBe(b[0]);
    expect(a[1]).toBe(b[1]);
  });
});

// ---------------------------------------------------------------------------
// v3.7B — oral groove contour indent
// ---------------------------------------------------------------------------

describe("v3.7B — applyOralGroove", () => {
  const N = 96;
  const heading = 0; // body facing right (anterior at angle 0)

  it("is a no-op when enableOralGroove is false (default)", () => {
    const deform = new Array(N).fill(0);
    const original = [...deform];
    const params: CellParams = { ...CELL_DEFAULTS, enableOralGroove: false };
    applyOralGroove(deform, heading, params);
    expect(deform).toEqual(original);
  });

  it("is a no-op when enableOralGroove is undefined (default)", () => {
    const deform = new Array(N).fill(0);
    const original = [...deform];
    const params: CellParams = { ...CELL_DEFAULTS };
    applyOralGroove(deform, heading, params);
    expect(deform).toEqual(original);
  });

  it("creates a concavity (negative dip) when enabled", () => {
    const deform = new Array(N).fill(0);
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableOralGroove: true,
      oralGrooveDepth: 0.04,
      oralGrooveAngle: 1.2,
      oralGrooveWidth: 0.6,
    };
    applyOralGroove(deform, heading, params);
    const minVal = Math.min(...deform);
    expect(minVal).toBeLessThan(0);
    // Max dip should be close to -depth at the centre
    expect(minVal).toBeCloseTo(-0.04, 2);
    // Most entries should be untouched (0)
    const untouched = deform.filter(v => v === 0).length;
    expect(untouched).toBeGreaterThan(N * 0.5);
  });

  it("dip is centred at oralGrooveAngle in body frame", () => {
    const deform = new Array(N).fill(0);
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableOralGroove: true,
      oralGrooveDepth: 0.1,
      oralGrooveAngle: 1.2,
      oralGrooveWidth: 0.6,
    };
    applyOralGroove(deform, heading, params);
    let minIdx = 0;
    for (let i = 1; i < N; i++) {
      if (deform[i] < deform[minIdx]) minIdx = i;
    }
    const deepestAngle = (minIdx / N) * TAU;
    const sampleStep = TAU / N;
    expect(Math.abs(deepestAngle - 1.2)).toBeLessThan(sampleStep * 1.5);
  });

  it("depth scales linearly with oralGrooveDepth", () => {
    const d1 = new Array(N).fill(0);
    const d2 = new Array(N).fill(0);
    const base: CellParams = {
      ...CELL_DEFAULTS,
      enableOralGroove: true,
      oralGrooveAngle: 1.2,
      oralGrooveWidth: 0.6,
    };
    applyOralGroove(d1, heading, { ...base, oralGrooveDepth: 0.04 });
    applyOralGroove(d2, heading, { ...base, oralGrooveDepth: 0.08 });
    const min1 = Math.min(...d1);
    const min2 = Math.min(...d2);
    expect(min2).toBeLessThan(min1);
    expect(min2 / min1).toBeCloseTo(2, 1);
  });

  it("follows bodyHeading rotation", () => {
    const halfPi = Math.PI / 2;
    const d1 = new Array(N).fill(0);
    const d2 = new Array(N).fill(0);
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableOralGroove: true,
      oralGrooveDepth: 0.1,
      oralGrooveAngle: 1.2,
      oralGrooveWidth: 0.6,
    };
    applyOralGroove(d1, 0, params);
    applyOralGroove(d2, halfPi, params);
    let minIdx1 = 0, minIdx2 = 0;
    for (let i = 1; i < N; i++) {
      if (d1[i] < d1[minIdx1]) minIdx1 = i;
      if (d2[i] < d2[minIdx2]) minIdx2 = i;
    }
    const ang1 = (minIdx1 / N) * TAU;
    const ang2 = (minIdx2 / N) * TAU;
    const shift = ((ang2 - ang1) % TAU + TAU) % TAU;
    expect(Math.abs(shift - halfPi)).toBeLessThan(TAU / N * 2);
  });

  it("cosine bell falloff is smooth (no sharp steps)", () => {
    const deform = new Array(N).fill(0);
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableOralGroove: true,
      oralGrooveDepth: 0.1,
      oralGrooveAngle: 1.2,
      oralGrooveWidth: 0.6,
    };
    applyOralGroove(deform, heading, params);
    for (let i = 0; i < N; i++) {
      const next = (i + 1) % N;
      const diff = Math.abs(deform[next] - deform[i]);
      expect(diff).toBeLessThan(0.05);
    }
  });

  it("returns the same array reference (mutates in place)", () => {
    const deform = new Array(N).fill(0);
    const params: CellParams = { ...CELL_DEFAULTS, enableOralGroove: true };
    const result = applyOralGroove(deform, heading, params);
    expect(result).toBe(deform);
  });

  it("works on top of bodyProfileDeform (additive)", () => {
    const baseR = 17;
    const profileParams: CellParams = {
      ...CELL_DEFAULTS,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.27,
      bodyAspect: 3,
    };
    const profileDeform = bodyProfileDeform(N, 0, baseR, profileParams);
    const before = [...profileDeform];
    const grooveParams: CellParams = {
      ...profileParams,
      enableOralGroove: true,
      oralGrooveDepth: 0.04,
    };
    applyOralGroove(profileDeform, 0, grooveParams);
    let anyChanged = false;
    for (let i = 0; i < N; i++) {
      if (profileDeform[i] !== before[i]) {
        anyChanged = true;
        // Each changed entry should be MORE negative (inward dip)
        expect(profileDeform[i]).toBeLessThan(before[i]);
      }
    }
    expect(anyChanged).toBe(true);
  });
});

describe("v3.7D — ectoplasm boundary", () => {
  const W = 200;
  const H = 200;

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
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
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

  it("enableEctoplasm defaults to false (no extra strokes)", () => {
    expect(CELL_DEFAULTS.enableEctoplasm).toBe(false);
  });

  it("ectoplasmFrac defaults to 0.85", () => {
    expect(CELL_DEFAULTS.ectoplasmFrac).toBe(0.85);
  });

  it("ectoplasmAlpha defaults to 0.15", () => {
    expect(CELL_DEFAULTS.ectoplasmAlpha).toBe(0.15);
  });

  it("enableEctoplasm=false (default) → renders without extra stroke", () => {
    const rafCalls = setupRaf();
    const { ctx, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    const strokeBefore = (ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    for (let i = 0; i < 5; i++) {
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    const strokeAfter = (ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    // With ectoplasm OFF we get some stroke calls (membrane), record as baseline
    const defaultStrokes = strokeAfter - strokeBefore;
    r.destroy();
    restore();

    // Now run with enableEctoplasm ON and verify MORE strokes
    const rafCalls2 = setupRaf();
    const { ctx: ctx2, restore: restore2 } = installCtx();
    const container2 = document.createElement("div");
    const r2 = createCellRenderer(container2, {
      width: W, height: H,
      params: { ...CELL_DEFAULTS, enableEctoplasm: true },
    });
    const strokeBefore2 = (ctx2.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    for (let i = 0; i < 5; i++) {
      r2.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls2.length) rafCalls2.shift()!();
    }
    const strokeAfter2 = (ctx2.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    const ectoStrokes = strokeAfter2 - strokeBefore2;
    // enableEctoplasm ON should produce MORE stroke() calls
    expect(ectoStrokes).toBeGreaterThan(defaultStrokes);
    r2.destroy();
    restore2();
  });

  it("enableEctoplasm=true → renders without throwing", () => {
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableEctoplasm: true,
        ectoplasmFrac: 0.85,
        ectoplasmAlpha: 0.15,
      },
    });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.7) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });

  it("ectoplasm uses save/restore (no context leak)", () => {
    const rafCalls = setupRaf();
    const { ctx, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: { ...CELL_DEFAULTS, enableEctoplasm: true },
    });
    for (let i = 0; i < 5; i++) {
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    const saveCalls = (ctx.save as ReturnType<typeof vi.fn>).mock.calls.length;
    const restoreCalls = (ctx.restore as ReturnType<typeof vi.fn>).mock.calls.length;
    // save/restore must be balanced
    expect(saveCalls).toBe(restoreCalls);
    r.destroy();
    restore();
  });

  it("custom ectoplasmFrac/ectoplasmAlpha accepted without error", () => {
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableEctoplasm: true,
        ectoplasmFrac: 0.75,
        ectoplasmAlpha: 0.30,
      },
    });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });

  it("gate-off golden: CELL_DEFAULTS with ectoplasm off renders identically", () => {
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
