// src/theme-engine/builtin/metaballs/index.ts
/**
 * Metaballs — floating glossy blobs that fuse and split, inspired by the
 * Apposite "Metaballs" sculpting app.
 *
 * A scalar metaball field is evaluated per-pixel over the square overlay
 * declared in the manifest. Blobs drift, bounce off the walls, and merge
 * smoothly where their fields overlap. The organism breathes with `audioLevel`
 * (radius swell) and low spectrum bins nudge individual blobs so it reacts to
 * your voice.
 *
 * Self-contained: `import type` only — the bundled theme.js must have 0 runtime
 * imports so it works verbatim when copied into the user themes folder.
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
  phase: number; // for idle breathing offset
  binIndex: number;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Single source of truth for the tunable material params. render() destructures
// these into per-frame local const numbers so the inner pixel loops never do
// per-pixel object-property reads.
const MAT = {
  // Chroma boost on the body albedo: fights field-blend desaturation at fused
  // necks so colour regions read as saturated matte clay. Albedo is clamped ≥0
  // before the gamma-2.0 decode (see shadeGooey).
  chromaBoost: 1.5,
  // Edge/dome occlusion for volume: ao = aoFloor + aoRange*nz → 0.48..1.0
  // (bright dome centre → dark silhouette/neck falloff = real 3D clay). Widened
  // from 0.58/0.42 once the corrected global dome makes nz actually sweep
  // 1.0(centre)→~0.5(edge), so AO now drives real across-body volume not just a
  // thin rim.
  aoFloor: 0.48,
  aoRange: 0.52,
  // Diffuse: low ambient keeps the unlit hemisphere genuinely dark (opaque clay
  // with a real dark side, not a self-illuminated orb); the cool fill below
  // keeps that dark side coloured. Lowered 0.14→0.11 for a deeper coloured
  // shadow side now that the dome produces a real terminator.
  ambient: 0.11,
  lightStr: 0.85,
  // Cool bluish fill light from the opposite side of the warm key, so shadows
  // read as matte volume instead of crushing to black. One extra N·L (no LUT),
  // multiplied by body albedo + a cool tint, added in linear.
  fillStr: 0.13,
  fillColR: 0.55,
  fillColG: 0.72,
  fillColB: 1.0,
  // Broad soft specular bloom = two energy-normalized Blinn-Phong lobes baked
  // into build-time LUTs (the conserving norm (n+2)/(2π) folded in → no
  // per-pixel pow): a low-exp main bright-core lobe and a very-low-exp radial
  // sheen lobe. Added in linear, then sqrt-encoded with the body (no separate
  // tonemap). Strengths kept low so the broad add feathers rather than clipping
  // a hard flat-white plateau.
  specExp: 10,        // main bright-core lobe exponent (broad, soft)
  sheenExp: 3,        // very broad radial sheen lobe exponent
  specBase: 0.09,     // base main-lobe intensity
  specEnergy: 0.10,   // extra main-lobe intensity scaled by audio energy
  sheenStrength: 0.07, // broad sheen lobe intensity (linear)
  // Surface-normal shaping. rimK: field multiple of threshold above which a
  // pixel is fully interior — the organic in-plane rim tilt is gated to the rim
  // band only so fused blobs form ONE smooth interior with no per-blob
  // dimples/pucks. domeStr: one weak global body dome (radial from centroid)
  // added to the shading normal for overall rounded volume without per-blob bumps.
  rimK: 2.2,     // field/threshold above which a pixel is fully interior (rim tilt → 0)
  domeStr: 1.1,  // global body-dome in-plane tilt at the body radius (volume); used with domeInvR matched to the real mass so dr ramps to ~1 at the silhouette → nz sweeps 1.0→~0.5 (rounded clay, no per-blob pucks)
} as const;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// Cheap deterministic per-pixel hash → uniform in [0,1). Integer-only (no
// per-pixel transcendental), keyed by (x, y, salt) so the TPDF dither grain is
// stable per pixel/frame yet decorrelated between channels via distinct salts.
function hashU(x: number, y: number, salt: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Write one RGBA pixel. Transparent writes pass (0,0,0,0).
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

  // Render the backing store at EXACTLY 2x the CSS size, regardless of
  // devicePixelRatio. On non-HiDPI displays (dpr=1) this supersamples: the
  // compositor's bilinear downscale at exactly 2:1 with aligned grids
  // degenerates into an exact box filter (every source pixel contributes
  // once), turning the analytic 1-render-px coverage feather into true 2x2
  // SSAA at the silhouette. On Retina (dpr=2) it is the native 1:1 backing
  // store as before. NEVER use odd factors (3x): bilinear skips 5 of every 9
  // source pixels and the staircase survives. The whole simulation runs in
  // render pixels: every pixel-space constant below scales by `dpr`.
  const dpr = 2;
  const CW = W * dpr;
  const CH = H * dpr;

  // Palette element validation: a non-string element makes hexToRgb throw. Keep
  // only parseable hex strings; if none survive, use the default palette.
  const DEFAULT_PALETTE = ["#ff6a3d", "#ff2d77", "#8a4bff", "#1fb6ff", "#19f0b0"];
  const isHex = (v: unknown): v is string =>
    typeof v === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(v.trim());
  const validHex = Array.isArray(cfg.palette)
    ? (cfg.palette as unknown[]).filter(isHex)
    : [];
  const palette: RGB[] = (validHex.length > 0 ? validHex : DEFAULT_PALETTE).map(hexToRgb);

  // Flowing gradient palette LUT. The body colour is a smooth multi-stop
  // gradient that sweeps across the whole fused mass and rotates over time.
  // Flatten the palette RGB into parallel Float64Arrays so the per-pixel
  // gradient lerp reads typed arrays (no per-pixel object reads). The gradient
  // wraps so the last stop blends back to the first (seamless cyclic sweep).
  const nStops = palette.length;
  const pr = new Float64Array(nStops);
  const pg = new Float64Array(nStops);
  const pb = new Float64Array(nStops);
  for (let i = 0; i < nStops; i++) {
    pr[i] = palette[i].r;
    pg[i] = palette[i].g;
    pb[i] = palette[i].b;
  }

  // Two spec lobe LUTs keyed by N·H (ndh) clamped to [0,1]; index = ndh*255.
  // Each bakes the energy-conserving Blinn-Phong norm (n+2)/(2π) at build so
  // brightness scales with lobe width (no per-pixel pow). specLUT = broad
  // bright-core lobe; sheenLUT = very broad low-intensity radial sheen.
  const specNorm = (MAT.specExp + 2) / (2 * Math.PI);
  const sheenNorm = (MAT.sheenExp + 2) / (2 * Math.PI);
  const specLUT = new Float64Array(256);
  const sheenLUT = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const n = i / 255;
    specLUT[i] = specNorm * Math.pow(n, MAT.specExp);
    sheenLUT[i] = sheenNorm * Math.pow(n, MAT.sheenExp);
  }

  // Round blobCount to an integer before clamping to [2,8] so a fractional
  // value (e.g. 3.7) yields a whole blob count.
  const blobCount = Math.max(2, Math.min(8, Math.round(Number(cfg.blobCount) || 5)));
  // Floor a non-positive or non-finite threshold to 1.0. A threshold of 0 (or
  // negative) is not a valid iso-level: the field (always > 0 everywhere) would
  // be >= 0 for every pixel, so the whole bbox would shade as a solid opaque
  // rectangle instead of a blob. (The bbox padThr guard below additionally
  // protects the divide-by-sqrt(threshold).)
  const t = Number(cfg.threshold);
  const threshold = Number.isFinite(t) && t > 0 ? t : 1.0;

  // Flat per-blob buffers refilled once per frame so the inner pixel loop reads
  // typed arrays instead of object props. Allocated once at mount.
  const bx = new Float64Array(blobCount);
  const by = new Float64Array(blobCount);
  const brr = new Float64Array(blobCount);

  const canvas = document.createElement("canvas");
  // Backing store at device resolution; CSS still fills the element (100%).
  canvas.width = CW;
  canvas.height = CH;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(CW, CH);
  const data = image.data;

  // ---- init blobs ----
  // Several independent blobs drifting, meeting, fusing and splitting. They
  // spawn around the centre of the square canvas; soft walls keep them on screen.
  // Random seed per mount → every Reload/Preview spawns a different starting
  // arrangement, so the blob morphs into a fresh shape each time.
  const seed = Math.random() * 1000;
  const blobs: Blob[] = [];
  for (let i = 0; i < blobCount; i++) {
    // jittered angle + radius so the cluster isn't a perfect symmetric ring
    // (that reads as a plain ball); asymmetry makes it wander into shapes.
    const ang = (i / blobCount) * Math.PI * 2 + seed + Math.sin(seed + i) * 0.8;
    // Spawn-ring radius wide enough that the cluster spreads over ~50-65% of the
    // canvas (like the reference) while the centre-pull keeps it fused/framed.
    const rad = Math.min(CW, CH) * (0.16 + 0.12 * ((Math.sin(seed * 3 + i * 2.7) + 1) / 2));
    blobs.push({
      x: CW / 2 + Math.cos(ang) * rad,
      y: CH / 2 + Math.sin(ang) * rad,
      vx: Math.cos(ang) * 0.6 * dpr,
      vy: Math.sin(ang) * 0.6 * dpr,
      baseR: (6.8 + (i % 3) * 2.4) * dpr,
      r: 6.8 * dpr,
      phase: i * 1.3 + seed,
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
    // 30fps render throttle: skip the expensive per-pixel render() on odd frames
    // while physics keeps advancing every frame. The first frame (time=1) is
    // skipped too (buffer still transparent — harmless). The real battery win is
    // the visibility pause (rAF fully stops when the overlay is hidden).
    const renderThrottled = (time % 2 !== 0);
    // Modest swell: the voice is felt as morph + jitter + sheen, not as the blob
    // ballooning to fill (and clip) the whole canvas.
    const swell = 1 + level * 0.4 + (mode === "recording" ? 0.1 : 0);

    // --- inter-blob attraction so they meet, fuse, then drift apart (morph) ---
    // A slow centre-seeking pull keeps them clustering and merging rather than
    // bouncing past each other.
    const cx = CW / 2;
    const cy = CH / 2;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      // gentle centre pull — loose enough that blobs swing out and the
      // silhouette wanders into shapes (lobes, peanuts) instead of a ball.
      b.vx += (cx - b.x) * 0.0022;
      b.vy += (cy - b.y) * 0.0022;
      // pairwise attraction at mid range, soft repulsion when overlapping hard.
      // Bigger want-distance keeps blobs spread so they form necks/lobes.
      for (let j = i + 1; j < blobs.length; j++) {
        const o = blobs[j];
        const dx = o.x - b.x;
        const dy = o.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 1e-3;
        // want-distance < (b.r+o.r) so centres sit close and fields overlap into
        // one broad plateau (one merged mass for the rim-gated normal), still >0
        // spread so necks/lobes morph (not a collapsed ball).
        const want = (b.r + o.r) * 0.92;     // closer → broader fused plateau
        const f = (dist - want) * 0.0013;     // +: attract, -: repel
        const ux = dx / dist, uy = dy / dist;
        b.vx += ux * f; b.vy += uy * f;
        o.vx -= ux * f; o.vy -= uy * f;
      }
    }

    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      // voice nudge from a low spectrum bin
      const binv = bins.length ? bins[Math.min(bins.length - 1, b.binIndex)] || 0 : 0;
      const speed = 0.5 + energy * 0.7;
      b.x += b.vx * speed;
      b.y += b.vy * speed;
      // per-blob wander on independent phases → lobes keep reshaping (morphing).
      b.vx += Math.sin(time * 0.02 + b.phase) * 0.03 * dpr;
      b.vy += Math.cos(time * 0.023 + b.phase * 1.4) * 0.03 * dpr;
      // damp / clamp velocity (limit is in device px/frame → scales with dpr)
      b.vx = Math.max(-1.1 * dpr, Math.min(1.1 * dpr, b.vx * 0.99));
      b.vy = Math.max(-1.1 * dpr, Math.min(1.1 * dpr, b.vy * 0.99));
      // breathing + audio swell + per-blob voice pop
      const breathe = 1 + 0.1 * Math.sin(time * 0.05 + b.phase);
      // radius cap so the fused cluster fills ~50-60% of the frame while the
      // 1.4× wall pad below still keeps body + AA/bloom halo clear of the border.
      const maxR = Math.min(CW, CH) * 0.19;
      b.r = Math.min(maxR, b.baseR * swell * breathe * (1 + binv * 0.3));

      // Soft walls padded by 1.4× radius so the fused iso-surface (which reaches
      // past a single radius) never touches an edge.
      const pad = b.r * 1.4;
      if (b.x < pad) { b.x = pad; b.vx = Math.abs(b.vx); }
      if (b.x > CW - pad) { b.x = CW - pad; b.vx = -Math.abs(b.vx); }
      if (b.y < pad) { b.y = pad; b.vy = Math.abs(b.vy); }
      if (b.y > CH - pad) { b.y = CH - pad; b.vy = -Math.abs(b.vy); }
    }

    if (!renderThrottled) render(energy);
    raf = requestAnimationFrame(step);
  }

  function render(energy: number) {
    const errTint = mode === "error" ? 1 : 0;
    // Destructure MAT into per-frame local const numbers (once per frame). The
    // inner pixel loops read these locals, never MAT.* properties.
    const {
      chromaBoost, aoFloor, aoRange, ambient, lightStr,
      specBase, specEnergy, sheenStrength,
      fillStr, fillColR, fillColG, fillColB,
      rimK, domeStr,
    } = MAT;
    // Light + view setup for a Half-Lambert wrap + broad Blinn-Phong highlight.
    // Light from upper-left, viewer straight on (0,0,1).
    const Llen = Math.sqrt(0.5 * 0.5 + 0.72 * 0.72 + 0.55 * 0.55);
    const Lx = -0.5 / Llen, Ly = -0.72 / Llen, Lz = 0.55 / Llen;
    // Cool fill light direction: opposite side (lower-right), shallow Z so it
    // grazes the shadow side the key misses. Normalized once per frame.
    const Flen = Math.sqrt(0.5 * 0.5 + 0.6 * 0.6 + 0.35 * 0.35);
    const Fx = 0.5 / Flen, Fy = 0.6 / Flen, Fz = 0.35 / Flen;
    // half vector between light and view (0,0,1)
    let Hx = Lx, Hy = Ly, Hz = Lz + 1;
    const Hl = Math.sqrt(Hx * Hx + Hy * Hy + Hz * Hz); Hx /= Hl; Hy /= Hl; Hz /= Hl;

    // Flowing gradient setup (per frame, NEVER per pixel). The body hue is a
    // smooth low-frequency sweep that drifts (phase) and rotates (theta) slowly.
    // All the transcendentals are computed ONCE here using the shared `time`
    // frame counter; the per-pixel hot path then only does mul/add/floor/fract/
    // lerp. Rates are tiny so the cycle takes many seconds (a calm flow).
    const gradCx = CW / 2;
    const gradCy = CH / 2;
    const gradInvR = 1 / (Math.min(CW, CH) * 0.5); // 1/body-radius for the COLOUR sweep (low freq) — DO NOT retune (sets the hue gradient width)
    // Separate, tighter inverse-radius for the SHADING dome only, matched to the
    // real fused mass (~0.32 of min(CW,CH)) so the dome `dr` ramps to ~1.0 at the
    // actual silhouette (gradInvR's 0.5 = half-canvas would cap dr at ~0.45 and
    // never round the body). Kept separate so the colour sweep above is untouched.
    const domeInvR = 1 / (Math.min(CW, CH) * 0.32);
    // Energy-gate the global dome strength on the smoothed audio LOUDNESS
    // (`level`, the per-frame signal that is ~0 idle, ~0.5 at rec05, ~0.85 at
    // rec085 — modeEnergy() is a constant per mode and can't distinguish loud
    // from quiet recording). FULL at idle/low (level<=0.5 → clamp term 0 →
    // factor exactly 1.0, byte-identical to the calm look) and knocked down to
    // ~0.825x at level 0.85 / ~0.75x at peak so loud recording doesn't
    // over-round the silhouette into an egg — keeps more organic bumps/necks
    // while the volume shading (dome) is only slightly relaxed. One per-frame
    // mul/clamp, depends only on level (not pixel).
    const domeStrEff = domeStr * (1 - 0.25 * clamp01((level - 0.5) / 0.5));
    const gradPhase = time * 0.0016;
    const gradTheta = time * 0.0009;
    const gradAx = Math.cos(gradTheta);
    const gradAy = Math.sin(gradTheta);

    // Bounding-box render: compute the AABB of all blob extents, pad for the
    // iso-surface/AA band, clamp to the canvas, iterate only inside it. Clear
    // the whole buffer first so everything outside the box is transparent.
    data.fill(0);
    let minX = CW, minY = CH, maxX = 0, maxY = 0, maxR = 0;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      if (b.x - b.r < minX) minX = b.x - b.r;
      if (b.x + b.r > maxX) maxX = b.x + b.r;
      if (b.y - b.r < minY) minY = b.y - b.r;
      if (b.y + b.r > maxY) maxY = b.y + b.r;
      if (b.r > maxR) maxR = b.r;
      // refill flat per-blob geometry buffers once per frame (colour is not
      // per-blob — it comes from the spatial gradient below).
      bx[i] = b.x;
      by[i] = b.y;
      brr[i] = b.r * b.r;
    }
    // Bounding-box pad. CRITICAL: the summed metaball field reaches well beyond
    // a single blob's radius — overlapping fields add, so the iso-surface
    // (field == threshold) sits far outside ±r. Too-small pad crops the smooth
    // iso-surface into FLAT "square" edges. A single blob of radius r meets the
    // iso at distance r/sqrt(threshold); a tight cluster of N reaches ~sqrt(N)
    // further. Pad generously by the largest radius. threshold is already
    // floored >0 at mount; Math.min(1,...) keeps the divide-by-sqrt(padThr)
    // well-defined.
    const padThr = Math.min(1, threshold);
    const boxPad = Math.ceil(4 * dpr + maxR * (Math.sqrt(blobCount) / Math.sqrt(padThr)));
    const x0 = Math.max(0, Math.floor(minX - boxPad));
    const x1 = Math.min(CW, Math.ceil(maxX + boxPad));
    const y0 = Math.max(0, Math.floor(minY - boxPad));
    const y1 = Math.min(CH, Math.ceil(maxY + boxPad));

    // SRP per-pixel hot path: three named CLOSURES sharing the per-frame MAT
    // locals / H-vector / errTint / energy in scope, writing into per-frame
    // SCRATCH objects allocated ONCE here (3 objects/frame, never per pixel) —
    // no per-pixel allocation / no GC pressure.
    const fld = { field: 0, gx: 0, gy: 0 };
    const nrm = { nx: 0, ny: 0, nz: 0 };
    const shaded = { r: 0, g: 0, b: 0 };

    // 1. field + gradient sampling — accumulate the scalar metaball field and
    //    the analytic in-plane gradient at (px, py). Colour comes from the
    //    spatial gradient in shadeGooey, not from which blob dominates.
    function sampleField(px: number, py: number): void {
      let field = 0;
      let gx = 0, gy = 0; // analytic field gradient (in-plane)
      for (let i = 0; i < blobCount; i++) {
        const dx = px - bx[i];
        const dy = py - by[i];
        const d2 = dx * dx + dy * dy + 1;
        const rr = brr[i];
        const f = rr / d2;
        field += f;
        gx += (-2 * rr * dx) / (d2 * d2);
        gy += (-2 * rr * dy) / (d2 * d2);
      }
      fld.field = field; fld.gx = gx; fld.gy = gy;
    }

    // 2. normal reconstruction — ONE smooth organic surface, NO per-blob pucks.
    //    The in-plane tilt comes from the field gradient but is GATED to the rim
    //    band only, plus one weak global body dome for volume. Reads fld +
    //    (px,py), writes nrm.
    function surfaceNormal(px: number, py: number): void {
      // INTERIOR-NESS: 0 at the iso-rim (field≈threshold) → 1 once the field is
      // a modest multiple (rimK) of threshold (clearly inside). The per-blob-
      // peaky gradient tilt is gated by (1-ic): full at the rim, ZERO deep
      // inside → fused blobs form ONE smooth interior, no per-blob dimples.
      // (rimK-1 guards divide-by-zero: rimK>1.)
      const iraw = clamp01((fld.field - threshold) / (threshold * (rimK - 1)));
      const ic = iraw * iraw * (3 - 2 * iraw); // smoothstep interior-ness
      const rimTilt = 1 - ic;                  // 1 at rim → 0 deep interior

      // RIM in-plane tilt: outward along -gradient. The gradient is smooth along
      // the silhouette AND at necks, so this rolls the normal over exactly at
      // the organic edges without touching the interior. Magnitude = rimTilt.
      const glen = Math.sqrt(fld.gx * fld.gx + fld.gy * fld.gy) + 1e-6;
      let ix = (-fld.gx / glen) * rimTilt;
      let iy = (-fld.gy / glen) * rimTilt;

      // WEAK GLOBAL BODY DOME (volume, NOT a per-blob bump): one radial tilt
      // from the body centroid so the whole fused mass reads as a soft overall
      // rounded form. Kept weak (domeStr); the silhouette is owned by coverage
      // (untouched). Gated by ic so the dome is full in the interior and fades
      // into the rim roll (no double-roll at the silhouette).
      const ddx = px - gradCx;
      const ddy = py - gradCy;
      const dlen = Math.sqrt(ddx * ddx + ddy * ddy) + 1e-6;
      const dr = Math.min(1, dlen * domeInvR);          // 0 centre → 1 body edge (domeInvR matched to real mass)
      const domeMag = domeStrEff * dr * ic;             // weak, interior-only (energy-gated)
      ix += (ddx / dlen) * domeMag;
      iy += (ddy / dlen) * domeMag;

      // Reconstruct the unit normal: horiz = |in-plane| (clamped), nz faces the
      // viewer for the remainder. Deep interior → tiny horiz → nz≈1; rim →
      // horiz→1 → nz→0.
      const ilen = Math.sqrt(ix * ix + iy * iy);
      const horiz = Math.min(1, ilen);
      const nz = Math.sqrt(Math.max(0, 1 - horiz * horiz));
      if (ilen > 1e-6) {
        nrm.nx = (ix / ilen) * horiz;
        nrm.ny = (iy / ilen) * horiz;
      } else {
        nrm.nx = 0;
        nrm.ny = 0;
      }
      nrm.nz = nz;
    }

    // 3. gooey shading — the body is the flowing gradient colour (chroma-
    //    boosted), lit by a soft Half-Lambert wrap diffuse, gently darkened
    //    toward the silhouette for volume, with one broad soft specular
    //    highlight. The lighting stage runs in LINEAR space (cheap gamma-2.0)
    //    and is encoded back to sRGB at output (reads fld + nrm, writes shaded).
    function shadeGooey(px: number, py: number): void {
      const nx = nrm.nx, ny = nrm.ny, nz = nrm.nz;

      // FLOWING MULTI-HUE GRADIENT ALBEDO: a smooth low-frequency sweep across
      // the whole mass, projected onto the slowly-rotating direction (gradAx,
      // gradAy) and drifting by gradPhase. Per pixel this is ONLY mul/add/floor/
      // fract/lerp (all cos/sin/phase precomputed per frame):
      //   u = 0.5 + 0.5*( ax*(px-cx)/R + ay*(py-cy)/R ) + phase
      // Wrap u to [0,1), scale by nStops, floor/fract → lerp between adjacent
      // palette stops (cyclic: last → first) for a continuous flow.
      let u = 0.5
        + 0.5 * (gradAx * (px - gradCx) * gradInvR + gradAy * (py - gradCy) * gradInvR)
        + gradPhase;
      u -= Math.floor(u);            // wrap to [0,1)
      const su = u * nStops;
      const s0 = Math.floor(su);
      const fr = su - s0;            // [0,1) blend factor between adjacent stops
      const i0 = s0 % nStops;
      const i1 = (i0 + 1) % nStops;
      const ar = pr[i0] + (pr[i1] - pr[i0]) * fr;
      const ag = pg[i0] + (pg[i1] - pg[i0]) * fr;
      const ab = pb[i0] + (pb[i1] - pb[i0]) * fr;

      // Body albedo = the gradient colour with a gentle chroma boost (no muddy
      // grey at stop blends). Only the lighting STAGE below is linear.
      const lum = ar * 0.299 + ag * 0.587 + ab * 0.114;
      // Clamp ≥0: the chroma boost can push a low channel below zero; without
      // the clamp the gamma-2.0 decode (squaring) would flip it back positive
      // (a colour artifact).
      const albR = Math.max(0, lum + (ar - lum) * chromaBoost);
      const albG = Math.max(0, lum + (ag - lum) * chromaBoost);
      const albB = Math.max(0, lum + (ab - lum) * chromaBoost);

      // Decode albedo to LINEAR before lighting (multiplying sRGB-encoded bytes
      // by diffuse/AO is physically wrong → muddy midtones, worse banding).
      // Cheap gamma-2.0 decode, one multiply per channel: lin = (c/255)^2.
      // ERROR PATH: in error mode, override the linear albedo with a saturated
      // alert red BEFORE lighting, then run the IDENTICAL diff*ao + bloom
      // pipeline below — same material, just red (reads as a clean ~#f02b1f).
      let lr: number, lg: number, lb: number;
      if (errTint) {
        lr = 0.85; lg = 0.02; lb = 0.02;
      } else {
        lr = (albR / 255) * (albR / 255);
        lg = (albG / 255) * (albG / 255);
        lb = (albB / 255) * (albB / 255);
      }

      // Directional diffuse with a steep Half-Lambert wrap → deep opaque-clay
      // shadow. w = max(0, ndl*0.8+0.2) (terminator at ndl≈-0.25) so the
      // away-from-key hemisphere drops to the low ambient floor (clear
      // bright→dark gradient across the body). The cool fill keeps the dark side
      // coloured. diff = ambient + lightStr*w → 0.14 .. 0.99.
      const ndl = nx * Lx + ny * Ly + nz * Lz;
      const w = Math.max(0, ndl * 0.8 + 0.2); // steeper wrap → deeper dark side
      const diff = ambient + lightStr * w;

      // Edge darkening for volume: ao = aoFloor + aoRange*nz (bright dome centre
      // → dark silhouette/neck). Directional diffuse is the sole value driver;
      // the cool fill keeps darkened rim/necks coloured.
      const ao = aoFloor + aoRange * nz;

      // Cool fill light: a weak bluish diffuse from the opposite (lower-right)
      // side fills the key's shadow so the body reads as rounded matte clay, not
      // a flat-lit disc with dead-black occlusion. One dot + clamp (no LUT/pow),
      // multiplied by the body albedo and a cool tint, added in linear.
      const ndf = Math.max(0, nx * Fx + ny * Fy + nz * Fz);
      const fill = fillStr * ndf;

      // Broad soft bloom: sum the two lobes (main bright core + very broad
      // radial sheen) in LINEAR. The main lobe is energy-scaled so recording
      // blooms brighter. Both read from build-time LUTs (no per-pixel pow).
      const ndh = Math.max(0, nx * Hx + ny * Hy + nz * Hz);
      const ndhI = ndh < 1 ? (ndh * 255) | 0 : 255;
      const spec = specLUT[ndhI] * (specBase + energy * specEnergy)
        + sheenLUT[ndhI] * sheenStrength;

      // Highlight colour ≈ WHITE (dielectric) but tinted ≤15% toward the LINEAR
      // albedo so the bloom transitions THROUGH colour at its feathered edge
      // instead of a hard white→hue jump.
      const specR = spec * (0.85 + 0.15 * lr);
      const specG = spec * (0.85 + 0.15 * lg);
      const specB = spec * (0.85 + 0.15 * lb);

      // Compose ALL lighting in linear: coloured body (albedo × diff × ao) plus
      // the additive near-white bloom. In error mode the only difference is the
      // red albedo above — the same diff*ao and bloom run, so error shading is
      // identical.
      const r = lr * (diff * ao + fill * fillColR) + specR;
      const g = lg * (diff * ao + fill * fillColG) + specG;
      const bl = lb * (diff * ao + fill * fillColB) + specB;

      // Encode linear → sRGB (cheap gamma-2.0: out = sqrt(lin)*255); clamp linear
      // to [0,1] first so sqrt stays in range and the body never exceeds 255.
      //
      // TPDF DITHER: the 8-bit write (Uint8ClampedArray rounds to int) stair-
      // steps the smooth linear→sRGB gradients into faint banding. Add a
      // triangular-PDF dither of ±1 LSB to each RGB channel BEFORE rounding to
      // dissolve the bands into imperceptible grain. TPDF = u1 + u2 - 1 (two
      // independent uniforms → triangular in [-1,+1]); per channel with distinct
      // hash salts. RGB ONLY — alpha stays exact analytic coverage; dithering it
      // would sparkle the AA edge. The transparent path never reaches here.
      const ditherFrame = time;
      const dR = hashU(px, py, ditherFrame * 6 + 1) + hashU(px, py, ditherFrame * 6 + 2) - 1;
      const dg = hashU(px, py, ditherFrame * 6 + 3) + hashU(px, py, ditherFrame * 6 + 4) - 1;
      const db = hashU(px, py, ditherFrame * 6 + 5) + hashU(px, py, ditherFrame * 6 + 6) - 1;
      shaded.r = Math.sqrt(clamp01(r)) * 255 + dR;
      shaded.g = Math.sqrt(clamp01(g)) * 255 + dg;
      shaded.b = Math.sqrt(clamp01(bl)) * 255 + db;
    }

    // composite: per-pixel mask → analytic coverage → shade or clear → write.
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        sampleField(px, py);

        const idx = (py * CW + px) * 4;
        const field = fld.field;

        // ANALYTIC GRADIENT ANTI-ALIASING: the signed distance from the pixel
        // centre to the iso-surface is ≈ (field - threshold) / |∇field| (device
        // px). Converting that to coverage over a 1px band gives continuous
        // 256-level alpha: coverage = clamp01((field-threshold)/glen + 0.5).
        // One field eval + a few muls (cheaper + smoother than a 4-tap).
        const glen = Math.sqrt(fld.gx * fld.gx + fld.gy * fld.gy);
        // Guard flat regions (glen → 0): the analytic distance is undefined
        // (divide-by-zero → ±Inf, or 0/0 → NaN at field==threshold). Fall back
        // to the hard threshold step so coverage stays a clean 0/1.
        const coverage = glen < 1e-9
          ? (field >= threshold ? 1 : 0)
          : clamp01((field - threshold) / glen + 0.5);

        if (coverage <= 0) {
          // fully outside the surface → transparent background (shows through).
          setPixel(data, idx, 0, 0, 0, 0);
        } else {
          // coverage in (0,1] → shade once and composite at that coverage.
          // coverage===1 is the hard-inside fast path; 0<cov<1 is the AA rim.
          surfaceNormal(px, py);
          shadeGooey(px, py);
          setPixel(data, idx, shaded.r, shaded.g, shaded.b, coverage);
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  const unsubscribe = api.onState((s) => {
    mode = s.mode;
    bins = s.spectrumBins || [];
    // smooth audio level — guard against a non-finite audioLevel (NaN/∞) which
    // would poison `level` permanently (NaN propagates through every subsequent
    // frame's swell/radius math).
    const lvl = Number.isFinite(s.audioLevel) ? s.audioLevel : 0;
    level += (lvl - level) * 0.3;
  });

  // Stop the rAF loop entirely while the tab/window is hidden, and resume it
  // (without ever double-starting) when it becomes visible again.
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
