// src/theme-engine/builtin/metaballs/index.ts
/**
 * Metaballs — floating glossy blobs that fuse and split, inspired by the
 * Apposite "Metaballs" sculpting app (iPhone/iPad/Vision Pro).
 *
 * A scalar metaball field is evaluated per-pixel over the square overlay
 * declared in the manifest (120×120).
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
// the metallic look discoverable in one place. The R1 extraction was pixel-
// identical (same numbers, just named); B1 has since RETUNED several values
// (darker albedo, near-white sky spike, narrower sheen, calmer iridescence)
// for the dark liquid-metal look — see each field's note. The silhouette edge
// AA is a separate, intentional behaviour change elsewhere.
// Hot-path note: render() destructures these into per-frame local
// `const` numbers at the top of the function so the inner pixel loops never do
// per-pixel object-property reads. The MAT object stays the single source of
// truth; the per-frame locals are the hot-path reads.
const MAT = {
  // G1 — Gooey conversion: the body is now the blob's SATURATED colour at full
  // brightness (matte/semigloss jelly, like the real Apposite Metaballs app),
  // not dark iridescent chrome. The per-pixel albedo ar/ag/ab is fed directly
  // (chroma-boosted) as the body colour; the entire metal stack (dark albedo,
  // env studio reflection, sheen bands, iridescence, hot core) is removed.
  // Optional chroma boost fights field-blend desaturation at fused necks.
  // S8 — raised 1.12 → 1.5 so the colour regions read as SATURATED matte clay
  // (the reference blobs are highly saturated), paired with the f² colour
  // weighting below (flat lobes, narrow neck blend) so necks stay saturated
  // instead of greying. Albedo is clamped ≥0 before the linear (gamma-2.0)
  // decode so a boosted low channel can't go negative-then-squared-positive.
  chromaBoost: 1.5,
  // S8 — DEEPEN VOLUME. AO floor crevice/silhouette occlusion. S8e — FLATTENED
  // FURTHER to kill the residual IDLE lit-disc cores: floor RAISED 0.66 → 0.72,
  // range CUT 0.34 → 0.20 (ao = aoFloor + aoRange*nz → 0.72..0.92). The nz-driven
  // term is the per-blob centre-brightener: nz peaks at every separated idle
  // detail-dome centre (it faces the viewer), so aoRange*nz painted each idle
  // blob a brighter circular core → distinct "lit discs". S8d cut this to 0.34;
  // S8e cuts the centre-vs-edge DELTA a further ~40% (0.34 → 0.20) while nudging
  // the floor up (0.66 → 0.72) so the overall lit level is preserved. AO now only
  // darkens NECKS/crevices (concavity), never brightens dome centres into discs;
  // the directional diffuse (N·L) stays the SOLE value driver, so idle reads as
  // one fused clay mass instead of separate glowing spheres.
  aoFloor: 0.72,
  aoRange: 0.2,
  // Diffuse term. S8d — OPAQUE CLAY. ambient lowered 0.13 → 0.11 so the unlit
  // hemisphere goes genuinely DARK (the cool fill below keeps it coloured, not
  // dead black) → the colour reads as lit OPAQUE surface albedo with a real dark
  // side, NOT a self-illuminated orb. The diffuse wrap is steepened further (see
  // shadeGooey: ndl*0.8+0.2) so the body shows a clear bright-lit → dark gradient
  // ACROSS the body like store_3's blue blob.
  ambient: 0.11,
  lightStr: 0.85,
  // S8 — COOL FILL LIGHT. A weak bluish diffuse from the OPPOSITE side (lower-
  // right) of the warm upper-left key, so shadows read as the matte clay/gooey
  // volume of the reference instead of crushing to black. Cheap: one extra
  // N·L2 (dot + clamp, no LUT / transcendental), multiplied by the body albedo
  // and a cool tint, added in LINEAR alongside the key diffuse.
  fillStr: 0.13,
  fillColR: 0.55,
  fillColG: 0.72,
  fillColB: 1.0,
  // S4 — BROAD SOFT SPECULAR BLOOM (replaces the tight POW32 ridge → the
  // razor highlight line the user complained about). Two energy-normalized
  // Blinn-Phong lobes, both baked into build-time LUTs (the conserving norm
  // (n+2)/(2π) is folded in so brightness tracks lobe width with zero per-pixel
  // pow):
  //  • main lobe — low exponent (~10) for a wide soft feathered bright core,
  //    energy-scaled so recording blooms brighter than idle.
  //  • sheen lobe — very low exponent (~3), low intensity, gives the radial
  //    "lit side brightens toward the light" falloff the reference shows.
  // The spec is an additive LINEAR light term (added in linear space, then
  // sqrt-encoded to sRGB with the body); no separate filmic tonemap. Strengths
  // are tuned DOWN so the broad add does NOT clip a hard-edged flat-white 255
  // plateau — the core is bright but FEATHERS into a soft gradient.
  specExp: 10,        // main bright-core lobe exponent (broad, soft)
  sheenExp: 3,        // very broad radial sheen lobe exponent
  specBase: 0.09,     // S8d — trimmed 0.13 → 0.09: each detail dome catching its own
                      // soft highlight read as per-orb bright cores; damping the
                      // spec keeps a subtle single-ish highlight on the lit cap and
                      // kills the multi-orb glow (NO macro normal used).
  specEnergy: 0.10,   // extra main-lobe intensity scaled by audio energy
  // S8c — sheen CUT 0.18 → 0.07. The very broad (exp3) near-white sheen lobe was
  // laying a milky/frosted film over the WHOLE body → the translucent-shell read.
  // Cutting it makes the body a MATTE opaque surface; the tighter specLUT (exp10)
  // bloom stays as the single highlight.
  sheenStrength: 0.07, // broad sheen lobe intensity (linear)
} as const;

// R2 — tiny hot-path helpers to DRY the per-channel triples / repeated clamps.
// All three are trivial and inline under V8; kept pixel-identical to the
// expressions they replace (see R2 notes). clamp01 uses the exact
// Math.max/Math.min form so it is byte-identical at every call site.
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// S7 — cheap deterministic per-pixel hash → uniform in [0,1). Integer-only
// (Math.imul + xorshifts, NO per-pixel transcendental), keyed by (x, y, salt)
// so the TPDF dither grain below is stable per pixel/frame (deterministic, not
// Math.random) yet decorrelated between channels via distinct salts. Used ONLY
// to break 8-bit output banding on the RGB colour channels.
function hashU(x: number, y: number, salt: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
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

  // S3 — render the backing store at the DEVICE pixel ratio so a Retina
  // compositor doesn't bilinearly upscale a 120² store (the soft/low-res look).
  // Cap at 2 and round to an integer to keep a crisp 1:1 pixel mapping; guard →
  // 1 when devicePixelRatio is undefined (e.g. jsdom). The entire simulation
  // runs in DEVICE pixels: CW×CH is the backing-store resolution and every
  // pixel-space constant below scales by `dpr`, so the visual layout is
  // identical — just at higher resolution. At dpr=1, CW=W/CH=H and every `*dpr`
  // is a multiply-by-1.0 (IEEE identity) → byte-identical to before.
  const dpr = Math.min(2, Math.max(1, Math.round((globalThis.devicePixelRatio || 1))));
  const CW = W * dpr;
  const CH = H * dpr;

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

  // S4 — two spec lobe LUTs keyed by N·H (ndh) clamped to [0,1]; index =
  // ndh*255. Each bakes the energy-conserving Blinn-Phong norm (n+2)/(2π) at
  // build so brightness scales with lobe width (no per-pixel pow). `specLUT` is
  // the broad bright-core lobe (low exp ~10); `sheenLUT` is the very broad,
  // low-intensity radial sheen (exp ~3). Both replace the old tight POW32 ridge.
  const specNorm = (MAT.specExp + 2) / (2 * Math.PI);
  const sheenNorm = (MAT.sheenExp + 2) / (2 * Math.PI);
  const specLUT = new Float64Array(256);
  const sheenLUT = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const n = i / 255;
    specLUT[i] = specNorm * Math.pow(n, MAT.specExp);
    sheenLUT[i] = sheenNorm * Math.pow(n, MAT.sheenExp);
  }

  // Fix 4.3 — round blobCount to an integer before clamping to [2,8] so a
  // fractional value (e.g. 3.7) yields a whole blob count.
  const blobCount = Math.max(2, Math.min(8, Math.round(Number(cfg.blobCount) || 5)));
  // Fix 4.1 — respect a legal `threshold: 0` (the old `|| 1.0` coerced it back
  // to 1.0). Only fall back when the value is not finite.
  // m4 — floor a non-positive or non-finite threshold to 1.0. A threshold of 0
  // (or negative) is not a valid iso-level: the field (always > 0 everywhere)
  // would be >= 0 for every pixel, so the whole bbox would shade as a solid
  // opaque rectangle instead of a blob. The >0 floor prevents that. (The bbox
  // padThr guard below additionally protects the divide-by-sqrt(threshold).)
  const t = Number(cfg.threshold);
  const threshold = Number.isFinite(t) && t > 0 ? t : 1.0;

  // Fix 2.3 — flat per-blob buffers refilled once per frame so the inner pixel
  // loop reads typed arrays instead of object props. Allocated once at mount.
  const bx = new Float64Array(blobCount);
  const by = new Float64Array(blobCount);
  const brr = new Float64Array(blobCount);
  const bcr = new Float64Array(blobCount);
  const bcg = new Float64Array(blobCount);
  const bcb = new Float64Array(blobCount);

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
  // Several independent blobs drifting, meeting, fusing and splitting — the
  // playful "liquid metal" morphing. They spawn around the centre of the square
  // canvas and roam freely; soft walls keep them on screen.
  // Random seed per mount → every Reload/Preview spawns a different starting
  // arrangement, so the blob morphs into a fresh shape each time.
  const seed = Math.random() * 1000;
  const blobs: Blob[] = [];
  for (let i = 0; i < blobCount; i++) {
    // jittered angle + radius so the cluster isn't a perfect symmetric ring
    // (that read as a plain ball); asymmetry makes it wander into shapes.
    const ang = (i / blobCount) * Math.PI * 2 + seed + Math.sin(seed + i) * 0.8;
    // S9 — SCALE THE FORM IN-FRAME. The fused body previously filled only ~30%
    // of the canvas with a big empty transparent margin; the reference blobs
    // fill ~50-65%. The spawn-ring radius is widened (0.12→0.16 base, +0.12
    // jitter) so the cluster spreads over more area while the centre-pull keeps
    // it fused and framed. baseR / init r are scaled up proportionally to the
    // bigger maxR (≈1.5×, see below) so the geometry grows uniformly and the
    // aspect/fusion feel is unchanged.
    const rad = Math.min(CW, CH) * (0.16 + 0.12 * ((Math.sin(seed * 3 + i * 2.7) + 1) / 2));
    blobs.push({
      x: CW / 2 + Math.cos(ang) * rad,
      y: CH / 2 + Math.sin(ang) * rad,
      vx: Math.cos(ang) * 0.6 * dpr,
      vy: Math.sin(ang) * 0.6 * dpr,
      baseR: (6.8 + (i % 3) * 2.4) * dpr,
      r: 6.8 * dpr,
      color: palette[i % palette.length],
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
    // A2 — 30fps render throttle for ALL modes: skip the expensive per-pixel
    // render() on odd frames while physics (step) keeps advancing every frame.
    // Recording/transcribing previously rendered full 60fps; on the larger
    // square canvas the bbox collapses to a full-canvas scan, so that was a big
    // CPU spike. On a 120px widget 30fps is visually indistinguishable. After a
    // mode change the next render lands on the following even frame, so the worst
    // case is up to ~33ms (2 frames) of staleness — harmless since physics is
    // already up to date when that even frame renders. The very first frame after
    // mount (time=1) is also skipped, which is harmless because the buffer is
    // still transparent. The real battery win is still the visibility pause (rAF
    // fully stops when the overlay is hidden).
    const renderThrottled = (time % 2 !== 0);
    // Modest swell: the voice is felt as morph + jitter + sheen, not as the
    // blob ballooning to fill the whole canvas (that clipped on every edge).
    const swell = 1 + level * 0.4 + (mode === "recording" ? 0.1 : 0);

    // --- inter-blob attraction so they meet, fuse, then drift apart (morph) ---
    // A slow centre-seeking pull keeps them clustering and merging like the
    // real Metaballs app, rather than bouncing past each other.
    const cx = CW / 2;
    const cy = CH / 2;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      // gentle centre pull — just enough to keep the cluster roughly centred,
      // but loose enough that blobs swing out and the silhouette WANDERS into
      // shapes (lobes, peanuts, teardrops) instead of collapsing to a ball.
      b.vx += (cx - b.x) * 0.0022;
      b.vy += (cy - b.y) * 0.0022;
      // pairwise attraction at mid range, soft repulsion when overlapping hard.
      // Bigger want-distance keeps blobs spread out so they form necks/lobes
      // (real morphing) rather than all stacking into one round disc.
      for (let j = i + 1; j < blobs.length; j++) {
        const o = blobs[j];
        const dx = o.x - b.x;
        const dy = o.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 1e-3;
        const want = (b.r + o.r) * 1.05;     // slight spread → necks/lobes, still fused
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
      // stronger per-blob wander on independent phases → the lobes keep moving
      // and reshaping, so the blob is constantly morphing into new figures.
      b.vx += Math.sin(time * 0.02 + b.phase) * 0.03 * dpr;
      b.vy += Math.cos(time * 0.023 + b.phase * 1.4) * 0.03 * dpr;
      // damp / clamp velocity (limit is in device px/frame → scales with dpr)
      b.vx = Math.max(-1.1 * dpr, Math.min(1.1 * dpr, b.vx * 0.99));
      b.vy = Math.max(-1.1 * dpr, Math.min(1.1 * dpr, b.vy * 0.99));
      // breathing + audio swell + per-blob voice pop
      const breathe = 1 + 0.1 * Math.sin(time * 0.05 + b.phase);
      // S9 — bigger radius cap so the fused cluster fills ~50-60% of the frame
      // (was 0.13 → ~30% with a large empty margin). 0.19 fills the frame like
      // the reference while the 1.4× wall pad below still keeps the body + its
      // soft AA/bloom halo clear of the canvas border (verified at the loudest
      // recording level, where swell pushes radii to this cap).
      const maxR = Math.min(CW, CH) * 0.19;
      b.r = Math.min(maxR, b.baseR * swell * breathe * (1 + binv * 0.3));

      // Soft walls padded by 1.4× radius so the fused iso-surface (which reaches
      // past a single radius) never touches an edge. Blobs roam the whole square
      // and fuse freely — the liquid metal morph is intact in every direction.
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
    // R1 — destructure MAT into per-frame local const numbers (once per frame).
    // The inner pixel loops below read these locals, never MAT.* properties.
    const {
      chromaBoost, aoFloor, aoRange, ambient, lightStr,
      specBase, specEnergy, sheenStrength,
      fillStr, fillColR, fillColG, fillColB,
    } = MAT;
    // Light + view setup for a Half-Lambert wrap + broad Blinn-Phong highlight.
    // Light from upper-left, viewer straight on (0,0,1).
    const Llen = Math.sqrt(0.5 * 0.5 + 0.72 * 0.72 + 0.55 * 0.55);
    const Lx = -0.5 / Llen, Ly = -0.72 / Llen, Lz = 0.55 / Llen;
    // S8 — COOL FILL light direction: opposite side (lower-right), shallow Z so
    // it grazes the shadow side the key misses. Normalized once per frame.
    const Flen = Math.sqrt(0.5 * 0.5 + 0.6 * 0.6 + 0.35 * 0.35);
    const Fx = 0.5 / Flen, Fy = 0.6 / Flen, Fz = 0.35 / Flen;
    // half vector between light and view (0,0,1)
    let Hx = Lx, Hy = Ly, Hz = Lz + 1;
    const Hl = Math.sqrt(Hx * Hx + Hy * Hy + Hz * Hz); Hx /= Hl; Hy /= Hl; Hz /= Hl;

    // Fix 1.3 — bounding-box render. The blobs only occupy a small slice of the
    // pill, so compute the AABB of all blob extents (x±r, y±r), pad a couple of
    // px for the iso-surface/AA band, clamp to the canvas, and iterate pixels
    // only inside it. Clear the whole buffer first so everything outside the
    // box is transparent — visually identical to clearing & scanning the lot.
    data.fill(0);
    let minX = CW, minY = CH, maxX = 0, maxY = 0, maxR = 0;
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
    // Bounding-box pad. CRITICAL: the summed metaball field reaches well beyond
    // a single blob's radius — when blobs overlap their fields add, so the
    // iso-surface (field == threshold) sits far outside ±r. If the pad is too
    // small the box crops the smooth iso-surface into FLAT edges (the "square"
    // clipping the user saw). A single blob of radius r meets the iso at
    // distance r/sqrt(threshold); a tight cluster of N blobs reaches roughly
    // sqrt(N) further. Pad generously by the largest radius so the whole
    // organic surface is always inside the scanned box.
    // threshold is already floored >0 at mount (m4); Math.min(1, ...) keeps the
    // divide-by-sqrt(padThr) below well-defined. Defensive, no live <=0 branch.
    const padThr = Math.min(1, threshold);
    const boxPad = Math.ceil(4 * dpr + maxR * (Math.sqrt(blobCount) / Math.sqrt(padThr)));
    const x0 = Math.max(0, Math.floor(minX - boxPad));
    const x1 = Math.min(CW, Math.ceil(maxX + boxPad));
    const y0 = Math.max(0, Math.floor(minY - boxPad));
    const y1 = Math.min(CH, Math.ceil(maxY + boxPad));

    // R3 — SRP decomposition of the per-pixel hot path into three named
    // sub-steps. They are CLOSURES defined here (after the per-frame MAT locals,
    // H-vector and errTint/energy are in scope) so they read those directly with
    // no params and no per-pixel allocation. They write results into per-frame
    // SCRATCH objects allocated ONCE here (3 objects/frame, never per pixel) —
    // this is the explicit no-GC-pressure guidance in the plan's Notes/risks.
    // This is the material/helper refactor: each helper holds the same
    // arithmetic, in the same order on the same operands, as the previous
    // monolithic loop body. NOTE: this is NOT a global pixel-identical claim —
    // shadeGooey now receives the ANALYTIC coverage (S5) via alpha so its
    // silhouette AA matches the coverage composite, not a no-op.
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
        // S8 — KILL THE PLASMA-CORE GLOW. The colour blend is weighted by f²
        // (not f) so the blob with the highest LOCAL field dominates its whole
        // lobe as a near-flat saturated colour, with the cross-fade compressed
        // into a narrow neck where two f² weights are comparable. The old linear
        // f weighting let the nearest blob's colour peak sharply at its exact
        // centre (a bright saturated "core dot" → the glowing-plasma read) while
        // greying the necks by 3-way averaging. f² (one extra multiply, no pow)
        // flattens each lobe to a solid colour region and keeps necks saturated.
        // `field` itself still sums the linear f, so all geometry, the analytic
        // gradient, coverage and the iso-surface (S1/S5) are byte-identical.
        const cw = f * f;
        cr += bcr[i] * cw;
        cg += bcg[i] * cw;
        cb += bcb[i] * cw;
        wsum += cw;
        gx += (-2 * rr * dx) / (d2 * d2);
        gy += (-2 * rr * dy) / (d2 * d2);
      }
      fld.field = field; fld.gx = gx; fld.gy = gy;
      fld.cr = cr; fld.cg = cg; fld.cb = cb; fld.wsum = wsum;
    }

    // 2. normal reconstruction — rebuild a spherical surface normal from the
    //    height field + its gradient (reads fld, writes nrm).
    function surfaceNormal(): void {
      // S1 — RESTORE BODY CURVATURE. t: how deep inside the iso-surface (0 at
      // rim → 1 at core). The divisor is now /3.0 (was /0.7) so `traw` ramps
      // GRADUALLY across the whole body instead of snapping to 1 just above
      // threshold. The plateau bias is lowered +0.04 → +0.02. Result: nzCurved
      // ramps rim→centre, so the FUSED body reads as one smooth dome (the
      // normal varies across it → a real large-scale shading gradient, and the
      // highlight can spread later in S4 instead of clinging to a 1px rim).
      const traw = clamp01((fld.field - threshold) / 3.0);
      const t = traw * traw * (3 - 2 * traw); // smoothstep → gentle dome ramp
      const nzCurved = Math.sqrt(Math.min(1, t + 0.02)); // faces viewer at core
      // GUARD the old artifact (why the flatten was originally added): WIDELY-
      // SEPARATED blobs must not each grow their own dome / dark AO-ring at
      // their rim. Gate the curvature by FIELD MAGNITUDE: domeStrength is a
      // smoothstep from 0 at the iso-rim (field≈threshold) to 1 in the high-
      // field fused interior. S8e — onset RAISED: divisor threshold*1.5 →
      // threshold*2.5 so domeStrength reaches 1 only at a HIGHER field (truly-
      // fused body), not on moderate idle fields. SEPARATED low-field idle blobs
      // therefore keep a flatter top (less per-blob dome curvature → fewer lit
      // discs), while the loud/rec fused high-field body still gets full
      // curvature. Blending nz from flat(≈1) toward nzCurved by domeStrength makes
      // horiz→0 (so nx,ny→0) in the thin low-field rim band of separated blobs →
      // they stay flat-topped with no per-blob ring.
      // Cheap: only mul/add (no per-pixel transcendental).
      const draw = clamp01((fld.field - threshold) / (threshold * 2.5));
      const domeStrength = draw * draw * (3 - 2 * draw); // smoothstep gate
      const nz = 1 + (nzCurved - 1) * domeStrength; // flat(1) → curved blend
      const horiz = Math.sqrt(Math.max(0, 1 - nz * nz));
      const glen = Math.sqrt(fld.gx * fld.gx + fld.gy * fld.gy) + 1e-6;
      // outward normal: away from bump centre (= -gradient direction)
      nrm.nx = (-fld.gx / glen) * horiz;
      nrm.ny = (-fld.gy / glen) * horiz;
      nrm.nz = nz;
    }

    // 3. gooey shading — the body is the field-weighted blob colour at full
    //    saturation (chroma-boosted), lit by a soft Half-Lambert wrap diffuse,
    //    gently darkened toward the silhouette for volume, with ONE broad soft
    //    specular highlight (no chrome env, no iridescence, no hot core). S2 —
    //    the diffuse/AO/spec lighting stage runs in LINEAR space (cheap
    //    gamma-2.0) and is encoded back to sRGB at output (reads fld + nrm,
    //    writes shaded).
    function shadeGooey(px: number, py: number): void {
      const ar = fld.cr / fld.wsum, ag = fld.cg / fld.wsum, ab = fld.cb / fld.wsum; // field-weighted blob colour
      const nx = nrm.nx, ny = nrm.ny, nz = nrm.nz;

      // Body albedo = saturated blob colour, used directly. A gentle chroma
      // boost fights any field-blend desaturation at fused necks. (The per-blob
      // colour BLEND above stays in sRGB by taste — only the lighting STAGE
      // below is linear.)
      const lum = ar * 0.299 + ag * 0.587 + ab * 0.114;
      // S8 — clamp ≥0: the higher chromaBoost (1.5) can push a low channel below
      // zero; without the clamp the gamma-2.0 decode (squaring) would flip it
      // back positive (a colour artifact). Math.max keeps saturated hues clean.
      const albR = Math.max(0, lum + (ar - lum) * chromaBoost);
      const albG = Math.max(0, lum + (ag - lum) * chromaBoost);
      const albB = Math.max(0, lum + (ab - lum) * chromaBoost);

      // S2 — decode albedo to LINEAR before lighting. Multiplying sRGB-encoded
      // bytes by diffuse/AO is physically wrong (muddy, non-linear midtones,
      // worse banding). Cheap gamma-2.0 decode, one multiply per channel (no
      // Math.pow): lin = (c/255)^2.
      // S6 — ERROR PATH FIX. In error mode, override the linear albedo with a
      // saturated alert red BEFORE lighting, then run the IDENTICAL diff*ao +
      // broad spec bloom pipeline below. The error blob gets the same
      // curvature/material/bloom as the normal modes, just red — instead of the
      // old crude post-lighting r*1.2+0.22 / g*=0.16 / bl*=0.13 wash that
      // crushed the carefully-built bloom into a flat red. Values are in LINEAR
      // space (sqrt-encoded at output → reads as a clean ~#f02b1f red); the
      // rainbow palette is fully overridden so no hue bleeds through.
      let lr: number, lg: number, lb: number;
      if (errTint) {
        lr = 0.85; lg = 0.02; lb = 0.02;
      } else {
        lr = (albR / 255) * (albR / 255);
        lg = (albG / 255) * (albG / 255);
        lb = (albB / 255) * (albB / 255);
      }

      // Directional diffuse — S8d: STEEPENED WRAP → deeper, opaque-clay shadow.
      // S8c used w = max(0, ndl*0.7+0.3) (terminator at ndl≈-0.43); the unlit
      // hemisphere still got partial light so the patches read as soft self-lit
      // orbs. Now w = max(0, ndl*0.8+0.2): the terminator moves up to ndl≈-0.25,
      // so MORE of the away-from-key hemisphere drops to the (low) ambient floor
      // → a clear, high-contrast bright-lit → genuinely DARK gradient ACROSS the
      // body (like store_3's blue blob). VALUE is driven ONLY by this directional
      // N·L — never by field magnitude (audited: albedo ar/ag/ab = cr/wsum is a
      // pure hue ratio, no field/wsum term scales brightness). The cool fill below
      // keeps the dark side COLOURED, not black. Cheap: one mul+add, no pow.
      // diff = ambient + lightStr*w → 0.11 .. 0.96.
      const ndl = nx * Lx + ny * Ly + nz * Lz;
      const w = Math.max(0, ndl * 0.8 + 0.2); // steeper wrap → deeper dark side
      const diff = ambient + lightStr * w;

      // Edge darkening for volume (replaces AO). S8d — floor RAISED to 0.66,
      // range CUT to 0.34 so AO is a NARROW silhouette/neck cue only and no
      // longer paints a per-blob centre-bright core (nz peaks at each dome
      // centre). The steeper directional diffuse is now the sole value driver;
      // the cool fill keeps darkened rim/necks coloured, not crushed to mud.
      const ao = aoFloor + aoRange * nz; // S8e — 0.72 .. 0.92 (narrow neck cue)

      // S8 — COOL FILL LIGHT. A weak bluish diffuse from the opposite (lower-
      // right) side fills the key's shadow so the body reads as rounded matte
      // clay, not a flat-lit disc with dead-black occlusion. Cheap: one dot +
      // clamp (no wrap/LUT/pow). Multiplied by the body albedo (so it tints the
      // local hue, staying coloured) and a cool RGB tint, added in LINEAR.
      const ndf = Math.max(0, nx * Fx + ny * Fy + nz * Fz);
      const fill = fillStr * ndf;

      // S4 — BROAD SOFT BLOOM. Sum the two lobes (main bright core + very broad
      // radial sheen) in LINEAR. The main lobe is energy-scaled so recording
      // blooms brighter. Both are read from build-time LUTs (no per-pixel pow).
      // S8c — REVERTED S8b: N·H is back on the DETAIL normal (nx,ny,nz). The S8b
      // macro body-centroid sphere normal over-rounded the body into an "egg" and
      // reinforced the glow; with S8c's low ambient + sharp diffuse + cut sheen
      // the detail-normal specLUT (exp10) reads as one broad highlight on the lit
      // cap without a milky film.
      const ndh = Math.max(0, nx * Hx + ny * Hy + nz * Hz);
      const ndhI = ndh < 1 ? (ndh * 255) | 0 : 255;
      const spec = specLUT[ndhI] * (specBase + energy * specEnergy)
        + sheenLUT[ndhI] * sheenStrength;

      // Highlight colour ≈ WHITE (dielectric) but tinted ≤15% toward the LINEAR
      // albedo so the bloom transitions THROUGH colour at its feathered edge
      // instead of a hard white→hue jump. Kept subtle (0.85 white + 0.15 hue).
      const specR = spec * (0.85 + 0.15 * lr);
      const specG = spec * (0.85 + 0.15 * lg);
      const specB = spec * (0.85 + 0.15 * lb);

      // Compose ALL lighting in linear: coloured body (albedo × diff × ao) plus
      // the additive near-white bloom, accumulated in linear light. In error
      // mode the only difference is the red albedo above — the SAME diff*ao and
      // additive white bloom run, so the error blob has identical shading.
      const r = lr * (diff * ao + fill * fillColR) + specR;
      const g = lg * (diff * ao + fill * fillColG) + specG;
      const bl = lb * (diff * ao + fill * fillColB) + specB;

      // Encode linear → sRGB at output (cheap gamma-2.0: out = sqrt(lin)*255).
      // One Math.sqrt per channel; clamp linear to [0,1] first so sqrt stays in
      // range and the body never exceeds 255.
      //
      // S7 — TPDF DITHER. The encode above quantizes to 8-bit on write (setPixel
      // → Uint8ClampedArray rounds to int), so the smooth S2/S4 linear→sRGB
      // gradients stair-step into faint banding on the broad bloom/body. Add a
      // triangular-PDF dither of ±1 LSB (one 8-bit step) to each RGB channel
      // BEFORE the typed array rounds it: this decorrelates the quantization
      // error and dissolves the bands into imperceptible grain (the standard,
      // ~free fix). TPDF = u1 + u2 - 1 (two independent uniforms → triangular in
      // [-1,+1]); applied per channel with independent grain (distinct hash
      // salts). RGB ONLY — alpha stays exact analytic coverage (S5); dithering
      // it would sparkle the AA edge. The fully-transparent path (coverage<=0)
      // never reaches here, so transparent pixels keep RGB=0.
      const f = time;
      const dr = hashU(px, py, f * 6 + 1) + hashU(px, py, f * 6 + 2) - 1;
      const dg = hashU(px, py, f * 6 + 3) + hashU(px, py, f * 6 + 4) - 1;
      const db = hashU(px, py, f * 6 + 5) + hashU(px, py, f * 6 + 6) - 1;
      shaded.r = Math.sqrt(clamp01(r)) * 255 + dr;
      shaded.g = Math.sqrt(clamp01(g)) * 255 + dg;
      shaded.b = Math.sqrt(clamp01(bl)) * 255 + db;
    }

    // composite: per-pixel mask → analytic coverage → shade or clear → write.
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        sampleField(px, py);

        const idx = (py * CW + px) * 4;
        const field = fld.field;

        // S5 — ANALYTIC GRADIENT ANTI-ALIASING. Replaces the old 4-tap
        // supersample (4 extra fieldAt() evals per edge pixel) with a single
        // field eval + the analytic in-plane gradient already accumulated in
        // sampleField. The signed distance from the pixel centre to the iso-
        // surface is ≈ (field - threshold) / |∇field| (in device px, since the
        // gradient is per-device-pixel). Converting that distance to coverage
        // over a 1px-wide band gives a continuous 256-level alpha:
        //   coverage = clamp01( (field - threshold) / glen + 0.5 )
        // This is the standard analytic edge AA: one field eval + a few muls,
        // cheaper than 4 field evals AND smoother (continuous coverage vs 4
        // discrete levels). At dpr (S3) the silhouette is already supersampled;
        // this finishes it into a smooth sub-pixel curve.
        const glen = Math.sqrt(fld.gx * fld.gx + fld.gy * fld.gy);
        // Guard flat regions (glen → 0): the analytic distance is undefined
        // (divide-by-zero → ±Inf, or 0/0 → NaN at field==threshold). Fall back
        // to the old hard threshold step so coverage stays a clean 0/1.
        const coverage = glen < 1e-9
          ? (field >= threshold ? 1 : 0)
          : clamp01((field - threshold) / glen + 0.5);

        if (coverage <= 0) {
          // fully outside the surface → transparent background (shows through).
          setPixel(data, idx, 0, 0, 0, 0);
        } else {
          // coverage in (0,1] → shade once and composite at that coverage.
          // coverage===1 is the hard-inside fast path (fully opaque); 0<cov<1
          // is the anti-aliased rim. shadeGooey runs exactly once either way.
          surfaceNormal();
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
    // smooth audio level — m3: guard against a non-finite audioLevel (NaN/∞)
    // which would poison `level` permanently (NaN propagates through every
    // subsequent frame's swell/radius math).
    const lvl = Number.isFinite(s.audioLevel) ? s.audioLevel : 0;
    level += (lvl - level) * 0.3;
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
