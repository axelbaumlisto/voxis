import { describe, it, expect } from "vitest";
import {
  noise2D, fbm, catmullRom, lowpassRadii, integrateDeformation, hsla, TAU,
  growthLevel,
} from "../shared";

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
});
