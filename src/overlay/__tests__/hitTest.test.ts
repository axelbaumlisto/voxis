import { describe, it, expect } from "vitest";
import { isOpaqueAt } from "../hitTest";

describe("isOpaqueAt", () => {
  it("returns true when alpha >= threshold", () => {
    // 2x2 RGBA image: pixel (0,1) has alpha 200
    const data = new Uint8ClampedArray([
      0,0,0,255,  0,0,0,10,
      0,0,0,5,    0,0,0,200,
    ]);
    expect(isOpaqueAt(data, 2, 0, 0)).toBe(true);   // alpha 255 >= 10
    expect(isOpaqueAt(data, 2, 1, 1)).toBe(true);   // alpha 200 >= 10
  });

  it("returns false when alpha < threshold", () => {
    const data = new Uint8ClampedArray([
      0,0,0,255,  0,0,0,9,
      0,0,0,5,    0,0,0,200,
    ]);
    expect(isOpaqueAt(data, 2, 1, 0)).toBe(false);  // alpha 9 < 10
    expect(isOpaqueAt(data, 2, 0, 1)).toBe(false);  // alpha 5 < 10
  });

  it("returns false for out-of-bounds x<0", () => {
    const data = new Uint8ClampedArray([0,0,0,255]);
    expect(isOpaqueAt(data, 1, -1, 0)).toBe(false);
  });

  it("returns false for out-of-bounds y<0", () => {
    const data = new Uint8ClampedArray([0,0,0,255]);
    expect(isOpaqueAt(data, 1, 0, -1)).toBe(false);
  });

  it("returns false for out-of-bounds x>=width", () => {
    const data = new Uint8ClampedArray([0,0,0,255, 0,0,0,255]);
    expect(isOpaqueAt(data, 2, 2, 0)).toBe(false);
  });

  it("returns false when computed index exceeds data length", () => {
    // data has 4 bytes (1 pixel), but we query out-of-range y
    const data = new Uint8ClampedArray([0,0,0,255]);
    expect(isOpaqueAt(data, 1, 0, 1)).toBe(false);
  });

  it("respects custom threshold", () => {
    const data = new Uint8ClampedArray([0,0,0,128]);
    expect(isOpaqueAt(data, 1, 0, 0, 100)).toBe(true);
    expect(isOpaqueAt(data, 1, 0, 0, 200)).toBe(false);
  });
});
