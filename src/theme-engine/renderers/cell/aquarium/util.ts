export const TAU = Math.PI * 2;

export function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

export function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, finite(value, 0)));
}

export function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

export function positive(value: number | undefined, fallback: number): number {
  return Math.max(0.001, finiteOr(value, fallback));
}
