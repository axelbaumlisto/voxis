import { describe, it, expect } from "vitest";
import {
  noise2D, fbm, catmullRom, lowpassRadii, integrateDeformation, hsla, TAU,
  growthLevel, wrapPi, deformAt, deformDerivAt,
} from "../shared";

describe("wrapPi", () => {
  it("is identity inside (-pi, pi]", () => {
    for (const a of [-3, -1, 0, 1, 3, Math.PI]) {
      expect(wrapPi(a)).toBeCloseTo(a, 12);
    }
  });
  it("wraps into (-pi, pi] and is congruent mod 2pi", () => {
    for (const a of [-10, -7, 4, 7, 12, 100]) {
      const w = wrapPi(a);
      expect(w).toBeGreaterThan(-Math.PI - 1e-12);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
      const diff = (a - w) / (Math.PI * 2);
      expect(Math.abs(diff - Math.round(diff))).toBeLessThan(1e-9);
    }
  });
});

describe("shared primitives", () => {
  it("noise2D is deterministic and bounded", () => {
    expect(noise2D(1.5, 2.5)).toBe(noise2D(1.5, 2.5));
    for (let i = 0; i < 50; i++) {
      const v = noise2D(i * 0.37, i * 0.71);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("fbm sums octaves deterministically and stays bounded", () => {
    const v = fbm(0.3, 0.7, 4, 2.0, 0.5);
    expect(v).toBe(fbm(0.3, 0.7, 4, 2.0, 0.5));
    expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
  });
  it("catmullRom passes through control points (closed)", () => {
    const pts: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const out = catmullRom(pts, 4);
    expect(out.length).toBe(pts.length * 4);
    // First emitted point of each span equals the control point (t=0).
    expect(out[0][0]).toBeCloseTo(0); expect(out[0][1]).toBeCloseTo(0);
    expect(out[4][0]).toBeCloseTo(10); expect(out[4][1]).toBeCloseTo(0);
  });
  it("lowpassRadii blends prev toward next", () => {
    expect(lowpassRadii([0], [10], 0)[0]).toBeCloseTo(10); // tension 0 = jump
    expect(lowpassRadii([0], [10], 1)[0]).toBeCloseTo(0);  // tension 1 = frozen
  });
  it("integrateDeformation attack faster than release", () => {
    const up = integrateDeformation([0], [1], 0.5, 0.01)[0];
    const down = integrateDeformation([1], [0], 0.5, 0.01)[0];
    expect(up).toBeCloseTo(0.5);     // grew at attack
    expect(down).toBeGreaterThan(0.98); // relaxed slowly at release
  });
  it("hsla formats a CSS string", () => {
    expect(hsla(120, 0.5, 0.6, 0.8)).toBe("hsla(120,50%,60%,0.8)");
  });
  it("TAU is two pi", () => { expect(TAU).toBeCloseTo(Math.PI * 2); });
});

describe("growthLevel", () => {
  it("rises fast (attack) toward audio during recording", () => {
    const g = growthLevel(0, 1.0, "recording", 0.5, 0.01);
    expect(g).toBeCloseTo(0.5); // moved halfway in one step at attack 0.5
  });
  it("falls slowly (release) toward 0 in silence", () => {
    const g = growthLevel(1.0, 0, "idle", 0.5, 0.01);
    expect(g).toBeGreaterThan(0.98); // barely shrinks at release 0.01
  });
  it("attack faster than release", () => {
    const up = growthLevel(0, 1, "recording", 0.4, 0.02);
    const down = growthLevel(1, 0, "recording", 0.4, 0.02);
    expect(up).toBeGreaterThan(1 - down);
  });
  it("clamps to [0,1]", () => {
    expect(growthLevel(0, 5, "recording", 1, 1)).toBeLessThanOrEqual(1);
    expect(growthLevel(0, -5, "recording", 1, 1)).toBeGreaterThanOrEqual(0);
  });
  it("target is 0 outside recording (transcribing/idle/error)", () => {
    expect(growthLevel(0.5, 1, "transcribing", 0.5, 0.5)).toBeLessThan(0.5);
    expect(growthLevel(0.5, 1, "idle", 0.5, 0.5)).toBeLessThan(0.5);
  });
  it("with release 0, holds its peak forever in silence (stays at last position)", () => {
    let g = 0;
    // grow during speech
    for (let i = 0; i < 40; i++) g = growthLevel(g, 0.8, "recording", 0.05, 0);
    const peak = g;
    expect(peak).toBeGreaterThan(0.3);
    // long silence — must NOT shrink
    for (let i = 0; i < 200; i++) g = growthLevel(g, 0, "idle", 0.05, 0);
    expect(g).toBeCloseTo(peak, 10);
  });
  it("with release 0, can still grow further on a louder later breath", () => {
    let g = growthLevel(0.4, 0.4, "recording", 0.5, 0); // ~0.4
    g = growthLevel(g, 0.9, "recording", 0.5, 0);        // rises toward 0.9
    expect(g).toBeGreaterThan(0.4);
  });
});

describe("deformAt / deformDerivAt (periodic scalar Catmull-Rom)", () => {
  const TWO_PI = Math.PI * 2;
  const deform = [0.3, -0.5, 0.8, 0.1, -0.2, 0.6, -0.9, 0.4];

  it("interpolates exactly through knots", () => {
    const n = deform.length;
    for (let k = 0; k < n; k++) {
      const theta = k * (TWO_PI / n);
      expect(deformAt(theta, deform)).toBeCloseTo(deform[k], 12);
    }
  });

  it("is 2*PI periodic", () => {
    for (const theta of [0.1, 1.0, 2.3, 4.7, -0.8, 5.9]) {
      expect(deformAt(theta + TWO_PI, deform)).toBeCloseTo(
        deformAt(theta, deform), 9,
      );
    }
  });

  it("returns the constant for a constant array, deriv ~0", () => {
    const c = [0.42, 0.42, 0.42, 0.42, 0.42];
    for (const theta of [0, 0.5, 1.7, 3.3, 6.1]) {
      expect(deformAt(theta, c)).toBeCloseTo(0.42, 12);
      expect(deformDerivAt(theta, c)).toBeCloseTo(0, 9);
    }
  });

  it("analytic deriv matches central finite difference", () => {
    const h = 1e-5;
    for (const theta of [0.13, 0.97, 2.41, 3.88, 5.12]) {
      const fd =
        (deformAt(theta + h, deform) - deformAt(theta - h, deform)) / (2 * h);
      expect(deformDerivAt(theta, deform)).toBeCloseTo(fd, 6);
    }
  });

  it("handles empty and single-element arrays", () => {
    expect(deformAt(1.23, [])).toBe(0);
    expect(deformDerivAt(1.23, [])).toBe(0);
    expect(deformAt(1.23, [0.77])).toBe(0.77);
    expect(deformDerivAt(1.23, [0.77])).toBe(0);
  });
});
