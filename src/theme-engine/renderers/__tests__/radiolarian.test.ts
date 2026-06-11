import { describe, it, expect } from "vitest";
import {
  RADIOLARIAN_DEFAULTS, radiolarianEnergy, shellRadius,
} from "../radiolarian";

const P = RADIOLARIAN_DEFAULTS;

describe("radiolarianEnergy", () => {
  it("idle returns a small positive breathing value", () => {
    const e = radiolarianEnergy("idle", 0, 1.0, P);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(0.5);
  });
  it("recording rises with audio level (monotonic-ish)", () => {
    const lo = radiolarianEnergy("recording", 0.1, 1.0, P);
    const hi = radiolarianEnergy("recording", 0.9, 1.0, P);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThanOrEqual(1);
  });
});

describe("shellRadius", () => {
  it("is deterministic", () => {
    expect(shellRadius(1.0, 2.0, 0.3, P)).toBe(shellRadius(1.0, 2.0, 0.3, P));
  });
  it("is N-fold symmetric: r(angle) ≈ r(angle + 2π/symmetry)", () => {
    const t = 3.0, energy = 0.3;
    const step = (Math.PI * 2) / P.symmetry;
    for (let k = 0; k < P.symmetry; k++) {
      const a = 0.4 + k * step;
      expect(shellRadius(a, t, energy, P)).toBeCloseTo(
        shellRadius(0.4, t, energy, P), 5,
      );
    }
  });
  it("stays within a sane band around 1.0 (rigid shell, small bumps)", () => {
    for (let i = 0; i < 60; i++) {
      const r = shellRadius(i * 0.21, 2.0, 0.4, P);
      expect(r).toBeGreaterThan(0.7);
      expect(r).toBeLessThan(1.4);
    }
  });
});
