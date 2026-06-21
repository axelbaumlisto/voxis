import { affineSqueezePoints } from "../../cell";
import type { CellParams } from "../../cell";

export type Point = [number, number];

export interface MembraneGeometryInput {
  deform: number[];
  squeezeK: number;
  squeezePhi: number;
  params: CellParams;
  cx: number;
  cy: number;
  baseR: number;
}

export function minDistToPolyline(p: Point, poly: Point[]): number {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a[0] + t * dx;
    const qy = a[1] + t * dy;
    const d = Math.hypot(p[0] - qx, p[1] - qy);
    if (d < best) best = d;
  }
  return best;
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect =
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function membranePolyline({
  deform,
  squeezeK,
  squeezePhi,
  params,
  cx,
  cy,
  baseR,
}: MembraneGeometryInput): Point[] {
  const poly: Point[] = [];
  for (let i = 0; i < deform.length; i++) {
    const angle = (i / deform.length) * Math.PI * 2;
    const r = baseR * (1 + deform[i]);
    poly.push(
      affineSqueezePoints(
        [[cx + r * Math.cos(angle), cy + r * Math.sin(angle)]],
        squeezeK,
        squeezePhi,
        cx,
        cy,
        params,
      )[0],
    );
  }
  return poly;
}
