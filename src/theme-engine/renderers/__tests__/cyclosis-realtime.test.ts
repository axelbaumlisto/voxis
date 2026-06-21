import { describe, it, expect } from "vitest";
import {
  cyclosisLoopPoint,
  interiorPoint,
  buildProfilePts,
  bodyHeadingStep,
  axialSpin,
  seedInteriorGranules,
  contractileVacuole,
  CELL_DEFAULTS,
  type InteriorCtx,
  type CellParams,
} from "../cell";

// Exact theme config values
const THEME: Partial<CellParams> = {
  cyclosisPeriod: 65,
  cyclosisActivityBoost: 0.4,
  enableInteriorField: true,
  enableBodyProfile: true,
  bodyProfileType: "egg",
  bodyProfileTaper: 0.20,
  bodyAspect: 3,
  bodyVentralBend: 0.18,
  enableAffine: true,
  enableAxialSpin: true,
  axialSpinMax: 1.0,
  baseRadiusPx: 17,
  idleSwimFrac: 0.12,
  bodyHeadingTau: 1.5,
  nucleusAspect: 1.8,
  enableVacuoles: true,
  vacuolePeriod: 7,
  vacuoleMaxFrac: 0.18,
  nucleusAlpha: 0.85,
};
const params: CellParams = { ...CELL_DEFAULTS, ...THEME };
const cx = 210, cy = 210, baseR = 17;
const dt = 1 / 60;
const deform = new Array(96).fill(0);

function simulate(seconds: number) {
  const granules = seedInteriorGranules(40, 0, params);
  const profilePts = buildProfilePts(baseR, params);
  let bodyHeading = 0;
  let simTime = 0;

  // Nucleus fixed body-coords
  const uN = -0.05, sN = 0.1;
  // CV1 fixed body-coords
  const uCV = 0.55, sCV = 0.62;

  const log: {
    t: number;
    granule0: [number, number];
    granule5: [number, number];
    granule10: [number, number];
    nucleus: [number, number];
    cv1: [number, number];
  }[] = [];

  const totalFrames = Math.round(seconds / dt);

  for (let frame = 0; frame <= totalFrames; frame++) {
    if (frame > 0) {
      simTime += dt;
      bodyHeading = bodyHeadingStep(bodyHeading, 0.01, 0.001, dt, params);
    }
    const speedNorm = params.idleSwimFrac ?? 0.12;
    const spinPhi = axialSpin(simTime, speedNorm, params);
    const squeezePhi = bodyHeading + spinPhi;
    const ictx: InteriorCtx = {
      cx, cy, baseR, deform, squeezeK: 1, squeezePhi, bodyHeading, params, profilePts,
    };

    // Sample at 0.5s intervals
    if (frame % 30 === 0) {
      const g0loop = cyclosisLoopPoint(granules[0], simTime, params);
      const g5loop = cyclosisLoopPoint(granules[5], simTime, params);
      const g10loop = cyclosisLoopPoint(granules[10], simTime, params);
      const nloop = { u: uN, s: sN }; // nucleus is wall-anchored, not on cyclosis
      const cvloop = { u: uCV, s: sCV };

      log.push({
        t: simTime,
        granule0: interiorPoint(g0loop.u, g0loop.s, ictx),
        granule5: interiorPoint(g5loop.u, g5loop.s, ictx),
        granule10: interiorPoint(g10loop.u, g10loop.s, ictx),
        nucleus: interiorPoint(nloop.u, nloop.s, ictx),
        cv1: interiorPoint(cvloop.u, cvloop.s, ictx),
      });
    }
  }
  return log;
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

describe("cyclosis real-time object tracking", () => {
  it("prints positions of each object every 0.5s for 10s", () => {
    const log = simulate(10);

    console.log("=== OBJECT POSITIONS (canvas px) ===");
    console.log("t(s) | granule0       | granule5       | granule10      | nucleus        | CV1");
    for (const e of log) {
      const fmt = (p: [number, number]) => `(${p[0].toFixed(1)},${p[1].toFixed(1)})`;
      console.log(
        `${e.t.toFixed(1).padStart(4)} | ${fmt(e.granule0).padEnd(14)} | ${fmt(e.granule5).padEnd(14)} | ${fmt(e.granule10).padEnd(14)} | ${fmt(e.nucleus).padEnd(14)} | ${fmt(e.cv1)}`
      );
    }

    // Measure displacement per 0.5s for each object
    console.log("\n=== DISPLACEMENT per 0.5s (px) ===");
    console.log("t(s) | granule0 | granule5 | granule10 | nucleus | CV1");
    for (let i = 1; i < log.length; i++) {
      const d0 = dist(log[i].granule0, log[i - 1].granule0);
      const d5 = dist(log[i].granule5, log[i - 1].granule5);
      const d10 = dist(log[i].granule10, log[i - 1].granule10);
      const dn = dist(log[i].nucleus, log[i - 1].nucleus);
      const dcv = dist(log[i].cv1, log[i - 1].cv1);
      console.log(
        `${log[i].t.toFixed(1).padStart(4)} | ${d0.toFixed(2).padStart(8)} | ${d5.toFixed(2).padStart(8)} | ${d10.toFixed(2).padStart(9)} | ${dn.toFixed(2).padStart(7)} | ${dcv.toFixed(2)}`
      );
    }

    // ASSERT: no object moves more than 3px per 0.5s (= 6px/s)
    for (let i = 1; i < log.length; i++) {
      const objects = [
        { name: "granule0", d: dist(log[i].granule0, log[i - 1].granule0) },
        { name: "granule5", d: dist(log[i].granule5, log[i - 1].granule5) },
        { name: "granule10", d: dist(log[i].granule10, log[i - 1].granule10) },
        { name: "nucleus", d: dist(log[i].nucleus, log[i - 1].nucleus) },
        { name: "CV1", d: dist(log[i].cv1, log[i - 1].cv1) },
      ];
      for (const obj of objects) {
        expect(obj.d, `${obj.name} at t=${log[i].t.toFixed(1)}s moved ${obj.d.toFixed(2)}px in 0.5s — too fast!`).toBeLessThan(3);
      }
    }
  });
});
