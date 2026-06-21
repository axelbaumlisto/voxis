import { noise2D, TAU } from "../shared";
import type { CellParams } from "./types";

/**
 * H4 (OPT) — ambient flow field from the body's swimming wake. A low-Reynolds
 * swimmer drags fluid; we model the far field as a 2-D SOURCE DIPOLE (doublet),
 * the potential-flow signature of a translating body:
 *
 *   u(r) = (S / r^2) * [ 2 (e·r̂) r̂ - e ]
 *
 * where `e = (cos heading, sin heading)` is the swim direction and `r = (dx,dy)`
 * is the offset from the cell centre to the sample point. Properties (all
 * exercised by tests): decays as 1/r^2 for a fixed bearing; LINEAR in `e` so it
 * reverses when heading reverses and scales with `strength`; frame-covariant
 * (rotating point+heading rotates the velocity). The r->0 singularity is clamped
 * to a small core so the field stays finite. Pure & deterministic.
 */
export function dipoleFlowAt(
  dx: number,
  dy: number,
  heading: number,
  strength: number,
): { vx: number; vy: number } {
  if (strength === 0) return { vx: 0, vy: 0 };
  const CORE2 = 4; // clamp r^2 to >= 2px core so the doublet stays bounded
  const r2 = Math.max(CORE2, dx * dx + dy * dy);
  const r = Math.sqrt(r2);
  const rxh = dx / r, ryh = dy / r;          // r̂
  const ex = Math.cos(heading), ey = Math.sin(heading); // e
  const edotr = ex * rxh + ey * ryh;         // e·r̂
  const k = strength / r2;
  return {
    vx: k * (2 * edotr * rxh - ex),
    vy: k * (2 * edotr * ryh - ey),
  };
}

/**
 * H4 (OPT) — advance one ambient mote by the local dipole flow for `dt`
 * (memoryless, low-Re: position += velocity*dt, no inertia). Motes that leave
 * the tank wrap toroidally so the field never depletes. Pure & deterministic.
 */
export function advectMote(
  mote: { x: number; y: number },
  cx: number,
  cy: number,
  heading: number,
  strength: number,
  dt: number,
  width: number,
  height: number,
  params: CellParams,
): { x: number; y: number } {
  const v = dipoleFlowAt(mote.x - cx, mote.y - cy, heading, strength * (params.flowStrength ?? 1));
  const wrap = (val: number, span: number) => {
    if (span <= 0) return 0;
    return ((val % span) + span) % span;
  };
  return {
    x: wrap(mote.x + v.vx * dt, width),
    y: wrap(mote.y + v.vy * dt, height),
  };
}

/**
 * H4 (OPT) — deterministic initial scatter of `flowMoteCount` motes across the
 * tank (value-noise seeded, so the same geometry always reproduces the same
 * field). Returns [] when the count is 0. Pure.
 */
export function seedMotes(width: number, height: number, params: CellParams): { x: number; y: number }[] {
  const n = Math.max(0, Math.floor(params.flowMoteCount ?? 0));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    // two decorrelated seeds per mote -> uniform-ish coverage, fully deterministic.
    const ux = (noise2D(i * 12.9898 + 3.1, 78.233) + 1) * 0.5;
    const uy = (noise2D(i * 39.346 + 7.7, 11.135) + 1) * 0.5;
    out.push({ x: ux * width, y: uy * height });
  }
  return out;
}

/**
 * Commit 27 — cytoplasmic streaming (cyclosis) velocity field. A rigid-rotation
 * field `u(dx,dy) = omega*(-dy, dx)` is EXACTLY divergence-free
 * (∂(-omega·dy)/∂dx + ∂(omega·dx)/∂dy = 0) and tangent to circles about the
 * centre, so `u·r = 0` (no radial flux) and `u·n = 0` at a circular wall. A
 * granule advected by this field stays on its circle, giving a stable closed
 * cyclosis loop. omega>0 is counterclockwise. Pure & deterministic.
 */
export function cyclosisField(dx: number, dy: number, omega: number): { vx: number; vy: number } {
  return { vx: -omega * dy, vy: omega * dx };
}

/**
 * Commit 27 — deterministic scatter of `cyclosisGranuleCount` granules as
 * BODY-FRAME offsets (relative to the centre) within
 * `granuleMaxRadiusFrac*baseR`. Two decorrelated value-noise seeds per granule
 * (→ angle + radius); the radius uses a sqrt for an area-uniform disc fill.
 * Returns [] when the gate is off or the count is 0. Pure & deterministic.
 */
export function seedGranules(baseR: number, params: CellParams): Array<{ x: number; y: number }> {
  if (!params.enableCyclosis) return [];
  const n = Math.max(0, Math.floor(params.cyclosisGranuleCount ?? 0));
  if (n === 0) return [];
  const maxRad = Math.max(0, params.granuleMaxRadiusFrac ?? 0.75) * Math.max(0, baseR);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const ang = (noise2D(i * 12.9898 + 1.7, 78.233) + 1) * Math.PI; // [0, 2PI]
    // sqrt of a [0,1] sample -> area-uniform fill of the disc.
    const rad = Math.sqrt((noise2D(i * 39.346 + 5.3, 11.135) + 1) * 0.5) * maxRad;
    out.push({ x: rad * Math.cos(ang), y: rad * Math.sin(ang) });
  }
  return out;
}

/**
 * Commit 27 — advance one granule's BODY-FRAME offset by the cyclosis rotation
 * field for `dt`. omega = TAU / max(0.1, cyclosisPeriod). Explicit Euler on a
 * rotation drifts outward by O(dt²); we renormalise the radius back to its prior
 * magnitude so the granule stays exactly on its circle (no spiral-out/collapse).
 * The body-frame radius is clamped to granuleMaxRadiusFrac*baseR. Pure &
 * deterministic; angular speed is fixed by cyclosisPeriod (frame-rate
 * independent in the sense that the same simTime path yields the same loop).
 */
export function advectGranule(
  g: { x: number; y: number },
  baseR: number,
  dt: number,
  params: CellParams,
): { x: number; y: number } {
  const omega = TAU / Math.max(0.1, params.cyclosisPeriod ?? 45);
  const v = cyclosisField(g.x, g.y, omega);
  const nx = g.x + v.vx * dt;
  const ny = g.y + v.vy * dt;
  const maxRad = Math.max(0, params.granuleMaxRadiusFrac ?? 0.75) * Math.max(0, baseR);
  const r0 = Math.min(Math.hypot(g.x, g.y), maxRad);
  const r1 = Math.hypot(nx, ny) || 1;
  const s = r0 / r1;
  return { x: nx * s, y: ny * s };
}
