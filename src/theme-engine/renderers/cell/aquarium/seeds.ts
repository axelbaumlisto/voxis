import type { AquariumFrame, AquariumSeedPoint } from "./types";

function mix32(n: number): number {
  let x = n | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function unit(seed: number, index: number, salt: number): number {
  return mix32(seed ^ Math.imul(index + 1, 0x9e3779b1) ^ salt) / 0x100000000;
}

export function seedPoints(
  count: number,
  seed: number,
  frame: AquariumFrame,
  salt: number,
): AquariumSeedPoint[] {
  if (count <= 0) return [];
  const points: AquariumSeedPoint[] = [];
  const safeWidth = Math.max(0, frame.width);
  const safeHeight = Math.max(0, frame.height);
  for (let i = 0; i < count; i++) {
    points.push({
      x: unit(seed, i, salt) * safeWidth,
      y: unit(seed, i, salt ^ 0x51ed270b) * safeHeight,
      phase: unit(seed, i, salt ^ 0x68bc21eb) * Math.PI * 2,
      size: 0.5 + unit(seed, i, salt ^ 0x02e5be93),
    });
  }
  return points;
}
