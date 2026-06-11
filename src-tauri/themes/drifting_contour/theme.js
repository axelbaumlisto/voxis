// src/theme-engine/renderers/cell.ts
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
var CELL_DEFAULTS = {
  noiseScale: 0.9,
  octaves: 4,
  lacunarity: 2.3,
  gain: 0.55,
  timeScale: 0.3,
  push: 18,
  sharpness: 4,
  intentDrift: 0.08,
  idle: 0.06,
  levelGain: 0.7,
  hueSpread: 40,
  shimmerSpeed: 0.5,
  hueBoost: 15,
  fillAlpha: 0.18,
  tension: 0.15,
  radiusFraction: 0.34
};
var TAU = Math.PI * 2;
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
  const amplitude = Math.max(params.idle, energy);
  return 1 + noiseVal * 0.28 * amplitude;
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
    const amp = params.push * (params.idle + audioLevel * params.levelGain) * (energy / Math.max(0.01, params.idle + 0.01));
    total += lobe * amp;
  }
  return total;
}
function iridescentHue(angle, t, audioLevel, baseHue, params) {
  const norm = (angle % TAU + TAU) % TAU / TAU;
  let hue = baseHue + norm * params.hueSpread + t * params.shimmerSpeed + audioLevel * params.hueBoost;
  hue = (hue % 360 + 360) % 360;
  return hue;
}
function lowpassRadii(prev, next, tension) {
  const t = Math.max(0, Math.min(1, tension));
  return prev.map((p, i) => lerp(p, next[i], 1 - t));
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
function buildCellContour(width, height, bins, t, audioLevel, energy, params) {
  const sampleCount = 96;
  const cx = width / 2;
  const cy = height / 2;
  const baseR = Math.min(width, height) * params.radiusFraction;
  const out = [];
  for (let i = 0;i < sampleCount; i++) {
    const angle = i / sampleCount * TAU;
    const normalized = (angle % TAU + TAU) % TAU / TAU;
    const binIdx = bins.length === 0 ? 0 : Math.min(Math.floor(normalized * bins.length), bins.length - 1);
    const binLevel = bins.length === 0 ? 0 : bins[binIdx];
    const rFbm = cellRadius(angle, t, energy, params);
    const rPseudo = pseudopodOffset(angle, t, audioLevel, energy, params);
    const radius = baseR * rFbm + rPseudo + binLevel * baseR * 0.15 * energy;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    out.push([x, y]);
  }
  return out;
}
function hsla(h, s, l, a) {
  return `hsla(${h},${Math.round(s * 100)}%,${Math.round(l * 100)}%,${a})`;
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
  let prevRadii = null;
  const startedAt = performance.now();
  let rafId = null;
  const tick = () => {
    const t = (performance.now() - startedAt) / 1000;
    const s = latestState;
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      const energy = cellEnergy(s.mode, s.audioLevel, t, params.idle, params.levelGain);
      const rawPoints = buildCellContour(width, height, s.spectrumBins, t, s.audioLevel, energy, params);
      const cx = width / 2;
      const cy = height / 2;
      const currentRadii = rawPoints.map(([px, py]) => Math.sqrt((px - cx) ** 2 + (py - cy) ** 2));
      let smoothedPoints = rawPoints;
      if (prevRadii && prevRadii.length === currentRadii.length) {
        const smoothedRadii = lowpassRadii(prevRadii, currentRadii, params.tension);
        smoothedPoints = rawPoints.map(([px, py], i) => {
          const angle = Math.atan2(py - cy, px - cx);
          const r = smoothedRadii[i];
          return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
        });
      }
      prevRadii = currentRadii;
      const splinePoints = catmullRom(smoothedPoints, 4);
      if (splinePoints.length >= 3) {
        ctx.fillStyle = hsla(baseHue, 0.7, 0.55, params.fillAlpha);
        ctx.beginPath();
        ctx.moveTo(splinePoints[0][0], splinePoints[0][1]);
        for (let i = 1;i < splinePoints.length; i++) {
          ctx.lineTo(splinePoints[i][0], splinePoints[i][1]);
        }
        ctx.closePath();
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.min(width, height) * params.radiusFraction * 0.9));
        grad.addColorStop(0, hsla(baseHue + 10, 0.5, 0.7, params.fillAlpha * 0.5));
        grad.addColorStop(1, hsla(baseHue, 0.7, 0.45, params.fillAlpha));
        ctx.fillStyle = grad;
        ctx.fill();
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
      push: 18,
      sharpness: 4,
      intentDrift: 0.08,
      idle: 0.06,
      levelGain: 0.7,
      hueSpread: 40,
      shimmerSpeed: 0.5,
      hueBoost: 15,
      fillAlpha: 0.18,
      tension: 0.15,
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
