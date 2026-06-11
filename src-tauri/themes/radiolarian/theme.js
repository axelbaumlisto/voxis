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

// src/theme-engine/renderers/radiolarian.ts
var RADIOLARIAN_DEFAULTS = {
  symmetry: 6,
  radiusFraction: 0.28,
  octaves: 2,
  lacunarity: 2,
  gain: 0.5,
  shellAmplitude: 0.12,
  timeScale: 0.25,
  idle: 0.12,
  levelGain: 0.8,
  spikeLength: 0.5,
  spikePulse: 0.45,
  poreRings: 2,
  poreRadius: 1.2,
  spinSpeed: 0.15,
  angleJitter: 0.1,
  lengthJitter: 0.22,
  jitterSpeed: 0.4,
  growthAttack: 0.06,
  growthRelease: 0.012,
  growthSpikeBoost: 0.5,
  growthShellSwell: 0.18
};
function radiolarianEnergy(mode, audioLevel, t, params) {
  switch (mode) {
    case "idle":
      return params.idle * (1 + Math.sin(t * 0.9) * 0.25);
    case "recording":
      return Math.max(0, Math.min(1, params.idle + audioLevel * params.levelGain));
    case "transcribing":
      return Math.max(0, Math.min(1, params.idle * 0.7 + audioLevel * 0.15));
    default:
      return params.idle;
  }
}
function shellRadius(angle, t, energy, growth, params) {
  const wedge = TAU / params.symmetry;
  const folded = (angle % wedge + wedge) % wedge;
  const sym = Math.abs(folded / wedge - 0.5) * 2;
  const n = fbm(sym * 3, t * params.timeScale, params.octaves, params.lacunarity, params.gain);
  const breathe = 1 + energy * 0.18;
  const swell = 1 + growth * params.growthShellSwell;
  return (1 + n * params.shellAmplitude) * breathe * swell;
}
function spikeEndpoints(cx, cy, baseR, width, height, t, audioLevel, growth, params) {
  const out = [];
  const spin = t * params.spinSpeed;
  const ext = baseR * (params.spikeLength + audioLevel * params.spikePulse + growth * params.growthSpikeBoost);
  const xB = width * 0.46;
  const yB = height * 0.46;
  const maxTipRadius = (a) => {
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    if (Math.abs(cos) < 0.0000000001 && Math.abs(sin) < 0.0000000001)
      return 0;
    const denom = Math.sqrt(cos * cos / (xB * xB) + sin * sin / (yB * yB));
    return 1 / denom;
  };
  for (let k = 0;k < params.symmetry; k++) {
    const baseAngle = spin + k / params.symmetry * TAU;
    const angleJit = noise2D(k * 13.1, t * params.jitterSpeed) * params.angleJitter;
    const lenJit = noise2D(k * 7.7, t * params.jitterSpeed + 50) * params.lengthJitter * params.spikeLength;
    const a = baseAngle + angleJit;
    const sr = baseR * shellRadius(a, t, params.idle, growth, params);
    let rawOuterR = sr + ext + baseR * lenJit;
    const maxR = maxTipRadius(a);
    if (rawOuterR > maxR)
      rawOuterR = maxR;
    const x1 = cx + sr * Math.cos(a);
    const y1 = cy + sr * Math.sin(a);
    const x2 = cx + rawOuterR * Math.cos(a);
    const y2 = cy + rawOuterR * Math.sin(a);
    out.push({ x1, y1, x2, y2 });
  }
  return out;
}
function poreLattice(cx, cy, baseR, t, params) {
  const out = [];
  const spin = t * params.spinSpeed * 0.5;
  const r = Math.max(0.6, params.poreRadius);
  for (let ring = 0;ring < params.poreRings; ring++) {
    const rr = baseR * (0.35 + 0.5 * (ring / Math.max(1, params.poreRings)));
    const count = params.symmetry * (ring + 1);
    const offset = ring % 2 === 0 ? 0 : TAU / count * 0.5;
    for (let j = 0;j < count; j++) {
      const a = spin + offset + j / count * TAU;
      out.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), r });
    }
  }
  return out;
}
var SAMPLE_COUNT = 96;
function createRadiolarianRenderer(container, opts) {
  const params = { ...RADIOLARIAN_DEFAULTS, ...opts.params ?? {} };
  const baseHue = opts.baseHue ?? 190;
  const { width, height } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let latestState = { mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) };
  let shellMemory = null;
  let growth = 0;
  const startedAt = performance.now();
  let rafId = null;
  const cx = width / 2;
  const cy = height / 2;
  const baseR = Math.min(width, height) * params.radiusFraction;
  const tick = () => {
    const t = (performance.now() - startedAt) / 1000;
    const s = latestState;
    growth = growthLevel(growth, s.audioLevel, s.mode, params.growthAttack, params.growthRelease);
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      const energy = radiolarianEnergy(s.mode, s.audioLevel, t, params);
      const target = [];
      for (let i = 0;i < SAMPLE_COUNT; i++) {
        const a = i / SAMPLE_COUNT * TAU + t * params.spinSpeed;
        const bin = s.spectrumBins[Math.min(s.spectrumBins.length - 1, Math.floor(i / SAMPLE_COUNT * s.spectrumBins.length))] ?? 0;
        target.push(shellRadius(a, t, energy, growth, params) + bin * 0.12 * energy);
      }
      shellMemory = shellMemory ? integrateDeformation(shellMemory, target, 0.25, 0.02) : target.slice();
      ctx.lineCap = "round";
      for (const sp of spikeEndpoints(cx, cy, baseR, width, height, t, s.audioLevel, growth, params)) {
        ctx.strokeStyle = hsla(baseHue + 10, 0.85, 0.65, 0.55 + 0.35 * energy);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sp.x1, sp.y1);
        ctx.lineTo(sp.x2, sp.y2);
        ctx.stroke();
      }
      const pts = shellMemory.map((rf, i) => {
        const a = i / SAMPLE_COUNT * TAU + t * params.spinSpeed;
        const rr = baseR * rf;
        return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
      });
      const drawClosed = (lw, style) => {
        ctx.lineWidth = lw;
        ctx.strokeStyle = style;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1;i < pts.length; i++)
          ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.stroke();
      };
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1;i < pts.length; i++)
        ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = hsla(baseHue, 0.6, 0.5, 0.12 + 0.1 * energy);
      ctx.fill();
      drawClosed(3, hsla(baseHue + 5, 0.9, 0.7, 0.18 + 0.18 * energy));
      drawClosed(1.2, hsla(baseHue, 0.85, 0.75, 0.9));
      for (const p of poreLattice(cx, cy, baseR, t, params)) {
        ctx.fillStyle = hsla(baseHue + 6, 0.7, 0.8, 0.5 + 0.4 * energy);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
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

// src/theme-engine/builtin/radiolarian/index.ts
function mount(container, api) {
  const userParams = api.params && typeof api.params === "object" ? api.params : {};
  const renderer = createRadiolarianRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: 190,
    params: {
      symmetry: 6,
      radiusFraction: 0.28,
      octaves: 2,
      lacunarity: 2,
      gain: 0.5,
      shellAmplitude: 0.12,
      timeScale: 0.25,
      idle: 0.12,
      levelGain: 0.8,
      spikeLength: 0.5,
      spikePulse: 0.45,
      poreRings: 2,
      poreRadius: 1.2,
      spinSpeed: 0.15,
      angleJitter: 0.1,
      lengthJitter: 0.22,
      jitterSpeed: 0.4,
      growthAttack: 0.06,
      growthRelease: 0.012,
      growthSpikeBoost: 0.5,
      growthShellSwell: 0.18,
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
