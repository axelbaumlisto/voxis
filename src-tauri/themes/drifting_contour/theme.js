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
function wrapPi(a) {
  const TWO_PI = Math.PI * 2;
  let x = ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  if (x <= -Math.PI)
    x += TWO_PI;
  return x;
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
function catmullRomOpen(points, segmentsPerSpan) {
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
  for (let i = 0;i < n - 1; i++) {
    const p0 = points[i - 1 < 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 > n - 1 ? n - 1 : i + 2];
    segment(p0, p1, p2, p3, segmentsPerSpan);
  }
  result.push([points[n - 1][0], points[n - 1][1]]);
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
  ciliaCurl: 0.7,
  ciliaBeatHz: 0.9,
  ciliaBeatHzActive: 1.6,
  ciliaAsymmetry: 0.49,
  ciliaMetachronal: 1.1,
  dragCoeff: 0.5,
  ciliaSegments: 6,
  ciliaLengthVar: 0.5,
  ciliaAngleJitter: 0.55,
  ciliaWidth: 1.6,
  growthAttack: 0.05,
  growthRelease: 0.012,
  growthSwell: 0.22,
  startleSensitivity: 2.2,
  startleDecay: 0.86,
  startleMaxPx: 5,
  startleBaselineRate: 0.08,
  enableStartleKick: true,
  startleKickThreshold: 0.12,
  startleKickMax: 1.2,
  startleBurstFrac: 0.5,
  idleMorphAmplitude: 0.18,
  idleMorphSpeed: 0.25,
  idleMorphPeriod: 7,
  idleMorphFloor: 0.25,
  driftActivationRate: 0.02,
  wanderTurnRate: 1.1,
  wanderFreq: 0.6,
  swimSpeedMaxFrac: 0.06,
  activityEnergyWeight: 0.6,
  activityGrowthWeight: 0.4,
  bodyHeadingTau: 0.4,
  bodyElongation: 0.13,
  bodyElongationFloor: 0,
  enableStrokeAxis: true,
  strokeAxisKnee: 0.5,
  strokeAxisAlign: 1,
  enableEnergySmoothing: true,
  energySmoothTau: 0.08,
  enableSaturation: true,
  deformMax: 0.6,
  enableAreaNorm: true,
  enableAffine: true,
  enableActivity: true
};
function sanitizeUnit(x) {
  if (!Number.isFinite(x))
    return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function sanitizeFinite(x, fallback) {
  return Number.isFinite(x) ? x : fallback;
}
function sanitizeBins(bins) {
  if (!bins || bins.length === 0)
    return [];
  const out = new Array(bins.length);
  for (let i = 0;i < bins.length; i++)
    out[i] = sanitizeUnit(bins[i]);
  return out;
}
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
function smoothEnergy(prev, target, dt, params) {
  if (params.enableEnergySmoothing === false)
    return target;
  const tau = params.energySmoothTau ?? 0.08;
  if (tau <= 0)
    return target;
  const alpha = 1 - Math.exp(-Math.max(0, dt) / tau);
  return prev + (target - prev) * alpha;
}
function cellActivity(energy, growth, params) {
  const we = params?.activityEnergyWeight ?? 0.6;
  const wg = params?.activityGrowthWeight ?? 0.4;
  const a = we * energy + wg * growth;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}
function swimSpeed(activity, width, height, params) {
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  const frac = params.swimSpeedMaxFrac ?? 0.06;
  return a * frac * Math.min(width, height);
}
function ciliaBeatHzEff(activity, params) {
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  const f0 = params.ciliaBeatHz ?? 0.9;
  const f1 = params.ciliaBeatHzActive ?? 1.6;
  return f0 + (f1 - f0) * a;
}
function bodyHeadingStep(prev, vx, vy, dt, params) {
  const sp = Math.hypot(vx, vy);
  if (sp < 0.000001)
    return prev;
  const target = Math.atan2(vy, vx);
  const tau = params.bodyHeadingTau ?? 0.4;
  const alpha = 1 - Math.exp(-dt / Math.max(0.000001, tau));
  let d = target - prev;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return prev + d * alpha;
}
function prolateAspect(speedNorm, params) {
  const s = speedNorm < 0 ? 0 : speedNorm > 1 ? 1 : speedNorm;
  const elong = params.bodyElongation ?? 0.13;
  const floor = params.bodyElongationFloor ?? 0;
  return 1 + elong * Math.max(floor, s);
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
    const sharp = Math.max(2, params.sharpness);
    const lobe = Math.pow(Math.max(0, Math.cos(delta)), sharp);
    const audioDrive = params.idle + audioLevel * params.levelGain;
    const amp = params.push * audioDrive * energy;
    total += lobe * amp;
  }
  return total;
}
function ciliaBeatPhase(t, index, params) {
  const hz = params.ciliaBeatHz ?? 0.9;
  const lag = (params.ciliaMetachronal ?? 0) * index;
  const lin = (t * hz + lag / TAU) % 1;
  const u = (lin % 1 + 1) % 1;
  const a = Math.max(0, Math.min(0.95, params.ciliaAsymmetry ?? 0));
  if (a === 0)
    return u;
  const A = a;
  const phase = u + A / TAU * (1 - Math.cos(TAU * u));
  return (phase % 1 + 1) % 1;
}
function strokeAxisStrength(activity, params) {
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  const knee = params.strokeAxisKnee ?? 0.5;
  return smoothstep(a / (knee > 0 ? knee : 0.000001));
}
function metachronalIndex(baseAngle, k, speedNorm, axis, gap, engaged) {
  if (!engaged)
    return k;
  const s = speedNorm < 0 ? 0 : speedNorm > 1 ? 1 : speedNorm;
  if (s === 0)
    return k;
  const axial = wrapPi(baseAngle - axis) / (gap > 0 ? gap : 0.000001);
  return (1 - s) * k + s * axial;
}
function ciliaStrokeAngle(baseAngle, axis, strength) {
  const local = baseAngle + Math.PI / 2;
  const s = strength < 0 ? 0 : strength > 1 ? 1 : strength;
  if (s === 0)
    return local;
  const delta = wrapPi(2 * (axis - local)) / 2;
  return local + s * delta;
}
function ciliaPath(cx, cy, baseR, t, energy, growth, params, motion) {
  const dragCoeff = params.dragCoeff ?? 0.5;
  const mTx = motion?.tx ?? 0;
  const mTy = motion?.ty ?? 0;
  const mSpeed = motion ? Math.max(0, Math.min(1, motion.speedNorm)) : 0;
  const axisEngaged = (params.enableStrokeAxis ?? true) && motion !== undefined;
  const axisStrength = axisEngaged ? Math.max(0, Math.min(1, (motion?.axisStrength ?? 0) * (params.strokeAxisAlign ?? 1))) : 0;
  const strokeAxis = Math.atan2(mTy, mTx);
  const out = [];
  const n = Math.max(1, params.ciliaCount);
  const seg = Math.max(2, params.ciliaSegments ?? 6);
  const curl = params.ciliaCurl;
  const lenVar = Math.max(0, Math.min(0.95, params.ciliaLengthVar ?? 0.5));
  const angleJit = Math.max(0, Math.min(0.9, params.ciliaAngleJitter ?? 0.55));
  const baseWidth = params.ciliaWidth ?? 1.6;
  const waves = 1.1;
  const gap = TAU / n;
  const lenMean = baseR * (params.ciliaLength + growth * params.ciliaGrowthBoost) * (0.55 + 0.45 * energy);
  for (let k = 0;k < n; k++) {
    const angOff = noise2D(k * 12.9898, 7.2) * angleJit * gap * 0.5;
    const baseAngle = k * gap + angOff;
    const ux = Math.cos(baseAngle);
    const uy = Math.sin(baseAngle);
    let pxn;
    let pyn;
    if (axisStrength === 0) {
      pxn = -uy;
      pyn = ux;
    } else {
      const strokeAngle = ciliaStrokeAngle(baseAngle, strokeAxis, axisStrength);
      pxn = Math.cos(strokeAngle);
      pyn = Math.sin(strokeAngle);
    }
    const r01 = noise2D(k * 3.7 + 0.3, 1.3) * 0.5 + 0.5;
    const lenK = lenMean * (1 - lenVar + 2 * lenVar * r01);
    const r01b = noise2D(k * 5.1 + 2.7, 4.9) * 0.5 + 0.5;
    const hairWidth = baseWidth * (0.55 + 0.9 * (0.5 * r01 + 0.5 * r01b));
    const metaIdx = metachronalIndex(baseAngle, k, mSpeed, strokeAxis, gap, axisEngaged);
    const phase = ciliaBeatPhase(t + r01 * 0.6, metaIdx, params);
    const recovery = smoothstep((phase - 0.35) / 0.3);
    const pts = [];
    for (let i = 0;i <= seg; i++) {
      const sFrac = i / seg;
      const along = baseR + lenK * sFrac;
      const wave = Math.sin(TAU * (waves * sFrac - phase));
      const amp = curl * lenK * 0.6 * Math.sin(Math.PI * sFrac) * (0.4 + 0.6 * recovery);
      const rawBend = wave * 0.7 * amp;
      const bendCap = 0.5 * gap * along;
      const bend = Math.max(-bendCap, Math.min(bendCap, rawBend));
      const lead = ux * mTx + uy * mTy;
      const dragGain = dragCoeff * mSpeed * (0.6 + 0.4 * lead);
      const dragPx = dragGain * lenK * Math.pow(sFrac, 1.3);
      const x = cx + ux * along + pxn * bend - mTx * dragPx;
      const y = cy + uy * along + pyn * bend - mTy * dragPx;
      pts.push([x, y]);
    }
    out.push({ points: pts, width: hairWidth });
  }
  return out;
}
function startleOffset(prevMag, level, baseline, sensitivity, decay) {
  const edge = Math.max(0, (level - baseline) * sensitivity);
  const decayed = prevMag * Math.max(0, Math.min(1, decay));
  return Math.max(0, Math.min(1, Math.max(decayed, edge)));
}
function startleHeadingKick(startle, prevStartle, t, params) {
  const rising = startle - prevStartle;
  if (rising <= (params.startleKickThreshold ?? 0.12))
    return 0;
  return noise2D(811.3, t * 1.7) * (params.startleKickMax ?? 1.2);
}
function startleBurstSpeed(startle, baseR, params) {
  const s = startle < 0 ? 0 : startle > 1 ? 1 : startle;
  return s * (params.startleBurstFrac ?? 0.5) * baseR;
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
function sampleBinLevel(bins, normalized) {
  const nBins = bins.length;
  if (nBins === 0)
    return 0;
  if (nBins === 1)
    return bins[0];
  const u = (normalized % 1 + 1) % 1 * nBins - 0.5;
  const i0 = Math.floor(u);
  const frac = u - i0;
  const a = bins[(i0 % nBins + nBins) % nBins];
  const b = bins[((i0 + 1) % nBins + nBins) % nBins];
  return lerp(a, b, smoothstep(frac));
}
function saturateTargetDeform(target, params) {
  if (!params.enableSaturation)
    return target;
  const Dmax = params.deformMax ?? 0.6;
  if (!(Dmax > 0))
    return target;
  return target.map((d) => Dmax * Math.tanh(d / Dmax));
}
function normalizeAreaDeform(integrated, params) {
  if (!params.enableAreaNorm)
    return integrated;
  const n = integrated.length;
  if (n === 0)
    return integrated;
  let sum = 0;
  let sumSq = 0;
  let minE = Infinity;
  for (const d of integrated) {
    const e = 1 + d;
    sum += e;
    sumSq += e * e;
    if (e < minE)
      minE = e;
  }
  const m1 = sum / n;
  const m2 = sumSq / n;
  const variance = m2 - m1 * m1;
  if (variance > 1 || !(m2 > 0)) {
    const s = m2 > 0 ? 1 / Math.sqrt(m2) : 1;
    return integrated.map((d) => (1 + d) * s - 1);
  }
  let c = m1 - Math.sqrt(1 - variance);
  const EPS = 0.0001;
  const cMax = minE - EPS;
  if (c > cMax)
    c = cMax;
  return integrated.map((d) => d - c);
}
function integrateDeformPipeline(prev, target, params) {
  const satTarget = saturateTargetDeform(target, params);
  const integrated = prev ? integrateDeformation(prev, satTarget, params.attack, params.release) : satTarget.slice();
  return normalizeAreaDeform(integrated, params);
}
function affineSqueezePoints(points, k, phi, cx, cy, params) {
  if (!params.enableAffine || k === 1)
    return points;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const invK = 1 / k;
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const xr = dx * cos + dy * sin;
    const yr = -dx * sin + dy * cos;
    const xs = xr * k;
    const ys = yr * invK;
    return [cx + xs * cos - ys * sin, cy + xs * sin + ys * cos];
  });
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
    const binLevel = sampleBinLevel(bins, normalized);
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
function nucleusTransform(t, audioLevel, baseR, params, minMembraneR) {
  const rawCx = baseR * params.nucleusWander * noise2D(137, t * params.nucleusDrift);
  const rawCy = baseR * params.nucleusWander * noise2D(241, t * params.nucleusDrift);
  const idleBreath = Math.sin(t * 1.3) * params.nucleusPulse * 0.25;
  let r = baseR * (params.nucleusRadius + audioLevel * params.nucleusPulse + idleBreath);
  const MIN_PX_RADIUS = 2.5;
  r = Math.max(MIN_PX_RADIUS, r);
  const PINCH_MARGIN = 0.15;
  const safeInner = minMembraneR !== undefined && Number.isFinite(minMembraneR) ? Math.max(0, minMembraneR) * (1 - PINCH_MARGIN) : baseR * 0.55;
  if (r > safeInner)
    r = Math.max(MIN_PX_RADIUS, safeInner);
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
    const base = { driftPhase: obj.driftPhase, growth: obj.growth, elapsed: obj.elapsed };
    if (typeof obj.fx === "number" && Number.isFinite(obj.fx) && obj.fx >= 0 && obj.fx <= 1 && typeof obj.fy === "number" && Number.isFinite(obj.fy) && obj.fy >= 0 && obj.fy <= 1 && typeof obj.heading === "number" && Number.isFinite(obj.heading) && obj.heading > -1e4 && obj.heading < 1e4) {
      base.fx = obj.fx;
      base.fy = obj.fy;
      base.heading = obj.heading;
    }
    return base;
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
function wanderPoseFromState(saved, width, height, baseR, params) {
  if (saved.fx === undefined || saved.fy === undefined || saved.heading === undefined) {
    return null;
  }
  const reach = cellReach(baseR, params);
  const inset = Math.max(params.driftMargin ?? 4, reach);
  const clamp = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
  return {
    x: clamp(saved.fx * width, inset, width - inset),
    y: clamp(saved.fy * height, inset, height - inset),
    heading: saved.heading
  };
}
function cellPersistKey(width, height) {
  return `talri.cell.state.v2.${Math.round(width)}x${Math.round(height)}`;
}
function membraneMaxRadius(width, height) {
  return Math.min(width, height) * 0.46;
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
  const lenVar = Math.max(0, Math.min(0.95, params.ciliaLengthVar ?? 0));
  const longestAlong = baseR + baseR * (ciliaLength + ciliaGrowthBoost) * (1 + lenVar);
  const ciliaCount = params.ciliaCount ?? 0;
  const gap = ciliaCount > 0 ? TAU / ciliaCount : 0;
  const ciliaOuter = longestAlong * Math.sqrt(1 + 0.25 * gap * gap);
  return Math.max(membraneOuter, ciliaOuter) + startleMaxPx;
}
function driftActivation(prev, recording, rate, dt) {
  const target = recording ? 1 : 0;
  const r = rate < 0 ? 0 : rate > 1 ? 1 : rate;
  const alpha = dt === undefined ? r : 1 - Math.pow(1 - r, dt * 60);
  const raw = prev + (target - prev) * alpha;
  if (raw > 1)
    return 1;
  if (raw < 0)
    return 0;
  return raw;
}
function wanderStep(s, dt, width, height, baseR, params, speedOverride) {
  const reach = cellReach(baseR, params);
  const inset = Math.max(params.driftMargin ?? 4, reach);
  const minX = inset, maxX = width - inset;
  const minY = inset, maxY = height - inset;
  if (maxX <= minX || maxY <= minY) {
    return { x: width / 2, y: height / 2, heading: s.heading, vx: 0, vy: 0, clock: (s.clock ?? 0) + dt };
  }
  const speed = speedOverride !== undefined ? speedOverride : (params.driftSpeed ?? 0.03) * Math.min(width, height) * 1.2;
  const turnRate = params.wanderTurnRate ?? 1.1;
  const wanderFreq = params.wanderFreq ?? 0.6;
  const clock = (s.clock ?? 0) + dt;
  const jitter = noise2D(s.heading * 0.5 + 13, clock * wanderFreq);
  let heading = s.heading + jitter * turnRate * dt;
  let vx = Math.cos(heading) * speed;
  let vy = Math.sin(heading) * speed;
  let x = s.x + vx * dt;
  let y = s.y + vy * dt;
  if (x < minX) {
    x = minX;
    heading = Math.PI - heading;
  } else if (x > maxX) {
    x = maxX;
    heading = Math.PI - heading;
  }
  if (y < minY) {
    y = minY;
    heading = -heading;
  } else if (y > maxY) {
    y = maxY;
    heading = -heading;
  }
  vx = Math.cos(heading) * speed;
  vy = Math.sin(heading) * speed;
  heading = Math.atan2(Math.sin(heading), Math.cos(heading));
  return { x, y, heading, vx, vy, clock };
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
  let energySmoothed = -1;
  let startle = 0;
  let baseline = 0;
  let drift01 = 0;
  let wander = null;
  let bodyHeading = 0;
  let lastTickMs = performance.now();
  const PERSIST_KEY = cellPersistKey(width, height);
  let driftPhaseOffset = 0;
  let lastPersist = 0;
  let startedAt = performance.now();
  let restoredPose = null;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem("talri.cell.state.v1");
      const saved = parseCellState(localStorage.getItem(PERSIST_KEY));
      if (saved) {
        growth = saved.growth;
        const seed = restoreSeed(saved, performance.now());
        startedAt = seed.startedAt;
        driftPhaseOffset = seed.driftPhaseOffset;
        restoredPose = wanderPoseFromState(saved, width, height, resolveBaseRadius(width, height, params, growth), params);
      }
    } catch {}
  }
  let rafId = null;
  const tick = () => {
    const nowMs = performance.now();
    const t = (nowMs - startedAt) / 1000;
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastTickMs) / 1000));
    lastTickMs = nowMs;
    const s = latestState;
    const audioLevel = sanitizeUnit(s.audioLevel);
    const spectrumBins = sanitizeBins(s.spectrumBins);
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      const energyTarget = cellEnergy(s.mode, audioLevel, t, params.idle, params.levelGain);
      if (energySmoothed < 0)
        energySmoothed = energyTarget;
      energySmoothed = sanitizeUnit(smoothEnergy(energySmoothed, energyTarget, dt, params));
      const energy = energySmoothed;
      growth = sanitizeUnit(growthLevel(sanitizeUnit(growth), audioLevel, s.mode, params.growthAttack, params.growthRelease));
      const activity = cellActivity(energy, growth, params);
      baseline = sanitizeFinite(baseline + (audioLevel - sanitizeFinite(baseline, 0)) * params.startleBaselineRate, 0);
      const prevStartle = startle;
      startle = sanitizeUnit(startleOffset(sanitizeUnit(startle), audioLevel, baseline, params.startleSensitivity, params.startleDecay));
      const useKick = params.enableStartleKick !== false;
      let sdx = 0;
      let sdy = 0;
      if (!useKick) {
        const startleAngle = TAU * noise2D(900.5, t * 0.7);
        sdx = Math.cos(startleAngle) * startle * params.startleMaxPx;
        sdy = Math.sin(startleAngle) * startle * params.startleMaxPx;
      }
      const recordingFade = s.mode === "recording" ? 0.3 : 1;
      const idleFactor = (1 - smoothstep(activity / 0.33)) * recordingFade;
      const targetDeform = buildTargetDeformation(width, height, spectrumBins, t, audioLevel, energy, params, idleFactor);
      const safePrev = deform && deform.every((v) => Number.isFinite(v)) ? deform : null;
      deform = integrateDeformPipeline(safePrev, targetDeform, params);
      drift01 = driftActivation(drift01, s.mode === "recording", params.driftActivationRate ?? 0.02, dt);
      const baseR = resolveBaseRadius(width, height, params, growth);
      if (!wander) {
        wander = restoredPose ? { x: restoredPose.x, y: restoredPose.y, heading: restoredPose.heading, vx: 0, vy: 0, clock: 0 } : { x: width / 2, y: height / 2, heading: noise2D(7.1, 3.3) * TAU, vx: 0, vy: 0, clock: 0 };
      }
      if (useKick) {
        const kick = startleHeadingKick(startle, prevStartle, t, params);
        if (kick !== 0)
          wander = { ...wander, heading: wander.heading + kick };
      }
      const baseSwim = params.enableActivity ? swimSpeed(activity, width, height, params) : undefined;
      const burst = useKick ? startleBurstSpeed(startle, baseR, params) : 0;
      const swimPx = baseSwim !== undefined ? baseSwim + burst : burst > 0 ? burst : undefined;
      wander = wanderStep(wander, dt, width, height, baseR, params, swimPx);
      const driftedX = width / 2 + (wander.x - width / 2) * drift01;
      const driftedY = height / 2 + (wander.y - height / 2) * drift01;
      const cx = driftedX + sdx;
      const cy = driftedY + sdy;
      const maxRadius = membraneMaxRadius(width, height);
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
      const swimPeak = swimSpeed(1, width, height, params);
      const curSpeed = Math.hypot(wander.vx, wander.vy);
      const speedNorm = params.enableActivity && swimPeak > 0 ? Math.min(1, curSpeed / swimPeak) : 0;
      bodyHeading = bodyHeadingStep(bodyHeading, wander.vx, wander.vy, dt, params);
      const squeezeK = params.enableAffine ? prolateAspect(speedNorm, params) : 1;
      const squeezePhi = bodyHeading;
      const contourPoints = affineSqueezePoints(smoothedPoints, squeezeK, squeezePhi, cx, cy, params);
      const splinePoints = catmullRom(contourPoints, 4);
      if (splinePoints.length >= 3) {
        {
          const ciliaParams = params.enableActivity ? {
            ...params,
            ciliaBeatHz: ciliaBeatHzEff(activity, params),
            ciliaCurl: params.ciliaCurl * (1 + 0.3 * activity)
          } : params;
          const ciliaMotion = {
            tx: Math.cos(bodyHeading),
            ty: Math.sin(bodyHeading),
            speedNorm,
            axisStrength: params.enableActivity ? strokeAxisStrength(activity, params) : 0
          };
          const cilia = ciliaPath(cx, cy, baseR, t, energy, growth, ciliaParams, ciliaMotion);
          ctx.lineCap = "round";
          for (const hair of cilia) {
            ctx.lineWidth = hair.width;
            ctx.strokeStyle = hsla(baseHue, 0.6, 0.6, 0.35 + 0.35 * energy);
            ctx.beginPath();
            ctx.moveTo(hair.points[0][0], hair.points[0][1]);
            const spline = catmullRomOpen(hair.points, 4);
            for (let i = 1;i < spline.length; i++) {
              ctx.lineTo(spline[i][0], spline[i][1]);
            }
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
        let minMembraneR = Infinity;
        for (const dv of deform)
          minMembraneR = Math.min(minMembraneR, baseR * (1 + dv));
        const nucleus = nucleusTransform(t, audioLevel, baseR, params, minMembraneR);
        if (nucleus.r >= 2.5) {
          const [nx, ny] = affineSqueezePoints([[cx + nucleus.cx, cy + nucleus.cy]], squeezeK, squeezePhi, cx, cy, params)[0];
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
        const segments = contourPoints.length;
        const pointsPerSegment = splinePoints.length / segments;
        for (let seg = 0;seg < segments; seg++) {
          const segStart = Math.floor(seg * pointsPerSegment);
          const segEnd = seg === segments - 1 ? splinePoints.length : Math.floor((seg + 1) * pointsPerSegment);
          if (segEnd - segStart < 2)
            continue;
          const midPt = splinePoints[Math.floor((segStart + segEnd) / 2) % splinePoints.length];
          const midAngle = Math.atan2(midPt[1] - cy, midPt[0] - cx);
          const hue = iridescentHue(midAngle, t, audioLevel, baseHue, params);
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
          elapsed: t,
          ...wander ? { fx: wander.x / width, fy: wander.y / height, heading: wander.heading } : {}
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
      baseRadiusPx: 17,
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
