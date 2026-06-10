// src/theme-engine/renderers/__tests__/smoothing.test.ts
import { describe, it, expect } from "vitest";
import { createSmoother } from "../smoothing";

describe("createSmoother", () => {
  it("converges toward input with alpha", () => {
    const s = createSmoother({ size: 2, alpha: 0.5, peakDecay: 1.0 });
    expect(s.push([1, 0])).toEqual([0.5, 0]);
    expect(s.push([1, 0])).toEqual([0.75, 0]);
  });

  it("pads/truncates input to size", () => {
    const s = createSmoother({ size: 3, alpha: 1.0, peakDecay: 1.0 });
    expect(s.push([1])).toEqual([1, 0, 0]);
    expect(s.push([1, 1, 1, 1])).toEqual([1, 1, 1]);
  });

  it("holds peaks when peakDecay < 1", () => {
    const s = createSmoother({ size: 1, alpha: 1.0, peakDecay: 0.5 });
    expect(s.push([1])).toEqual([1]);
    // input drops to 0; smoothed=0 but peak=0.5 wins
    expect(s.push([0])).toEqual([0.5]);
  });
});
