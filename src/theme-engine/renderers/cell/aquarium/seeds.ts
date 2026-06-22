import type { AquariumFrame, AquariumSeedPoint } from "./types";

export function mix32(n: number): number {
  let x = n | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function seededUnit(seed: number, index: number, salt: number): number {
  return mix32(seed ^ Math.imul(index + 1, 0x9e3779b1) ^ salt) / 0x100000000;
}

function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function latticeUnit(seed: number, ix: number, iy: number): number {
  return mix32(seed ^ Math.imul(ix | 0, 0x9e3779b1) ^ Math.imul(iy | 0, 0x85ebca6b)) / 0x100000000;
}

/** Deterministic 2D value noise in [0,1), built from integer lattice hashes. */
export function noise2D(seed: number, x: number, y: number): number {
  const fx = Number.isFinite(x) ? x : 0;
  const fy = Number.isFinite(y) ? y : 0;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothstep01(fx - x0);
  const ty = smoothstep01(fy - y0);
  const v00 = latticeUnit(seed, x0, y0);
  const v10 = latticeUnit(seed, x0 + 1, y0);
  const v01 = latticeUnit(seed, x0, y0 + 1);
  const v11 = latticeUnit(seed, x0 + 1, y0 + 1);
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
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
      x: seededUnit(seed, i, salt) * safeWidth,
      y: seededUnit(seed, i, salt ^ 0x51ed270b) * safeHeight,
      phase: seededUnit(seed, i, salt ^ 0x68bc21eb) * Math.PI * 2,
      size: 0.5 + seededUnit(seed, i, salt ^ 0x02e5be93),
    });
  }
  return points;
}
