// src/theme-engine/builtin/metaballs/index.ts
/**
 * Metaballs — floating glossy blobs that fuse and split, inspired by the
 * Apposite "Metaballs" sculpting app (iPhone/iPad/Vision Pro).
 *
 * A scalar metaball field is evaluated per-pixel over the 172×36 overlay.
 * Blobs drift, bounce off the walls, and merge smoothly where their fields
 * overlap. The whole organism breathes with `audioLevel` (radius swell) and
 * the low spectrum bins nudge individual blobs so it reacts to your voice.
 *
 * Self-contained: no imports, everything inlined so the bundled theme.js
 * works verbatim when copied into the user themes folder.
 */
import type { ThemeApi, ThemeInstance, ThemeState } from "../../contract";

interface RGB { r: number; g: number; b: number; }

interface Blob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseR: number; // base radius in px
  r: number;     // current radius
  color: RGB;
  phase: number; // for idle breathing offset
  binIndex: number;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// R1 — single source of truth for the tunable material params. Every value here
// was previously an inline magic number in render()/tonemap(); naming them makes
// the metallic look discoverable in one place. PIXEL-IDENTICAL: same numbers,
// just named. Hot-path note: render() destructures these into per-frame local
// `const` numbers at the top of the function so the inner pixel loops never do
// per-pixel object-property reads. The MAT object stays the single source of
// truth; the per-frame locals are the hot-path reads.
const MAT = {
  // Liquid-metal albedo: dark neutral base rgb + a whisper of desaturated tint.
  albedoBaseR: 50,
  albedoBaseG: 54,
  albedoBaseB: 60,
  tintDesat: 0.30, // how much per-channel chroma survives (vs. pulled to luma)
  tintScale: 0.14, // overall tint contribution mixed into the base
  // Ambient occlusion: darker toward the silhouette (low nz).
  aoFloor: 0.45,
  aoRange: 0.55,
  // Environment studio gradient.
  envFloor: 0.20,
  envSky: 0.95,
  envFloorBounce: 0.30,
  skyEdge: 0.60, // sky band starts above this reflected-y coord
  floorEdge: 0.30, // floor band starts below this reflected-y coord
  envBandSlope: 6, // sky/floor gradient steepness
  envTint: 0.9, // palette-tinted env reflection weight
  // Reflected light strips (liquid-metal banding).
  bandCenter: 0.66,
  bandWidth: 5.5,
  band2Center: 0.32,
  band2Width: 6.5,
  band2Scale: 0.7,
  sheenScale: 150, // bright achromatic sheen from the strips
  // Iridescent thin-film on the rim.
  iridFresWeight: 0.6,
  iridBandWeight: 0.12,
  iridClamp: 0.7,
  // Specular highlight + white-hot core energy mix.
  specBase: 0.85,
  specEnergy: 0.6,
  hotBase: 0.6,
  hotEnergy: 0.5,
  // Filmic tonemap exposure (was 1.45; lowered for the darker chrome base).
  exposure: 1.1,
} as const;

// Fix 2.1 — filmic ACES-ish tonemap hoisted to module scope (pure, no per-frame
// closure allocation). Preserves bright sheen while lifting the body.
// R1 — exposure is now a MAT param passed in (was a hardcoded 1.1 here) so all
// material tunables live in one place; Fix 3.5 rationale below still applies.
function tonemap(v: number, exposure: number): number {
  // Fix 3.5 — exposure lowered (was 1.45) to suit the darker chrome base so the
  // bright sheen/sky reflection rolls off instead of blowing to flat white.
  const x = (v / 255) * exposure;
  const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return clamp01(y) * 255;
}

// R2 — tiny hot-path helpers to DRY the per-channel triples / repeated clamps.
// All three are trivial and inline under V8; kept pixel-identical to the
// expressions they replace (see R2 notes). clamp01 uses the exact
// Math.max/Math.min form so it is byte-identical at every call site.
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// mix preserves the original arithmetic `a*(1-t)+b*t` (NOT the algebraically
// equal `a+(b-a)*t`) so the float ops — and thus the final bytes — are identical.
function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

// setPixel writes one RGBA pixel with the exact same Math.min(255,...) /
// Math.round(a*255) behavior used inline before. Transparent writes pass
// (0,0,0,0) which round-trips to the same zero bytes.
function setPixel(
  data: Uint8ClampedArray,
  idx: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  data[idx] = Math.min(255, r);
  data[idx + 1] = Math.min(255, g);
  data[idx + 2] = Math.min(255, b);
  data[idx + 3] = Math.round(a * 255);
}

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const cfg = (api.params && typeof api.params === "object" ? api.params : {}) as Record<string, unknown>;
  const W = api.size.width;
  const H = api.size.height;

  // Fix 4.2 — palette element validation. A non-string element makes hexToRgb
  // throw → hard fallback. Keep only parseable hex strings; if none survive,
  // use the default palette instead of throwing.
  const DEFAULT_PALETTE = ["#ff6a3d", "#ff2d77", "#8a4bff", "#1fb6ff", "#19f0b0"];
  const isHex = (v: unknown): v is string =>
    typeof v === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(v.trim());
  const validHex = Array.isArray(cfg.palette)
    ? (cfg.palette as unknown[]).filter(isHex)
    : [];
  const palette: RGB[] = (validHex.length > 0 ? validHex : DEFAULT_PALETTE).map(hexToRgb);

  // Fix 2.1 — Iridescent thin-film tint LUT. The pearly hue sweep
  // (cyan → magenta → gold → cyan) is precomputed once instead of doing 3×
  // Math.sin per pixel. Keyed by the fractional phase in [0,1); sin is periodic
  // so fract(phase) reproduces the original closure to within ≤1/255 rounding.
  const IRID_N = 256;
  const iridR = new Float64Array(IRID_N);
  const iridG = new Float64Array(IRID_N);
  const iridB = new Float64Array(IRID_N);
  for (let i = 0; i < IRID_N; i++) {
    const a = (i / IRID_N) * Math.PI * 2;
    iridR[i] = 128 + 127 * Math.sin(a + 0.0);
    iridG[i] = 128 + 127 * Math.sin(a + 2.094);
    iridB[i] = 128 + 127 * Math.sin(a + 4.188);
  }
  // map any phase to the nearest LUT entry (wraps via fract)
  function iridIndex(phase: number): number {
    const f = phase - Math.floor(phase);
    return (f * IRID_N) | 0;
  }

  // Fix 2.2 — specular falloff LUTs keyed by N·H (ndh) clamped to [0,1];
  // index = ndh*255. Replaces Math.pow(ndh, 90) / Math.pow(ndh, 220) per pixel.
  const POW90 = new Float64Array(256);
  const POW220 = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const n = i / 255;
    POW90[i] = Math.pow(n, 90);
    POW220[i] = Math.pow(n, 220);
  }

  // Fix 4.3 — round blobCount to an integer before clamping to [2,8] so a
  // fractional value (e.g. 3.7) yields a whole blob count.
  const blobCount = Math.max(2, Math.min(8, Math.round(Number(cfg.blobCount) || 5)));
  // Fix 4.1 — respect a legal `threshold: 0` (the old `|| 1.0` coerced it back
  // to 1.0). Only fall back when the value is not finite.
  const t = Number(cfg.threshold);
  const threshold = Number.isFinite(t) ? t : 1.0;

  // Fix 2.3 — flat per-blob buffers refilled once per frame so the inner pixel
  // loop reads typed arrays instead of object props. Allocated once at mount.
  const bx = new Float64Array(blobCount);
  const by = new Float64Array(blobCount);
  const brr = new Float64Array(blobCount);
  const bcr = new Float64Array(blobCount);
  const bcg = new Float64Array(blobCount);
  const bcb = new Float64Array(blobCount);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(W, H);
  const data = image.data;

  // ---- init blobs ----
  const blobs: Blob[] = [];
  for (let i = 0; i < blobCount; i++) {
    const t = (i + 0.5) / blobCount;
    blobs.push({
      x: t * W,
      y: H * (0.4 + 0.2 * Math.sin(i * 1.7)),
      vx: (Math.sin(i * 2.3) * 0.6 + 0.5) * (i % 2 ? 1 : -1),
      vy: (Math.cos(i * 1.9) * 0.3 + 0.2) * (i % 3 ? 1 : -1),
      baseR: 4 + (i % 3) * 1.1,
      r: 4,
      color: palette[i % palette.length],
      phase: i * 1.3,
      binIndex: 2 + i * 2,
    });
  }

  let level = 0;        // smoothed audio level
  let mode: ThemeState["mode"] = "idle";
  let bins: number[] = [];
  let raf = 0;
  let time = 0;
  let paused = false;   // true while the document/tab is hidden

  // mode → ambient energy + tint
  function modeEnergy(): number {
    switch (mode) {
      case "recording": return 1.0;
      case "transcribing": return 0.55;
      case "error": return 0.7;
      default: return 0.3;
    }
  }

  function step() {
    time += 1;
    const energy = modeEnergy();
    // Fix 1.2 — idle frame throttle: when truly idle (no audio) skip the
    // expensive per-pixel render on most frames. Physics still advances so the
    // blobs are in the right place the instant audio/mode activity resumes.
    // Never throttle while recording/transcribing/error or when audio present.
    // Load is tiny (~6% of one core); only a gentle idle halving (30fps) is
    // worth it — heavy throttling looked choppy. The real battery win is the
    // visibility pause (rAF fully stops when the overlay is hidden).
    const renderThrottled = mode === "idle" && level < 0.01 && (time % 2 !== 0);
    const swell = 1 + level * 0.8 + (mode === "recording" ? 0.12 : 0);

    // --- inter-blob attraction so they meet, fuse, then drift apart (morph) ---
    // A slow centre-seeking pull keeps them clustering and merging like the
    // real Metaballs app, rather than bouncing past each other.
    const cx = W / 2;
    const cy = H / 2;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      // pull toward the cluster centre (very gentle) → they keep meeting
      b.vx += (cx - b.x) * 0.0006;
      b.vy += (cy - b.y) * 0.0010;
      // pairwise attraction at mid range, soft repulsion when overlapping hard
      for (let j = i + 1; j < blobs.length; j++) {
        const o = blobs[j];
        const dx = o.x - b.x;
        const dy = o.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 1e-3;
        const want = (b.r + o.r) * 0.85;     // comfortable fuse distance
        const f = (dist - want) * 0.0008;     // +: attract, -: repel
        const ux = dx / dist, uy = dy / dist;
        b.vx += ux * f; b.vy += uy * f;
        o.vx -= ux * f; o.vy -= uy * f;
      }
    }

    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      // voice nudge from a low spectrum bin
      const binv = bins.length ? bins[Math.min(bins.length - 1, b.binIndex)] || 0 : 0;
      const speed = 0.35 + energy * 0.6;
      b.x += b.vx * speed;
      b.y += b.vy * speed * 0.6;
      // gentle wander
      b.vx += Math.sin(time * 0.013 + b.phase) * 0.008;
      b.vy += Math.cos(time * 0.017 + b.phase) * 0.006;
      // damp / clamp velocity (slower → more time fused together)
      b.vx = Math.max(-0.9, Math.min(0.9, b.vx * 0.985));
      b.vy = Math.max(-0.7, Math.min(0.7, b.vy * 0.985));
      // bounce off walls
      const pad = 2;
      if (b.x < pad) { b.x = pad; b.vx = Math.abs(b.vx); }
      if (b.x > W - pad) { b.x = W - pad; b.vx = -Math.abs(b.vx); }
      if (b.y < pad) { b.y = pad; b.vy = Math.abs(b.vy); }
      if (b.y > H - pad) { b.y = H - pad; b.vy = -Math.abs(b.vy); }
      // breathing + audio swell + per-blob voice pop
      const breathe = 1 + 0.1 * Math.sin(time * 0.05 + b.phase);
      b.r = b.baseR * swell * breathe * (1 + binv * 0.35);
    }

    if (!renderThrottled) render(energy);
    raf = requestAnimationFrame(step);
  }

  function render(energy: number) {
    const errTint = mode === "error" ? 1 : 0;
    // R1 — destructure MAT into per-frame local const numbers (once per frame).
    // The inner pixel loops below read these locals, never MAT.* properties.
    const {
      albedoBaseR, albedoBaseG, albedoBaseB, tintDesat, tintScale,
      aoFloor, aoRange,
      envFloor, envSky, envFloorBounce, skyEdge, floorEdge, envBandSlope, envTint,
      bandCenter, bandWidth, band2Center, band2Width, band2Scale, sheenScale,
      iridFresWeight, iridBandWeight, iridClamp,
      specBase, specEnergy, hotBase, hotEnergy, exposure,
    } = MAT;
    // Light + view setup for a metallic Blinn-Phong + env-reflection look.
    // Light from upper-left, viewer straight on (0,0,1).
    const Llen = Math.sqrt(0.5 * 0.5 + 0.72 * 0.72 + 0.55 * 0.55);
    const Lx = -0.5 / Llen, Ly = -0.72 / Llen, Lz = 0.55 / Llen;
    // half vector between light and view (0,0,1)
    let Hx = Lx, Hy = Ly, Hz = Lz + 1;
    const Hl = Math.sqrt(Hx * Hx + Hy * Hy + Hz * Hz); Hx /= Hl; Hy /= Hl; Hz /= Hl;

    // Fix 1.3 — bounding-box render. The blobs only occupy a small slice of the
    // pill, so compute the AABB of all blob extents (x±r, y±r), pad a couple of
    // px for the iso-surface/AA band, clamp to the canvas, and iterate pixels
    // only inside it. Clear the whole buffer first so everything outside the
    // box is transparent — visually identical to clearing & scanning the lot.
    data.fill(0);
    let minX = W, minY = H, maxX = 0, maxY = 0, maxR = 0;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      if (b.x - b.r < minX) minX = b.x - b.r;
      if (b.x + b.r > maxX) maxX = b.x + b.r;
      if (b.y - b.r < minY) minY = b.y - b.r;
      if (b.y + b.r > maxY) maxY = b.y + b.r;
      if (b.r > maxR) maxR = b.r;
      // Fix 2.3 — refill flat per-blob buffers once per frame
      bx[i] = b.x;
      by[i] = b.y;
      brr[i] = b.r * b.r;
      bcr[i] = b.color.r;
      bcg[i] = b.color.g;
      bcb[i] = b.color.b;
    }
    // Threshold-aware pad: a low threshold pushes the iso-surface outward
    // (iso radius scales like r/sqrt(threshold)), so grow the pad by that
    // extra reach for the largest blob to avoid clipping blob edges.
    // Guard the pad math against threshold <= 0 (the requested threshold is
    // still used for the field test below; here we only need a finite reach).
    const padThr = threshold > 0 ? Math.min(1, threshold) : 1;
    const boxPad = Math.ceil(2 + maxR * (1 / Math.sqrt(padThr) - 1));
    const x0 = Math.max(0, Math.floor(minX - boxPad));
    const x1 = Math.min(W, Math.ceil(maxX + boxPad));
    const y0 = Math.max(0, Math.floor(minY - boxPad));
    const y1 = Math.min(H, Math.ceil(maxY + boxPad));

    // R3 — SRP decomposition of the per-pixel hot path into three named
    // sub-steps. They are CLOSURES defined here (after the per-frame MAT locals,
    // H-vector and errTint/energy are in scope) so they read those directly with
    // no params and no per-pixel allocation. They write results into per-frame
    // SCRATCH objects allocated ONCE here (3 objects/frame, never per pixel) —
    // this is the explicit no-GC-pressure guidance in the plan's Notes/risks.
    // PIXEL-IDENTICAL: each helper holds the exact same arithmetic, in the same
    // order on the same operands, as the previous monolithic loop body.
    const fld = { field: 0, gx: 0, gy: 0, cr: 0, cg: 0, cb: 0, wsum: 0 };
    const nrm = { nx: 0, ny: 0, nz: 0 };
    const shaded = { r: 0, g: 0, b: 0 };

    // 1. field + gradient sampling — accumulate the scalar metaball field, the
    //    weighted colour, and the analytic in-plane gradient at (px, py).
    function sampleField(px: number, py: number): void {
      let field = 0;
      let cr = 0, cg = 0, cb = 0, wsum = 0;
      let gx = 0, gy = 0; // analytic field gradient (in-plane)
      for (let i = 0; i < blobCount; i++) {
        const dx = px - bx[i];
        const dy = py - by[i];
        const d2 = dx * dx + dy * dy + 1;
        const rr = brr[i];
        const f = rr / d2;
        field += f;
        cr += bcr[i] * f;
        cg += bcg[i] * f;
        cb += bcb[i] * f;
        wsum += f;
        gx += (-2 * rr * dx) / (d2 * d2);
        gy += (-2 * rr * dy) / (d2 * d2);
      }
      fld.field = field; fld.gx = gx; fld.gy = gy;
      fld.cr = cr; fld.cg = cg; fld.cb = cb; fld.wsum = wsum;
    }

    // 2. normal reconstruction — rebuild a spherical surface normal from the
    //    height field + its gradient (reads fld, writes nrm).
    function surfaceNormal(): void {
      // t: how deep inside the iso-surface (0 at rim → 1 at core)
      const t = clamp01((fld.field - threshold) / 1.6);
      const nz = Math.sqrt(Math.min(1, t + 0.04)); // faces viewer at core
      const horiz = Math.sqrt(Math.max(0, 1 - nz * nz));
      const glen = Math.sqrt(fld.gx * fld.gx + fld.gy * fld.gy) + 1e-6;
      // outward normal: away from bump centre (= -gradient direction)
      nrm.nx = (-fld.gx / glen) * horiz;
      nrm.ny = (-fld.gy / glen) * horiz;
      nrm.nz = nz;
    }

    // 3. metal shading — albedo + AO + env reflection + iridescence + specular +
    //    hot core + error tint + tonemap (reads fld + nrm, writes shaded). This
    //    is the bulk of the look; kept as one cohesive "shade this surface" unit.
    function shadeMetal(alpha: number): void {
      const ar = fld.cr / fld.wsum, ag = fld.cg / fld.wsum, ab = fld.cb / fld.wsum; // albedo (metal tint)
      const nx = nrm.nx, ny = nrm.ny, nz = nrm.nz;

      // razor-sharp specular highlight (polished chrome)
      const ndh = Math.max(0, nx * Hx + ny * Hy + nz * Hz);
      const ndhI = ndh < 1 ? (ndh * 255) | 0 : 255;
      const spec = POW90[ndhI] * (specBase + energy * specEnergy);
      // fresnel rim (grazing edges reflect more → bright metallic rim)
      const om = 1 - nz;
      const fres = om * om * Math.sqrt(om); // (1-nz)^2.5

      // --- Fix 3.1 dark neutral metal albedo + subtle desaturated tint ---
      // The saturated palette no longer fills the body (that read as jelly);
      // blob identity colour is pushed into the reflection + iridescence
      // terms below. The body is a dark neutral metal (~rgb 28,30,34) with
      // only a whisper of heavily-desaturated per-blob tint.
      // Liquid-metal base: a lit mid-tone neutral metal (not a black hole),
      // carrying a whisper of desaturated per-blob tint so the centre reads
      // as flowing chrome/mercury rather than dark oil.
      const lum = ar * 0.299 + ag * 0.587 + ab * 0.114;
      const albR = albedoBaseR + (lum + (ar - lum) * tintDesat) * tintScale;
      const albG = albedoBaseG + (lum + (ag - lum) * tintDesat) * tintScale;
      const albB = albedoBaseB + (lum + (ab - lum) * tintDesat) * tintScale;
      // Fix 3.2 ambient-occlusion darkening toward the silhouette: the body
      // is darker where the normal grazes (low nz) so the core reads rounded
      // (replaces the removed diffuse * 0.35 body lift).
      const ao = aoFloor + aoRange * nz;

      // --- Fix 3.3 environment reflection: high-contrast vertical studio
      // gradient sampled by the reflect vector R = reflect(V, N), V=(0,0,1).
      // R = V - 2(N·V)N → with V=(0,0,1): Rx=-2*nz*nx, Ry=-2*nz*ny.
      const Rx = -2 * nz * nx;
      const Ry = -2 * nz * ny;
      // vertical studio coord: ~1 = sky overhead, ~0 = floor below
      const ry = 0.5 - Ry * 0.85 + Rx * 0.15;
      // near-white sky band on top, near-black middle, dim floor bounce below
      const sky = clamp01((ry - skyEdge) * envBandSlope);
      const floor = clamp01((floorEdge - ry) * envBandSlope);
      // mercury studio: lit mid-tone body + a bright sky sweep up top and a
      // darker belly below → high-contrast liquid-metal reflection.
      const env = envFloor + envSky * sky + envFloorBounce * floor;
      // crisp reflected light strips sweeping the body → liquid-metal banding
      const bnd = Math.max(0, 1 - Math.abs(ry - bandCenter) * bandWidth);
      const bnd2 = Math.max(0, 1 - Math.abs(ry - band2Center) * band2Width);
      const band = (bnd * bnd) * (bnd * bnd);
      const band2 = (bnd2 * bnd2) * (bnd2 * bnd2) * band2Scale;

      // --- Fix 3.4 iridescent thin-film on the dark base ---
      // Strong at grazing angles (high fresnel), suppressed across the flat
      // centre, and feathered out of the 1px alpha edge via smoothstep so the
      // green/magenta CA-style rim fringe disappears. A slow time drift makes
      // it shimmer when blobs move.
      const iphase = fres * 1.3 + (nx * 0.5 + ny * 0.5) * 0.4 + 0.15 + time * 0.004;
      const iri = iridIndex(iphase);
      const irR = iridR[iri], irG = iridG[iri], irB = iridB[iri];
      const edgeFade = alpha < 1 ? alpha * alpha * (3 - 2 * alpha) : 1; // smoothstep
      // iridescence rides the rim only — keep the body reading as metal,
      // not pastel soap.
      let iAmt = (fres * iridFresWeight + band * iridBandWeight) * edgeFade;
      if (iAmt > iridClamp) iAmt = iridClamp;

      // Compose: dark body (albedo·AO) + palette-tinted environment reflection
      // — blob identity colour now comes from this reflection — + achromatic
      // white sheen from the reflected strips.
      const sheen = (band + band2) * sheenScale; // bright achromatic reflection
      let baseR = albR * ao + ar * env * envTint + sheen;
      let baseG = albG * ao + ag * env * envTint + sheen;
      let baseB = albB * ao + ab * env * envTint + sheen;
      baseR = mix(baseR, irR, iAmt);
      baseG = mix(baseG, irG, iAmt);
      baseB = mix(baseB, irB, iAmt);

      let r = baseR + spec * 255;
      let g = baseG + spec * 255;
      let bl = baseB + spec * 255;

      // white-hot chrome core in the tightest highlight
      const hot = POW220[ndhI] * 255 * (hotBase + energy * hotEnergy);
      r += hot; g += hot; bl += hot;

      // Fix 5.3 — clean alert red: boost red hard and crush green/blue much
      // harder than before (was r*0.5+120, g*0.4, b*0.42 → muddy pink). The
      // brightness shape from spec/hot is preserved; tonemap rolls off the hot
      // red so the chrome highlight still reads on the dark-metal base (Fix 3).
      if (errTint) { r = r * 1.2 + 60; g *= 0.16; bl *= 0.13; }

      // cinematic tone-map (filmic ACES-ish) — preserves bright sheen, lifts body
      shaded.r = tonemap(r, exposure);
      shaded.g = tonemap(g, exposure);
      shaded.b = tonemap(bl, exposure);
    }

    // composite: per-pixel mask → shade or clear → write (the remaining render
    // responsibility: alpha/edge + setPixel).
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        sampleField(px, py);

        const idx = (py * W + px) * 4;
        // crisp, near-binary surface mask with 1px anti-alias band
        const alpha = (fld.field - threshold) * 6 + 0.5;

        if (alpha > 0.02) {
          surfaceNormal();
          shadeMetal(alpha);
          const a = Math.min(1, alpha);
          // Opaque metal colour; the alpha channel carries the crisp silhouette
          // so the overlay stays transparent everywhere outside the blobs.
          setPixel(data, idx, shaded.r, shaded.g, shaded.b, a);
        } else {
          // fully transparent background — overlay shows through
          setPixel(data, idx, 0, 0, 0, 0);
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  const unsubscribe = api.onState((s) => {
    mode = s.mode;
    bins = s.spectrumBins || [];
    // smooth audio level
    level += (s.audioLevel - level) * 0.3;
  });

  // Fix 1.1 — stop the rAF loop entirely while the tab/window is hidden, and
  // resume it (without ever double-starting) when it becomes visible again.
  function onVisibility() {
    if (document.hidden) {
      if (!paused) {
        paused = true;
        cancelAnimationFrame(raf);
        raf = 0;
      }
    } else if (paused) {
      paused = false;
      raf = requestAnimationFrame(step);
    }
  }
  document.addEventListener("visibilitychange", onVisibility);

  raf = requestAnimationFrame(step);

  return {
    unmount() {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
