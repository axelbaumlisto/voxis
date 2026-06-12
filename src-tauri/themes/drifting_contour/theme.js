// src/theme-engine/renderers/shared.ts
var PERM = [
  151,
  160,
  137,
  91,
  90,
  15,
  131,
  13,
  201,
  95,
  96,
  53,
  194,
  233,
  7,
  225,
  140,
  36,
  103,
  30,
  69,
  142,
  8,
  99,
  37,
  240,
  21,
  10,
  23,
  190,
  6,
  148,
  247,
  120,
  234,
  75,
  0,
  26,
  197,
  62,
  94,
  252,
  219,
  203,
  117,
  35,
  11,
  32,
  57,
  177,
  33,
  88,
  237,
  149,
  56,
  87,
  174,
  20,
  125,
  136,
  171,
  168,
  68,
  175,
  74,
  165,
  71,
  134,
  139,
  48,
  27,
  166,
  77,
  146,
  158,
  231,
  83,
  111,
  229,
  122,
  60,
  211,
  133,
  230,
  220,
  105,
  92,
  41,
  55,
  46,
  245,
  40,
  244,
  102,
  143,
  54,
  65,
  25,
  63,
  161,
  1,
  216,
  80,
  73,
  209,
  76,
  132,
  187,
  208,
  89,
  18,
  169,
  200,
  196,
  135,
  130,
  116,
  188,
  159,
  86,
  164,
  100,
  109,
  198,
  173,
  186,
  3,
  64,
  52,
  217,
  226,
  250,
  124,
  123,
  5,
  202,
  38,
  147,
  118,
  126,
  255,
  82,
  85,
  212,
  207,
  206,
  59,
  227,
  47,
  16,
  58,
  17,
  182,
  189,
  28,
  42,
  223,
  183,
  170,
  213,
  119,
  248,
  152,
  2,
  44,
  154,
  163,
  70,
  221,
  153,
  101,
  155,
  167,
  43,
  172,
  9,
  129,
  22,
  39,
  253,
  19,
  98,
  108,
  110,
  79,
  113,
  224,
  232,
  178,
  185,
  112,
  104,
  218,
  246,
  97,
  228,
  251,
  34,
  242,
  193,
  238,
  210,
  144,
  12,
  191,
  179,
  162,
  241,
  81,
  51,
  145,
  235,
  249,
  14,
  239,
  107,
  49,
  192,
  214,
  31,
  181,
  199,
  106,
  157,
  184,
  84,
  204,
  176,
  115,
  121,
  50,
  45,
  127,
  4,
  150,
  254,
  138,
  236,
  205,
  93,
  222,
  114,
  67,
  29,
  24,
  72,
  243,
  141,
  128,
  195,
  78,
  66,
  215,
  61,
  156,
  180
];
var PERM2 = [...PERM, ...PERM];
function smoothstep(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function noise2D(x, y) {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const sx = smoothstep(xf);
  const sy = smoothstep(yf);
  const v00 = PERM2[PERM2[xi] + yi];
  const v10 = PERM2[PERM2[xi + 1] + yi];
  const v01 = PERM2[PERM2[xi] + yi + 1];
  const v11 = PERM2[PERM2[xi + 1] + yi + 1];
  const nx0 = lerp(v00 / 255, v10 / 255, sx);
  const nx1 = lerp(v01 / 255, v11 / 255, sx);
  const val = lerp(nx0, nx1, sy);
  return val * 2 - 1;
}
function fbm(x, y, octaves, lacunarity, gain) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0;i < octaves; i++) {
    value += noise2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return value / maxValue;
}
function catmullRom(points, segmentsPerSpan) {
  const n = points.length;
  if (n < 2)
    return [...points];
  const result = [];
  const segment = (p0, p1, p2, p3, steps) => {
    for (let i = 0;i < steps; i++) {
      const t = i / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      result.push([x, y]);
    }
  };
  for (let i = 0;i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    segment(p0, p1, p2, p3, segmentsPerSpan);
  }
  return result;
}
function integrateDeformation(prevDeform, targetDeform, attack, release) {
  const a = Math.max(0, Math.min(1, attack));
  const r = Math.max(0, Math.min(1, release));
  const n = prevDeform.length;
  const result = new Array(n);
  for (let i = 0;i < n; i++) {
    const prev = prevDeform[i];
    const tgt = targetDeform[i];
    const rate = Math.abs(tgt) >= Math.abs(prev) ? a : r;
    result[i] = prev + (tgt - prev) * rate;
  }
  return result;
}
function hsla(h, s, l, a) {
  return `hsla(${h},${Math.round(s * 100)}%,${Math.round(l * 100)}%,${a})`;
}
var TAU = Math.PI * 2;
function growthLevel(prevGrowth, audioLevel, mode, attack, release) {
  const target = mode === "recording" ? Math.max(0, Math.min(1, audioLevel)) : 0;
  const rate = target >= prevGrowth ? attack : release;
  const raw = prevGrowth + (target - prevGrowth) * rate;
  return Math.max(0, Math.min(1, raw));
}

// src/theme-engine/renderers/cell.ts
var CELL_DEFAULTS = {
  noiseScale: 0.9,
  octaves: 4,
  lacunarity: 2.3,
  gain: 0.55,
  timeScale: 0.3,
  membraneAmplitude: 0.35,
  energyDrive: 0.8,
  push: 3,
  sharpness: 4,
  intentDrift: 0.08,
  idle: 0.1,
  levelGain: 0.7,
  hueSpread: 40,
  shimmerSpeed: 0.5,
  hueBoost: 20,
  fillAlpha: 0.18,
  tension: 0.15,
  radiusFraction: 0.34,
  attack: 0.2,
  release: 0.005,
  nucleusRadius: 0.28,
  nucleusPulse: 0.1,
  nucleusWander: 0.14,
  nucleusDrift: 0.12,
  nucleusAlpha: 0.55,
  ciliaCount: 18,
  ciliaLength: 0.45,
  ciliaGrowthBoost: 0.6,
  ciliaWave: 0.5,
  ciliaWaveSpeed: 1.6,
  growthAttack: 0.05,
  growthRelease: 0.012,
  growthSwell: 0.22,
  startleSensitivity: 2.2,
  startleDecay: 0.86,
  startleMaxPx: 5,
  startleBaselineRate: 0.08,
  idleMorphAmplitude: 0.18,
  idleMorphSpeed: 0.25,
  idleMorphPeriod: 7,
  idleMorphFloor: 0.25
};
function cellEnergy(mode, audioLevel, t, idle, levelGain) {
  switch (mode) {
    case "idle":
      return idle * (1 + Math.sin(t * 0.8) * 0.25);
    case "recording":
      return Math.max(0, Math.min(1, idle + audioLevel * levelGain));
    case "transcribing":
      return Math.max(0, Math.min(1, idle * 0.72 + audioLevel * 0.12));
    case "error":
      return idle;
    default:
      return idle;
  }
}
function cellRadius(angle, t, energy, params) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const noiseVal = fbm(dx * params.noiseScale + t * params.timeScale * 0.3, dy * params.noiseScale + t * params.timeScale * 0.2, params.octaves, params.lacunarity, params.gain);
  const amp = params.idle + energy * params.energyDrive;
  return 1 + noiseVal * params.membraneAmplitude * amp;
}
function pseudopodOffset(angle, t, audioLevel, energy, params) {
  let total = 0;
  const numLobes = 2;
  for (let i = 0;i < numLobes; i++) {
    const seed = (i + 1) * 1000;
    const theta = TAU * noise2D(seed, t * params.intentDrift);
    let delta = angle - theta;
    delta = ((delta + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const lobe = Math.pow(Math.max(0, Math.cos(delta)), params.sharpness);
    const audioDrive = params.idle + audioLevel * params.levelGain;
    const amp = params.push * audioDrive * energy;
    total += lobe * amp;
  }
  return total;
}
function ciliaEndpoints(cx, cy, baseR, t, energy, growth, params) {
  const out = [];
  const n = Math.max(1, params.ciliaCount);
  const lenPx = baseR * (params.ciliaLength + growth * params.ciliaGrowthBoost) * (0.7 + energy * 0.6);
  for (let k = 0;k < n; k++) {
    const baseAngle = k / n * TAU;
    const sway = noise2D(k * 5.3, t * params.ciliaWaveSpeed) * params.ciliaWave;
    const tipAngle = baseAngle + sway;
    const x1 = cx + baseR * Math.cos(baseAngle);
    const y1 = cy + baseR * Math.sin(baseAngle);
    const x2 = cx + (baseR + lenPx) * Math.cos(tipAngle);
    const y2 = cy + (baseR + lenPx) * Math.sin(tipAngle);
    out.push({ x1, y1, x2, y2 });
  }
  return out;
}
function startleOffset(prevMag, level, baseline, sensitivity, decay) {
  const edge = Math.max(0, (level - baseline) * sensitivity);
  const decayed = prevMag * Math.max(0, Math.min(1, decay));
  return Math.max(0, Math.min(1, Math.max(decayed, edge)));
}
function idleMorph(sampleCount, t, params) {
  const out = [];
  const phase = (Math.cos(TAU * t / Math.max(0.01, params.idleMorphPeriod)) + 1) / 2;
  const env = params.idleMorphFloor + (1 - params.idleMorphFloor) * phase;
  const travel = t * params.idleMorphSpeed;
  for (let i = 0;i < sampleCount; i++) {
    const a = i / sampleCount * TAU;
    const n1 = noise2D(Math.cos(a) * 1.6 + travel, Math.sin(a) * 1.6 - travel * 0.7);
    const n2 = noise2D(Math.cos(a) * 3.1 - travel * 0.5, Math.sin(a) * 3.1 + travel * 0.9);
    const raw = n1 * 0.65 + n2 * 0.35;
    let d = raw * params.idleMorphAmplitude * env;
    const cap = params.idleMorphAmplitude;
    if (d > cap)
      d = cap;
    else if (d < -cap)
      d = -cap;
    out.push(d);
  }
  return out;
}
function iridescentHue(angle, t, audioLevel, baseHue, params) {
  const norm = (angle % TAU + TAU) % TAU / TAU;
  let hue = baseHue + norm * params.hueSpread + t * params.shimmerSpeed + audioLevel * params.hueBoost;
  hue = (hue % 360 + 360) % 360;
  return hue;
}
function buildTargetDeformation(width, height, bins, t, audioLevel, energy, params, idleFactor = 0) {
  const sampleCount = 96;
  const baseR = resolveBaseRadius(width, height, params, 0);
  const invBaseR = baseR > 0 ? 1 / baseR : 1;
  const morph = idleFactor > 0 ? idleMorph(sampleCount, t, params) : null;
  const out = [];
  for (let i = 0;i < sampleCount; i++) {
    const angle = i / sampleCount * TAU;
    const normalized = (angle % TAU + TAU) % TAU / TAU;
    const binIdx = bins.length === 0 ? 0 : Math.min(Math.floor(normalized * bins.length), bins.length - 1);
    const binLevel = bins.length === 0 ? 0 : bins[binIdx];
    const rFbm = cellRadius(angle, t, energy, params);
    const fbmDeform = rFbm - 1;
    const rPseudo = pseudopodOffset(angle, t, audioLevel, energy, params);
    const pseudoDeform = rPseudo * invBaseR;
    const binDeform = binLevel * 0.15 * energy;
    const idle = morph ? morph[i] * idleFactor : 0;
    out.push(fbmDeform + pseudoDeform + binDeform + idle);
  }
  return out;
}
function nucleusTransform(t, audioLevel, baseR, params) {
  const rawCx = baseR * params.nucleusWander * noise2D(137, t * params.nucleusDrift);
  const rawCy = baseR * params.nucleusWander * noise2D(241, t * params.nucleusDrift);
  const idleBreath = Math.sin(t * 1.3) * params.nucleusPulse * 0.25;
  let r = baseR * (params.nucleusRadius + audioLevel * params.nucleusPulse + idleBreath);
  const MIN_PX_RADIUS = 2.5;
  r = Math.max(MIN_PX_RADIUS, r);
  const safeInner = baseR * 0.55;
  const offsetMag = Math.sqrt(rawCx * rawCx + rawCy * rawCy);
  const maxOffsetMag = Math.max(0, safeInner - r);
  if (maxOffsetMag <= 0) {
    return { cx: 0, cy: 0, r: Math.max(0, safeInner) };
  }
  let cx;
  let cy;
  if (offsetMag <= maxOffsetMag) {
    cx = rawCx;
    cy = rawCy;
  } else {
    const scale = maxOffsetMag / offsetMag;
    cx = rawCx * scale;
    cy = rawCy * scale;
  }
  return { cx, cy, r };
}
function serializeCellState(s) {
  return JSON.stringify(s);
}
function parseCellState(raw) {
  if (raw === null)
    return null;
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null || typeof obj.driftPhase !== "number" || !Number.isFinite(obj.driftPhase) || typeof obj.growth !== "number" || !Number.isFinite(obj.growth) || typeof obj.elapsed !== "number" || !Number.isFinite(obj.elapsed)) {
      return null;
    }
    if (obj.elapsed < 0 || obj.elapsed >= 1e7)
      return null;
    if (obj.driftPhase < -1e7 || obj.driftPhase > 1e7)
      return null;
    return { driftPhase: obj.driftPhase, growth: obj.growth, elapsed: obj.elapsed };
  } catch {
    return null;
  }
}
function restoreSeed(saved, now) {
  const elapsed = saved.elapsed > 0 ? saved.elapsed : 0;
  return {
    startedAt: now - elapsed * 1000,
    driftPhaseOffset: saved.driftPhase - elapsed
  };
}
function resolveBaseRadius(width, height, params, growth) {
  const fallbackR = Math.min(width, height) * params.radiusFraction;
  const rawBaseR = params.baseRadiusPx ?? fallbackR;
  return rawBaseR * (1 + growth * params.growthSwell);
}
function cellReach(baseR, params) {
  const ciliaLength = params.ciliaLength ?? 0;
  const ciliaGrowthBoost = params.ciliaGrowthBoost ?? 0;
  const startleMaxPx = params.startleMaxPx ?? 0;
  const membraneOuter = baseR * 1.4;
  const ciliaOuter = baseR + baseR * (ciliaLength + ciliaGrowthBoost) * 1.3;
  return Math.max(membraneOuter, ciliaOuter) + startleMaxPx;
}
function cellDrift(t, width, height, baseR, params) {
  const reach = cellReach(baseR, params);
  const inset = Math.max(params.driftMargin ?? 4, reach);
  const speed = params.driftSpeed ?? 0.03;
  const travelRangeX = width - 2 * inset;
  const travelRangeY = height - 2 * inset;
  const phaseX = t * speed + 1000;
  const phaseY = t * speed + 2000;
  const noiseX = noise2D(phaseX, 0);
  const noiseY = noise2D(phaseY, 0);
  const mapTo = (noise, lo, hi) => lo + (noise * 0.5 + 0.5) * (hi - lo);
  const cx = travelRangeX > 0 ? mapTo(noiseX, inset, width - inset) : width / 2;
  const cy = travelRangeY > 0 ? mapTo(noiseY, inset, height - inset) : height / 2;
  return { cx, cy };
}
function createCellRenderer(container, opts) {
  const params = { ...CELL_DEFAULTS, ...opts.params ?? {} };
  const baseHue = opts.baseHue ?? 34;
  const { width, height } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let latestState = {
    mode: "idle",
    audioLevel: 0,
    spectrumBins: new Array(32).fill(0)
  };
  let deform = null;
  let growth = 0;
  let startle = 0;
  let baseline = 0;
  const PERSIST_KEY = "talri.cell.state.v1";
  let driftPhaseOffset = 0;
  let lastPersist = 0;
  let startedAt = performance.now();
  if (typeof localStorage !== "undefined") {
    try {
      const saved = parseCellState(localStorage.getItem(PERSIST_KEY));
      if (saved) {
        growth = saved.growth;
        const seed = restoreSeed(saved, performance.now());
        startedAt = seed.startedAt;
        driftPhaseOffset = seed.driftPhaseOffset;
      }
    } catch {}
  }
  let rafId = null;
  const tick = () => {
    const t = (performance.now() - startedAt) / 1000;
    const s = latestState;
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      const energy = cellEnergy(s.mode, s.audioLevel, t, params.idle, params.levelGain);
      growth = growthLevel(growth, s.audioLevel, s.mode, params.growthAttack, params.growthRelease);
      baseline = baseline + (s.audioLevel - baseline) * params.startleBaselineRate;
      startle = startleOffset(startle, s.audioLevel, baseline, params.startleSensitivity, params.startleDecay);
      const startleAngle = TAU * noise2D(900.5, t * 0.7);
      const sdx = Math.cos(startleAngle) * startle * params.startleMaxPx;
      const sdy = Math.sin(startleAngle) * startle * params.startleMaxPx;
      const recordingFade = s.mode === "recording" ? 0.3 : 1;
      const idleFactor = Math.max(0, 1 - s.audioLevel * 3) * recordingFade;
      const targetDeform = buildTargetDeformation(width, height, s.spectrumBins, t, s.audioLevel, energy, params, idleFactor);
      deform = deform ? integrateDeformation(deform, targetDeform, params.attack, params.release) : targetDeform.slice();
      const baseR = resolveBaseRadius(width, height, params, growth);
      const drift = cellDrift(t + driftPhaseOffset, width, height, baseR, params);
      const cx = drift.cx + sdx;
      const cy = drift.cy + sdy;
      const maxRadius = height * 0.46;
      const floorRadius = baseR * 0.35;
      const sampleCount = deform.length;
      const smoothedPoints = [];
      for (let i = 0;i < sampleCount; i++) {
        const angle = i / sampleCount * TAU;
        const rawRadius = baseR * (1 + deform[i]);
        const radius = Math.max(floorRadius, Math.min(maxRadius, rawRadius));
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        smoothedPoints.push([x, y]);
      }
      const splinePoints = catmullRom(smoothedPoints, 4);
      if (splinePoints.length >= 3) {
        {
          const cilia = ciliaEndpoints(cx, cy, baseR, t, energy, growth, params);
          ctx.lineCap = "round";
          ctx.lineWidth = 1;
          for (const c of cilia) {
            ctx.strokeStyle = hsla(baseHue, 0.6, 0.6, 0.35 + 0.35 * energy);
            ctx.beginPath();
            ctx.moveTo(c.x1, c.y1);
            ctx.lineTo(c.x2, c.y2);
            ctx.stroke();
          }
        }
        ctx.fillStyle = hsla(baseHue, 0.7, 0.55, params.fillAlpha);
        ctx.beginPath();
        ctx.moveTo(splinePoints[0][0], splinePoints[0][1]);
        for (let i = 1;i < splinePoints.length; i++) {
          ctx.lineTo(splinePoints[i][0], splinePoints[i][1]);
        }
        ctx.closePath();
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, baseR * 0.9));
        grad.addColorStop(0, hsla(baseHue + 10, 0.5, 0.7, params.fillAlpha * 0.5));
        grad.addColorStop(1, hsla(baseHue, 0.7, 0.45, params.fillAlpha));
        ctx.fillStyle = grad;
        ctx.fill();
        const nucleus = nucleusTransform(t, s.audioLevel, baseR, params);
        if (nucleus.r >= 2.5) {
          const nx = cx + nucleus.cx;
          const ny = cy + nucleus.cy;
          const nr = nucleus.r;
          const nucGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
          nucGrad.addColorStop(0, hsla(baseHue - 5, 0.8, 0.48, params.nucleusAlpha));
          nucGrad.addColorStop(0.4, hsla(baseHue - 8, 0.75, 0.4, params.nucleusAlpha));
          nucGrad.addColorStop(1, hsla(baseHue - 10, 0.65, 0.3, params.nucleusAlpha * 0.7));
          ctx.fillStyle = nucGrad;
          ctx.beginPath();
          ctx.arc(nx, ny, nr, 0, TAU);
          ctx.fill();
          ctx.fillStyle = hsla(baseHue + 5, 0.55, 0.72, params.nucleusAlpha * 0.8);
          ctx.beginPath();
          ctx.arc(nx, ny, nr * 0.22, 0, TAU);
          ctx.fill();
        }
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = hsla(baseHue, 0.8, 0.6, 0.9);
        ctx.lineWidth = 1.8;
        ctx.stroke();
        const segments = smoothedPoints.length;
        const pointsPerSegment = splinePoints.length / segments;
        for (let seg = 0;seg < segments; seg++) {
          const segStart = Math.floor(seg * pointsPerSegment);
          const segEnd = seg === segments - 1 ? splinePoints.length : Math.floor((seg + 1) * pointsPerSegment);
          if (segEnd - segStart < 2)
            continue;
          const midPt = splinePoints[Math.floor((segStart + segEnd) / 2) % splinePoints.length];
          const midAngle = Math.atan2(midPt[1] - cy, midPt[0] - cx);
          const hue = iridescentHue(midAngle, t, s.audioLevel, baseHue, params);
          ctx.strokeStyle = hsla(hue, 0.85, 0.6, 0.85);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(splinePoints[segStart][0], splinePoints[segStart][1]);
          for (let i = segStart + 1;i < segEnd; i++) {
            ctx.lineTo(splinePoints[i][0], splinePoints[i][1]);
          }
          ctx.stroke();
        }
      }
    }
    const now = performance.now();
    if (now - lastPersist > 500 && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(PERSIST_KEY, serializeCellState({
          driftPhase: t + driftPhaseOffset,
          growth,
          elapsed: t
        }));
        lastPersist = now;
      } catch {}
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return {
    update(state) {
      latestState = state;
    },
    destroy() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      container.innerHTML = "";
    }
  };
}

// src/theme-engine/builtin/drifting_contour/index.ts
function mount(container, api) {
  const userParams = api.params && typeof api.params === "object" ? api.params : {};
  const renderer = createCellRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: 34,
    params: {
      noiseScale: 0.9,
      octaves: 4,
      lacunarity: 2.3,
      gain: 0.55,
      timeScale: 0.3,
      membraneAmplitude: 0.35,
      energyDrive: 0.8,
      push: 3,
      sharpness: 4,
      intentDrift: 0.08,
      idle: 0.1,
      levelGain: 0.7,
      hueSpread: 40,
      shimmerSpeed: 0.5,
      hueBoost: 20,
      fillAlpha: 0.18,
      tension: 0.15,
      ciliaCount: 18,
      ciliaLength: 0.4,
      ciliaGrowthBoost: 0.55,
      ciliaWave: 0.5,
      ciliaWaveSpeed: 1.6,
      growthAttack: 0.05,
      growthRelease: 0.012,
      baseRadiusPx: 16,
      driftSpeed: 0.03,
      driftMargin: 30,
      idleMorphAmplitude: 0.16,
      idleMorphSpeed: 0.22,
      idleMorphPeriod: 7,
      idleMorphFloor: 0.3,
      growthSwell: 0.2,
      startleSensitivity: 2.2,
      startleDecay: 0.86,
      startleMaxPx: 4,
      startleBaselineRate: 0.08,
      ...userParams
    }
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return {
    unmount() {
      unsubscribe();
      renderer.destroy();
    }
  };
}
export {
  mount
};
