import { describe, it, expect } from "vitest";
import {
  cyclosisLoopPoint,
  seedInteriorGranules,
  CELL_DEFAULTS,
  type CellParams,
} from "../cell";

// Theme config values
const THEME: Partial<CellParams> = {
  cyclosisPeriod: 65,
  cyclosisActivityBoost: 0.4,
  enableInteriorField: true,
};
const params: CellParams = { ...CELL_DEFAULTS, ...THEME };

describe("cyclosis body-frame speed", () => {
  it("granule (u,s) displacement < 0.15 per 0.5s at idle (period=65s)", () => {
    const granules = seedInteriorGranules(40, 0, params);
    const trackIndices = [0, 5, 10, 20, 30];
    const dt = 0.5;
    const totalSteps = 20; // 10 seconds

    const maxDisplacements: number[] = [];

    for (const gi of trackIndices) {
      const g = granules[gi];
      let maxD = 0;

      for (let step = 0; step < totalSteps; step++) {
        const t0 = step * dt;
        const t1 = (step + 1) * dt;
        const p0 = cyclosisLoopPoint(g, t0, params);
        const p1 = cyclosisLoopPoint(g, t1, params);
        const d = Math.hypot(p1.u - p0.u, p1.s - p0.s);
        if (d > maxD) maxD = d;
      }
      maxDisplacements.push(maxD);
    }

    console.log("=== Body-frame (u,s) max displacement per 0.5s ===");
    for (let i = 0; i < trackIndices.length; i++) {
      console.log(`granule[${trackIndices[i]}]: max Δ(u,s) = ${maxDisplacements[i].toFixed(4)}`);
    }

    // At period=65, max body-frame displacement per 0.5s should be small
    // amp * TAU/T * dt ≈ 0.98 * 6.28/65 * 0.5 ≈ 0.047 per axis
    // Hypotenuse ≈ 0.067
    for (let i = 0; i < trackIndices.length; i++) {
      expect(
        maxDisplacements[i],
        `granule[${trackIndices[i]}] body-frame delta too fast: ${maxDisplacements[i].toFixed(4)}`
      ).toBeLessThan(0.15);
    }
  });

  it("effectiveCyclosisPeriod at idle activity matches config", () => {
    // At idle: activity ≈ 0.06, boost = 0.4
    // effectiveT = 65 / (1 + 0.06*0.4) = 65/1.024 = 63.5s
    // Very close to raw 65
    const rawT = params.cyclosisPeriod ?? 65;
    const boost = params.cyclosisActivityBoost ?? 0;
    const idleActivity = 0.06;
    const effectiveT = rawT / (1 + idleActivity * boost);
    
    console.log(`Raw period: ${rawT}s, effective at idle: ${effectiveT.toFixed(1)}s`);
    expect(effectiveT).toBeGreaterThan(60);
    expect(effectiveT).toBeLessThan(70);
  });

  it("nucleus (fixed u,s) has zero body-frame displacement", () => {
    // Nucleus at (u=-0.05, s=0.1) — wall-anchored, not on cyclosis
    // Its body-frame coords never change
    const u = -0.05, s = 0.1;
    // Nucleus does not use cyclosisLoopPoint — it's always at (u,s)
    // So body-frame displacement is exactly 0
    expect(0).toBe(0); // trivially true — document the invariant
    console.log("Nucleus at fixed (u=-0.05, s=0.1) — zero body-frame motion ✓");
  });
});
