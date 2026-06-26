// src/theme-engine/builtin/metaballs/index.ts
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
}
var MAT = {
  chromaBoost: 1.5,
  aoFloor: 0.48,
  aoRange: 0.52,
  ambient: 0.11,
  lightStr: 0.85,
  fillStr: 0.13,
  fillColR: 0.55,
  fillColG: 0.72,
  fillColB: 1,
  specExp: 10,
  sheenExp: 3,
  specBase: 0.09,
  specEnergy: 0.1,
  sheenStrength: 0.07,
  rimK: 2.2,
  domeStr: 1.1
};
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function hashU(x, y, salt) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 2246822519) >>> 0;
  h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
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
  const dpr = Math.min(2, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
  const CW = W * dpr;
  const CH = H * dpr;
  const DEFAULT_PALETTE = ["#ff6a3d", "#ff2d77", "#8a4bff", "#1fb6ff", "#19f0b0"];
  const isHex = (v) => typeof v === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(v.trim());
  const validHex = Array.isArray(cfg.palette) ? cfg.palette.filter(isHex) : [];
  const palette = (validHex.length > 0 ? validHex : DEFAULT_PALETTE).map(hexToRgb);
  const nStops = palette.length;
  const pr = new Float64Array(nStops);
  const pg = new Float64Array(nStops);
  const pb = new Float64Array(nStops);
  for (let i = 0;i < nStops; i++) {
    pr[i] = palette[i].r;
    pg[i] = palette[i].g;
    pb[i] = palette[i].b;
  }
  const specNorm = (MAT.specExp + 2) / (2 * Math.PI);
  const sheenNorm = (MAT.sheenExp + 2) / (2 * Math.PI);
  const specLUT = new Float64Array(256);
  const sheenLUT = new Float64Array(256);
  for (let i = 0;i < 256; i++) {
    const n = i / 255;
    specLUT[i] = specNorm * Math.pow(n, MAT.specExp);
    sheenLUT[i] = sheenNorm * Math.pow(n, MAT.sheenExp);
  }
  const blobCount = Math.max(2, Math.min(8, Math.round(Number(cfg.blobCount) || 5)));
  const t = Number(cfg.threshold);
  const threshold = Number.isFinite(t) && t > 0 ? t : 1;
  const bx = new Float64Array(blobCount);
  const by = new Float64Array(blobCount);
  const brr = new Float64Array(blobCount);
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(CW, CH);
  const data = image.data;
  const seed = Math.random() * 1000;
  const blobs = [];
  for (let i = 0;i < blobCount; i++) {
    const ang = i / blobCount * Math.PI * 2 + seed + Math.sin(seed + i) * 0.8;
    const rad = Math.min(CW, CH) * (0.16 + 0.12 * ((Math.sin(seed * 3 + i * 2.7) + 1) / 2));
    blobs.push({
      x: CW / 2 + Math.cos(ang) * rad,
      y: CH / 2 + Math.sin(ang) * rad,
      vx: Math.cos(ang) * 0.6 * dpr,
      vy: Math.sin(ang) * 0.6 * dpr,
      baseR: (6.8 + i % 3 * 2.4) * dpr,
      r: 6.8 * dpr,
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
    const renderThrottled = time % 2 !== 0;
    const swell = 1 + level * 0.4 + (mode === "recording" ? 0.1 : 0);
    const cx = CW / 2;
    const cy = CH / 2;
    for (let i = 0;i < blobs.length; i++) {
      const b = blobs[i];
      b.vx += (cx - b.x) * 0.0022;
      b.vy += (cy - b.y) * 0.0022;
      for (let j = i + 1;j < blobs.length; j++) {
        const o = blobs[j];
        const dx = o.x - b.x;
        const dy = o.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.001;
        const want = (b.r + o.r) * 0.92;
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
      b.vx += Math.sin(time * 0.02 + b.phase) * 0.03 * dpr;
      b.vy += Math.cos(time * 0.023 + b.phase * 1.4) * 0.03 * dpr;
      b.vx = Math.max(-1.1 * dpr, Math.min(1.1 * dpr, b.vx * 0.99));
      b.vy = Math.max(-1.1 * dpr, Math.min(1.1 * dpr, b.vy * 0.99));
      const breathe = 1 + 0.1 * Math.sin(time * 0.05 + b.phase);
      const maxR = Math.min(CW, CH) * 0.19;
      b.r = Math.min(maxR, b.baseR * swell * breathe * (1 + binv * 0.3));
      const pad = b.r * 1.4;
      if (b.x < pad) {
        b.x = pad;
        b.vx = Math.abs(b.vx);
      }
      if (b.x > CW - pad) {
        b.x = CW - pad;
        b.vx = -Math.abs(b.vx);
      }
      if (b.y < pad) {
        b.y = pad;
        b.vy = Math.abs(b.vy);
      }
      if (b.y > CH - pad) {
        b.y = CH - pad;
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
      chromaBoost,
      aoFloor,
      aoRange,
      ambient,
      lightStr,
      specBase,
      specEnergy,
      sheenStrength,
      fillStr,
      fillColR,
      fillColG,
      fillColB,
      rimK,
      domeStr
    } = MAT;
    const Llen = Math.sqrt(0.5 * 0.5 + 0.72 * 0.72 + 0.55 * 0.55);
    const Lx = -0.5 / Llen, Ly = -0.72 / Llen, Lz = 0.55 / Llen;
    const Flen = Math.sqrt(0.5 * 0.5 + 0.6 * 0.6 + 0.35 * 0.35);
    const Fx = 0.5 / Flen, Fy = 0.6 / Flen, Fz = 0.35 / Flen;
    let Hx = Lx, Hy = Ly, Hz = Lz + 1;
    const Hl = Math.sqrt(Hx * Hx + Hy * Hy + Hz * Hz);
    Hx /= Hl;
    Hy /= Hl;
    Hz /= Hl;
    const gradCx = CW / 2;
    const gradCy = CH / 2;
    const gradInvR = 1 / (Math.min(CW, CH) * 0.5);
    const domeInvR = 1 / (Math.min(CW, CH) * 0.32);
    const domeStrEff = domeStr * (1 - 0.25 * clamp01((level - 0.5) / 0.5));
    const gradPhase = time * 0.0016;
    const gradTheta = time * 0.0009;
    const gradAx = Math.cos(gradTheta);
    const gradAy = Math.sin(gradTheta);
    data.fill(0);
    let minX = CW, minY = CH, maxX = 0, maxY = 0, maxR = 0;
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
    }
    const padThr = Math.min(1, threshold);
    const boxPad = Math.ceil(4 * dpr + maxR * (Math.sqrt(blobCount) / Math.sqrt(padThr)));
    const x0 = Math.max(0, Math.floor(minX - boxPad));
    const x1 = Math.min(CW, Math.ceil(maxX + boxPad));
    const y0 = Math.max(0, Math.floor(minY - boxPad));
    const y1 = Math.min(CH, Math.ceil(maxY + boxPad));
    const fld = { field: 0, gx: 0, gy: 0 };
    const nrm = { nx: 0, ny: 0, nz: 0 };
    const shaded = { r: 0, g: 0, b: 0 };
    function sampleField(px, py) {
      let field = 0;
      let gx = 0, gy = 0;
      for (let i = 0;i < blobCount; i++) {
        const dx = px - bx[i];
        const dy = py - by[i];
        const d2 = dx * dx + dy * dy + 1;
        const rr = brr[i];
        const f = rr / d2;
        field += f;
        gx += -2 * rr * dx / (d2 * d2);
        gy += -2 * rr * dy / (d2 * d2);
      }
      fld.field = field;
      fld.gx = gx;
      fld.gy = gy;
    }
    function surfaceNormal(px, py) {
      const iraw = clamp01((fld.field - threshold) / (threshold * (rimK - 1)));
      const ic = iraw * iraw * (3 - 2 * iraw);
      const rimTilt = 1 - ic;
      const glen = Math.sqrt(fld.gx * fld.gx + fld.gy * fld.gy) + 0.000001;
      let ix = -fld.gx / glen * rimTilt;
      let iy = -fld.gy / glen * rimTilt;
      const ddx = px - gradCx;
      const ddy = py - gradCy;
      const dlen = Math.sqrt(ddx * ddx + ddy * ddy) + 0.000001;
      const dr = Math.min(1, dlen * domeInvR);
      const domeMag = domeStrEff * dr * ic;
      ix += ddx / dlen * domeMag;
      iy += ddy / dlen * domeMag;
      const ilen = Math.sqrt(ix * ix + iy * iy);
      const horiz = Math.min(1, ilen);
      const nz = Math.sqrt(Math.max(0, 1 - horiz * horiz));
      if (ilen > 0.000001) {
        nrm.nx = ix / ilen * horiz;
        nrm.ny = iy / ilen * horiz;
      } else {
        nrm.nx = 0;
        nrm.ny = 0;
      }
      nrm.nz = nz;
    }
    function shadeGooey(px, py) {
      const { nx, ny, nz } = nrm;
      let u = 0.5 + 0.5 * (gradAx * (px - gradCx) * gradInvR + gradAy * (py - gradCy) * gradInvR) + gradPhase;
      u -= Math.floor(u);
      const su = u * nStops;
      const s0 = Math.floor(su);
      const fr = su - s0;
      const i0 = s0 % nStops;
      const i1 = (i0 + 1) % nStops;
      const ar = pr[i0] + (pr[i1] - pr[i0]) * fr;
      const ag = pg[i0] + (pg[i1] - pg[i0]) * fr;
      const ab = pb[i0] + (pb[i1] - pb[i0]) * fr;
      const lum = ar * 0.299 + ag * 0.587 + ab * 0.114;
      const albR = Math.max(0, lum + (ar - lum) * chromaBoost);
      const albG = Math.max(0, lum + (ag - lum) * chromaBoost);
      const albB = Math.max(0, lum + (ab - lum) * chromaBoost);
      let lr, lg, lb;
      if (errTint) {
        lr = 0.85;
        lg = 0.02;
        lb = 0.02;
      } else {
        lr = albR / 255 * (albR / 255);
        lg = albG / 255 * (albG / 255);
        lb = albB / 255 * (albB / 255);
      }
      const ndl = nx * Lx + ny * Ly + nz * Lz;
      const w = Math.max(0, ndl * 0.8 + 0.2);
      const diff = ambient + lightStr * w;
      const ao = aoFloor + aoRange * nz;
      const ndf = Math.max(0, nx * Fx + ny * Fy + nz * Fz);
      const fill = fillStr * ndf;
      const ndh = Math.max(0, nx * Hx + ny * Hy + nz * Hz);
      const ndhI = ndh < 1 ? ndh * 255 | 0 : 255;
      const spec = specLUT[ndhI] * (specBase + energy * specEnergy) + sheenLUT[ndhI] * sheenStrength;
      const specR = spec * (0.85 + 0.15 * lr);
      const specG = spec * (0.85 + 0.15 * lg);
      const specB = spec * (0.85 + 0.15 * lb);
      const r = lr * (diff * ao + fill * fillColR) + specR;
      const g = lg * (diff * ao + fill * fillColG) + specG;
      const bl = lb * (diff * ao + fill * fillColB) + specB;
      const ditherFrame = time;
      const dR = hashU(px, py, ditherFrame * 6 + 1) + hashU(px, py, ditherFrame * 6 + 2) - 1;
      const dg = hashU(px, py, ditherFrame * 6 + 3) + hashU(px, py, ditherFrame * 6 + 4) - 1;
      const db = hashU(px, py, ditherFrame * 6 + 5) + hashU(px, py, ditherFrame * 6 + 6) - 1;
      shaded.r = Math.sqrt(clamp01(r)) * 255 + dR;
      shaded.g = Math.sqrt(clamp01(g)) * 255 + dg;
      shaded.b = Math.sqrt(clamp01(bl)) * 255 + db;
    }
    for (let py = y0;py < y1; py++) {
      for (let px = x0;px < x1; px++) {
        sampleField(px, py);
        const idx = (py * CW + px) * 4;
        const field = fld.field;
        const glen = Math.sqrt(fld.gx * fld.gx + fld.gy * fld.gy);
        const coverage = glen < 0.000000001 ? field >= threshold ? 1 : 0 : clamp01((field - threshold) / glen + 0.5);
        if (coverage <= 0) {
          setPixel(data, idx, 0, 0, 0, 0);
        } else {
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
    const lvl = Number.isFinite(s.audioLevel) ? s.audioLevel : 0;
    level += (lvl - level) * 0.3;
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
