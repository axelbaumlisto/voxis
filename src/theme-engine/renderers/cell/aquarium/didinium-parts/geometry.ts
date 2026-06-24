import { finite } from "../util";

// ── biology geometry constants (Didinium nasutum) ───────────────────────────
// Stout barrel, aspect ~1.35:1 (length:width). Two transverse ciliary girdles
// (pectinelles): anterior at the shoulder, posterior just below mid-body. A
// conical apical snout (cytostome cone, closed at rest). Dorsal brosse rows.
export const DIDINIUM_ASPECT = 1.42; // length : width (real D. nasutum is an ELONGATE barrel ~1.4:1, not globular)
export const DIDINIUM_GIRDLE_A_U = 0.46; // anterior girdle position (shoulder), u ∈ [-1(post), +1(snout)]
export const DIDINIUM_GIRDLE_P_U = -0.16; // posterior girdle position (just below mid-body)
export const DIDINIUM_SHOULDER_U = 0.49; // where the barrel meets the cone snout (slightly longer visible cone)
export const DIDINIUM_BRUSH_ROWS = 5; // dorsal brushes (brosse) per girdle

/**
 * Display body length (px). SINGLE SOURCE OF TRUTH shared by updateDidinium
 * (speed in body-lengths) and drawDidinium (geometry).
 */
export function didiniumDisplayLength(size: number, scale: number): number {
  const s = Math.max(0.1, finite(scale, 1));
  return Math.max(7, Math.min(34 * s, (16 + finite(size, 1) * 4) * s));
}

/**
 * Normalized barrel half-width profile, peak ≈ 1. u=+1 is the apical snout tip
 * (cone, closed), u=-1 the rounded aboral pole. A flattened anterior shoulder
 * sits just below the cone; the mid-body is the widest; the posterior rounds off.
 */
function bodyShape(u: number): number {
  if (u >= DIDINIUM_SHOULDER_U) {
    // cone snout: half-width eases from the shoulder width down to ~0 at the tip,
    // slightly concave flanks (a cone, not a dome).
    const q = (u - DIDINIUM_SHOULDER_U) / (1 - DIDINIUM_SHOULDER_U); // 0 at shoulder, 1 at tip
    // cone base width MUST equal the body shoulder width (0.72) for a C0/C1-smooth
    // join — a mismatch here read as a kink/notch in the silhouette.
    const wShoulder = 0.72;
    return wShoulder * (0.07 + 0.93 * Math.pow(1 - q, 1.35)); // blunt rounded cone tip, not a needle point
  }
  // ovoid body: moderately narrow anterior shoulder, full belly widest ~40% down,
  // BROADLY ROUNDED posterior (real D. nasutum is plump/egg-shaped, not a flat
  // lemon). Two smooth cosine lobes meet C1-continuously at the belly peak.
  const t = (u - DIDINIUM_SHOULDER_U) / (-1 - DIDINIUM_SHOULDER_U); // 0 at shoulder, 1 at aboral pole
  const tp = 0.45; // widest point, just below mid
  if (t <= tp) {
    return 0.72 + 0.28 * Math.sin((t / tp) * (Math.PI / 2)); // shoulder 0.72 -> belly 1.0
  }
  // belly 1.0 -> ROUNDED aboral DOME: a quarter-circle profile (sqrt) that reaches
  // 0 at the pole with a VERTICAL tangent, i.e. the outline closes as a smooth
  // hemispherical cap (NOT a flat truncated floor, NOT a pointed lemon tip).
  const s = (t - tp) / (1 - tp); // 0 at belly, 1 at aboral pole
  return Math.sqrt(Math.max(0, 1 - s * s));
}

const DIDINIUM_BODY_SHAPE_MAX = (() => {
  let m = 0;
  for (let i = 0; i <= 400; i++) {
    const u = -1 + (i / 400) * 2;
    m = Math.max(m, bodyShape(u));
  }
  return m;
})();

export function didiniumNormHalfWidth(u: number): number {
  return bodyShape(u) / DIDINIUM_BODY_SHAPE_MAX;
}
