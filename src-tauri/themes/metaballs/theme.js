// src/theme-engine/builtin/metaballs/index.ts
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
}
var MAT = {
  albedoBaseR: 50,
  albedoBaseG: 54,
  albedoBaseB: 60,
  tintDesat: 0.3,
  tintScale: 0.14,
  aoFloor: 0.45,
  aoRange: 0.55,
  envFloor: 0.2,
  envSky: 0.95,
  envFloorBounce: 0.3,
  skyEdge: 0.6,
  floorEdge: 0.3,
  envBandSlope: 6,
  envTint: 0.9,
  bandCenter: 0.66,
  bandWidth: 5.5,
  band2Center: 0.32,
  band2Width: 6.5,
  band2Scale: 0.7,
  sheenScale: 150,
  iridFresWeight: 0.6,
  iridBandWeight: 0.12,
  iridClamp: 0.7,
  specBase: 0.85,
  specEnergy: 0.6,
  hotBase: 0.6,
  hotEnergy: 0.5,
  exposure: 1.1
};
function tonemap(v, exposure) {
  const x = v / 255 * exposure;
  const y = x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14);
  return clamp01(y) * 255;
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function mix(a, b, t) {
  return a * (1 - t) + b * t;
}
function setPixel(data, idx, r, g, b, a) {
  data[idx] = Math.min(255, r);
  data[idx + 1] = Math.min(255, g);
  data[idx + 2] = Math.min(255, b);
  data[idx + 3] = Math.round(a * 255);
}
function mount(container, api) {
  const cfg = api.params && typeof api.params === "object" ? api.params : {};
  const W = api.size.width;
  const H = api.size.height;
  const DEFAULT_PALETTE = ["#ff6a3d", "#ff2d77", "#8a4bff", "#1fb6ff", "#19f0b0"];
  const isHex = (v) => typeof v === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(v.trim());
  const validHex = Array.isArray(cfg.palette) ? cfg.palette.filter(isHex) : [];
  const palette = (validHex.length > 0 ? validHex : DEFAULT_PALETTE).map(hexToRgb);
  const IRID_N = 256;
  const iridR = new Float64Array(IRID_N);
  const iridG = new Float64Array(IRID_N);
  const iridB = new Float64Array(IRID_N);
  for (let i = 0;i < IRID_N; i++) {
    const a = i / IRID_N * Math.PI * 2;
    iridR[i] = 128 + 127 * Math.sin(a + 0);
    iridG[i] = 128 + 127 * Math.sin(a + 2.094);
    iridB[i] = 128 + 127 * Math.sin(a + 4.188);
  }
  function iridIndex(phase) {
    const f = phase - Math.floor(phase);
    return f * IRID_N | 0;
  }
  const POW90 = new Float64Array(256);
  const POW220 = new Float64Array(256);
  for (let i = 0;i < 256; i++) {
    const n = i / 255;
    POW90[i] = Math.pow(n, 90);
    POW220[i] = Math.pow(n, 220);
  }
  const blobCount = Math.max(2, Math.min(8, Math.round(Number(cfg.blobCount) || 5)));
  const t = Number(cfg.threshold);
  const threshold = Number.isFinite(t) ? t : 1;
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
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(W, H);
  const data = image.data;
  const seed = Math.random() * 1000;
  const blobs = [];
  for (let i = 0;i < blobCount; i++) {
    const ang = i / blobCount * Math.PI * 2 + seed + Math.sin(seed + i) * 0.8;
    const rad = Math.min(W, H) * (0.12 + 0.1 * ((Math.sin(seed * 3 + i * 2.7) + 1) / 2));
    blobs.push({
      x: W / 2 + Math.cos(ang) * rad,
      y: H / 2 + Math.sin(ang) * rad,
      vx: Math.cos(ang) * 0.6,
      vy: Math.sin(ang) * 0.6,
      baseR: 4.5 + i % 3 * 1.6,
      r: 4.5,
      color: palette[i % palette.length],
      phase: i * 1.3 + seed,
      binIndex: 2 + i * 2
    });
  }
  let level = 0;
  let mode = "idle";
  let bins = [];
  let raf = 0;
  let time = 0;
  let paused = false;
  function modeEnergy() {
    switch (mode) {
      case "recording":
        return 1;
      case "transcribing":
        return 0.55;
      case "error":
        return 0.7;
      default:
        return 0.3;
    }
  }
  function step() {
    time += 1;
    const energy = modeEnergy();
    const renderThrottled = mode === "idle" && level < 0.01 && time % 2 !== 0;
    const swell = 1 + level * 0.4 + (mode === "recording" ? 0.1 : 0);
    const cx = W / 2;
    const cy = H / 2;
    for (let i = 0;i < blobs.length; i++) {
      const b = blobs[i];
      b.vx += (cx - b.x) * 0.0022;
      b.vy += (cy - b.y) * 0.0022;
      for (let j = i + 1;j < blobs.length; j++) {
        const o = blobs[j];
        const dx = o.x - b.x;
        const dy = o.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.001;
        const want = (b.r + o.r) * 1.05;
        const f = (dist - want) * 0.0013;
        const ux = dx / dist, uy = dy / dist;
        b.vx += ux * f;
        b.vy += uy * f;
        o.vx -= ux * f;
        o.vy -= uy * f;
      }
    }
    for (let i = 0;i < blobs.length; i++) {
      const b = blobs[i];
      const binv = bins.length ? bins[Math.min(bins.length - 1, b.binIndex)] || 0 : 0;
      const speed = 0.5 + energy * 0.7;
      b.x += b.vx * speed;
      b.y += b.vy * speed;
      b.vx += Math.sin(time * 0.02 + b.phase) * 0.03;
      b.vy += Math.cos(time * 0.023 + b.phase * 1.4) * 0.03;
      b.vx = Math.max(-1.1, Math.min(1.1, b.vx * 0.99));
      b.vy = Math.max(-1.1, Math.min(1.1, b.vy * 0.99));
      const breathe = 1 + 0.1 * Math.sin(time * 0.05 + b.phase);
      const maxR = Math.min(W, H) * 0.13;
      b.r = Math.min(maxR, b.baseR * swell * breathe * (1 + binv * 0.3));
      const pad = b.r * 1.4;
      if (b.x < pad) {
        b.x = pad;
        b.vx = Math.abs(b.vx);
      }
      if (b.x > W - pad) {
        b.x = W - pad;
        b.vx = -Math.abs(b.vx);
      }
      if (b.y < pad) {
        b.y = pad;
        b.vy = Math.abs(b.vy);
      }
      if (b.y > H - pad) {
        b.y = H - pad;
        b.vy = -Math.abs(b.vy);
      }
    }
    if (!renderThrottled)
      render(energy);
    raf = requestAnimationFrame(step);
  }
  function render(energy) {
    const errTint = mode === "error" ? 1 : 0;
    const {
      albedoBaseR,
      albedoBaseG,
      albedoBaseB,
      tintDesat,
      tintScale,
      aoFloor,
      aoRange,
      envFloor,
      envSky,
      envFloorBounce,
      skyEdge,
      floorEdge,
      envBandSlope,
      envTint,
      bandCenter,
      bandWidth,
      band2Center,
      band2Width,
      band2Scale,
      sheenScale,
      iridFresWeight,
      iridBandWeight,
      iridClamp,
      specBase,
      specEnergy,
      hotBase,
      hotEnergy,
      exposure
    } = MAT;
    const Llen = Math.sqrt(0.5 * 0.5 + 0.72 * 0.72 + 0.55 * 0.55);
    const Lx = -0.5 / Llen, Ly = -0.72 / Llen, Lz = 0.55 / Llen;
    let Hx = Lx, Hy = Ly, Hz = Lz + 1;
    const Hl = Math.sqrt(Hx * Hx + Hy * Hy + Hz * Hz);
    Hx /= Hl;
    Hy /= Hl;
    Hz /= Hl;
    data.fill(0);
    let minX = W, minY = H, maxX = 0, maxY = 0, maxR = 0;
    for (let i = 0;i < blobs.length; i++) {
      const b = blobs[i];
      if (b.x - b.r < minX)
        minX = b.x - b.r;
      if (b.x + b.r > maxX)
        maxX = b.x + b.r;
      if (b.y - b.r < minY)
        minY = b.y - b.r;
      if (b.y + b.r > maxY)
        maxY = b.y + b.r;
      if (b.r > maxR)
        maxR = b.r;
      bx[i] = b.x;
      by[i] = b.y;
      brr[i] = b.r * b.r;
      bcr[i] = b.color.r;
      bcg[i] = b.color.g;
      bcb[i] = b.color.b;
    }
    const padThr = threshold > 0 ? Math.min(1, threshold) : 1;
    const boxPad = Math.ceil(4 + maxR * (Math.sqrt(blobCount) / Math.sqrt(padThr)));
    const x0 = Math.max(0, Math.floor(minX - boxPad));
    const x1 = Math.min(W, Math.ceil(maxX + boxPad));
    const y0 = Math.max(0, Math.floor(minY - boxPad));
    const y1 = Math.min(H, Math.ceil(maxY + boxPad));
    const fld = { field: 0, gx: 0, gy: 0, cr: 0, cg: 0, cb: 0, wsum: 0 };
    const nrm = { nx: 0, ny: 0, nz: 0 };
    const shaded = { r: 0, g: 0, b: 0 };
    function sampleField(px, py) {
      let field = 0;
      let cr = 0, cg = 0, cb = 0, wsum = 0;
      let gx = 0, gy = 0;
      for (let i = 0;i < blobCount; i++) {
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
        gx += -2 * rr * dx / (d2 * d2);
        gy += -2 * rr * dy / (d2 * d2);
      }
      fld.field = field;
      fld.gx = gx;
      fld.gy = gy;
      fld.cr = cr;
      fld.cg = cg;
      fld.cb = cb;
      fld.wsum = wsum;
    }
    function fieldAt(px, py) {
      let field = 0;
      for (let i = 0;i < blobCount; i++) {
        const dx = px - bx[i];
        const dy = py - by[i];
        field += brr[i] / (dx * dx + dy * dy + 1);
      }
      return field;
    }
    function surfaceNormal() {
      const t2 = clamp01((fld.field - threshold) / 1.6);
      const nz = Math.sqrt(Math.min(1, t2 + 0.04));
      const horiz = Math.sqrt(Math.max(0, 1 - nz * nz));
      const glen = Math.sqrt(fld.gx * fld.gx + fld.gy * fld.gy) + 0.000001;
      nrm.nx = -fld.gx / glen * horiz;
      nrm.ny = -fld.gy / glen * horiz;
      nrm.nz = nz;
    }
    function shadeMetal(alpha) {
      const ar = fld.cr / fld.wsum, ag = fld.cg / fld.wsum, ab = fld.cb / fld.wsum;
      const { nx, ny, nz } = nrm;
      const ndh = Math.max(0, nx * Hx + ny * Hy + nz * Hz);
      const ndhI = ndh < 1 ? ndh * 255 | 0 : 255;
      const spec = POW90[ndhI] * (specBase + energy * specEnergy);
      const om = 1 - nz;
      const fres = om * om * Math.sqrt(om);
      const lum = ar * 0.299 + ag * 0.587 + ab * 0.114;
      const albR = albedoBaseR + (lum + (ar - lum) * tintDesat) * tintScale;
      const albG = albedoBaseG + (lum + (ag - lum) * tintDesat) * tintScale;
      const albB = albedoBaseB + (lum + (ab - lum) * tintDesat) * tintScale;
      const ao = aoFloor + aoRange * nz;
      const Rx = -2 * nz * nx;
      const Ry = -2 * nz * ny;
      const ry = 0.5 - Ry * 0.85 + Rx * 0.15;
      const sky = clamp01((ry - skyEdge) * envBandSlope);
      const floor = clamp01((floorEdge - ry) * envBandSlope);
      const env = envFloor + envSky * sky + envFloorBounce * floor;
      const bnd = Math.max(0, 1 - Math.abs(ry - bandCenter) * bandWidth);
      const bnd2 = Math.max(0, 1 - Math.abs(ry - band2Center) * band2Width);
      const band = bnd * bnd * (bnd * bnd);
      const band2 = bnd2 * bnd2 * (bnd2 * bnd2) * band2Scale;
      const iphase = fres * 1.3 + (nx * 0.5 + ny * 0.5) * 0.4 + 0.15 + time * 0.004;
      const iri = iridIndex(iphase);
      const irR = iridR[iri], irG = iridG[iri], irB = iridB[iri];
      const edgeFade = alpha < 1 ? alpha * alpha * (3 - 2 * alpha) : 1;
      let iAmt = (fres * iridFresWeight + band * iridBandWeight) * edgeFade;
      if (iAmt > iridClamp)
        iAmt = iridClamp;
      const sheen = (band + band2) * sheenScale;
      let baseR = albR * ao + ar * env * envTint + sheen;
      let baseG = albG * ao + ag * env * envTint + sheen;
      let baseB = albB * ao + ab * env * envTint + sheen;
      baseR = mix(baseR, irR, iAmt);
      baseG = mix(baseG, irG, iAmt);
      baseB = mix(baseB, irB, iAmt);
      let r = baseR + spec * 255;
      let g = baseG + spec * 255;
      let bl = baseB + spec * 255;
      const hot = POW220[ndhI] * 255 * (hotBase + energy * hotEnergy);
      r += hot;
      g += hot;
      bl += hot;
      if (errTint) {
        r = r * 1.2 + 60;
        g *= 0.16;
        bl *= 0.13;
      }
      shaded.r = tonemap(r, exposure);
      shaded.g = tonemap(g, exposure);
      shaded.b = tonemap(bl, exposure);
    }
    for (let py = y0;py < y1; py++) {
      for (let px = x0;px < x1; px++) {
        sampleField(px, py);
        const idx = (py * W + px) * 4;
        const field = fld.field;
        if (field >= threshold) {
          surfaceNormal();
          shadeMetal(1);
          setPixel(data, idx, shaded.r, shaded.g, shaded.b, 1);
        } else if (field >= threshold * 0.82) {
          let inside = 0;
          if (fieldAt(px - 0.3, py - 0.3) >= threshold)
            inside++;
          if (fieldAt(px + 0.3, py - 0.3) >= threshold)
            inside++;
          if (fieldAt(px - 0.3, py + 0.3) >= threshold)
            inside++;
          if (fieldAt(px + 0.3, py + 0.3) >= threshold)
            inside++;
          if (inside > 0) {
            surfaceNormal();
            shadeMetal(1);
            setPixel(data, idx, shaded.r, shaded.g, shaded.b, inside / 4);
          } else {
            setPixel(data, idx, 0, 0, 0, 0);
          }
        } else {
          setPixel(data, idx, 0, 0, 0, 0);
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const unsubscribe = api.onState((s) => {
    mode = s.mode;
    bins = s.spectrumBins || [];
    level += (s.audioLevel - level) * 0.3;
  });
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
    }
  };
}
export {
  mount
};
