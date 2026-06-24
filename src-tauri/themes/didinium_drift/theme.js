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
function deformAt(theta, deform) {
  const n = deform.length;
  if (n === 0)
    return 0;
  if (n === 1)
    return deform[0];
  const TWO_PI = Math.PI * 2;
  let f = theta / TWO_PI * n;
  f = (f % n + n) % n;
  const i = Math.floor(f);
  const u = f - i;
  const p0 = deform[(i - 1 + n) % n];
  const p1 = deform[i % n];
  const p2 = deform[(i + 1) % n];
  const p3 = deform[(i + 2) % n];
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}
function deformDerivAt(theta, deform) {
  const n = deform.length;
  if (n < 2)
    return 0;
  const TWO_PI = Math.PI * 2;
  let f = theta / TWO_PI * n;
  f = (f % n + n) % n;
  const i = Math.floor(f);
  const u = f - i;
  const p0 = deform[(i - 1 + n) % n];
  const p1 = deform[i % n];
  const p2 = deform[(i + 1) % n];
  const p3 = deform[(i + 2) % n];
  const u2 = u * u;
  const dDeform_du = 0.5 * (-p0 + p2 + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u2);
  return dDeform_du * (n / TWO_PI);
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
// src/theme-engine/renderers/cell/math.ts
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
// src/theme-engine/renderers/cell/activity.ts
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
function effectiveCyclosisPeriod(activity, params) {
  const base = Math.max(0.1, params.cyclosisPeriod ?? 45);
  const boost = params.cyclosisActivityBoost ?? 0;
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  return Math.max(0.1, base / (1 + a * boost));
}
// src/theme-engine/renderers/cell/phases.ts
function advanceAxialSpinPhase(prevPhase, dt, speedNorm, params) {
  if (!params.enableAxialSpin)
    return 0;
  const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const s = speedNorm < 0 ? 0 : speedNorm > 1 ? 1 : speedNorm;
  return prevPhase - (params.axialSpinMax ?? 0) * s * safeDt;
}
function advanceCyclosisPhase(prevPhase, dt, params) {
  const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const T = Math.max(0.1, params.cyclosisPeriod ?? 45);
  const sense = (params.cyclosisSense ?? 1) >= 0 ? 1 : -1;
  return prevPhase + sense * (TAU / T) * safeDt;
}
function advanceCiliaBeatCycles(prevCycles, dt, hz) {
  const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const next = prevCycles + Math.max(0, Number.isFinite(hz) ? hz : 0) * safeDt;
  return (next % 1 + 1) % 1;
}
// src/theme-engine/renderers/cell/sizing.ts
function membraneMaxRadius(width, height) {
  return Math.min(width, height) * 0.46;
}
function resolveBaseRadius(width, height, params, growth) {
  const fallbackR = Math.min(width, height) * params.radiusFraction;
  const rawBaseR = params.baseRadiusPx ?? fallbackR;
  return rawBaseR * (1 + growth * params.growthSwell);
}
function perimeterCiliaCount(baseR, params) {
  const spacing = Math.max(0.5, params.ciliaSpacingPx ?? 8);
  const n = Math.round(TAU * Math.max(0, baseR) / spacing);
  const cap = Math.max(1, params.ciliaCount);
  return Math.max(1, Math.min(cap, n));
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
// src/theme-engine/renderers/cell/startle.ts
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
// src/theme-engine/renderers/cell/locomotion.ts
function swimSpeed(activity, width, height, params) {
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  const frac = params.swimSpeedMaxFrac ?? 0.06;
  return a * frac * Math.min(width, height);
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
function wallReorientHeading(incoming, t, params) {
  const jitter = (params.wallReorientJitter ?? 0.6) * noise2D(517.3, t * 1.9);
  return incoming + Math.PI + jitter;
}
function rotationalBrownianStep(t, dt, params) {
  const Dr = params.rotationalDiffusion ?? 0;
  if (Dr <= 0)
    return 0;
  const TAP_SUM_STD = 0.795;
  const g = (noise2D(211.7, t * 7.3) + noise2D(389.1, t * 11.9 + 5.5) + noise2D(53.9, t * 17.1 + 1.3)) / TAP_SUM_STD;
  return g * Math.sqrt(2 * Dr * Math.max(0, dt));
}
function sedimentationBias(speed, params) {
  const frac = Math.max(0, Math.min(0.15, params.sedimentationFrac ?? 0));
  return { dvx: 0, dvy: frac * speed };
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
  if (params.enableRotationalBrownian) {
    heading += rotationalBrownianStep(clock, dt, params);
  }
  let vx = Math.cos(heading) * speed;
  let vy = Math.sin(heading) * speed;
  let x = s.x + vx * dt;
  let y = s.y + vy * dt;
  const hitWall = x < minX || x > maxX || y < minY || y > maxY;
  if (params.enableWallReorient && hitWall) {
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
    heading = wallReorientHeading(heading, clock, params);
  } else {
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
  }
  vx = Math.cos(heading) * speed;
  vy = Math.sin(heading) * speed;
  if (params.enableSedimentation) {
    const sed = sedimentationBias(speed, params);
    vx += sed.dvx;
    vy += sed.dvy;
    x = Math.max(minX, Math.min(maxX, x + sed.dvx * dt));
    y = Math.max(minY, Math.min(maxY, y + sed.dvy * dt));
  }
  heading = Math.atan2(Math.sin(heading), Math.cos(heading));
  return { x, y, heading, vx, vy, clock };
}
// src/theme-engine/renderers/cell/body-motion.ts
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
  const base = 1 + elong * Math.max(floor, s);
  if (!params.enableRestingProlate)
    return base;
  const rest = params.prolateRestAspect ?? 1.7;
  return Math.max(rest, base);
}
function helicalOffset(spinPhi, bodyHeading, baseR, params) {
  const hAmp = params.helicalAmplitude ?? 0;
  if (hAmp === 0 || spinPhi === 0)
    return [0, 0];
  const lateralOffset = hAmp * baseR * Math.sin(spinPhi);
  return [
    lateralOffset * -Math.sin(bodyHeading),
    lateralOffset * Math.cos(bodyHeading)
  ];
}
// src/theme-engine/renderers/cell/profile.ts
function bodyHalfWidth(u, params) {
  const c = params.bodyProfileTaper ?? 0.3;
  const base = Math.sqrt(Math.max(0, 1 - u * u));
  const type = params.bodyProfileType ?? "taperedEllipse";
  switch (type) {
    case "egg":
      return base / Math.sqrt(1 - 2 * c * u + c * c);
    case "piriform": {
      const w = base * (1 + c * u) * Math.sqrt(Math.max(0, (1 + u) / 2));
      return w < 0 ? 0 : w;
    }
    case "taperedEllipse":
    default: {
      const w = base * (1 + c * u);
      return w < 0 ? 0 : w;
    }
  }
}
function bodyProfilePoint(t, baseR, params) {
  const c = params.bodyProfileTaper ?? 0.3;
  const aspect = params.bodyAspect ?? 3;
  const L = baseR * Math.sqrt(aspect);
  const W = baseR / Math.sqrt(aspect);
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const x = L * ct;
  let y;
  const type = params.bodyProfileType ?? "taperedEllipse";
  switch (type) {
    case "egg":
      y = W * st / Math.sqrt(1 - 2 * c * ct + c * c);
      break;
    case "piriform":
      y = W * st * (1 + c * ct) * Math.sqrt(Math.max(0, (1 + ct) / 2));
      break;
    case "taperedEllipse":
    default:
      y = W * st * (1 + c * ct);
      break;
  }
  const bend = params.bodyVentralBend ?? 0;
  if (bend !== 0) {
    y += bend * W * Math.max(0, ct);
  }
  return [x, y];
}
function bodyProfileArea(baseR, params, samples = 96) {
  const n = Math.max(3, Math.floor(samples));
  let a = 0;
  let [px, py] = bodyProfilePoint(0, baseR, params);
  const [x0, y0] = [px, py];
  for (let k = 1;k <= n; k++) {
    const [cx, cy] = k === n ? [x0, y0] : bodyProfilePoint(TAU * k / n, baseR, params);
    a += px * cy - cx * py;
    px = cx;
    py = cy;
  }
  return Math.abs(a) / 2;
}
function bodyProfileAreaScale(baseR, params, samples = 96) {
  const area = bodyProfileArea(baseR, params, samples);
  if (!(area > 0))
    return 1;
  return Math.sqrt(Math.PI * baseR * baseR / area);
}
function interpProfileRadius(angle, pts) {
  const n = pts.length;
  if (n === 0)
    return 0;
  let a = angle % TAU;
  if (a < 0)
    a += TAU;
  const sorted = pts.map((p) => ({ ang: (p.ang % TAU + TAU) % TAU, rad: p.rad })).sort((u, v) => u.ang - v.ang);
  for (let i = 0;i < n; i++) {
    const lo2 = sorted[i];
    const hi2 = sorted[(i + 1) % n];
    let hiAng = hi2.ang;
    if (i === n - 1)
      hiAng += TAU;
    if (a >= lo2.ang && a <= hiAng) {
      const span2 = hiAng - lo2.ang;
      const f2 = span2 > 0 ? (a - lo2.ang) / span2 : 0;
      return lo2.rad + (hi2.rad - lo2.rad) * f2;
    }
  }
  const lo = sorted[n - 1];
  const hi = sorted[0];
  const span = hi.ang + TAU - lo.ang;
  const aShift = a + TAU;
  const f = span > 0 ? (aShift - lo.ang) / span : 0;
  return lo.rad + (hi.rad - lo.rad) * f;
}
function bodyProfileDeform(sampleCount, bodyHeading, baseR, params) {
  const N = Math.max(3, Math.floor(sampleCount));
  const pts = [];
  for (let k = 0;k < N; k++) {
    const t = k / N * TAU;
    const [px, py] = bodyProfilePoint(t, baseR, params);
    pts.push({ ang: Math.atan2(py, px), rad: Math.hypot(px, py) });
  }
  const scale = bodyProfileAreaScale(baseR, params, N);
  const out = [];
  for (let j = 0;j < N; j++) {
    const phi = j / N * TAU;
    const bodyAng = phi - bodyHeading;
    const r = interpProfileRadius(bodyAng, pts) * scale;
    out.push(r / baseR - 1);
  }
  return out;
}
function applyOralGroove(deform, bodyHeading, params) {
  if (!params.enableOralGroove)
    return deform;
  const N = deform.length;
  if (N < 3)
    return deform;
  const depth = params.oralGrooveDepth ?? 0.04;
  const center = params.oralGrooveAngle ?? 1.2;
  const halfW = params.oralGrooveWidth ?? 0.6;
  for (let i = 0;i < N; i++) {
    const canvasAng = i / N * TAU;
    let bodyAng = canvasAng - bodyHeading;
    bodyAng = (bodyAng % TAU + TAU + Math.PI) % TAU - Math.PI;
    const dist = Math.abs(bodyAng - center);
    if (dist < halfW) {
      const t = dist / halfW;
      const bell = 0.5 * (1 + Math.cos(Math.PI * t));
      deform[i] -= depth * bell;
    }
  }
  return deform;
}
function buildProfilePts(baseR, params, samples = 96) {
  const N = Math.max(3, Math.floor(samples));
  const pts = [];
  for (let k = 0;k < N; k++) {
    const t = k / N * TAU;
    const [px, py] = bodyProfilePoint(t, baseR, params);
    pts.push({ ang: Math.atan2(py, px), rad: Math.hypot(px, py) });
  }
  return pts;
}
function profileCDFInv(xi, params) {
  const M = 128;
  const us = [];
  const cdf = [];
  let acc = 0;
  let prevW = bodyHalfWidth(-1, params);
  us.push(-1);
  cdf.push(0);
  for (let k = 1;k <= M; k++) {
    const u2 = -1 + 2 * k / M;
    const w = bodyHalfWidth(u2, params);
    acc += (prevW + w) * 0.5 * (2 / M);
    prevW = w;
    us.push(u2);
    cdf.push(acc);
  }
  const Z = acc || 1;
  const target = Math.max(0, Math.min(1, xi)) * Z;
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (cdf[mid] < target)
      lo = mid + 1;
    else
      hi = mid;
  }
  if (lo === 0)
    return us[0];
  const c0 = cdf[lo - 1];
  const c1 = cdf[lo];
  const span = c1 - c0;
  const frac = span > 0 ? (target - c0) / span : 0;
  const u = us[lo - 1] + frac * (us[lo] - us[lo - 1]);
  return u < -1 ? -1 : u > 1 ? 1 : u;
}
// src/theme-engine/renderers/cell/persistence.ts
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
// src/theme-engine/renderers/cell/contour.ts
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
    if (params.enableRigidMembrane) {
      out.push(0);
      continue;
    }
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
function bandLimitDeform(deform, params) {
  const N = deform.length;
  if (N === 0)
    return [];
  const K = Math.max(0, Math.floor(params.bandLimitMode ?? 4));
  const cap = params.bandLimitAmp ?? 0.08;
  const a = new Array(K + 1).fill(0);
  const b = new Array(K + 1).fill(0);
  for (let k = 0;k <= K; k++) {
    let re = 0, im = 0;
    for (let i = 0;i < N; i++) {
      const ang = k * i / N * TAU;
      re += deform[i] * Math.cos(ang);
      im += deform[i] * Math.sin(ang);
    }
    a[k] = re / N;
    b[k] = im / N;
  }
  const out = new Array(N);
  for (let i = 0;i < N; i++) {
    let v = a[0];
    for (let k = 1;k <= K; k++) {
      const ang = k * i / N * TAU;
      v += 2 * (a[k] * Math.cos(ang) + b[k] * Math.sin(ang));
    }
    out[i] = v < -cap ? -cap : v > cap ? cap : v;
  }
  return out;
}
// src/theme-engine/renderers/cell/cilia.ts
function ciliaBeatPhase(t, index, params) {
  const hz = params.ciliaBeatHz ?? 0.9;
  return ciliaBeatPhaseAtCycle(t * hz, index, params);
}
function ciliaBeatPhaseAtCycle(baseCycles, index, params) {
  const lag = (params.ciliaMetachronal ?? 0) * index;
  const lin = (baseCycles + lag / TAU) % 1;
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
function somaticCiliaParams(params) {
  if (!params.enableSomaticCilia)
    return params;
  return {
    ...params,
    ciliaCount: params.somaticCiliaCount ?? 72,
    ciliaLength: params.somaticCiliaLength ?? 0.15
  };
}
function ciliaStructureMod(psi, hairNoise, params) {
  if (!params.enableCiliaStructure)
    return { lengthScale: 1, keep: true };
  const caudalTuftWidth = params.caudalTuftWidth ?? 0.6;
  const caudalTuftLength = params.caudalTuftLength ?? 1.7;
  const oralGapCenter = params.oralGapCenter ?? 1.2;
  const oralGapWidth = params.oralGapWidth ?? 0.75;
  const oralGapDip = params.oralGapDip ?? 0.3;
  const dPost = Math.PI - Math.abs(psi);
  let lengthScale = 1;
  if (dPost < caudalTuftWidth) {
    const f = 1 - dPost / caudalTuftWidth;
    lengthScale = 1 + (caudalTuftLength - 1) * f;
  }
  let keep = true;
  const dOral = Math.abs(wrapPi(psi - oralGapCenter));
  if (dOral < oralGapWidth) {
    const central = 1 - dOral / oralGapWidth;
    if (hairNoise < oralGapDip * central)
      keep = false;
  }
  return { lengthScale, keep };
}
function ciliaPath(cx, cy, baseR, t, energy, growth, params, motion) {
  const dragCoeff = params.dragCoeff ?? 0.5;
  const mTx = motion?.tx ?? 0;
  const mTy = motion?.ty ?? 0;
  const mSpeed = motion ? Math.max(0, Math.min(1, motion.speedNorm)) : 0;
  const anchored = params.enableCiliaOnContour === true && motion?.contour !== undefined;
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
    let bx = 0;
    let by = 0;
    let anx = 0;
    let any = 0;
    if (anchored) {
      const contour = motion.contour;
      const d = deformAt(baseAngle, contour.deform);
      const dp = deformDerivAt(baseAngle, contour.deform);
      const rTheta = baseR * (1 + d);
      const bx0 = cx + ux * rTheta;
      const by0 = cy + uy * rTheta;
      const sq = affineSqueezePoints([[bx0, by0]], contour.squeezeK, contour.squeezePhi, cx, cy, params)[0];
      bx = sq[0];
      by = sq[1];
      let n0x = ux * (1 + d) + uy * dp;
      let n0y = uy * (1 + d) - ux * dp;
      const n0len = Math.hypot(n0x, n0y) || 1;
      n0x /= n0len;
      n0y /= n0len;
      if (params.enableAffine && contour.squeezeK !== 1) {
        const cphi = Math.cos(contour.squeezePhi);
        const sphi = Math.sin(contour.squeezePhi);
        const xr = n0x * cphi + n0y * sphi;
        const yr = -n0x * sphi + n0y * cphi;
        const xs = xr / contour.squeezeK;
        const ys = yr * contour.squeezeK;
        const nx = xs * cphi - ys * sphi;
        const ny = xs * sphi + ys * cphi;
        const nlen = Math.hypot(nx, ny) || 1;
        anx = nx / nlen;
        any = ny / nlen;
      } else {
        anx = n0x;
        any = n0y;
      }
      pxn = -any;
      pyn = anx;
    }
    const r01 = noise2D(k * 3.7 + 0.3, 1.3) * 0.5 + 0.5;
    let lengthScale = 1;
    if (params.enableCiliaStructure) {
      const psi = wrapPi(baseAngle - strokeAxis);
      const struct = ciliaStructureMod(psi, r01, params);
      if (!struct.keep)
        continue;
      lengthScale = struct.lengthScale;
    }
    let lenK = lenMean * (1 - lenVar + 2 * lenVar * r01) * lengthScale;
    if (params.enableMetachronal) {
      const mWave = params.metachronalWavelength ?? 20;
      const mSpd = params.metachronalSpeed ?? 4;
      const metaPhase = k / mWave * TAU - t * mSpd;
      const depth = params.metachronalDepth ?? 0.4;
      const mod = 1 - depth + depth * (0.5 + 0.5 * Math.cos(metaPhase));
      lenK *= mod;
    }
    const r01b = noise2D(k * 5.1 + 2.7, 4.9) * 0.5 + 0.5;
    const hairWidth = baseWidth * (0.55 + 0.9 * (0.5 * r01 + 0.5 * r01b));
    const metaIdx = metachronalIndex(baseAngle, k, mSpeed, strokeAxis, gap, axisEngaged);
    const phase = motion?.beatCycles !== undefined ? ciliaBeatPhaseAtCycle(motion.beatCycles + r01 * 0.6 * (params.ciliaBeatHz ?? 0.9), metaIdx, params) : ciliaBeatPhase(t + r01 * 0.6, metaIdx, params);
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
      const x = anchored ? bx + anx * (along - baseR) + pxn * bend - mTx * dragPx : cx + ux * along + pxn * bend - mTx * dragPx;
      const y = anchored ? by + any * (along - baseR) + pyn * bend - mTy * dragPx : cy + uy * along + pyn * bend - mTy * dragPx;
      pts.push([x, y]);
    }
    out.push({ points: pts, width: hairWidth });
  }
  return out;
}
// src/theme-engine/renderers/cell/interior.ts
function interiorPoint(u, s, ctx) {
  const { cx, cy, baseR, deform, squeezeK, squeezePhi, bodyHeading, params } = ctx;
  const aspect = params.bodyAspect ?? 3;
  const L = baseR * Math.sqrt(aspect);
  const W = baseR / Math.sqrt(aspect);
  const what = bodyHalfWidth(u, params);
  const xb = L * u;
  const bend = params.bodyVentralBend ?? 0;
  const yb = s * W * what + bend * W * Math.max(0, u);
  const rho = Math.hypot(xb, yb);
  const thetaBody = Math.atan2(yb, xb);
  const pts = ctx.profilePts ?? buildProfilePts(baseR, params);
  const profileR = interpProfileRadius(thetaBody, pts);
  const f = profileR > 0.000000001 ? rho / profileR : 0;
  const thetaCanvas = thetaBody + bodyHeading;
  const wallR = baseR * (1 + deformAt(thetaCanvas, deform));
  const px0 = cx + Math.cos(thetaCanvas) * f * wallR;
  const py0 = cy + Math.sin(thetaCanvas) * f * wallR;
  return affineSqueezePoints([[px0, py0]], squeezeK, squeezePhi, cx, cy, params)[0];
}
function seedInteriorGranules(count, seedBase, params) {
  const n = Math.max(0, Math.floor(count));
  const out = [];
  for (let i = 0;i < n; i++) {
    const xiU = (noise2D(i * 12.9898 + seedBase + 1.7, 78.233) + 1) * 0.5;
    const xiS = (noise2D(i * 39.346 + seedBase + 5.3, 11.135) + 1) * 0.5;
    const xiQ = (noise2D(i * 17.13 + seedBase + 2.9, 51.07) + 1) * 0.5;
    const xiP = (noise2D(i * 7.77 + seedBase + 9.1, 23.31) + 1) * 0.5;
    const s = 2 * xiS - 1;
    const u = profileCDFInv(xiU, params);
    out.push({ u, s, q: xiQ, phi0: xiP * TAU });
  }
  return out;
}
function cyclosisLoopPointAtPhase(g, phase) {
  const phi = g.phi0 + phase;
  const amp = 0.3 + 0.68 * Math.sqrt(Math.max(0, Math.min(1, g.q)));
  const u = amp * Math.sin(phi);
  const s = amp * Math.sin(phi + Math.PI / 2);
  return { u, s };
}
// src/theme-engine/renderers/cell/flow.ts
function dipoleFlowAt(dx, dy, heading, strength) {
  if (strength === 0)
    return { vx: 0, vy: 0 };
  const CORE2 = 4;
  const r2 = Math.max(CORE2, dx * dx + dy * dy);
  const r = Math.sqrt(r2);
  const rxh = dx / r, ryh = dy / r;
  const ex = Math.cos(heading), ey = Math.sin(heading);
  const edotr = ex * rxh + ey * ryh;
  const k = strength / r2;
  return {
    vx: k * (2 * edotr * rxh - ex),
    vy: k * (2 * edotr * ryh - ey)
  };
}
function advectMote(mote, cx, cy, heading, strength, dt, width, height, params) {
  const v = dipoleFlowAt(mote.x - cx, mote.y - cy, heading, strength * (params.flowStrength ?? 1));
  const wrap = (val, span) => {
    if (span <= 0)
      return 0;
    return (val % span + span) % span;
  };
  return {
    x: wrap(mote.x + v.vx * dt, width),
    y: wrap(mote.y + v.vy * dt, height)
  };
}
function seedMotes(width, height, params) {
  const n = Math.max(0, Math.floor(params.flowMoteCount ?? 0));
  const out = [];
  for (let i = 0;i < n; i++) {
    const ux = (noise2D(i * 12.9898 + 3.1, 78.233) + 1) * 0.5;
    const uy = (noise2D(i * 39.346 + 7.7, 11.135) + 1) * 0.5;
    out.push({ x: ux * width, y: uy * height });
  }
  return out;
}
function cyclosisField(dx, dy, omega) {
  return { vx: -omega * dy, vy: omega * dx };
}
function seedGranules(baseR, params) {
  if (!params.enableCyclosis)
    return [];
  const n = Math.max(0, Math.floor(params.cyclosisGranuleCount ?? 0));
  if (n === 0)
    return [];
  const maxRad = Math.max(0, params.granuleMaxRadiusFrac ?? 0.75) * Math.max(0, baseR);
  const out = [];
  for (let i = 0;i < n; i++) {
    const ang = (noise2D(i * 12.9898 + 1.7, 78.233) + 1) * Math.PI;
    const rad = Math.sqrt((noise2D(i * 39.346 + 5.3, 11.135) + 1) * 0.5) * maxRad;
    out.push({ x: rad * Math.cos(ang), y: rad * Math.sin(ang) });
  }
  return out;
}
function advectGranule(g, baseR, dt, params) {
  const omega = TAU / Math.max(0.1, params.cyclosisPeriod ?? 45);
  const v = cyclosisField(g.x, g.y, omega);
  const nx = g.x + v.vx * dt;
  const ny = g.y + v.vy * dt;
  const maxRad = Math.max(0, params.granuleMaxRadiusFrac ?? 0.75) * Math.max(0, baseR);
  const r0 = Math.min(Math.hypot(g.x, g.y), maxRad);
  const r1 = Math.hypot(nx, ny) || 1;
  const s = r0 / r1;
  return { x: nx * s, y: ny * s };
}

// src/theme-engine/renderers/cell/organelles.ts
function nucleusTransform(t, audioLevel, baseR, params, minMembraneR) {
  const rawCx = baseR * params.nucleusWander * noise2D(137, t * params.nucleusDrift);
  const rawCy = baseR * params.nucleusWander * noise2D(241, t * params.nucleusDrift * 1.3 + 555.5);
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
function contractileVacuole(t, baseR, params) {
  const period = Math.max(0.1, params.vacuolePeriod ?? 7);
  const Rmax = Math.max(0, params.vacuoleMaxFrac ?? 0.18) * Math.max(0, baseR);
  const u = (t / period % 1 + 1) % 1;
  let fill;
  if (u <= 0.85) {
    fill = smoothstep(u / 0.85);
  } else {
    fill = 1 - smoothstep((u - 0.85) / 0.15);
  }
  return { r: Rmax * fill };
}
function contractileVacuolePair(t, baseR, squeezePhi, params) {
  if (!params.enableVacuoles)
    return [];
  const maxFrac = params.vacuolePairMaxFrac ?? 0.16;
  const antPeriod = params.vacuoleAnteriorPeriod ?? 9;
  const postPeriod = params.vacuolePosteriorPeriod ?? 13;
  const antBearing = params.vacuoleAnteriorBearing ?? 1.9;
  const postBearing = params.vacuolePosteriorBearing ?? -1.9;
  const postPhase = params.vacuolePosteriorPhase ?? 0.5;
  const anterior = contractileVacuole(t, baseR, {
    ...params,
    vacuolePeriod: antPeriod,
    vacuoleMaxFrac: maxFrac
  });
  const posterior = contractileVacuole(t + postPhase * postPeriod, baseR, {
    ...params,
    vacuolePeriod: postPeriod,
    vacuoleMaxFrac: maxFrac
  });
  return [
    { bearing: squeezePhi + antBearing, r: anterior.r },
    { bearing: squeezePhi + postBearing, r: posterior.r }
  ];
}
function foodVacuoleSize(t, seedPhase, params) {
  const period = Math.max(0.1, params.foodVacuoleDigestPeriod ?? 30);
  const u = ((t / period + seedPhase) % 1 + 1) % 1;
  return 1 - 0.7 * u;
}
function seedFoodVacuoles(baseR, params) {
  if (!params.enableOrganelles)
    return [];
  const n = Math.max(0, Math.floor(params.foodVacuoleCount ?? 0));
  if (n === 0)
    return [];
  const maxRad = Math.max(0, params.foodVacuoleMaxRadiusFrac ?? 0.62) * Math.max(0, baseR);
  const out = [];
  for (let i = 0;i < n; i++) {
    const ang = (noise2D(i * 17.413 + 3.1, 52.917) + 1) * Math.PI;
    const rad = Math.sqrt((noise2D(i * 44.197 + 9.7, 23.671) + 1) * 0.5) * maxRad;
    const phase = (noise2D(i * 61.829 + 2.3, 88.541) + 1) * 0.5;
    out.push({ x: rad * Math.cos(ang), y: rad * Math.sin(ang), phase });
  }
  return out;
}
function seedInteriorFoodVacuoles(count, params) {
  const n = Math.max(0, Math.floor(count));
  const out = [];
  for (let i = 0;i < n; i++) {
    const xi_q = (noise2D(i * 17.413 + 3.1, 52.917) + 1) * 0.5;
    const xi_p = (noise2D(i * 44.197 + 9.7, 23.671) + 1) * 0.5;
    const xi_d = (noise2D(i * 61.829 + 2.3, 88.541) + 1) * 0.5;
    out.push({ q: xi_q, phi0: xi_p * TAU, digestPhase: xi_d });
  }
  return out;
}
function advectFoodVacuole(v, baseR, dt, params) {
  const omega = TAU / Math.max(0.1, params.foodVacuolePeriod ?? 55);
  const field = cyclosisField(v.x, v.y, omega);
  const nx = v.x + field.vx * dt;
  const ny = v.y + field.vy * dt;
  const maxRad = Math.max(0, params.foodVacuoleMaxRadiusFrac ?? 0.62) * Math.max(0, baseR);
  const r0 = Math.min(Math.hypot(v.x, v.y), maxRad);
  const r1 = Math.hypot(nx, ny) || 1;
  const s = r0 / r1;
  return { x: nx * s, y: ny * s, phase: v.phase };
}
function micronucleusTransform(macroCx, macroCy, macroR, params) {
  const r = macroR * (params.micronucleusSizeFrac ?? 0.32);
  const off = macroR * (params.micronucleusOffsetFrac ?? 1.15);
  const bearing = 0.7;
  return {
    cx: macroCx + Math.cos(bearing) * off,
    cy: macroCy + Math.sin(bearing) * off,
    r
  };
}
// src/theme-engine/renderers/cell/defaults.ts
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
  enableRestingProlate: false,
  prolateRestAspect: 1.7,
  enableAxialSpin: false,
  axialSpinMax: 3.5,
  enableStrokeAxis: true,
  strokeAxisKnee: 0.5,
  strokeAxisAlign: 1,
  enableEnergySmoothing: true,
  energySmoothTau: 0.08,
  enableSaturation: true,
  deformMax: 0.6,
  enableAreaNorm: true,
  enableAffine: true,
  enableActivity: true,
  enableAquarium: false,
  aquariumSeed: 1,
  aquariumAlpha: 0.35,
  aquariumActivityBoost: 0.4,
  diatomCount: 0,
  diatomAlpha: 0.35,
  diatomDriftSpeed: 1,
  euglenaCount: 0,
  euglenaSpeed: 1,
  euglenaSpeedActive: 2,
  euglenaScale: 1,
  euglenaHueOffset: 42,
  euglenaGravitaxis: 0,
  euglenaPhototaxis: 0,
  euglenaSeparation: 0,
  euglenaRotDiffusion: 0,
  vorticellaCount: 0,
  vorticellaContractRate: 1,
  vorticellaScale: 1,
  vorticellaAlongFrac: 0.5,
  didiniumCount: 0,
  didiniumSpeed: 1,
  didiniumSpeedActive: 2,
  didiniumScale: 1,
  didiniumHueOffset: 0,
  enableFlowField: false,
  flowMoteCount: 0,
  flowStrength: 300,
  enableCiliaOnContour: false,
  enableSomaticCilia: false,
  somaticCiliaCount: 72,
  somaticCiliaLength: 0.15,
  enableCiliaStructure: false,
  oralGapCenter: 1.2,
  oralGapWidth: 0.75,
  oralGapDip: 0.3,
  caudalTuftWidth: 0.6,
  caudalTuftLength: 1.7,
  enableRigidMembrane: false,
  enableBodyProfile: false,
  bodyProfileType: "egg",
  bodyProfileTaper: 0.27,
  bodyAspect: 3,
  bodyVentralBend: 0,
  enableOralGroove: false,
  oralGrooveDepth: 0.04,
  oralGrooveAngle: 1.2,
  oralGrooveWidth: 0.6,
  enableEctoplasm: false,
  ectoplasmFrac: 0.85,
  ectoplasmAlpha: 0.15,
  enableTrichocysts: false,
  trichocystCount: 30,
  trichocystLengthMul: 3,
  trichocystDecay: 1,
  trichocystLineWidth: 1.5,
  enableVacuoles: false,
  vacuoleAnteriorBearing: 1.9,
  vacuolePosteriorBearing: -1.9,
  vacuoleAnteriorPeriod: 9,
  vacuolePosteriorPeriod: 13,
  vacuolePairMaxFrac: 0.16,
  vacuolePosteriorPhase: 0.5,
  enableCyclosis: false,
  enableInteriorField: false,
  cyclosisGranuleCount: 14,
  cyclosisPeriod: 45,
  cyclosisSense: 1,
  granuleMaxRadiusFrac: 0.75,
  granuleSizePx: 1.3,
  enableOrganelles: false,
  foodVacuoleCount: 5,
  foodVacuolePeriod: 55,
  foodVacuoleMaxRadiusFrac: 0.62,
  foodVacuoleSizePx: 3,
  foodVacuoleDigestPeriod: 30,
  foodVacuoleSizeMul: 1,
  micronucleusSizeFrac: 0.2,
  micronucleusOffsetFrac: 1.15,
  macronucleusU: -0.05,
  macronucleusS: 0.1,
  cvAnteriorU: 0.55,
  cvAnteriorS: 0.62,
  cvPosteriorU: -0.55,
  cvPosteriorS: 0.62
};
// src/theme-engine/renderers/cell/aquarium/util.ts
var TAU2 = Math.PI * 2;
function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function wrapUnit(value) {
  if (!Number.isFinite(value))
    return 0;
  return (value % 1 + 1) % 1;
}
function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value, 0)));
}
function smoothstep2(x) {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}
function positive(value, fallback) {
  return Math.max(0.001, finiteOr(value, fallback));
}

// src/theme-engine/renderers/cell/aquarium/params.ts
function nonNegativeInt(value, fallback) {
  return Math.max(0, Math.floor(finiteOr(value, fallback)));
}
function nonNegative(value, fallback) {
  return Math.max(0, finiteOr(value, fallback));
}
function euglenaSteerOverride(params) {
  const gravitaxis = nonNegative(params.euglenaGravitaxis, 0);
  const phototaxis = nonNegative(params.euglenaPhototaxis, 0);
  const separation = nonNegative(params.euglenaSeparation, 0);
  const hasLoiter = params.euglenaLoiter !== undefined;
  const hasWake = params.euglenaWake !== undefined;
  if (gravitaxis === 0 && phototaxis === 0 && separation === 0 && !hasLoiter && !hasWake)
    return;
  return {
    gravitaxis,
    phototaxis,
    ...separation === 0 ? {} : { separation },
    ...hasLoiter ? { loiter: nonNegative(params.euglenaLoiter, 0) } : {},
    ...hasWake ? { wake: nonNegative(params.euglenaWake, 0) } : {}
  };
}
function mediumOverride(params) {
  const rotDiffusion = nonNegative(params.euglenaRotDiffusion, 0);
  if (rotDiffusion === 0)
    return;
  return { rotDiffusion };
}
function aquariumParamsView(params) {
  return {
    enabled: params.enableAquarium === true,
    seed: Math.trunc(finiteOr(params.aquariumSeed, 1)),
    alpha: nonNegative(params.aquariumAlpha, 0.35),
    activityBoost: nonNegative(params.aquariumActivityBoost, 0.4),
    diatoms: {
      count: nonNegativeInt(params.diatomCount, 0),
      alpha: nonNegative(params.diatomAlpha, 0.35),
      driftSpeed: nonNegative(params.diatomDriftSpeed, 1)
    },
    euglena: {
      count: nonNegativeInt(params.euglenaCount, 0),
      speed: nonNegative(params.euglenaSpeed, 1),
      speedActive: nonNegative(params.euglenaSpeedActive, 2),
      scale: nonNegative(params.euglenaScale, 1),
      hueOffset: finiteOr(params.euglenaHueOffset, 42),
      steer: euglenaSteerOverride(params)
    },
    medium: mediumOverride(params),
    vorticella: {
      count: nonNegativeInt(params.vorticellaCount, 0),
      contractRate: nonNegative(params.vorticellaContractRate, 1),
      scale: nonNegative(params.vorticellaScale, 1),
      alongFrac: Math.min(1, Math.max(0, finiteOr(params.vorticellaAlongFrac, 0.5)))
    },
    didinium: {
      count: nonNegativeInt(params.didiniumCount, 0),
      speed: nonNegative(params.didiniumSpeed, 1),
      speedActive: nonNegative(params.didiniumSpeedActive, 2),
      scale: nonNegative(params.didiniumScale, 1),
      hueOffset: finiteOr(params.didiniumHueOffset, 0)
    }
  };
}

// src/theme-engine/renderers/cell/aquarium/interaction.ts
var KIND_ID = { diatom: 0, euglena: 1, vorticella: 2, hero: 3, didinium: 4 };
function buildField(contribs) {
  const obstacles = [];
  const motiles = [];
  const wakes = [];
  for (const contrib of contribs) {
    if (contrib.kind === "obstacle") {
      obstacles.push(contrib);
    } else if (contrib.kind === "motile") {
      motiles.push(contrib);
    } else {
      wakes.push(contrib);
    }
  }
  return { obstacles, motiles, wakes };
}
function sourceId(kind, instanceIndex) {
  return KIND_ID[kind] << 20 | instanceIndex;
}

// src/theme-engine/renderers/cell/aquarium/hero.ts
function heroContribute(hero) {
  if (!hero)
    return [];
  const heroId = sourceId("hero", 0);
  return [
    {
      kind: "obstacle",
      shape: "ellipse",
      x: hero.x,
      y: hero.y,
      halfLen: hero.halfLen ?? hero.radius,
      halfWid: hero.halfWid ?? hero.radius,
      heading: hero.heading ?? 0,
      social: true,
      sourceId: heroId
    },
    {
      kind: "wake",
      x: hero.x,
      y: hero.y,
      heading: hero.heading ?? 0,
      sourceId: heroId
    },
    {
      kind: "motile",
      x: hero.x,
      y: hero.y,
      heading: hero.heading ?? 0,
      radius: Math.max(hero.halfWid ?? hero.radius, (hero.halfLen ?? hero.radius) * 0.35),
      speed: 0,
      role: "prey",
      strength: 1,
      sourceId: heroId
    }
  ];
}
function heroConsumeObstacles(circles, cx, cy, heroReach) {
  let curX = cx;
  let curY = cy;
  for (const o of circles) {
    const dx = curX - o.x;
    const dy = curY - o.y;
    const d = Math.hypot(dx, dy);
    const minD = o.radius + heroReach;
    if (d < minD && d > 0.000001) {
      const push = minD - d;
      curX += dx / d * push;
      curY += dy / d * push;
    }
  }
  return { dx: curX - cx, dy: curY - cy };
}

// src/theme-engine/renderers/cell/aquarium/seeds.ts
function mix32(n) {
  let x = n | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2146121005);
  x ^= x >>> 15;
  x = Math.imul(x, 2221713035);
  x ^= x >>> 16;
  return x >>> 0;
}
function seededUnit(seed, index, salt) {
  return mix32(seed ^ Math.imul(index + 1, 2654435761) ^ salt) / 4294967296;
}
function smoothstep01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}
function lerp2(a, b, t) {
  return a + (b - a) * t;
}
function latticeUnit(seed, ix, iy) {
  return mix32(seed ^ Math.imul(ix | 0, 2654435761) ^ Math.imul(iy | 0, 2246822507)) / 4294967296;
}
function noise2D2(seed, x, y) {
  const fx = Number.isFinite(x) ? x : 0;
  const fy = Number.isFinite(y) ? y : 0;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothstep01(fx - x0);
  const ty = smoothstep01(fy - y0);
  const v00 = latticeUnit(seed, x0, y0);
  const v10 = latticeUnit(seed, x0 + 1, y0);
  const v01 = latticeUnit(seed, x0, y0 + 1);
  const v11 = latticeUnit(seed, x0 + 1, y0 + 1);
  return lerp2(lerp2(v00, v10, tx), lerp2(v01, v11, tx), ty);
}

// src/theme-engine/renderers/cell/aquarium/diatoms.ts
function wrap(value, max) {
  if (!(max > 0))
    return 0;
  const wrapped = value % max;
  return wrapped < 0 ? wrapped + max : wrapped;
}
function transform(cx, cy, ux, uy, x, y) {
  const nx = -uy;
  const ny = ux;
  return { x: cx + ux * x + nx * y, y: cy + uy * x + ny * y };
}
function naviculaHalfWidth(u, halfWidth) {
  return halfWidth * Math.sin(Math.acos(Math.max(-1, Math.min(1, u))));
}
function diatomGeometry(shape, options = {}) {
  const cx = finiteOr(options.centerX, 0);
  const cy = finiteOr(options.centerY, 0);
  const length = positive(options.length, shape === "navicula" ? 7 : 5);
  const width = positive(options.width, shape === "navicula" ? length * 0.32 : length * 0.62);
  const heading = finiteOr(options.heading, 0);
  const minStriaSpacing = positive(options.minStriaSpacing, 1.1);
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const outline = [];
  const striae = [];
  const raphe = [];
  if (shape === "navicula") {
    const steps = 16;
    for (let i = 0;i < steps; i++) {
      const a = i / steps * Math.PI * 2;
      const x = halfLength * Math.cos(a);
      const y = halfWidth * Math.sin(a) * (0.72 + 0.28 * Math.abs(Math.cos(a)));
      outline.push(transform(cx, cy, ux, uy, x, y));
    }
    raphe.push(transform(cx, cy, ux, uy, -halfLength * 0.78, 0));
    raphe.push(transform(cx, cy, ux, uy, halfLength * 0.78, 0));
    const pairCount = Math.max(1, Math.min(8, Math.floor(length / minStriaSpacing)));
    for (let i = 1;i <= pairCount; i++) {
      const x = i / (pairCount + 1) * halfLength * 0.9;
      for (const sign of [-1, 1]) {
        const sx = x * sign;
        const u = sx / halfLength;
        const hw = naviculaHalfWidth(u, halfWidth) * 0.72;
        striae.push({
          from: transform(cx, cy, ux, uy, sx, -hw),
          to: transform(cx, cy, ux, uy, sx, hw)
        });
      }
    }
  } else {
    const steps = 20;
    for (let i = 0;i < steps; i++) {
      const a = i / steps * Math.PI * 2;
      outline.push(transform(cx, cy, ux, uy, halfLength * Math.cos(a), halfWidth * Math.sin(a)));
    }
    raphe.push(transform(cx, cy, ux, uy, -halfLength * 0.18, 0));
    raphe.push(transform(cx, cy, ux, uy, halfLength * 0.18, 0));
    const radialCount = Math.max(4, Math.min(16, Math.floor(Math.PI * width / minStriaSpacing)));
    for (let i = 0;i < radialCount; i++) {
      const a = i / radialCount * Math.PI * 2;
      striae.push({
        from: transform(cx, cy, ux, uy, Math.cos(a) * halfLength * 0.18, Math.sin(a) * halfWidth * 0.18),
        to: transform(cx, cy, ux, uy, Math.cos(a) * halfLength * 0.72, Math.sin(a) * halfWidth * 0.72)
      });
    }
  }
  return { shape, center: { x: cx, y: cy }, outline, raphe, striae };
}
function seedDiatoms(count, seed, frame, salt = 219836621) {
  if (count <= 0)
    return [];
  const diatoms = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  for (let i = 0;i < count; i++) {
    const shape = seededUnit(seed, i, salt ^ 430193937) < 0.68 ? "navicula" : "ovalCentric";
    const heading = seededUnit(seed, i, salt ^ 1757159915) * Math.PI * 2;
    const driftAngle = seededUnit(seed, i, salt ^ 879275157) * Math.PI * 2;
    const driftMag = 0.18 + seededUnit(seed, i, salt ^ 802853537) * 0.82;
    const rotationSign = seededUnit(seed, i, salt ^ 1440215741) < 0.5 ? -1 : 1;
    diatoms.push({
      x: seededUnit(seed, i, salt) * safeWidth,
      y: seededUnit(seed, i, salt ^ 1374496523) * safeHeight,
      phase: heading,
      size: 0.5 + seededUnit(seed, i, salt ^ 48610963),
      shape,
      heading,
      driftX: Math.cos(driftAngle) * driftMag,
      driftY: Math.sin(driftAngle) * driftMag,
      rotationRate: rotationSign * (0.018 + seededUnit(seed, i, salt ^ 474954439) * 0.045)
    });
  }
  return diatoms;
}
function updateDiatoms(diatoms, frame, view) {
  if (diatoms.length === 0)
    return diatoms;
  const dt = Math.max(0, finite(frame.dt, 0));
  const speed = Math.max(0, finite(view.diatoms.driftSpeed, 0));
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  return diatoms.map((diatom) => ({
    ...diatom,
    x: wrap(finite(diatom.x, 0) + finite(diatom.driftX, 0) * speed * dt, safeWidth),
    y: wrap(finite(diatom.y, 0) + finite(diatom.driftY, 0) * speed * dt, safeHeight),
    heading: wrap(finite(diatom.heading, 0) + finite(diatom.rotationRate, 0) * dt, TAU2)
  }));
}
function drawPolyline(ctx, points, close) {
  if (points.length === 0)
    return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1;i < points.length; i++)
    ctx.lineTo(points[i].x, points[i].y);
  if (close)
    ctx.closePath();
}
function drawDiatoms(ctx, diatoms, frame, view) {
  if (!view.enabled || diatoms.length === 0 || view.diatoms.count <= 0)
    return;
  const alpha = Math.max(0, Math.min(1, view.alpha * view.diatoms.alpha));
  if (alpha <= 0)
    return;
  const shimmer = 1 + 0.05 * Math.max(0, Math.min(1, finite(frame.activity, 0)));
  const hue = finite(frame.baseHue, 50) - 8;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0;i < diatoms.length; i++) {
    const diatom = diatoms[i];
    const length = Math.max(3, Math.min(8, (diatom.shape === "navicula" ? 5.5 : 4.6) * finite(diatom.size, 1)));
    const width = diatom.shape === "navicula" ? length * 0.33 : length * 0.68;
    const geometry = diatomGeometry(diatom.shape, {
      centerX: finite(diatom.x, 0),
      centerY: finite(diatom.y, 0),
      length,
      width,
      heading: finite(diatom.heading, 0),
      minStriaSpacing: 1.25
    });
    const fillAlpha = alpha * 0.18 * shimmer;
    const strokeAlpha = alpha * 0.42 * shimmer;
    const detailAlpha = alpha * 0.24 * shimmer;
    drawPolyline(ctx, geometry.outline, true);
    ctx.fillStyle = `hsla(${hue}, 35%, 63%, ${fillAlpha})`;
    ctx.strokeStyle = `hsla(${hue}, 42%, 70%, ${strokeAlpha})`;
    ctx.lineWidth = 0.55;
    ctx.fill();
    ctx.stroke();
    drawPolyline(ctx, geometry.raphe, false);
    ctx.strokeStyle = `hsla(${hue + 12}, 28%, 78%, ${detailAlpha})`;
    ctx.lineWidth = 0.35;
    ctx.stroke();
    ctx.strokeStyle = `hsla(${hue - 8}, 32%, 55%, ${detailAlpha * 0.75})`;
    ctx.lineWidth = 0.28;
    for (const stria of geometry.striae) {
      ctx.beginPath();
      ctx.moveTo(stria.from.x, stria.from.y);
      ctx.lineTo(stria.to.x, stria.to.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// src/theme-engine/renderers/cell/aquarium/euglena.ts
var METABOLY_AMP = 0.16;
var METABOLY_K = 1.3;
var STRIAE_TURNS = 1.25;
var STRIAE_AMP = 0.62;
function euglenaModeView(mode) {
  switch (mode) {
    case "recording":
      return { motionMul: 1.15, alphaMul: 1.08 };
    case "transcribing":
      return { motionMul: 0.35, alphaMul: 0.8 };
    case "error":
      return { motionMul: 0.15, alphaMul: 0.55 };
    case "idle":
    default:
      return { motionMul: 1, alphaMul: 1 };
  }
}
function point(cx, cy, ux, uy, along) {
  return { x: cx + ux * along, y: cy + uy * along };
}
function transform2(cx, cy, ux, uy, along, lateral) {
  const nx = -uy;
  const ny = ux;
  return { x: cx + ux * along + nx * lateral, y: cy + uy * along + ny * lateral };
}
function euglenaDisplayLength(size, scale) {
  const s = Math.max(0.1, finite(scale, 1));
  return Math.max(5, Math.min(16 * s, (7.2 + finite(size, 1) * 1.6) * s));
}
function bodyShape(u) {
  const us = u - 0.28 * (1 - u * u);
  const a = Math.max(0, 1 - us * us);
  const p = us >= 0 ? 0.4 : 0.9;
  let w = Math.pow(a, p);
  const d = (u - 0.9) / 0.11;
  w *= 1 - 0.32 * Math.exp(-d * d);
  return w;
}
var BODY_SHAPE_MAX = (() => {
  let m = 0;
  for (let i = 0;i <= 400; i++) {
    const u = -1 + i / 400 * 2;
    m = Math.max(m, bodyShape(u));
  }
  return m;
})();
function normHalfWidth(u) {
  return bodyShape(u) / BODY_SHAPE_MAX;
}
function euglenaPose(rollPhase, metabolyPhase, options = {}) {
  const cx = finiteOr(options.centerX, 0);
  const cy = finiteOr(options.centerY, 0);
  const length = positive(options.length, 8);
  const baseWidth = positive(options.baseWidth, length * 0.22);
  const heading = finiteOr(options.heading, 0);
  const flagellumLength = positive(options.flagellumLength, length * 1.1);
  const envelope = clamp01(finiteOr(options.metabolyEnvelope, 1));
  const roll = wrapUnit(rollPhase);
  const metaboly = wrapUnit(metabolyPhase);
  const flagellum = wrapUnit(options.flagellumPhase ?? roll * 1.7);
  const rollAng = roll * TAU2;
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const halfLength = length / 2;
  const rollCos = Math.cos(rollAng);
  const widthMul = 0.85 + 0.15 * Math.abs(rollCos);
  const wmax = baseWidth / 2;
  const apparentWidth = baseWidth * widthMul;
  const stripePhase = wrapUnit(roll + metaboly * 0.18);
  const metabolyAt = (u) => {
    const wave = Math.sin(TAU2 * (METABOLY_K * (u + 1) / 2 - metaboly)) * (1 - u * u);
    return 1 + METABOLY_AMP * envelope * wave;
  };
  let areaScale = 1;
  {
    let a0 = 0;
    let at = 0;
    for (let i = 0;i <= 40; i++) {
      const u = -1 + i / 40 * 2;
      const base = normHalfWidth(u);
      a0 += base;
      at += base * metabolyAt(u);
    }
    areaScale = at > 0.000001 ? a0 / at : 1;
  }
  const halfWidthAt = (u) => wmax * widthMul * normHalfWidth(u) * metabolyAt(u) * areaScale;
  const anterior = point(cx, cy, ux, uy, halfLength);
  const posterior = point(cx, cy, ux, uy, -halfLength);
  const SAMPLES = Math.max(28, Math.min(56, Math.round(length / 2.2)));
  const upper = [];
  const lower = [];
  for (let i = 0;i <= SAMPLES; i++) {
    const u = -Math.cos(Math.PI * i / SAMPLES);
    const hw = halfWidthAt(u);
    upper.push(transform2(cx, cy, ux, uy, halfLength * u, hw));
    lower.push(transform2(cx, cy, ux, uy, halfLength * u, -hw));
  }
  const outline = [...upper, ...lower.reverse()];
  const bodySamples = [-1, -0.5, 0, 0.5, 1].map((u) => ({ u, halfWidth: halfWidthAt(u) }));
  const ampTip = positive(options.flagellumAmp, apparentWidth * 0.9);
  const maxLat = positive(options.maxFlagellumLateral, ampTip);
  const waves = positive(options.flagellumWaves, 1.7);
  const segs = Math.max(2, Math.floor(finiteOr(options.flagellumSegments, 10)));
  const flagellumPoints = [anterior];
  for (let i = 1;i <= segs; i++) {
    const q = i / segs;
    const env = 0.18 + 0.82 * Math.pow(q, 1.5);
    const ph = TAU2 * flagellum - waves * TAU2 * q;
    const lateral = clamp(ampTip * env * (Math.sin(ph) + 0.28 * Math.sin(2 * ph + Math.PI / 2)), -maxLat, maxLat);
    const curl = ampTip * env * 0.55 * Math.cos(ph);
    const along = halfLength + flagellumLength * q + curl;
    flagellumPoints.push(transform2(cx, cy, ux, uy, along, lateral));
  }
  const flagellumEnd = flagellumPoints[flagellumPoints.length - 1];
  const eyeSUnit = 0.7;
  const eyespot = transform2(cx, cy, ux, uy, halfLength * 0.66, eyeSUnit * Math.cos(rollAng) * halfWidthAt(0.66));
  const eyespotFront = 0.5 + 0.5 * Math.cos(rollAng - eyeSUnit * 1.2);
  const seed = options.organelleSeed;
  const chloroplasts = [];
  const paramylon = [];
  let nucleus = null;
  let reservoir = null;
  let contractileVacuole2 = null;
  const pellicleStrips = [];
  if (seed !== undefined) {
    const bodyPoint = (u, sFrac) => transform2(cx, cy, ux, uy, halfLength * u, sFrac * halfWidthAt(u));
    const safeEllipse = (u, sUnit, baseRx, baseRy, hueShift, lightShift) => {
      const hw = halfWidthAt(u);
      const ry = Math.max(0.2, Math.min(baseRy, hw * 0.85));
      const latMax = Math.max(0, hw - ry);
      const lat = sUnit * latMax * Math.cos(rollAng);
      const p = transform2(cx, cy, ux, uy, halfLength * u, lat);
      return {
        x: p.x,
        y: p.y,
        rx: Math.max(0.3, Math.min(baseRx, halfLength * 0.5)),
        ry,
        angle: heading,
        hueShift,
        lightShift,
        front: 0.5 + 0.5 * Math.cos(rollAng - sUnit * 1.2)
      };
    };
    const chCount = Math.max(0, Math.floor(finiteOr(options.chloroplastCount, 0)));
    for (let j = 0;j < chCount; j++) {
      const u = -0.7 + seededUnit(seed, j, 2585733948) * 1.2;
      const sUnit = (seededUnit(seed, j, 1371344503) - 0.5) * 2;
      chloroplasts.push(safeEllipse(u, sUnit, length * 0.08, length * 0.045, (seededUnit(seed, j, 752460107) - 0.5) * 8, (seededUnit(seed, j, 2117754257) - 0.5) * 5));
    }
    if (options.includeNucleus) {
      nucleus = safeEllipse(-0.22, 0, length * 0.11, length * 0.12, 0, 0);
    }
    const pmCount = Math.max(0, Math.floor(finiteOr(options.paramylonCount, 0)));
    if (pmCount >= 1)
      paramylon.push(safeEllipse(-0.45, 0.5, length * 0.038, length * 0.038, 0, 0));
    if (pmCount >= 2)
      paramylon.push(safeEllipse(-0.22, -0.5, length * 0.034, length * 0.034, 0, 0));
    if (options.includeReservoir) {
      const rr = Math.max(0.4, Math.min(length * 0.04, halfWidthAt(0.78) * 0.8));
      const p = bodyPoint(0.78, 0);
      reservoir = { x: p.x, y: p.y, r: rr };
    }
    if (options.includeCV) {
      const cvPulse = 0.5 - 0.5 * Math.cos(TAU2 * wrapUnit(finiteOr(options.cvPhase, 0)));
      const cvR = Math.max(0.4, Math.min(length * (0.025 + 0.05 * cvPulse), halfWidthAt(0.6) * 0.75));
      const latMax = Math.max(0, halfWidthAt(0.6) - cvR);
      const lat = -0.5 * latMax * Math.cos(rollAng);
      const p = transform2(cx, cy, ux, uy, halfLength * 0.6, lat);
      contractileVacuole2 = { x: p.x, y: p.y, r: cvR };
    }
    const stCount = Math.max(0, Math.floor(finiteOr(options.striaeCount, 0)));
    for (let j = 0;j < stCount; j++) {
      const phiJ = j / stCount;
      const strip = [];
      for (let k = 0;k <= 11; k++) {
        const u = -0.85 + k / 11 * 1.7;
        const ax = (u + 1) / 2;
        const sFrac = clamp(STRIAE_AMP * Math.sin(TAU2 * (STRIAE_TURNS * ax + phiJ + stripePhase)), -0.92, 0.92);
        strip.push(bodyPoint(u, sFrac));
      }
      pellicleStrips.push(strip);
    }
  }
  return {
    center: { x: cx, y: cy },
    anterior,
    posterior,
    eyespot,
    eyespotFront,
    flagellumEnd,
    flagellumPoints,
    apparentWidth,
    stripePhase,
    bodySamples,
    heading,
    ux,
    uy,
    halfLength,
    outline,
    chloroplasts,
    nucleus,
    paramylon,
    reservoir,
    contractileVacuole: contractileVacuole2,
    pellicleStrips
  };
}
function seedEuglena(count, seed, frame, salt = 235478698) {
  if (count <= 0)
    return [];
  const euglena = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  for (let i = 0;i < count; i++) {
    const dir = seededUnit(seed, i, salt ^ 1757159915) < 0.5 ? 0 : Math.PI;
    const tilt = (seededUnit(seed, i, salt ^ 463228477) - 0.5) * 0.5;
    const heading = dir + tilt;
    euglena.push({
      x: seededUnit(seed, i, salt) * safeWidth,
      y: seededUnit(seed, i, salt ^ 1374496523) * safeHeight,
      phase: heading,
      size: 0.5 + seededUnit(seed, i, salt ^ 48610963),
      heading,
      swimSpeed: 0.85 + seededUnit(seed, i, salt ^ 802853537) * 0.3,
      rollPhase: seededUnit(seed, i, salt ^ 1107813911),
      metabolyPhase: seededUnit(seed, i, salt ^ 972076277),
      flagellumPhase: seededUnit(seed, i, salt ^ 668265263),
      rollRate: 0.25 + seededUnit(seed, i, salt ^ 348696353) * 0.25,
      metabolyRate: 0.1 + seededUnit(seed, i, salt ^ 1002986003) * 0.06,
      flagellumRate: 10 + seededUnit(seed, i, salt ^ 1966046297) * 6,
      spiralAmplitude: 0.12 + seededUnit(seed, i, salt ^ 1638598935) * 0.06,
      cvPhase: seededUnit(seed, i, salt ^ 1033993285),
      cvRate: 0.035 + seededUnit(seed, i, salt ^ 1508030371) * 0.015,
      burstPhase: seededUnit(seed, i, salt ^ 528247593),
      burstRate: 0.08 + seededUnit(seed, i, salt ^ 1186583265) * 0.05,
      turnProgress: 2,
      turnFrom: heading,
      turnTo: heading,
      tumbleIndex: 0,
      tumbleFrom: heading,
      tumbleTo: heading,
      tumbleProgress: 1,
      startle: 0,
      noiseSeed: mix32(seed ^ Math.imul(i + 1, 2654435761) ^ 24301) >>> 0
    });
  }
  return euglena;
}
var EUGLENA_STEER = {
  forward: 1,
  wall: 2,
  hero: 0,
  loiter: 1.1,
  wake: 10,
  separation: 0,
  startleAway: 3,
  startleDart: 1,
  gravitaxis: 0,
  phototaxis: 0,
  obstacle: 1.8
};
var MEDIUM = {
  viscosity: 1.6,
  rotDiffusion: 0,
  translationDrag: 1
};
var HERO_LOITER_Q = 1.3;
var HERO_INTEREST_RANGE = 2.2;
var HERO_WAKE_RANGE = 1.5;
var STARTLE_TRIGGER_Q = 1.12;
var STARTLE_TAU = 0.6;
var TUMBLE_WINDOW = 0.08;
var TUMBLE_SECONDS = 1;
var TUMBLE_MIN_RAD = Math.PI / 6;
var TUMBLE_MAX_RAD = 5 * Math.PI / 6;
var TUMBLE_RATE_MIN = 0.045;
var TUMBLE_RATE_MAX = 0.16;
var SEPARATION_RANGE_BODY_LENGTHS = 1.6;
var DIDINIUM_HAZARD_WEIGHT = 0.55;
var EUGLENA_RELEVANT_FIELDS = new Set(["obstacle", "wake", "motile"]);
function euglenaContribute(cell, idx, scale = 1) {
  const length = euglenaDisplayLength(finite(cell.size, 1), scale);
  return [{
    kind: "motile",
    x: cell.x,
    y: cell.y,
    heading: finiteOr(cell.heading, finiteOr(cell.phase, 0)),
    radius: length * 0.18,
    speed: Math.max(0, finiteOr(cell.swimSpeed, 0)),
    role: "neutral",
    strength: 0.35,
    sourceId: sourceId("euglena", idx)
  }];
}
function updateEuglena(euglena, frame, view) {
  if (euglena.length === 0)
    return euglena;
  const dt = Math.max(0, finite(frame.dt, 0));
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  const activityMix = clamp01(finite(frame.activity, 0) * finite(view.activityBoost, 0));
  const modeView = euglenaModeView(frame.mode);
  const vIdleBL = Math.max(0, finite(view.euglena.speed, 0));
  const vActiveBL = Math.max(0, finite(view.euglena.speedActive, vIdleBL));
  const vBL = (vIdleBL + (vActiveBL - vIdleBL) * activityMix) * modeView.motionMul;
  const act = modeView.motionMul * (1 + 0.7 * activityMix);
  const scale = view.euglena.scale;
  const steer = view.euglena.steer ? { ...EUGLENA_STEER, ...view.euglena.steer } : EUGLENA_STEER;
  const medium = view.medium ? { ...MEDIUM, ...view.medium } : MEDIUM;
  const drag = Math.max(0.1, finite(medium.viscosity, 1));
  return euglena.map((cell, idx) => {
    const selfId = sourceId("euglena", idx);
    const L = euglenaDisplayLength(finite(cell.size, 1), scale);
    let heading = finite(cell.heading, 0);
    const wrapPi2 = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const px0 = finite(cell.x, 0);
    const py0 = finite(cell.y, 0);
    let ux = Math.cos(heading);
    let uy = Math.sin(heading);
    const vPx = Math.max(0, finite(cell.swimSpeed, 0)) * vBL * L;
    const wallInset = Math.min(L * 0.8, safeWidth * 0.22, safeHeight * 0.22);
    const field = frame.interaction;
    const fieldObstacles = field ? field.obstacles.filter((obstacle) => obstacle.sourceId !== selfId) : undefined;
    const fieldWakes = field ? field.wakes.filter((wake) => wake.sourceId !== selfId) : undefined;
    const sameSpeciesMotiles = field?.motiles.filter((motile) => motile.sourceId >> 20 === KIND_ID.euglena && motile.sourceId !== selfId);
    const didiniumHazards = field?.motiles.filter((motile) => motile.sourceId >> 20 === KIND_ID.didinium);
    const circleObstacles = fieldObstacles?.filter((obstacle) => obstacle.shape === "circle");
    const socialEllipse = fieldObstacles?.find((obstacle) => obstacle.shape === "ellipse" && obstacle.social === true);
    const socialWake = socialEllipse ? fieldWakes?.find((wake) => wake.sourceId === socialEllipse.sourceId) : undefined;
    let heroParams = null;
    let heroQd = Infinity;
    if (socialEllipse) {
      const hx = finite(socialEllipse.x, safeWidth / 2);
      const hy = finite(socialEllipse.y, safeHeight / 2);
      const m = 0.9 * L;
      const A = Math.max(0.001, finiteOr(socialEllipse.halfLen, 0) + m);
      const B = Math.max(0.001, finiteOr(socialEllipse.halfWid, 0) + m);
      const hh = finiteOr(socialEllipse.heading, 0);
      heroParams = { hx, hy, A, B, cphi: Math.cos(hh), sphi: Math.sin(hh), heading: hh };
      const dx = px0 - hx, dy = py0 - hy;
      const px = dx * heroParams.cphi + dy * heroParams.sphi;
      const py = -dx * heroParams.sphi + dy * heroParams.cphi;
      heroQd = px * px / (A * A) + py * py / (B * B);
    } else if (!field && frame.hero) {
      const hx = finite(frame.hero.x, safeWidth / 2);
      const hy = finite(frame.hero.y, safeHeight / 2);
      const hr = Math.max(0, finite(frame.hero.radius, 0));
      const m = 0.9 * L;
      const A = Math.max(0.001, finiteOr(frame.hero.halfLen, hr) + m);
      const B = Math.max(0.001, finiteOr(frame.hero.halfWid, hr) + m);
      const hh = finiteOr(frame.hero.heading, 0);
      heroParams = { hx, hy, A, B, cphi: Math.cos(hh), sphi: Math.sin(hh), heading: hh };
      const dx = px0 - hx, dy = py0 - hy;
      const px = dx * heroParams.cphi + dy * heroParams.sphi;
      const py = -dx * heroParams.sphi + dy * heroParams.cphi;
      heroQd = px * px / (A * A) + py * py / (B * B);
    }
    const heroQ = Math.sqrt(Math.max(0, heroQd));
    let ax = 0, ay = 0;
    if (heroParams) {
      const dxh = px0 - heroParams.hx, dyh = py0 - heroParams.hy;
      const dh = Math.hypot(dxh, dyh) || 0.000001;
      ax = dxh / dh;
      ay = dyh / dh;
    }
    const interest = 0.55 + 0.45 * Math.sin(TAU2 * wrapUnit(finiteOr(cell.burstPhase, 0)) + 1.3);
    let startle = clamp01(finiteOr(cell.startle, 0));
    if (heroParams && heroQ > 0.0001 && heroQ < STARTLE_TRIGGER_Q)
      startle = 1;
    if (finite(frame.startle, 0) > 0.5)
      startle = 1;
    let priorityPressure = 0;
    {
      let sx = ux * steer.forward;
      let sy = uy * steer.forward;
      const look = L * 2.8;
      const leftGap = px0 - wallInset;
      const rightGap = safeWidth - wallInset - px0;
      const topGap = py0 - wallInset;
      const bottomGap = safeHeight - wallInset - py0;
      if (leftGap < look)
        sx += (1 - leftGap / look) * steer.wall;
      if (rightGap < look)
        sx -= (1 - rightGap / look) * steer.wall;
      if (topGap < look)
        sy += (1 - topGap / look) * steer.wall;
      if (bottomGap < look)
        sy -= (1 - bottomGap / look) * steer.wall;
      const gravFade = clamp01((safeHeight / Math.max(0.000001, L) - 3) / 2);
      sy -= steer.gravitaxis * gravFade;
      if (steer.phototaxis !== 0 && safeWidth > 0 && safeHeight > 0) {
        const lightX = safeWidth;
        const lightY = safeHeight / 2;
        const ldx = lightX - px0;
        const ldy = lightY - py0;
        const ldist = Math.hypot(ldx, ldy) || 0.000001;
        const intensity = clamp01(finite(frame.activity, 0) + 0.5 * finite(frame.audioLevel, 0));
        const I_SAT = 0.7;
        const response = intensity * (1 - intensity / I_SAT);
        const photoW = steer.phototaxis * response;
        sx += ldx / ldist * photoW;
        sy += ldy / ldist * photoW;
      }
      if (heroParams && heroQ < HERO_INTEREST_RANGE && heroQ > 0.0001) {
        const falloff = Math.min(1, (HERO_INTEREST_RANGE - heroQ) / (HERO_INTEREST_RANGE - 1));
        const wr = (steer.hero + steer.loiter * interest * (HERO_LOITER_Q - heroQ)) * falloff;
        sx += ax * wr;
        sy += ay * wr;
        sx += ax * steer.startleAway * startle;
        sy += ay * steer.startleAway * startle;
      }
      const separationW = steer.separation;
      if (sameSpeciesMotiles && sameSpeciesMotiles.length > 0) {
        const reach = L * SEPARATION_RANGE_BODY_LENGTHS;
        for (let mi = 0;mi < sameSpeciesMotiles.length; mi++) {
          const mdx = px0 - finite(sameSpeciesMotiles[mi].x, 0);
          const mdy = py0 - finite(sameSpeciesMotiles[mi].y, 0);
          const md = Math.hypot(mdx, mdy) || 0.000001;
          if (md < reach) {
            const prox = (reach - md) / reach;
            const w = separationW * prox;
            sx += mdx / md * w;
            sy += mdy / md * w;
          }
        }
      }
      if (didiniumHazards && didiniumHazards.length > 0) {
        for (let hi = 0;hi < didiniumHazards.length; hi++) {
          const hazard = didiniumHazards[hi];
          const hdx = px0 - finite(hazard.x, 0);
          const hdy = py0 - finite(hazard.y, 0);
          const hd = Math.hypot(hdx, hdy) || 0.000001;
          const hazardRadius = Math.max(0, finiteOr(hazard.radius, L * 0.35));
          const reach = Math.max(L * 1.2, L * 0.75 + hazardRadius * 1.25 + 8);
          if (hd < reach) {
            const prox = (reach - hd) / reach;
            const w = DIDINIUM_HAZARD_WEIGHT * prox;
            sx += hdx / hd * w;
            sy += hdy / hd * w;
          }
        }
      }
      const obstacles = circleObstacles;
      if (obstacles && obstacles.length > 0) {
        for (let oi = 0;oi < obstacles.length; oi++) {
          const ox = finite(obstacles[oi].x, 0);
          const oy = finite(obstacles[oi].y, 0);
          const orad = Math.max(1, finite(obstacles[oi].radius, 1));
          const odx = px0 - ox, ody = py0 - oy;
          const od = Math.hypot(odx, ody) || 0.000001;
          const reach = orad + L * 1.8;
          if (od < reach) {
            const prox = (reach - od) / reach;
            sx += odx / od * steer.obstacle * prox;
            sy += ody / od * steer.obstacle * prox;
          }
        }
      }
      const pressure = Math.hypot(sx - ux * steer.forward, sy - uy * steer.forward);
      priorityPressure = pressure;
      if (pressure > 0.000001) {
        const desired = Math.atan2(sy, sx);
        const turnK = (1 + 2.5 * Math.min(1, pressure)) / drag;
        heading += wrapPi2(desired - heading) * (1 - Math.exp(-turnK * dt));
        ux = Math.cos(heading);
        uy = Math.sin(heading);
      }
    }
    const vPxEff = vPx * (1 + steer.startleDart * startle) / Math.max(0.1, finite(medium.translationDrag, 1));
    let nextX = px0 + ux * vPxEff * dt;
    let nextY = py0 + uy * vPxEff * dt;
    if (heroParams && (!field || socialWake) && heroQ < HERO_WAKE_RANGE && heroQ > 0.0001) {
      const hd = finiteOr(socialWake?.heading, heroParams.heading);
      const hdx = Math.cos(hd), hdy = Math.sin(hd);
      const behind = Math.max(0, -(ax * hdx + ay * hdy));
      const prox = Math.min(1, (HERO_WAKE_RANGE - heroQ) / (HERO_WAKE_RANGE - 1));
      const wakeSpeed = steer.wake * prox * behind / drag;
      nextX += hdx * wakeSpeed * dt;
      nextY += hdy * wakeSpeed * dt;
    }
    if (heroParams) {
      const { hx, hy, A, B, cphi, sphi } = heroParams;
      const dx = nextX - hx, dy = nextY - hy;
      const px = dx * cphi + dy * sphi;
      const py = -dx * sphi + dy * cphi;
      const qd = px * px / (A * A) + py * py / (B * B);
      if (qd < 1 && qd > 0.000000001) {
        const f = 1 / Math.sqrt(qd);
        const tx = px * f, ty = py * f;
        const mvx = (tx - px) * cphi - (ty - py) * sphi;
        const mvy = (tx - px) * sphi + (ty - py) * cphi;
        const need = Math.hypot(mvx, mvy);
        if (need > 0.000001) {
          const step = need * (1 - Math.exp(-6 * dt));
          nextX += mvx / need * step;
          nextY += mvy / need * step;
        }
      }
    }
    const obstacles2 = circleObstacles;
    if (obstacles2 && obstacles2.length > 0) {
      for (let oi = 0;oi < obstacles2.length; oi++) {
        const ox = finite(obstacles2[oi].x, 0);
        const oy = finite(obstacles2[oi].y, 0);
        const minD = Math.max(1, finite(obstacles2[oi].radius, 1)) + 0.4 * L;
        const odx = nextX - ox, ody = nextY - oy;
        const od = Math.hypot(odx, ody);
        if (od < minD && od > 0.000001) {
          const push = (minD - od) * (1 - Math.exp(-6 * dt));
          nextX += odx / od * push;
          nextY += ody / od * push;
        }
      }
    }
    const rollDelta = Math.max(0, finite(cell.rollRate, 0)) * act * dt;
    const noiseSeed = finiteOr(cell.noiseSeed, 0) | 0;
    const bphase = wrapUnit(finiteOr(cell.burstPhase, 0));
    const burstBase = Math.max(0, finiteOr(cell.burstRate, 0));
    let tumbleIndex = Math.max(0, Math.floor(finiteOr(cell.tumbleIndex, 0)));
    let tumbleFrom = finiteOr(cell.tumbleFrom, heading);
    let tumbleTo = finiteOr(cell.tumbleTo, heading);
    let tumbleProgress = clamp01(finiteOr(cell.tumbleProgress, 1));
    const runU = Math.max(0.02, noise2D2(noiseSeed ^ 1821285621, tumbleIndex + 0.17, 0.31));
    const intervalScale = clamp(Math.pow(runU, -0.85), 0.6, 3.6);
    const effectiveBurstRate = burstBase > 0 ? clamp(burstBase / intervalScale, TUMBLE_RATE_MIN, TUMBLE_RATE_MAX) : 0;
    const newBurstPhase = wrapUnit(bphase + effectiveBurstRate * act * dt);
    const firedTumble = effectiveBurstRate > 0 && newBurstPhase < bphase;
    if (firedTumble) {
      tumbleIndex += 1;
      const sign = noise2D2(noiseSeed ^ 2050968865, tumbleIndex, 0.23) < 0.5 ? -1 : 1;
      const magU = noise2D2(noiseSeed ^ 791783381, tumbleIndex, 0.71);
      const magnitude = TUMBLE_MIN_RAD + (TUMBLE_MAX_RAD - TUMBLE_MIN_RAD) * magU;
      tumbleFrom = heading;
      tumbleTo = heading + sign * magnitude;
      tumbleProgress = 0;
    }
    const flick = effectiveBurstRate > 0 && (bphase < TUMBLE_WINDOW || tumbleProgress < 1) ? Math.sin(Math.min(1, tumbleProgress) * Math.PI) : 0;
    const beatBoost = 1 + 1.3 * Math.max(0, flick);
    if (tumbleProgress < 1) {
      const nextProgress = Math.min(1, tumbleProgress + dt / TUMBLE_SECONDS);
      if (priorityPressure < 0.9) {
        const turnK = 5 / drag;
        heading += wrapPi2(tumbleTo - heading) * (1 - Math.exp(-turnK * dt));
        if (nextProgress >= 1)
          heading = tumbleTo;
      }
      tumbleProgress = nextProgress;
    }
    const rotDiffusion = Math.max(0, finite(medium.rotDiffusion, 0));
    if (rotDiffusion > 0 && dt > 0) {
      const jitter = (noise2D2(noiseSeed ^ 5370206, px0 * 0.037, finite(frame.t, 0) * 0.73) * 2 - 1) * rotDiffusion * Math.sqrt(dt);
      heading += jitter;
    }
    const fEff = Math.min(18, Math.max(0, finite(cell.flagellumRate, 0)) * act * beatBoost);
    return {
      ...cell,
      x: clamp(nextX, wallInset, Math.max(wallInset, safeWidth - wallInset)),
      y: clamp(nextY, wallInset, Math.max(wallInset, safeHeight - wallInset)),
      phase: heading,
      heading,
      turnProgress: finiteOr(cell.turnProgress, 2),
      turnFrom: finiteOr(cell.turnFrom, heading),
      turnTo: finiteOr(cell.turnTo, heading),
      tumbleIndex,
      tumbleFrom,
      tumbleTo,
      tumbleProgress,
      startle: startle * Math.exp(-dt / STARTLE_TAU),
      rollPhase: wrapUnit(finite(cell.rollPhase, 0) + rollDelta),
      metabolyPhase: wrapUnit(finite(cell.metabolyPhase, 0) + Math.max(0, finite(cell.metabolyRate, 0)) * act * dt),
      flagellumPhase: wrapUnit(finite(cell.flagellumPhase, 0) + fEff * dt),
      cvPhase: wrapUnit(finiteOr(cell.cvPhase, 0) + Math.max(0, finiteOr(cell.cvRate, 0)) * act * dt),
      burstPhase: newBurstPhase
    };
  });
}
function drawPolyline2(ctx, points, close) {
  if (points.length === 0)
    return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1;i < points.length; i++)
    ctx.lineTo(points[i].x, points[i].y);
  if (close)
    ctx.closePath();
}
function metabolyEnvelope(burstPhase) {
  const p = wrapUnit(burstPhase);
  if (p < 0.6)
    return 0;
  return Math.sin((p - 0.6) / 0.4 * Math.PI);
}
function drawEuglena(ctx, euglena, frame, view) {
  if (!view.enabled || euglena.length === 0 || view.euglena.count <= 0)
    return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.72 * euglenaModeView(frame.mode).alphaMul));
  if (alpha <= 0)
    return;
  const scale = Math.max(0.1, finite(view.euglena.scale, 1));
  const hue = finite(frame.baseHue, 50) + finite(view.euglena.hueOffset, 42);
  const H = Math.max(1, finite(frame.height, 36));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  euglena.forEach((cell, idx) => {
    const tp = finiteOr(cell.turnProgress, 2);
    const turnShrink = tp < 1 ? 0.5 + 0.5 * Math.abs(Math.cos(tp * Math.PI)) : 1;
    const fullLength = euglenaDisplayLength(finite(cell.size, 1), scale);
    const length = fullLength * turnShrink;
    const turnWiden = 1 + 0.9 * (1 - turnShrink);
    const width = fullLength * 0.22 * turnWiden;
    const flagellumLength = length * 0.95;
    const heading = finite(cell.heading, 0);
    const chCount = length < 7 ? 0 : length < 14 ? 5 : length < 40 ? clamp(Math.round(length / 4), 8, 12) : clamp(Math.round(length / 4.5), 12, 20);
    const stCount = length < 7 ? 0 : length < 14 ? 2 : length < 40 ? 4 : Math.min(7, Math.round(length / 9));
    const pmCount = length < 14 ? 0 : length < 40 ? 1 : 2;
    const includeNucleus = length >= 14;
    const includeReservoir = length >= 7;
    const includeCV = length >= 14;
    const flagSegs = clamp(Math.round(length / 3), 10, 24);
    const roll = wrapUnit(finite(cell.rollPhase, 0));
    const aHelix = finiteOr(cell.spiralAmplitude, 0.15) * length;
    const apparentW = width * (0.85 + 0.15 * Math.abs(Math.cos(roll * TAU2)));
    const lmax = Math.max(0, 0.4 * H - apparentW / 2);
    const aFit = Math.min(aHelix, 0.9 * lmax);
    const lateral = lmax > 0 ? lmax * Math.tanh(aFit * Math.sin(roll * TAU2 + heading) / lmax) : 0;
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const nx = -uy;
    const ny = ux;
    const cxr = finite(cell.x, 0) + nx * lateral;
    const cyr = finite(cell.y, 0) + ny * lateral;
    const bp = wrapUnit(finiteOr(cell.burstPhase, 0));
    const hh = finite(cell.heading, 0);
    const flick = bp < 0.08 ? Math.sin(bp / 0.08 * Math.PI) : 0;
    const vigour = 0.8 + 0.12 * Math.sin(TAU2 * bp + hh) + 0.08 * Math.sin(TAU2 * bp * 2.7 + hh * 1.7) + 0.3 * flick;
    const ampTip = clamp(length * 0.22, 2, 0.4 * H) * vigour;
    const env = metabolyEnvelope(finiteOr(cell.burstPhase, 0));
    const pose = euglenaPose(cell.rollPhase, cell.metabolyPhase, {
      centerX: cxr,
      centerY: cyr,
      length,
      baseWidth: width,
      heading,
      flagellumLength,
      flagellumPhase: cell.flagellumPhase,
      flagellumAmp: ampTip,
      maxFlagellumLateral: 0.4 * H,
      flagellumSegments: flagSegs,
      flagellumWaves: 1.5,
      metabolyEnvelope: env,
      organelleSeed: (view.seed ^ (idx + 1) * 2654435761) >>> 0,
      chloroplastCount: chCount,
      striaeCount: stCount,
      paramylonCount: pmCount,
      includeNucleus,
      includeReservoir,
      includeCV,
      cvPhase: cell.cvPhase
    });
    drawPolyline2(ctx, pose.outline, true);
    ctx.fillStyle = `hsla(${hue}, 50%, 46%, ${alpha * 0.5})`;
    ctx.strokeStyle = `hsla(${hue + 6}, 42%, 64%, ${alpha * 0.62})`;
    ctx.lineWidth = Math.max(0.5, Math.min(0.9, width * 0.08));
    ctx.fill();
    ctx.stroke();
    if (length >= 12) {
      const gx = cxr + ux * length * 0.33;
      const gy = cyr + uy * length * 0.33;
      ctx.fillStyle = `hsla(188, 16%, 84%, ${alpha * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(gx, gy, length * 0.26, width * 0.4, heading, 0, TAU2);
      ctx.fill();
    }
    if (pose.pellicleStrips.length > 0) {
      ctx.strokeStyle = `hsla(${hue - 6}, 22%, 76%, ${alpha * 0.4})`;
      ctx.lineWidth = Math.max(0.35, Math.min(0.55, width * 0.06));
      for (const strip of pose.pellicleStrips) {
        drawPolyline2(ctx, strip, false);
        ctx.stroke();
      }
    }
    for (const c of pose.chloroplasts) {
      const fa = alpha * 0.74 * (0.65 + 0.35 * c.front);
      ctx.fillStyle = `hsla(${hue + c.hueShift}, 64%, ${40 + c.lightShift}%, ${fa})`;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.ry, c.angle, 0, TAU2);
      ctx.fill();
    }
    if (pose.nucleus) {
      ctx.fillStyle = `hsla(${hue - 2}, 20%, 44%, ${alpha * 0.34})`;
      ctx.beginPath();
      ctx.ellipse(pose.nucleus.x, pose.nucleus.y, pose.nucleus.rx, pose.nucleus.ry, pose.nucleus.angle, 0, TAU2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue - 6}, 18%, 38%, ${alpha * 0.5})`;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.ellipse(pose.nucleus.x, pose.nucleus.y, pose.nucleus.rx, pose.nucleus.ry, pose.nucleus.angle, 0, TAU2);
      ctx.stroke();
    }
    pose.paramylon.forEach((p, j) => {
      const fa = alpha * 0.42 * (0.55 + 0.45 * p.front);
      ctx.fillStyle = `hsla(50, 12%, 74%, ${fa})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, p.angle, 0, TAU2);
      ctx.fill();
      if (j === 0) {
        ctx.strokeStyle = `hsla(50, 14%, 68%, ${alpha * 0.45})`;
        ctx.lineWidth = Math.max(0.3, width * 0.05);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx, p.ry, p.angle, 0, TAU2);
        ctx.stroke();
      }
    });
    if (pose.reservoir) {
      ctx.fillStyle = `hsla(186, 18%, 78%, ${alpha * 0.3})`;
      ctx.beginPath();
      ctx.arc(pose.reservoir.x, pose.reservoir.y, pose.reservoir.r, 0, TAU2);
      ctx.fill();
    }
    if (pose.contractileVacuole) {
      ctx.fillStyle = `hsla(190, 16%, 86%, ${alpha * 0.34})`;
      ctx.beginPath();
      ctx.arc(pose.contractileVacuole.x, pose.contractileVacuole.y, Math.max(0.4, pose.contractileVacuole.r), 0, TAU2);
      ctx.fill();
    }
    ctx.fillStyle = `hsla(8, 88%, 49%, ${alpha * (0.45 + 0.47 * pose.eyespotFront)})`;
    ctx.beginPath();
    ctx.arc(pose.eyespot.x, pose.eyespot.y, Math.max(0.6, length * 0.03), 0, TAU2);
    ctx.fill();
    const fp = pose.flagellumPoints;
    if (fp.length >= 2) {
      let flagFade = 1;
      if (frame.hero) {
        const hdx = finite(cell.x, 0) - finite(frame.hero.x, 0);
        const hdy = finite(cell.y, 0) - finite(frame.hero.y, 0);
        const reach = (Math.max(finiteOr(frame.hero.halfLen, frame.hero.radius), frame.hero.radius) + flagellumLength) * 1.05;
        const hdist = Math.hypot(hdx, hdy);
        flagFade = hdist >= reach ? 1 : clamp((hdist / reach - 0.45) / 0.5, 0, 1);
      }
      ctx.strokeStyle = `hsla(${hue + 8}, 20%, 66%, ${alpha * 0.3 * flagFade})`;
      ctx.lineWidth = Math.max(0.9, width * 0.18);
      drawPolyline2(ctx, fp, false);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${hue + 8}, 34%, 70%, ${alpha * 0.9 * flagFade})`;
      ctx.lineWidth = Math.max(0.5, width * 0.1);
      drawPolyline2(ctx, fp, false);
      ctx.stroke();
      const nprox = Math.max(2, Math.round(fp.length * 0.6));
      ctx.lineWidth = Math.max(0.8, width * 0.16);
      drawPolyline2(ctx, fp.slice(0, nprox), false);
      ctx.stroke();
    }
  });
  ctx.restore();
}

// src/theme-engine/renderers/cell/aquarium/vorticella.ts
var VC_CONTRACT = 0.02;
var VC_HOLD = 0.02;
var VC_RELAX = 0.33;
var T_C = 0.033;
var T_HOLD = 0.05;
var T_E = 2.6;
function vorticellaCellSeed(anchorX) {
  return (Math.round(anchorX * 7) ^ 117600714) >>> 0;
}
function vorticellaBellMetrics(cell, scale, H) {
  const Hc = Math.max(1, finite(H, 80));
  const Sc = Math.max(0.1, finite(scale, 1));
  const D = clamp((8 + finite(cell.size, 1) * 4) * Sc, 6, Hc * 0.4);
  const bellHeight = 1.45 * D;
  const restStalk = Math.max(0, Math.min(D * 3.7, Hc - bellHeight - Math.max(10, D * 0.34)));
  return { D, bellHeight, restStalk };
}
var MIG_DETACH = 0.6;
var MIG_SWIM = 16;
var MIG_ATTACH = 0.7;
function drawMigrateInterval(cellSeed, migrateCount) {
  const u = Math.max(0.0001, seededUnit(cellSeed, migrateCount, 1831565813));
  return clamp(-Math.log(u) * 900, 540, 2400);
}
function vorticellaLegAmount(leg, timer) {
  if (leg === 1) {
    const fast = clamp01(timer / 0.016);
    const tail = clamp01((timer - 0.016) / Math.max(0.000001, T_C - 0.016));
    return 0.9 * (1 - Math.pow(1 - fast, 3)) + 0.1 * (1 - Math.pow(1 - tail, 3));
  }
  if (leg === 2)
    return 1;
  if (leg === 3) {
    const u = clamp01(timer / T_E);
    const e0 = Math.exp(-Math.pow(1.9, 1.4));
    return (Math.exp(-Math.pow(u * 1.9, 1.4)) - e0) / (1 - e0);
  }
  return 0;
}
function vorticellaContractPhase(cyclePhase) {
  const phase = wrapUnit(cyclePhase);
  if (phase < VC_CONTRACT) {
    const q = phase / VC_CONTRACT;
    return 1 - Math.pow(1 - q, 3);
  }
  if (phase < VC_CONTRACT + VC_HOLD)
    return 1;
  if (phase < VC_CONTRACT + VC_HOLD + VC_RELAX) {
    const q = (phase - VC_CONTRACT - VC_HOLD) / VC_RELAX;
    return 1 - smoothstep2(q);
  }
  return 0;
}
function vorticellaGeometry(contractPhase, options = {}) {
  const phase = clamp01(contractPhase);
  const anchorX = finiteOr(options.anchorX, 0);
  const anchorY = finiteOr(options.anchorY, 0);
  const restLength = Math.max(0.001, finiteOr(options.restLength, 10));
  const minLengthFrac = Math.min(1, Math.max(0.12, finiteOr(options.minLengthFrac, 0.35)));
  const angle = finiteOr(options.directionAngle, -Math.PI / 2);
  const coilTurnsRest = Math.max(0, finiteOr(options.coilTurnsRest, 0));
  const coilTurnsContracted = Math.max(coilTurnsRest, finiteOr(options.coilTurnsContracted, 3.5));
  const sampleCount = Math.max(2, Math.floor(finiteOr(options.coilSampleCount, 22)));
  const coilRadiusMax = Math.max(0, finiteOr(options.coilRadius, restLength * 0.18));
  const stalkLength = restLength * (1 - phase * (1 - minLengthFrac));
  const coilTurns = coilTurnsRest + (coilTurnsContracted - coilTurnsRest) * phase;
  const coilRadius = coilRadiusMax * phase;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const nx = -uy;
  const ny = ux;
  const stalkPath = [];
  for (let i = 0;i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    const along = stalkLength * t;
    const fill = smoothstep2(t) * (1 - smoothstep2((t - 0.85) / 0.15));
    const theta = t * coilTurns * TAU2;
    const wave = Math.cos(theta) * coilRadius * fill;
    const loop = Math.sin(theta) * coilRadius * 0.85 * fill;
    stalkPath.push({
      x: anchorX + ux * (along + loop) + nx * wave,
      y: anchorY + uy * (along + loop) + ny * wave
    });
  }
  return {
    contractPhase: phase,
    anchor: { x: anchorX, y: anchorY },
    bellCenter: { x: anchorX + ux * stalkLength, y: anchorY + uy * stalkLength },
    stalkLength,
    coilTurns,
    stalkPath
  };
}
function vorticellaObstacle(cell, scale, frameHeight) {
  const { D, bellHeight, restStalk } = vorticellaBellMetrics(cell, scale, frameHeight);
  const ax = finite(cell.anchorX, 0);
  const ay = finite(cell.anchorY, 0);
  return { x: ax, y: ay - (restStalk + bellHeight * 0.5), radius: 1.1 * D };
}
var VORTICELLA_RELEVANT_FIELDS = new Set(["motile"]);
function motileKindId(motile) {
  return Math.floor(Math.max(0, finiteOr(motile.sourceId, 0)) / (1 << 20));
}
function vorticellaTriggerRadius(obsRadius, motile) {
  const radius = Math.max(0, finiteOr(motile.radius, 0));
  const hasMetadata = radius > 0 || motile.strength !== undefined || motile.role !== undefined;
  if (!hasMetadata)
    return obsRadius * 1.25;
  const kind = motileKindId(motile);
  const strengthFallback = kind === KIND_ID.hero ? 1 : kind === KIND_ID.didinium ? 0.75 : kind === KIND_ID.euglena ? 0.35 : 0.5;
  const strength = clamp(finiteOr(motile.strength, strengthFallback), 0.15, 1.5);
  const baseMul = kind === KIND_ID.euglena ? 1.3 : 1.55;
  const bodyMul = kind === KIND_ID.hero ? 0.95 : kind === KIND_ID.didinium ? 0.9 : kind === KIND_ID.euglena ? 0.5 : 0.65;
  return obsRadius * baseMul + radius * bodyMul * strength;
}
function vorticellaContribute(cell, scale, frameHeight, idx) {
  const obstacle = vorticellaObstacle(cell, scale, frameHeight);
  return [{
    kind: "obstacle",
    shape: "circle",
    x: obstacle.x,
    y: obstacle.y,
    radius: obstacle.radius,
    sourceId: sourceId("vorticella", idx)
  }, {
    kind: "wake",
    x: obstacle.x,
    y: obstacle.y,
    heading: finite(cell.directionAngle, -Math.PI / 2),
    sourceId: sourceId("vorticella", idx)
  }];
}
function seedVorticella(count, seed, frame, alongFrac = 0.5, salt = 117600714) {
  if (count <= 0)
    return [];
  const vorticella = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  const inset = 0.5;
  for (let i = 0;i < count; i++) {
    const along = count === 1 ? clamp01(alongFrac) : seededUnit(seed, i, salt ^ 1164169887);
    const anchorX = along * safeWidth;
    const anchorY = safeHeight - inset;
    const lean = clamp((0.5 - along) * 1.2, -0.35, 0.35);
    const directionAngle = -Math.PI / 2 + lean;
    const restLength = 7.5 + seededUnit(seed, i, salt ^ 48610963) * 3.5;
    const cycle = seededUnit(seed, i, salt ^ 1628012333);
    vorticella.push({
      x: anchorX,
      y: anchorY,
      phase: cycle,
      size: 0.5 + seededUnit(seed, i, salt ^ 1921111239),
      anchorX,
      anchorY,
      directionAngle,
      restLength,
      contractPhase: vorticellaContractPhase(cycle),
      contractCyclePhase: cycle,
      oralWreathPhase: seededUnit(seed, i, salt ^ 1757159915),
      contractRate: 0.06 + seededUnit(seed, i, salt ^ 802853537) * 0.05,
      oralRate: 0.42 + seededUnit(seed, i, salt ^ 348696353) * 0.18,
      swayPhase: seededUnit(seed, i, salt ^ 999411207),
      swayRate: 0.1 + seededUnit(seed, i, salt ^ 1513062835) * 0.07,
      contractLeg: 0,
      contractTimer: seededUnit(seed, i, salt ^ 699105045) * 1.5,
      voiceEnv: 0,
      migrateState: 0,
      attach: 1,
      migrateTimer: seededUnit(seed, i, salt ^ 1912249405) * 6,
      migrateInterval: drawMigrateInterval(vorticellaCellSeed(anchorX), 0),
      migrateTargetX: anchorX,
      migrateCount: 0
    });
  }
  return vorticella;
}
function updateVorticella(vorticella, frame, view) {
  if (vorticella.length === 0)
    return vorticella;
  const dt = Math.max(0, finite(frame.dt, 0));
  const oralHz = 5;
  const swayMul = 1;
  return vorticella.map((cell, idx) => {
    const cvClock = wrapUnit(finite(cell.contractCyclePhase, 0) + Math.max(0, finite(cell.contractRate, 0)) * dt);
    const cellSeed = vorticellaCellSeed(finite(cell.anchorX, 0));
    let leg = Math.max(0, Math.min(3, Math.floor(finiteOr(cell.contractLeg, 0))));
    let timer = Math.max(0, finiteOr(cell.contractTimer, 0)) + dt;
    let voiceEnv = clamp01(finiteOr(cell.voiceEnv, 0));
    const loud = clamp01(Math.max(finite(frame.audioLevel, 0), finite(frame.activity, 0)));
    const voiceTarget = frame.mode === "recording" ? Math.max(0.4, loud) : 0;
    const voiceTau = voiceTarget > voiceEnv ? 0.3 : 1.4;
    voiceEnv = clamp01(voiceEnv + (voiceTarget - voiceEnv) * (1 - Math.exp(-dt / voiceTau)));
    const motiles = frame.interaction?.motiles.filter((motile) => motile.sourceId !== sourceId("vorticella", idx));
    if (motiles && motiles.length > 0 && leg === 0 && timer > 1) {
      const obs = vorticellaObstacle(cell, view.vorticella.scale, frame.height);
      for (let mi = 0;mi < motiles.length; mi++) {
        const motile = motiles[mi];
        const trigR = vorticellaTriggerRadius(obs.radius, motile);
        const mdx = finite(motile.x, 0) - obs.x;
        const mdy = finite(motile.y, 0) - obs.y;
        if (mdx * mdx + mdy * mdy < trigR * trigR) {
          leg = 1;
          timer = 0;
          break;
        }
      }
    }
    for (let guard = 0;guard < 128; guard++) {
      if (leg === 1) {
        if (timer >= T_C) {
          timer -= T_C;
          leg = 2;
        } else
          break;
      } else if (leg === 2) {
        if (timer >= T_HOLD) {
          timer -= T_HOLD;
          leg = 3;
        } else
          break;
      } else if (leg === 3) {
        if (timer >= T_E) {
          timer -= T_E;
          leg = 0;
        } else
          break;
      } else
        break;
    }
    let migrateState = Math.max(0, Math.min(3, Math.floor(finiteOr(cell.migrateState, 0))));
    let attach = clamp01(finiteOr(cell.attach, 1));
    let migrateTimer = Math.max(0, finiteOr(cell.migrateTimer, 0));
    let migrateInterval = Math.max(8, finiteOr(cell.migrateInterval, 900));
    let migrateTargetX = finiteOr(cell.migrateTargetX, finite(cell.anchorX, 0));
    let migrateCount = Math.max(0, Math.floor(finiteOr(cell.migrateCount, 0)));
    let anchorX = finite(cell.anchorX, 0);
    const safeWidth = Math.max(1, finite(frame.width, 0));
    const inset2 = Math.max(8, safeWidth * 0.08);
    if (migrateState === 0) {
      migrateTimer += dt;
      if (migrateTimer >= migrateInterval && leg === 0) {
        migrateState = 1;
        migrateCount += 1;
        const u = seededUnit(cellSeed, migrateCount, 2654435761);
        const nx = inset2 + u * (safeWidth - 2 * inset2);
        migrateTargetX = Math.abs(nx - anchorX) >= safeWidth * 0.2 ? nx : anchorX < safeWidth / 2 ? Math.min(safeWidth - inset2, anchorX + safeWidth * 0.3) : Math.max(inset2, anchorX - safeWidth * 0.3);
      }
    } else if (migrateState === 1) {
      attach = Math.max(0, attach - dt / MIG_DETACH);
      if (attach <= 0) {
        attach = 0;
        migrateState = 2;
      }
    } else if (migrateState === 2) {
      const dx = migrateTargetX - anchorX;
      const step = MIG_SWIM * dt;
      if (Math.abs(dx) <= step) {
        anchorX = migrateTargetX;
        migrateState = 3;
      } else
        anchorX += Math.sign(dx) * step;
    } else {
      attach = Math.min(1, attach + dt / MIG_ATTACH);
      if (attach >= 1) {
        attach = 1;
        migrateState = 0;
        migrateTimer = 0;
        migrateInterval = drawMigrateInterval(cellSeed, migrateCount);
      }
    }
    return {
      ...cell,
      x: anchorX,
      y: cell.anchorY,
      anchorX,
      phase: cvClock,
      contractCyclePhase: cvClock,
      contractPhase: clamp01(vorticellaLegAmount(leg, timer)),
      contractLeg: leg,
      contractTimer: timer,
      voiceEnv,
      oralWreathPhase: wrapUnit(cell.oralWreathPhase + oralHz * dt),
      swayPhase: wrapUnit(finiteOr(cell.swayPhase, 0) + Math.max(0, finiteOr(cell.swayRate, 0.12)) * swayMul * dt),
      migrateState,
      attach,
      migrateTimer,
      migrateInterval,
      migrateTargetX,
      migrateCount
    };
  });
}
function drawPolyline3(ctx, points, close) {
  if (points.length === 0)
    return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1;i < points.length; i++)
    ctx.lineTo(points[i].x, points[i].y);
  if (close)
    ctx.closePath();
}
function drawVorticella(ctx, vorticella, frame, view) {
  if (!view.enabled || vorticella.length === 0 || view.vorticella.count <= 0)
    return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.85));
  if (alpha <= 0)
    return;
  const scale = Math.max(0.1, finite(view.vorticella.scale, 1));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const cell of vorticella) {
    const s = clamp01(finite(cell.contractPhase, 0));
    const baseDir = finite(cell.directionAngle, -Math.PI / 2);
    const attach = clamp01(finiteOr(cell.attach, 1));
    const sway = 0.07 * (1 - 0.8 * s) * attach * Math.sin(TAU2 * wrapUnit(finiteOr(cell.swayPhase, 0)));
    const vleg = Math.floor(finiteOr(cell.contractLeg, 0));
    const arrestT = vleg === 2 ? Math.max(0, finiteOr(cell.contractTimer, 0)) : vleg === 3 ? T_HOLD + Math.max(0, finiteOr(cell.contractTimer, 0)) : -1;
    const wobble = arrestT >= 0 && arrestT < 0.7 ? 0.1 * Math.exp(-0.45 * TAU2 * 6 * arrestT) * Math.sin(TAU2 * 6 * 0.8932 * arrestT) : 0;
    const tt = finite(frame.t, 0);
    const aSeed = (Math.round(finite(cell.restLength, 10) * 1024) ^ 3862981) >>> 0;
    const asymA = (seededUnit(aSeed, 0, 17) - 0.5) * 0.24;
    const skewAmt = (seededUnit(aSeed, 7, 136) - 0.5) * 0.22 * (1 - 0.6 * s);
    const periOff = (seededUnit(aSeed, 1, 34) - 0.5) * 0.12;
    const lean = (seededUnit(aSeed, 2, 51) - 0.5) * 0.11;
    const bp0 = seededUnit(aSeed, 3, 68) * TAU2, bp1 = seededUnit(aSeed, 4, 85) * TAU2;
    const lobePhase = seededUnit(aSeed, 5, 102) * TAU2;
    const nod = 0.035 * Math.sin(TAU2 * 0.06 * tt + seededUnit(aSeed, 6, 119) * TAU2);
    const breathMod = (u) => 1 + 0.035 * Math.sin(TAU2 * 0.075 * tt + bp0 + 2.4 * u) + 0.025 * Math.sin(TAU2 * 0.115 * tt + bp1);
    const vEnv = clamp01(finiteOr(cell.voiceEnv, 0));
    const glow = 1 + 0.45 * vEnv;
    const dir = baseDir + lean + sway * (1 + 0.7 * vEnv) + wobble + nod;
    const ux = Math.cos(dir), uy = Math.sin(dir);
    const nx = -uy, ny = ux;
    const anchorX = finite(cell.anchorX, 0);
    const anchorY = finite(cell.anchorY, 0);
    const { D, bellHeight, restStalk } = vorticellaBellMetrics(cell, scale, frame.height);
    const drawBellH = bellHeight * (1 - 0.25 * s);
    const restLength = restStalk * attach;
    const geom = vorticellaGeometry(s, {
      anchorX,
      anchorY,
      restLength,
      directionAngle: dir,
      minLengthFrac: 0.32,
      coilSampleCount: 40,
      coilTurnsContracted: 6.5,
      coilRadius: D * 0.4
    });
    const neck = geom.bellCenter;
    const rimC = { x: neck.x + ux * drawBellH + nx * (periOff + skewAmt) * D, y: neck.y + uy * drawBellH + ny * (periOff + skewAmt) * D };
    const open = (1 - 0.7 * s) * (1 + 0.22 * vEnv);
    const Rrim = 0.8 * D * open;
    const crownFade = smoothstep2(clamp01((open - 0.3) / 0.18));
    if (crownFade > 0.05 && s < 0.35) {
      ctx.save();
      ctx.lineCap = "round";
      const flowAlpha = alpha * crownFade * (0.08 + 0.06 * vEnv);
      for (let k = 0;k < 6; k++) {
        const lane = (k - 2.5) / 2.5;
        const phase = TAU2 * wrapUnit(tt * (0.1 + k * 0.011) + seededUnit(aSeed, k, 1326500606));
        const reach = D * (1.35 + 0.18 * k);
        const wob = Math.sin(phase) * D * 0.08;
        const start = {
          x: rimC.x + ux * reach + nx * (lane * D * 0.42 + wob),
          y: rimC.y + uy * reach + ny * (lane * D * 0.42 + wob)
        };
        const mid = {
          x: rimC.x + ux * reach * 0.48 + nx * (lane * D * 0.24 - wob * 0.35),
          y: rimC.y + uy * reach * 0.48 + ny * (lane * D * 0.24 - wob * 0.35)
        };
        const end = {
          x: rimC.x + nx * lane * D * 0.1,
          y: rimC.y + ny * lane * D * 0.1
        };
        ctx.strokeStyle = `hsla(198, 35%, 88%, ${flowAlpha * (0.55 + 0.45 * (1 - Math.abs(lane)))})`;
        ctx.lineWidth = Math.max(0.35, D * 0.018);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(mid.x, mid.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      ctx.restore();
    }
    const bodyPoint = (along, lateral) => {
      const cl = skewAmt * D * smoothstep2(clamp01(along / Math.max(1, drawBellH)));
      return {
        x: neck.x + ux * along + nx * (lateral + cl),
        y: neck.y + uy * along + ny * (lateral + cl)
      };
    };
    const halfW = (u) => {
      const um = 0.66, w0 = 0.16 + 0.34 * s, wMax = 0.66, wRim = 0.42;
      const base = u <= um ? w0 + (wMax - w0) * Math.pow(smoothstep2(u / um), 0.6) : wMax - (wMax - wRim) * smoothstep2((u - um) / (1 - um));
      const lipGate = 1 - (1 - (0.55 + 0.45 * open)) * smoothstep2((u - 0.82) / 0.18);
      return D * base * lipGate;
    };
    drawPolyline3(ctx, geom.stalkPath, false);
    ctx.strokeStyle = `hsla(202, 26%, 80%, ${alpha * 0.34})`;
    ctx.lineWidth = Math.max(0.6, D * 0.07);
    ctx.stroke();
    if (s > 0.05 && geom.stalkPath.length > 2) {
      const n = geom.stalkPath.length;
      for (let i = 1;i < n; i++) {
        const t = i / (n - 1);
        const near = Math.cos(t * geom.coilTurns * TAU2);
        drawPolyline3(ctx, [geom.stalkPath[i - 1], geom.stalkPath[i]], false);
        if (near > 0) {
          ctx.strokeStyle = `hsla(204, 32%, 90%, ${alpha * (0.18 + 0.34 * near) * s})`;
          ctx.lineWidth = Math.max(0.4, D * (0.05 + 0.05 * near));
        } else {
          ctx.strokeStyle = `hsla(204, 24%, 64%, ${alpha * 0.12 * s})`;
          ctx.lineWidth = Math.max(0.75, D * 0.03);
        }
        ctx.stroke();
      }
    }
    drawPolyline3(ctx, geom.stalkPath, false);
    ctx.strokeStyle = `hsla(204, 30%, 70%, ${alpha * 0.3})`;
    ctx.lineWidth = Math.max(0.75, D * 0.03);
    ctx.stroke();
    if (attach > 0.5) {
      ctx.beginPath();
      ctx.arc(anchorX, anchorY, Math.max(0.8, D * 0.16), 0, TAU2);
      ctx.fillStyle = `hsla(202, 24%, 76%, ${alpha * 0.4 * attach})`;
      ctx.fill();
    }
    if (attach < 0.7) {
      const band = (1 - attach) * (1 - attach);
      const ringR = halfW(0.06) * 1.05;
      const M = Math.max(8, Math.round(D * 1));
      const beatBase = wrapUnit(finiteOr(cell.oralWreathPhase, 0));
      ctx.strokeStyle = `hsla(196, 30%, 92%, ${alpha * 0.55 * band})`;
      ctx.lineWidth = Math.max(0.75, D * 0.025);
      for (let i = 0;i < M; i++) {
        const a = i / M;
        const lateral = Math.cos(a * TAU2) * ringR;
        const baseP = bodyPoint(-D * 0.04, lateral);
        const beat = Math.sin((a * 3 - beatBase) * TAU2);
        const len = D * (0.12 + 0.025 * beat);
        const tip = { x: baseP.x - ux * len + nx * beat * D * 0.02, y: baseP.y - uy * len + ny * beat * D * 0.02 };
        drawPolyline3(ctx, [baseP, tip], false);
        ctx.stroke();
      }
    }
    const SAMP = 32;
    const left = [];
    const right = [];
    for (let i = 0;i <= SAMP; i++) {
      const u = i / SAMP;
      const hwB = halfW(u) * breathMod(u);
      const lobeL = 1 + 0.06 * Math.sin(Math.PI * u * 1.7 + lobePhase);
      const lobeR = 1 + 0.06 * Math.sin(Math.PI * u * 1.3 + lobePhase + 2.1);
      left.push(bodyPoint(drawBellH * u, -hwB * lobeL * (1 - asymA)));
      right.push(bodyPoint(drawBellH * u, hwB * lobeR * (1 + asymA)));
    }
    const outline = [...left, ...right.reverse()];
    if (vEnv > 0.01) {
      const bellMid = bodyPoint(drawBellH * 0.5, 0);
      const haloR = drawBellH * (0.95 + 0.35 * vEnv);
      const halo = ctx.createRadialGradient(bellMid.x, bellMid.y, drawBellH * 0.2, bellMid.x, bellMid.y, haloR);
      halo.addColorStop(0, `hsla(196, 60%, 86%, ${alpha * 0.42 * vEnv})`);
      halo.addColorStop(0.5, `hsla(198, 55%, 80%, ${alpha * 0.2 * vEnv})`);
      halo.addColorStop(1, `hsla(200, 50%, 78%, 0)`);
      ctx.beginPath();
      ctx.arc(bellMid.x, bellMid.y, haloR, 0, TAU2);
      ctx.fillStyle = halo;
      ctx.fill();
    }
    drawPolyline3(ctx, outline, true);
    const cyto = ctx.createLinearGradient(rimC.x, rimC.y, neck.x, neck.y);
    cyto.addColorStop(0, `hsla(200, 16%, 94%, ${alpha * 0.62 * glow})`);
    cyto.addColorStop(1, `hsla(200, 20%, 86%, ${alpha * 0.74 * glow})`);
    ctx.fillStyle = cyto;
    ctx.fill();
    ctx.save();
    drawPolyline3(ctx, outline, true);
    ctx.clip();
    const gSeed = (Math.round(finite(cell.restLength, 10) * 8192) ^ 28218) >>> 0;
    const gCount = Math.round(clamp(D * 5, 44, 150));
    for (let k = 0;k < gCount; k++) {
      const gphi = seededUnit(gSeed, k, 4005751) * TAU2;
      const gamp = 0.96 * Math.sqrt(seededUnit(gSeed, k, 1784445));
      const gph = TAU2 / 46 * tt + gphi + 0.5 * noise2D2(gSeed, gphi * 3.3 + k, tt * 0.045);
      const gu = 0.46 + 0.44 * gamp * Math.sin(gph);
      const glat = gamp * Math.cos(gph) * 0.72 * halfW(gu) * breathMod(gu);
      const gp = bodyPoint(drawBellH * gu, glat);
      const gr = 0.4 + seededUnit(gSeed, k, 7848355) * 0.9;
      ctx.beginPath();
      ctx.arc(gp.x, gp.y, gr, 0, TAU2);
      ctx.fillStyle = seededUnit(gSeed, k, 10293743) > 0.5 ? `hsla(196, 18%, 97%, ${alpha * 0.46})` : `hsla(200, 16%, 90%, ${alpha * 0.36})`;
      ctx.fill();
    }
    const gCount2 = Math.round(clamp(D * 3, 24, 96));
    for (let k = 0;k < gCount2; k++) {
      const p2 = seededUnit(gSeed, k, 5614139) * TAU2;
      const a2 = 0.96 * Math.sqrt(seededUnit(gSeed, k, 2916241));
      const ph2 = TAU2 / 60 * tt + p2 + 0.4 * noise2D2(gSeed, p2 * 2.7 + k, tt * 0.04);
      const u2 = 0.46 + 0.46 * a2 * Math.sin(ph2);
      const l2 = a2 * Math.cos(ph2) * 0.72 * halfW(u2) * breathMod(u2);
      const fp = bodyPoint(drawBellH * u2, l2);
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, 0.3 + seededUnit(gSeed, k, 7019823) * 0.4, 0, TAU2);
      ctx.fillStyle = seededUnit(gSeed, k, 10031565) > 0.5 ? `hsla(196, 16%, 95%, ${alpha * 0.16})` : `hsla(200, 14%, 80%, ${alpha * 0.13})`;
      ctx.fill();
    }
    ctx.restore();
    drawPolyline3(ctx, outline, true);
    ctx.strokeStyle = `hsla(205, 12%, 70%, ${alpha * 0.22})`;
    ctx.lineWidth = Math.max(0.5, D * 0.03);
    ctx.stroke();
    drawPolyline3(ctx, outline, true);
    ctx.strokeStyle = `hsla(200, 16%, 88%, ${alpha * 0.3})`;
    ctx.lineWidth = Math.max(0.5, D * 0.018);
    ctx.stroke();
    ctx.save();
    drawPolyline3(ctx, outline, true);
    ctx.clip();
    const macPts = [];
    const macAlong = drawBellH * 0.5;
    const macR = D * 0.44;
    for (let i = 0;i <= 14; i++) {
      const th = Math.PI * (0.32 + i / 14 * 1.08);
      macPts.push(bodyPoint(macAlong - macR * 1.35 * Math.cos(th), macR * 0.95 * Math.sin(th)));
    }
    drawPolyline3(ctx, macPts, false);
    ctx.strokeStyle = `hsla(205, 9%, 54%, ${alpha * 0.28})`;
    ctx.lineWidth = Math.max(1.6, D * 0.24);
    ctx.stroke();
    drawPolyline3(ctx, macPts, false);
    ctx.strokeStyle = `hsla(200, 14%, 86%, ${alpha * 0.5})`;
    ctx.lineWidth = Math.max(1, D * 0.12);
    ctx.stroke();
    if (D >= 11) {
      const mic = bodyPoint(macAlong - macR * 0.9, macR * 0.5);
      ctx.beginPath();
      ctx.arc(mic.x, mic.y, Math.max(0.4, D * 0.045), 0, TAU2);
      ctx.fillStyle = `hsla(200, 12%, 66%, ${alpha * 0.46})`;
      ctx.fill();
    }
    if (D >= 10) {
      const cvPhase = wrapUnit(finite(cell.contractCyclePhase, 0));
      const cvPulse = cvPhase < 0.82 ? smoothstep2(cvPhase / 0.82) : 1 - smoothstep2((cvPhase - 0.82) / 0.18);
      const cv = bodyPoint(drawBellH * 0.7, -D * 0.24);
      const cvR = Math.max(0.8, D * (0.03 + 0.15 * cvPulse));
      ctx.beginPath();
      ctx.arc(cv.x, cv.y, cvR, 0, TAU2);
      const cgx = cv.x - nx * cvR * 0.4 - ux * cvR * 0.4, cgy = cv.y - ny * cvR * 0.4 - uy * cvR * 0.4;
      const cg = ctx.createRadialGradient(cgx, cgy, cvR * 0.1, cv.x, cv.y, cvR * 1.12);
      cg.addColorStop(0, `hsla(200, 14%, 98%, ${alpha * 0.34})`);
      cg.addColorStop(0.7, `hsla(200, 12%, 93%, ${alpha * 0.2})`);
      cg.addColorStop(0.88, `hsla(196, 26%, 95%, ${alpha * 0.5})`);
      cg.addColorStop(1, `hsla(196, 30%, 96%, 0)`);
      ctx.beginPath();
      ctx.arc(cv.x, cv.y, cvR * 1.12, 0, TAU2);
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cgx, cgy, Math.max(0.4, cvR * 0.3), 0, TAU2);
      ctx.fillStyle = `hsla(196, 20%, 96%, ${alpha * 0.4})`;
      ctx.fill();
    }
    if (D >= 12) {
      const fvSeed = (Math.round(finite(cell.restLength, 10) * 4096) ^ 40503) >>> 0;
      const fvCount = 8;
      for (let j = 0;j < fvCount; j++) {
        const cycT = 34 + seededUnit(fvSeed, j, 5047) * 14;
        const phi0 = seededUnit(fvSeed, j, 1371344503) * TAU2;
        const amp = 0.96 * Math.sqrt(seededUnit(fvSeed, j, 752460107));
        const ph = TAU2 / cycT * tt + phi0 + 0.6 * noise2D2(fvSeed, phi0 * 5.1 + j, tt * 0.05);
        const u = 0.46 + 0.42 * amp * Math.sin(ph);
        const lat = amp * Math.cos(ph) * 0.72 * halfW(u) * breathMod(u);
        const fv = bodyPoint(drawBellH * u, lat);
        const fr = Math.max(0.7, D * (0.028 + seededUnit(fvSeed, j, 2117754257) * 0.075));
        const warm = j === 0;
        const fg = ctx.createRadialGradient(fv.x, fv.y, fr * 0.1, fv.x, fv.y, fr * 1.12);
        fg.addColorStop(0, `hsla(200, 14%, 80%, ${alpha * 0.14})`);
        fg.addColorStop(0.55, `hsla(198, 16%, 86%, ${alpha * 0.2})`);
        fg.addColorStop(0.84, warm ? `hsla(42, 26%, 92%, ${alpha * 0.46})` : `hsla(196, 24%, 96%, ${alpha * 0.52})`);
        fg.addColorStop(1, `hsla(196, 30%, 96%, 0)`);
        ctx.beginPath();
        ctx.arc(fv.x, fv.y, fr * 1.12, 0, TAU2);
        ctx.fillStyle = fg;
        ctx.fill();
      }
    }
    ctx.restore();
    const lipRy = Math.max(0.5, Rrim * 0.24);
    const ringPath = (rl, rd, wob) => {
      const pts = [];
      for (let i = 0;i <= 24; i++) {
        const a = i / 24 * TAU2;
        const w = 1 + wob * (0.6 * Math.sin(a * 3 + lobePhase) + 0.4 * Math.sin(a * 2 - bp0));
        const lateral = Math.cos(a) * rl * w;
        const depth = Math.sin(a) * rd * w;
        pts.push({ x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth });
      }
      return pts;
    };
    drawPolyline3(ctx, ringPath(Rrim, lipRy, 0.05), true);
    ctx.fillStyle = `hsla(186, 36%, 88%, ${alpha * 0.22 * open})`;
    ctx.fill();
    ctx.strokeStyle = `hsla(186, 50%, 90%, ${alpha * 0.55 * open})`;
    ctx.lineWidth = Math.max(0.75, D * 0.05);
    ctx.stroke();
    drawPolyline3(ctx, ringPath(Rrim * 0.9, lipRy * 0.9, 0.07), true);
    ctx.fillStyle = `hsla(200, 12%, 84%, ${alpha * 0.26 * open})`;
    ctx.fill();
    if (crownFade > 0.02 && D >= 9) {
      const turns = 1.6, N = 30;
      const cytLat = Rrim * 0.3, cytDep = lipRy * 0.3;
      const spiral = [];
      for (let i = 0;i <= N; i++) {
        const t = i / N;
        const rr = 1 - t;
        const a = -t * turns * TAU2;
        const lateral = Math.cos(a) * Rrim * rr + cytLat * t;
        const depth = Math.sin(a) * lipRy * rr + cytDep * t;
        spiral.push({ x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth });
      }
      drawPolyline3(ctx, spiral, false);
      ctx.strokeStyle = `hsla(198, 18%, 94%, ${alpha * 0.48 * crownFade * glow})`;
      ctx.lineWidth = Math.max(0.75, D * 0.03);
      ctx.stroke();
      const spiral2 = [];
      for (let i = 0;i <= N; i++) {
        const t = i / N;
        const rr = (1 - t) * 0.7;
        const a = -t * turns * TAU2 + 0.6;
        const lateral = Math.cos(a) * Rrim * rr + cytLat * t;
        const depth = Math.sin(a) * lipRy * rr + cytDep * t;
        spiral2.push({ x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth });
      }
      drawPolyline3(ctx, spiral2, false);
      ctx.strokeStyle = `hsla(198, 18%, 92%, ${alpha * 0.34 * crownFade * glow})`;
      ctx.lineWidth = Math.max(0.75, D * 0.022);
      ctx.stroke();
      const cyt = { x: rimC.x + nx * cytLat + ux * cytDep, y: rimC.y + ny * cytLat + uy * cytDep };
      ctx.beginPath();
      ctx.arc(cyt.x, cyt.y, Math.max(0.4, D * 0.05), 0, TAU2);
      ctx.fillStyle = `hsla(200, 16%, 64%, ${alpha * 0.42 * crownFade})`;
      ctx.fill();
    }
    if (crownFade > 0.02) {
      const oral = wrapUnit(finite(cell.oralWreathPhase, 0));
      const bandPts = [];
      for (let i = 0;i <= 36; i++) {
        const a = i / 36;
        const lateral = Math.cos(a * TAU2) * Rrim;
        const depth = Math.sin(a * TAU2) * lipRy;
        bandPts.push({ x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth });
      }
      drawPolyline3(ctx, bandPts, true);
      ctx.strokeStyle = `hsla(198, 16%, 93%, ${alpha * 0.26 * crownFade * glow})`;
      ctx.lineWidth = Math.max(1, D * 0.11);
      ctx.stroke();
      const M = Math.max(8, Math.round(D * 0.7));
      ctx.strokeStyle = `hsla(198, 16%, 93%, ${alpha * 0.3 * crownFade * glow})`;
      ctx.lineWidth = Math.max(0.5, D * 0.018);
      const cilS = (Math.round(finite(cell.restLength, 10) * 2048) ^ 20899) >>> 0;
      for (let i = 0;i < M; i++) {
        const a = i / M;
        const ca = Math.cos(a * TAU2);
        const lateral = ca * Rrim;
        const depth = Math.sin(a * TAU2) * lipRy;
        const base = { x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth };
        const beat = Math.sin((a * 2 - oral) * TAU2);
        const lv = 0.7 + seededUnit(cilS, i, 11165) * 0.6;
        const len = D * (0.1 + 0.025 * beat) * lv;
        const outx = nx * (ca >= 0 ? 0.5 : -0.5) + ux;
        const outy = ny * (ca >= 0 ? 0.5 : -0.5) + uy;
        const tip = { x: base.x + outx * len + nx * beat * D * 0.02, y: base.y + outy * len + ny * beat * D * 0.02 };
        drawPolyline3(ctx, [base, tip], false);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// src/theme-engine/renderers/cell/aquarium/didinium.ts
var DIDINIUM_SALT = 220011530;
var ASPECT = 1.42;
var GIRDLE_A_U = 0.46;
var GIRDLE_P_U = -0.16;
var SHOULDER_U = 0.49;
var BRUSH_ROWS = 5;
var STOPGO_FREQ = 0.32;
var WANDER_FREQ = 0.1;
var WANDER_RAD = 0.42;
var HELIX_LEAN = 0.07;
var CURVE_FREQ = 0.09;
var CURVE_BIAS = 0.18;
var WALL_LOOK = 1.25;
var BACKUP_SECONDS = 0.08;
var AVOID_SECONDS = 0.18;
var AVOID_TURN_MIN = 2 * Math.PI / 3;
var AVOID_TURN_MAX = 5 * Math.PI / 6;
function didiniumModeView(mode) {
  switch (mode) {
    case "recording":
      return { motionMul: 1.2, alphaMul: 1.08 };
    case "transcribing":
      return { motionMul: 0.35, alphaMul: 0.8 };
    case "error":
      return { motionMul: 0.15, alphaMul: 0.55 };
    case "idle":
    default:
      return { motionMul: 1, alphaMul: 1 };
  }
}
function didiniumDisplayLength(size, scale) {
  const s = Math.max(0.1, finite(scale, 1));
  return Math.max(7, Math.min(34 * s, (16 + finite(size, 1) * 4) * s));
}
function bodyShape2(u) {
  if (u >= SHOULDER_U) {
    const q = (u - SHOULDER_U) / (1 - SHOULDER_U);
    const wShoulder = 0.72;
    return wShoulder * (0.07 + 0.93 * Math.pow(1 - q, 1.35));
  }
  const t = (u - SHOULDER_U) / (-1 - SHOULDER_U);
  const tp = 0.45;
  if (t <= tp) {
    return 0.72 + 0.28 * Math.sin(t / tp * (Math.PI / 2));
  }
  const s = (t - tp) / (1 - tp);
  return Math.sqrt(Math.max(0, 1 - s * s));
}
var BODY_SHAPE_MAX2 = (() => {
  let m = 0;
  for (let i = 0;i <= 400; i++) {
    const u = -1 + i / 400 * 2;
    m = Math.max(m, bodyShape2(u));
  }
  return m;
})();
function normHalfWidth2(u) {
  return bodyShape2(u) / BODY_SHAPE_MAX2;
}
function seedDidinium(count, seed, frame, salt = DIDINIUM_SALT) {
  if (count <= 0)
    return [];
  const out = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  for (let i = 0;i < count; i++) {
    const heading = seededUnit(seed, i, salt ^ 1757159915) * TAU2;
    out.push({
      x: (0.2 + 0.6 * seededUnit(seed, i, salt)) * safeWidth,
      y: (0.25 + 0.5 * seededUnit(seed, i, salt ^ 1374496523)) * safeHeight,
      phase: heading,
      size: 0.5 + seededUnit(seed, i, salt ^ 48610963),
      heading,
      swimSpeed: 0.85 + seededUnit(seed, i, salt ^ 802853537) * 0.3,
      rollPhase: seededUnit(seed, i, salt ^ 1107813911),
      rollRate: 0.6 + seededUnit(seed, i, salt ^ 348696353) * 0.24,
      beatPhase: seededUnit(seed, i, salt ^ 668265263),
      beatRate: 4 + seededUnit(seed, i, salt ^ 1966046297) * 1.5,
      cvPhase: seededUnit(seed, i, salt ^ 1033993285),
      cvRate: 0.045 + seededUnit(seed, i, salt ^ 1508030371) * 0.02,
      turnSide: seededUnit(seed, i, salt ^ 2050968865) < 0.5 ? -1 : 1,
      avoidIndex: 0,
      avoidFrom: heading,
      avoidTo: heading,
      avoidProgress: 1,
      noiseSeed: mix32(seed ^ Math.imul(i + 1, 2654435761) ^ salt) >>> 0
    });
  }
  return out;
}
var DIDINIUM_RELEVANT_FIELDS = new Set(["obstacle", "motile"]);
function didiniumContribute(cell, idx, scale = 1) {
  const length = didiniumDisplayLength(finite(cell.size, 1), scale);
  return [{
    kind: "motile",
    x: finite(cell.x, 0),
    y: finite(cell.y, 0),
    heading: finiteOr(cell.heading, finiteOr(cell.phase, 0)),
    radius: length * 0.35,
    speed: Math.max(0, finiteOr(cell.swimSpeed, 0)),
    role: "predator",
    strength: 0.75,
    sourceId: sourceId("didinium", idx)
  }];
}
function updateDidinium(didinium, frame, view) {
  if (didinium.length === 0)
    return didinium;
  const dt = Math.max(0, finite(frame.dt, 0));
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  const activityMix = clamp01(finite(frame.activity, 0) * finite(view.activityBoost, 0));
  const modeView = didiniumModeView(frame.mode);
  const vIdleBL = Math.max(0, finite(view.didinium.speed, 0));
  const vActiveBL = Math.max(0, finite(view.didinium.speedActive, vIdleBL));
  const vBL = (vIdleBL + (vActiveBL - vIdleBL) * activityMix) * modeView.motionMul;
  const act = modeView.motionMul * (1 + 0.7 * activityMix);
  const scale = view.didinium.scale;
  const t = finite(frame.t, 0);
  const wrapPi2 = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  return didinium.map((cell, _idx) => {
    const L = didiniumDisplayLength(finite(cell.size, 1), scale);
    const nseed = finiteOr(cell.noiseSeed, 0) | 0;
    let heading = finite(cell.heading, 0);
    const px0 = finite(cell.x, 0);
    const py0 = finite(cell.y, 0);
    const wasContacting = finiteOr(cell.contactTimer, 0) > 0;
    let contactTimer = Math.max(0, finiteOr(cell.contactTimer, 0) - dt);
    let contactDuration = Math.max(0, finiteOr(cell.contactDuration, contactTimer));
    let huntCooldown = Math.max(0, finiteOr(cell.huntCooldown, 0) - dt);
    const stopgo = noise2D2(nseed ^ 1399873280, t * STOPGO_FREQ, 0.13);
    const cruiseEnv = 0.65 + 0.35 * (1 - Math.pow(1 - stopgo, 1.4));
    const vPx = Math.max(0, finite(cell.swimSpeed, 0)) * vBL * L * cruiseEnv;
    const wander = (noise2D2(nseed ^ 447978529, t * WANDER_FREQ, 0.61) * 2 - 1) * WANDER_RAD;
    let wallPressure = 0;
    let wallAwayX = 0;
    let wallAwayY = 0;
    const look = L * WALL_LOOK;
    if (px0 < look) {
      wallAwayX += 1 - px0 / look;
      wallPressure += 1 - px0 / look;
    }
    if (safeWidth - px0 < look) {
      wallAwayX -= 1 - (safeWidth - px0) / look;
      wallPressure += 1 - (safeWidth - px0) / look;
    }
    if (py0 < look) {
      wallAwayY += 1 - py0 / look;
      wallPressure += 1 - py0 / look;
    }
    if (safeHeight - py0 < look) {
      wallAwayY -= 1 - (safeHeight - py0) / look;
      wallPressure += 1 - (safeHeight - py0) / look;
    }
    let avoidIndex = Math.max(0, Math.floor(finiteOr(cell.avoidIndex, 0)));
    let avoidFrom = finiteOr(cell.avoidFrom, heading);
    let avoidTo = finiteOr(cell.avoidTo, heading);
    let avoidProgress = clamp01(finiteOr(cell.avoidProgress, 1));
    const side = finiteOr(cell.turnSide, 1) < 0 ? -1 : 1;
    const hitWall = wallPressure > 0.12 && avoidProgress >= 1;
    if (hitWall) {
      avoidIndex += 1;
      const magU = noise2D2(nseed ^ 791783381, avoidIndex, 0.71);
      const magnitude = AVOID_TURN_MIN + (AVOID_TURN_MAX - AVOID_TURN_MIN) * magU;
      avoidFrom = heading;
      const inward = Math.atan2(wallAwayY, wallAwayX);
      avoidTo = inward + side * magnitude * 0.5;
      avoidProgress = 0;
    }
    const avoidTotal = BACKUP_SECONDS + AVOID_SECONDS;
    const backupFrac = BACKUP_SECONDS / avoidTotal;
    let reversing = false;
    if (avoidProgress < 1) {
      const next = Math.min(1, avoidProgress + dt / avoidTotal);
      if (avoidProgress < backupFrac) {
        reversing = true;
      } else {
        const turnK = 6;
        heading += wrapPi2(avoidTo - heading) * (1 - Math.exp(-turnK * dt));
        if (next >= 1)
          heading = avoidTo;
      }
      avoidProgress = next;
    } else if (wallPressure > 0.000001) {
      const desired = Math.atan2(Math.sin(heading) + wallAwayY, Math.cos(heading) + wallAwayX);
      const turnK = 3 + 7 * Math.min(1, wallPressure);
      heading += wrapPi2(desired - heading) * (1 - Math.exp(-turnK * dt));
    }
    const field = frame.interaction;
    const prey = (field?.obstacles ?? []).find((obs) => obs.shape === "ellipse" && obs.social);
    let preyData = null;
    let huntWeight = 0;
    if (prey && prey.shape === "ellipse") {
      const hh = finiteOr(prey.heading, 0);
      const ch = Math.cos(hh), sh = Math.sin(hh);
      const dx = px0 - prey.x;
      const dy = py0 - prey.y;
      const localX = dx * ch + dy * sh;
      const localY = -dx * sh + dy * ch;
      const A = Math.max(0.001, finiteOr(prey.halfLen, 1) + L * 0.38);
      const B = Math.max(0.001, finiteOr(prey.halfWid, 1) + L * 0.38);
      const q = Math.sqrt(localX * localX / (A * A) + localY * localY / (B * B)) || 0.000001;
      const targetQ = 1.03;
      const sx = localX * (targetQ / q);
      const sy = localY * (targetQ / q);
      const surfaceX = prey.x + sx * ch - sy * sh;
      const surfaceY = prey.y + sx * sh + sy * ch;
      const toTargetX = q < 1 ? prey.x - px0 : surfaceX - px0;
      const toTargetY = q < 1 ? prey.y - py0 : surfaceY - py0;
      const toTargetD = Math.hypot(toTargetX, toTargetY) || 1;
      const probeHeading = heading + wander;
      const approachDot = (Math.cos(probeHeading) * toTargetX + Math.sin(probeHeading) * toTargetY) / toTargetD;
      preyData = { q, surfaceX, surfaceY, preyX: prey.x, preyY: prey.y, approachDot };
      if (q < 1.07 && approachDot > 0.55 && huntCooldown <= 0 && contactTimer <= 0 && avoidProgress >= 1) {
        contactDuration = 2.4 + seededUnit(nseed, 0, 714207245) * 0.9;
        contactTimer = contactDuration;
      }
    }
    let obstaclePressure = 0;
    let obstacleAwayX = 0;
    let obstacleAwayY = 0;
    const circleObstacles = [];
    for (const obs of field?.obstacles ?? []) {
      if (obs.shape !== "circle")
        continue;
      circleObstacles.push({ x: obs.x, y: obs.y, radius: obs.radius });
      const dx = px0 - obs.x;
      const dy = py0 - obs.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = obs.radius + L * 1.25;
      if (d < reach) {
        const p = 1 - d / reach;
        obstaclePressure += p;
        obstacleAwayX += dx / d * p;
        obstacleAwayY += dy / d * p;
      }
    }
    for (const motile of field?.motiles ?? []) {
      if (motile.sourceId >> 20 !== KIND_ID.euglena)
        continue;
      const dx = px0 - motile.x;
      const dy = py0 - motile.y;
      const d = Math.hypot(dx, dy) || 1;
      const radius = Math.max(0, finiteOr(motile.radius, 0));
      const reach = Math.max(8, 0.85 * (L + radius));
      if (d < reach) {
        const p = (1 - d / reach) * 0.45;
        obstaclePressure += p;
        obstacleAwayX += dx / d * p;
        obstacleAwayY += dy / d * p;
      }
    }
    if (obstaclePressure > 0.0001 && avoidProgress >= 1) {
      const desired = Math.atan2(obstacleAwayY, obstacleAwayX);
      const turnK = 2.5 + 5 * Math.min(1, obstaclePressure);
      heading += wrapPi2(desired - heading) * (1 - Math.exp(-turnK * dt));
    } else if (avoidProgress >= 1 && wallPressure < 0.2 && contactTimer <= 0) {
      if (preyData) {
        const dx = preyData.surfaceX - px0;
        const dy = preyData.surfaceY - py0;
        const d = Math.hypot(dx, dy) || 1;
        const sense = clamp(L * 2, 32, 52);
        if (d < sense && preyData.approachDot > -0.15) {
          const cone = clamp01((preyData.approachDot + 0.15) / 0.65);
          const huntRaw = clamp01((sense - d) / (sense * 0.75)) * cone;
          const hunt = preyData.q < 1.07 ? huntRaw : Math.min(0.35, huntRaw);
          huntWeight = hunt;
          const desired = Math.atan2(dy, dx);
          const turnK = 1.4 + 2.4 * hunt;
          heading += wrapPi2(desired - heading) * (1 - Math.exp(-turnK * dt)) * hunt;
        }
      }
    }
    const curveEnv = clamp01(noise2D2(nseed ^ 2009178803, t * CURVE_FREQ, 0.29));
    const curve = side * CURVE_BIAS * curveEnv;
    const huntSuppression = 1 - 0.35 * huntWeight;
    const travel = heading + wander * (0.3 + 0.7 * cruiseEnv) * huntSuppression + curve * huntSuppression;
    const spinFreq = Math.max(0, finite(cell.rollRate, 0));
    const spinSeed = seededUnit(nseed, 0, 1821285621);
    const spinAng = TAU2 * (spinSeed + spinFreq * t);
    const lean = Math.sin(spinAng) * HELIX_LEAN;
    const eh = travel + lean;
    const ux = Math.cos(eh);
    const uy = Math.sin(eh);
    const vSigned = reversing ? -vPx * 0.28 : vPx;
    const rawX = px0 + ux * vSigned * dt;
    const rawY = py0 + uy * vSigned * dt;
    let nextX = rawX;
    let nextY = rawY;
    if (contactTimer > 0 && preyData) {
      const corrX = preyData.surfaceX - nextX;
      const corrY = preyData.surfaceY - nextY;
      const corrL = Math.hypot(corrX, corrY) || 1;
      const maxStep = L * (preyData.q < 1 ? 0.65 : 0.04);
      const kLatch = preyData.q < 1 ? 1 : 1 - Math.exp(-2 * dt);
      const step = Math.min(maxStep, corrL * kLatch);
      nextX += corrX / corrL * step;
      nextY += corrY / corrL * step;
      heading = Math.atan2(preyData.preyY - nextY, preyData.preyX - nextX);
    }
    const margin = Math.min(L * 0.55, safeWidth * 0.45, safeHeight * 0.45);
    for (const obs of circleObstacles) {
      const dx = nextX - obs.x;
      const dy = nextY - obs.y;
      const d = Math.hypot(dx, dy) || 1;
      const minD = obs.radius + L * 0.45;
      if (d < minD) {
        const need = minD - d;
        const step = Math.min(L * 0.35, need * (1 - Math.exp(-8 * dt)));
        nextX += dx / d * step;
        nextY += dy / d * step;
        if (d < obs.radius + L * 0.9 && avoidProgress >= 1 && contactTimer <= 0) {
          avoidIndex += 1;
          avoidFrom = heading;
          avoidTo = Math.atan2(dy, dx) + side * Math.PI * 0.55;
          avoidProgress = 0;
        }
      }
    }
    nextX = clamp(nextX, margin, safeWidth - margin);
    nextY = clamp(nextY, margin, safeHeight - margin);
    if ((nextX !== rawX || nextY !== rawY) && avoidProgress >= 1 && contactTimer <= 0) {
      avoidIndex += 1;
      const magU = noise2D2(nseed ^ 791783381, avoidIndex, 0.71);
      const magnitude = AVOID_TURN_MIN + (AVOID_TURN_MAX - AVOID_TURN_MIN) * magU;
      avoidFrom = heading;
      const inward = Math.atan2(wallAwayY, wallAwayX);
      avoidTo = inward + side * magnitude * 0.5;
      avoidProgress = 0;
    }
    if (wasContacting && contactTimer <= 0) {
      huntCooldown = 22 + seededUnit(nseed, 0, 1243315241) * 14;
      avoidIndex += 1;
      avoidFrom = heading;
      avoidTo = heading + side * (Math.PI * (0.45 + 0.25 * seededUnit(nseed, avoidIndex, 899314129)));
      avoidProgress = 0;
    }
    const beatEff = Math.min(6, Math.max(0, finite(cell.beatRate, 0)) * act);
    return {
      ...cell,
      x: nextX,
      y: nextY,
      phase: contactTimer > 0 ? heading : travel,
      heading,
      rollPhase: wrapUnit(finite(cell.rollPhase, 0) + spinFreq * dt),
      beatPhase: wrapUnit(finiteOr(cell.beatPhase, 0) + beatEff * dt),
      cvPhase: wrapUnit(finiteOr(cell.cvPhase, 0) + Math.max(0, finiteOr(cell.cvRate, 0)) * act * dt),
      avoidIndex,
      avoidFrom,
      avoidTo,
      avoidProgress,
      contactTimer,
      contactDuration: contactTimer > 0 ? contactDuration : 0,
      huntCooldown
    };
  });
}
function transform3(cx, cy, ux, uy, along, lateral) {
  const nx = -uy;
  const ny = ux;
  return { x: cx + ux * along + nx * lateral, y: cy + uy * along + ny * lateral };
}
function drawPolyline4(ctx, points, close) {
  if (points.length === 0)
    return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1;i < points.length; i++)
    ctx.lineTo(points[i].x, points[i].y);
  if (close)
    ctx.closePath();
}
function drawDidinium(ctx, didinium, frame, view) {
  if (!view.enabled || didinium.length === 0 || view.didinium.count <= 0)
    return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.9 * didiniumModeView(frame.mode).alphaMul));
  if (alpha <= 0)
    return;
  const scale = Math.max(0.1, finite(view.didinium.scale, 1));
  const hue = 200 + finite(view.didinium.hueOffset, 0);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  didinium.forEach((cell) => {
    const L = didiniumDisplayLength(finite(cell.size, 1), scale);
    const halfLength = L / 2;
    const wMax = L / ASPECT / 2;
    const heading = finiteOr(cell.phase, finite(cell.heading, 0));
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const cx = finite(cell.x, 0);
    const cy = finite(cell.y, 0);
    const roll = wrapUnit(finite(cell.rollPhase, 0));
    const rollAng = roll * TAU2;
    const rollCos = Math.cos(rollAng);
    const widthMul = 0.96 + 0.04 * Math.abs(rollCos);
    const halfWidthAt = (u) => wMax * widthMul * normHalfWidth2(u);
    const SAMP = 64;
    const upper = [];
    const lower = [];
    for (let i = 0;i <= SAMP; i++) {
      const u = -Math.cos(Math.PI * i / SAMP);
      const hw = halfWidthAt(u);
      upper.push(transform3(cx, cy, ux, uy, halfLength * u, hw));
      lower.push(transform3(cx, cy, ux, uy, halfLength * u, -hw));
    }
    const outline = [...upper, ...lower.reverse()];
    ctx.save();
    drawPolyline4(ctx, outline, true);
    ctx.clip();
    const glowR = Math.max(1, halfLength * 1.05);
    const grad = ctx.createRadialGradient(cx, cy, glowR * 0.1, cx, cy, glowR);
    grad.addColorStop(0, `hsla(${hue}, 26%, 92%, ${alpha * 0.66})`);
    grad.addColorStop(0.62, `hsla(${hue + 2}, 30%, 84%, ${alpha * 0.5})`);
    grad.addColorStop(1, `hsla(${hue + 4}, 34%, 74%, ${alpha * 0.16})`);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
    const gSeed = finiteOr(cell.noiseSeed, 0) | 0;
    const gCount = Math.round(clamp(L * 6, 60, 220));
    for (let g = 0;g < gCount; g++) {
      const gu = (seededUnit(gSeed, g, 1371344503) * 2 - 1) * 0.9;
      const gs = (seededUnit(gSeed, g, 2585733948) * 2 - 1) * 0.92;
      const hw = halfWidthAt(gu);
      const p = transform3(cx, cy, ux, uy, halfLength * gu, gs * hw);
      const r = 0.5 + seededUnit(gSeed, g, 752460107) * 0.9;
      const nearGirdle = Math.min(Math.abs(gu - GIRDLE_A_U), Math.abs(gu - GIRDLE_P_U));
      const lane = smoothstep2(clamp01(1 - nearGirdle / 0.075));
      ctx.fillStyle = `hsla(${hue}, 22%, ${90 - 8 * lane}%, ${alpha * (0.34 - 0.12 * lane)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU2);
      ctx.fill();
    }
    const gCount2 = Math.round(clamp(L * 4, 40, 150));
    for (let g = 0;g < gCount2; g++) {
      const gu = (seededUnit(gSeed, g, 1033993285) * 2 - 1) * 0.9;
      const gs = (seededUnit(gSeed, g, 1508030371) * 2 - 1) * 0.92;
      const hw = halfWidthAt(gu);
      const p = transform3(cx, cy, ux, uy, halfLength * gu, gs * hw);
      const r = 0.3 + seededUnit(gSeed, g, 348696353) * 0.5;
      const nearGirdle = Math.min(Math.abs(gu - GIRDLE_A_U), Math.abs(gu - GIRDLE_P_U));
      const lane = smoothstep2(clamp01(1 - nearGirdle / 0.075));
      ctx.fillStyle = `hsla(${hue + 4}, 18%, ${94 - 6 * lane}%, ${alpha * (0.16 - 0.07 * lane)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU2);
      ctx.fill();
    }
    ctx.restore();
    for (let i = 0;i < upper.length - 1; i++) {
      const u = -Math.cos(Math.PI * i / SAMP);
      const flank = 1 - Math.abs(u);
      const a = alpha * (0.1 + 0.18 * flank * flank);
      ctx.strokeStyle = `hsla(${hue + 2}, 32%, 92%, ${a})`;
      ctx.lineWidth = Math.max(0.5, wMax * 0.07);
      ctx.beginPath();
      ctx.moveTo(upper[i].x, upper[i].y);
      ctx.lineTo(upper[i + 1].x, upper[i + 1].y);
      ctx.moveTo(lower[i].x, lower[i].y);
      ctx.lineTo(lower[i + 1].x, lower[i + 1].y);
      ctx.stroke();
    }
    {
      const muStart = -0.58;
      const muEnd = 0.4;
      const bowDepth = 0.72 * (0.45 + 0.55 * Math.abs(rollCos));
      const MN = 40;
      const side2 = rollCos >= 0 ? 1 : -1;
      const macro = [];
      for (let k = 0;k <= MN; k++) {
        const f = k / MN;
        const u = muStart + (muEnd - muStart) * (0.5 - 0.5 * Math.cos(Math.PI * f));
        const bow = Math.sin(f * Math.PI) * bowDepth;
        const lat = bow * halfWidthAt(u) * side2;
        macro.push(transform3(cx, cy, ux, uy, halfLength * u, lat));
      }
      const halfTh = Math.max(1.2, wMax * 0.2);
      const left = [];
      const right = [];
      for (let k = 0;k <= MN; k++) {
        const f = k / MN;
        const taper = Math.pow(Math.sin(Math.max(0, Math.min(1, f)) * Math.PI), 0.45);
        const a = macro[Math.max(0, k - 1)];
        const b = macro[Math.min(MN, k + 1)];
        let tx = b.x - a.x, ty = b.y - a.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const nx2 = -ty, ny2 = tx;
        const th = halfTh * (0.55 + 0.45 * taper);
        const p = macro[k];
        left.push({ x: p.x + nx2 * th, y: p.y + ny2 * th });
        right.push({ x: p.x - nx2 * th, y: p.y - ny2 * th });
      }
      const ribbon = [...left, ...right.reverse()];
      drawPolyline4(ctx, ribbon, true);
      ctx.fillStyle = `hsla(${hue - 8}, 6%, 76%, ${alpha * 0.9})`;
      ctx.fill();
      ctx.save();
      drawPolyline4(ctx, ribbon, true);
      ctx.clip();
      const mnSeed = finiteOr(cell.noiseSeed, 0) | 0;
      for (let m = 0;m < MN; m += 2) {
        const c0 = macro[m];
        const u01 = seededUnit(mnSeed, m, 1545415487);
        const dark = u01 < 0.5;
        const jx = (seededUnit(mnSeed, m, 752460107) - 0.5) * halfTh * 1.2;
        const jy = (seededUnit(mnSeed, m, 2585733948) - 0.5) * halfTh * 1.2;
        const r = halfTh * (0.4 + 0.5 * seededUnit(mnSeed, m, 348696353));
        ctx.fillStyle = dark ? `hsla(${hue - 8}, 7%, 50%, ${alpha * 0.6})` : `hsla(${hue}, 7%, 90%, ${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(c0.x + jx, c0.y + jy, r, 0, TAU2);
        ctx.fill();
      }
      ctx.restore();
      drawPolyline4(ctx, ribbon, true);
      ctx.strokeStyle = `hsla(${hue - 2}, 18%, 90%, ${alpha * 0.36})`;
      ctx.lineWidth = Math.max(0.4, wMax * 0.04);
      ctx.stroke();
    }
    const beat = wrapUnit(finiteOr(cell.beatPhase, 0));
    const RING_TILT = 0.1;
    const gSeedR = finiteOr(cell.noiseSeed, 0) | 0;
    const drawGirdle = (gu, seatHue, gi) => {
      const hw = halfWidthAt(gu);
      const baseAlong = halfLength * gu;
      const NT = 104;
      ctx.lineWidth = Math.max(0.3, wMax * 0.026);
      for (let s = 0;s < NT; s++) {
        const phi = s / NT * TAU2;
        const depth = Math.cos(phi + rollAng);
        if (depth < -0.1)
          continue;
        const front = clamp01(0.5 + 0.5 * depth);
        const jit = (seededUnit(gSeedR, s + gi * 97, 752460107) - 0.5) * 0.1;
        const lat = Math.cos(phi) * hw;
        const along = baseAlong + Math.sin(phi) * hw * RING_TILT;
        const wave = 0.5 + 0.5 * Math.sin(TAU2 * beat - phi * 3);
        const cilLen = hw * (0.042 + 0.022 * wave) * (1 + jit);
        const outLat = Math.cos(phi);
        const outAlong = Math.sin(phi) * RING_TILT;
        const bandJ1 = (seededUnit(gSeedR, s + gi * 131, 2083166993) - 0.5) * hw * 0.34;
        const bandJ2 = (seededUnit(gSeedR, s + gi * 131, 1309787047) - 0.5) * hw * 0.34;
        const base = transform3(cx, cy, ux, uy, along + bandJ1 * 0.55, lat + bandJ2);
        ctx.fillStyle = `hsla(${seatHue}, 34%, 94%, ${alpha * (0.07 + 0.22 * front)})`;
        ctx.beginPath();
        ctx.arc(base.x, base.y, Math.max(0.42, wMax * 0.052), 0, TAU2);
        ctx.fill();
        if (s % 2 === 0) {
          const bandJ3 = (seededUnit(gSeedR, s + gi * 149, 796744337) - 0.5) * hw * 0.32;
          const bandJ4 = (seededUnit(gSeedR, s + gi * 149, 1639241769) - 0.5) * hw * 0.32;
          const dust = transform3(cx, cy, ux, uy, along + outAlong * cilLen * 0.35 + bandJ3 * 0.45, lat + outLat * cilLen * 0.35 + bandJ4);
          ctx.fillStyle = `hsla(${seatHue}, 36%, 96%, ${alpha * (0.05 + 0.15 * front)})`;
          ctx.beginPath();
          ctx.arc(dust.x, dust.y, Math.max(0.28, wMax * 0.03), 0, TAU2);
          ctx.fill();
        }
      }
    };
    drawGirdle(GIRDLE_A_U, hue + 6, 0);
    drawGirdle(GIRDLE_P_U, hue + 6, 1);
    const drawBrushes = (gu) => {
      const phi = rollAng;
      const depth = Math.cos(phi);
      if (depth < 0)
        return;
      const front = clamp01(0.5 + 0.5 * depth);
      for (let r = 0;r < BRUSH_ROWS; r++) {
        const bu = gu - 0.06 - r * 0.035;
        const hw = halfWidthAt(bu);
        const lat = Math.cos(phi) * hw * 0.62;
        const along = halfLength * bu + Math.sin(phi) * hw * 0.34 * 0.62;
        const dot = transform3(cx, cy, ux, uy, along + hw * 0.028, lat + Math.sign(lat || 1) * hw * 0.028);
        ctx.fillStyle = `hsla(${hue + 8}, 34%, 92%, ${alpha * 0.48 * front})`;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, Math.max(0.28, wMax * 0.026), 0, TAU2);
        ctx.fill();
      }
    };
    drawBrushes(GIRDLE_A_U);
    drawBrushes(GIRDLE_P_U);
    {
      const coneBaseU = SHOULDER_U;
      const tip = transform3(cx, cy, ux, uy, halfLength * 1.02, 0);
      const NS = 4;
      for (let k = 1;k < NS; k++) {
        const f = k / NS;
        const lat = (f * 2 - 1) * halfWidthAt(coneBaseU) * 0.22;
        const dot = transform3(cx, cy, ux, uy, halfLength * (coneBaseU + (1.02 - coneBaseU) * 0.62), lat);
        ctx.fillStyle = `hsla(${hue + 4}, 14%, 88%, ${alpha * 0.08})`;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, Math.max(0.2, wMax * 0.018), 0, TAU2);
        ctx.fill();
      }
      const collarHw = halfWidthAt(coneBaseU);
      ctx.lineWidth = Math.max(0.35, wMax * 0.03);
      for (let s = 0;s <= 10; s++) {
        const f = s / 10;
        const lat = (f * 2 - 1) * collarHw;
        const depth = Math.cos(rollAng);
        if (depth < -0.2)
          continue;
        const front = clamp01(0.5 + 0.5 * depth);
        const base = transform3(cx, cy, ux, uy, halfLength * coneBaseU, lat);
        const tipC = transform3(cx, cy, ux, uy, halfLength * (coneBaseU + 0.045), lat + Math.sign(lat || 1) * collarHw * 0.05);
        ctx.strokeStyle = `hsla(${hue + 6}, 30%, 91%, ${alpha * (0.1 + 0.28 * front)})`;
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(tipC.x, tipC.y);
        ctx.stroke();
      }
      ctx.fillStyle = `hsla(${hue + 4}, 18%, 88%, ${alpha * 0.17})`;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, Math.max(0.36, wMax * 0.052), 0, TAU2);
      ctx.fill();
    }
    {
      const cvPulse = 0.5 - 0.5 * Math.cos(TAU2 * wrapUnit(finiteOr(cell.cvPhase, 0)));
      const cvR = Math.max(0.5, wMax * (0.13 + 0.06 * cvPulse));
      const p = transform3(cx, cy, ux, uy, -halfLength * 0.86, 0);
      ctx.fillStyle = `hsla(${hue + 2}, 22%, 90%, ${alpha * 0.22})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, cvR, 0, TAU2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue + 4}, 32%, 96%, ${alpha * 0.78})`;
      ctx.lineWidth = Math.max(0.4, wMax * 0.04);
      ctx.beginPath();
      ctx.arc(p.x, p.y, cvR, 0, TAU2);
      ctx.stroke();
    }
  });
  ctx.restore();
}

// src/theme-engine/renderers/cell/aquarium/registry.ts
var ZERO_DIATOMS = { count: 0, alpha: 0, driftSpeed: 0 };
var ZERO_EUGLENA = { count: 0, speed: 0, speedActive: 0, scale: 1, hueOffset: 42 };
var ZERO_VORTICELLA = { count: 0, contractRate: 0, scale: 1, alongFrac: 0.5 };
var ZERO_DIDINIUM = { count: 0, speed: 0, speedActive: 0, scale: 1, hueOffset: 0 };
function viewForDiatom(cfg) {
  return {
    enabled: true,
    seed: cfg.seed,
    alpha: cfg.aquariumAlpha,
    activityBoost: cfg.activityBoost,
    diatoms: cfg,
    euglena: ZERO_EUGLENA,
    vorticella: ZERO_VORTICELLA,
    didinium: ZERO_DIDINIUM
  };
}
function viewForEuglena(cfg) {
  return {
    enabled: true,
    seed: cfg.seed,
    alpha: cfg.aquariumAlpha,
    activityBoost: cfg.activityBoost,
    medium: cfg.medium,
    diatoms: ZERO_DIATOMS,
    euglena: cfg,
    vorticella: ZERO_VORTICELLA,
    didinium: ZERO_DIDINIUM
  };
}
function viewForVorticella(cfg) {
  return {
    enabled: true,
    seed: cfg.seed,
    alpha: cfg.aquariumAlpha,
    activityBoost: cfg.activityBoost,
    diatoms: ZERO_DIATOMS,
    euglena: ZERO_EUGLENA,
    vorticella: cfg,
    didinium: ZERO_DIDINIUM
  };
}
function viewForDidinium(cfg) {
  return {
    enabled: true,
    seed: cfg.seed,
    alpha: cfg.aquariumAlpha,
    activityBoost: cfg.activityBoost,
    diatoms: ZERO_DIATOMS,
    euglena: ZERO_EUGLENA,
    vorticella: ZERO_VORTICELLA,
    didinium: cfg
  };
}
var REGISTRY = {
  diatom: {
    salt: 219836621,
    z: 0,
    slot: "diatoms",
    seed: (count, seed, frame) => seedDiatoms(count, seed, frame),
    update: (states, frame, cfg) => updateDiatoms(states, frame, viewForDiatom(cfg)),
    draw: (ctx, states, frame, cfg) => drawDiatoms(ctx, states, frame, viewForDiatom(cfg))
  },
  euglena: {
    salt: 235478698,
    z: 1,
    slot: "euglena",
    seed: (count, seed, frame) => seedEuglena(count, seed, frame),
    update: (states, frame, cfg) => updateEuglena(states, frame, viewForEuglena(cfg)),
    draw: (ctx, states, frame, cfg) => drawEuglena(ctx, states, frame, viewForEuglena(cfg))
  },
  vorticella: {
    salt: 117600714,
    z: 2,
    slot: "vorticella",
    seed: (count, seed, frame, cfg) => seedVorticella(count, seed, frame, cfg.alongFrac),
    update: (states, frame, cfg) => updateVorticella(states, frame, viewForVorticella(cfg)),
    draw: (ctx, states, frame, cfg) => drawVorticella(ctx, states, frame, viewForVorticella(cfg))
  },
  didinium: {
    salt: 220011530,
    z: 3,
    slot: "didinium",
    seed: (count, seed, frame) => seedDidinium(count, seed, frame),
    update: (states, frame, cfg) => updateDidinium(states, frame, viewForDidinium(cfg)),
    draw: (ctx, states, frame, cfg) => drawDidinium(ctx, states, frame, viewForDidinium(cfg))
  }
};
function sceneFromParams(params) {
  const view = aquariumParamsView(params);
  const instances = [];
  if (!view.enabled)
    return { seed: view.seed | 0, instances };
  if (view.diatoms.count > 0) {
    instances.push({
      species: "diatom",
      count: view.diatoms.count,
      cfg: { ...view.diatoms, seed: view.seed, aquariumAlpha: view.alpha, activityBoost: view.activityBoost }
    });
  }
  if (view.euglena.count > 0) {
    instances.push({
      species: "euglena",
      count: view.euglena.count,
      cfg: {
        ...view.euglena,
        medium: view.medium,
        seed: view.seed,
        aquariumAlpha: view.alpha,
        activityBoost: view.activityBoost
      }
    });
  }
  if (view.vorticella.count > 0) {
    instances.push({
      species: "vorticella",
      count: view.vorticella.count,
      cfg: { ...view.vorticella, seed: view.seed, aquariumAlpha: view.alpha, activityBoost: view.activityBoost }
    });
  }
  if (view.didinium.count > 0) {
    instances.push({
      species: "didinium",
      count: view.didinium.count,
      cfg: { ...view.didinium, seed: view.seed, aquariumAlpha: view.alpha, activityBoost: view.activityBoost }
    });
  }
  return { seed: view.seed | 0, instances };
}

// src/theme-engine/renderers/cell/aquarium/layer.ts
function buildAquariumInteractionField(euglena, vorticella, hero, vorticellaScale, frameHeight, didinium, euglenaScale = 1, didiniumScale = 1) {
  const contribs = [];
  if (vorticella) {
    for (let i = 0;i < vorticella.length; i++) {
      contribs.push(...vorticellaContribute(vorticella[i], vorticellaScale, frameHeight, i));
    }
  }
  if (euglena) {
    for (let i = 0;i < euglena.length; i++) {
      contribs.push(...euglenaContribute(euglena[i], i, euglenaScale));
    }
  }
  if (didinium) {
    for (let i = 0;i < didinium.length; i++) {
      contribs.push(...didiniumContribute(didinium[i], i, didiniumScale));
    }
  }
  contribs.push(...heroContribute(hero));
  return buildField(contribs);
}
function seedAquarium(frame, params) {
  const scene = sceneFromParams(params);
  const state = { seed: scene.seed, diatoms: [], euglena: [], vorticella: [], didinium: [] };
  for (const instance of scene.instances) {
    const entry = REGISTRY[instance.species];
    state[entry.slot] = entry.seed(instance.count, scene.seed, frame, instance.cfg);
  }
  return state;
}
function updateAquarium(aquarium, frame, params) {
  const view = aquariumParamsView(params);
  if (!view.enabled)
    return aquarium;
  const scene = sceneFromParams(params);
  const cfgBySpecies = Object.fromEntries(scene.instances.map((instance) => [instance.species, instance.cfg]));
  const diatoms = view.diatoms.count > 0 ? REGISTRY.diatom.update(aquarium.diatoms, frame, cfgBySpecies.diatom) : aquarium.diatoms;
  const preUpdateEuglena = view.euglena.count > 0 && aquarium.euglena.length > 0 ? aquarium.euglena : undefined;
  const preUpdateVorticella = view.vorticella.count > 0 && aquarium.vorticella.length > 0 ? aquarium.vorticella : undefined;
  const preUpdateDidinium = view.didinium.count > 0 && aquarium.didinium.length > 0 ? aquarium.didinium : undefined;
  const interaction = buildAquariumInteractionField(preUpdateEuglena, preUpdateVorticella, frame.hero, view.vorticella.scale, frame.height, preUpdateDidinium, view.euglena.scale, view.didinium.scale);
  const interactionFrame = { ...frame, interaction };
  const euglena = view.euglena.count > 0 ? REGISTRY.euglena.update(aquarium.euglena, interactionFrame, cfgBySpecies.euglena) : aquarium.euglena;
  const vorticella = view.vorticella.count > 0 ? REGISTRY.vorticella.update(aquarium.vorticella, interactionFrame, cfgBySpecies.vorticella) : aquarium.vorticella;
  const didinium = view.didinium.count > 0 ? REGISTRY.didinium.update(aquarium.didinium, interactionFrame, cfgBySpecies.didinium) : aquarium.didinium;
  return diatoms === aquarium.diatoms && euglena === aquarium.euglena && vorticella === aquarium.vorticella && didinium === aquarium.didinium ? aquarium : { ...aquarium, diatoms, euglena, vorticella, didinium };
}
function drawAquariumBackground(ctx, aquarium, frame, params) {
  const view = aquariumParamsView(params);
  if (!view.enabled)
    return;
  const scene = sceneFromParams(params);
  const instancesByZ = [...scene.instances].sort((a, b) => REGISTRY[a.species].z - REGISTRY[b.species].z);
  for (const instance of instancesByZ) {
    const entry = REGISTRY[instance.species];
    entry.draw(ctx, aquarium[entry.slot], frame, instance.cfg);
  }
}
function drawAquariumForeground(ctx, aquarium, frame, params) {
  const view = aquariumParamsView(params);
  if (!view.enabled || view.didinium.count <= 0)
    return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.9));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of aquarium.didinium) {
    const contact = Math.max(0, d.contactTimer ?? 0);
    if (contact <= 0)
      continue;
    const L = didiniumDisplayLength(d.size, view.didinium.scale);
    const heading = d.phase;
    const ux = Math.cos(heading), uy = Math.sin(heading);
    const snoutX = d.x + ux * L * 0.52;
    const snoutY = d.y + uy * L * 0.52;
    const duration = Math.max(0.001, d.contactDuration ?? contact);
    const elapsed = Math.max(0, duration - contact);
    const env = Math.min(1, Math.min(elapsed / 0.25, contact / 0.25));
    const sideEnv = Math.min(1, Math.max(0, (elapsed - 0.25) / 0.35));
    const fanEnv = Math.min(1, Math.max(0, (elapsed - 1.2) / 0.45));
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(heading);
    ctx.strokeStyle = `hsla(226, 48%, 96%, ${alpha * 0.96 * env})`;
    ctx.lineWidth = Math.max(0.9, L * 0.03);
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.5, L * 0.22, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `hsla(214, 54%, 98%, ${alpha * 0.92 * env})`;
    ctx.lineWidth = Math.max(0.9, L * 0.028);
    for (const gx of [L * 0.18, -L * 0.12]) {
      ctx.beginPath();
      ctx.moveTo(gx, -L * 0.2);
      ctx.lineTo(gx, L * 0.2);
      ctx.stroke();
    }
    ctx.restore();
    let px = snoutX + ux * Math.min(18, Math.max(14, L * 0.42));
    let py = snoutY + uy * Math.min(18, Math.max(14, L * 0.42));
    const hero = frame.hero;
    if (hero) {
      const hx = Number.isFinite(hero.x) ? hero.x : 0;
      const hy = Number.isFinite(hero.y) ? hero.y : 0;
      const hh = Number.isFinite(hero.heading ?? 0) ? hero.heading ?? 0 : 0;
      const ch = Math.cos(hh), sh = Math.sin(hh);
      const dx = snoutX - hx;
      const dy = snoutY - hy;
      const localX = dx * ch + dy * sh;
      const localY = -dx * sh + dy * ch;
      const A = Math.max(0.001, Number.isFinite(hero.halfLen ?? hero.radius) ? hero.halfLen ?? hero.radius : hero.radius);
      const B = Math.max(0.001, Number.isFinite(hero.halfWid ?? hero.radius) ? hero.halfWid ?? hero.radius : hero.radius);
      const q = Math.sqrt(localX * localX / (A * A) + localY * localY / (B * B)) || 0.000001;
      const sx = localX / q;
      const sy = localY / q;
      px = hx + sx * ch - sy * sh;
      py = hy + sx * sh + sy * ch;
    }
    ctx.fillStyle = `hsla(205, 18%, 15%, ${alpha * 0.55 * env})`;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1.3, L * 0.065), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `hsla(210, 14%, 10%, ${alpha * 0.42 * env})`;
    ctx.lineWidth = Math.max(1, L * 0.035);
    ctx.beginPath();
    ctx.arc(px - ux * 1.5, py - uy * 1.5, Math.max(3, L * 0.16), heading + Math.PI * 0.62, heading + Math.PI * 1.38);
    ctx.stroke();
    for (const [side, aMul, wMul] of [[-L * 0.055, 0.55 * sideEnv, 0.8], [0, 1, 1.25], [L * 0.055, 0.55 * sideEnv, 0.8]]) {
      const sx = snoutX - uy * side;
      const sy = snoutY + ux * side;
      ctx.strokeStyle = `hsla(198, 52%, 98%, ${alpha * 0.95 * env * aMul})`;
      ctx.lineWidth = Math.max(0.75, L * 0.026) * wMul;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(px, py);
      ctx.stroke();
    }
    const fanAlpha = alpha * 0.22 * env * fanEnv;
    ctx.lineWidth = 0.75;
    for (let k = 0;k < 7; k++) {
      if (k % 5 === 1)
        continue;
      const jitter = Math.sin((k + 1) * 12.9898) * 0.07;
      const a = heading + Math.PI + (k - 3) * 0.16 + jitter;
      const len = 4.8 + k * 5 % 4 * 0.7;
      const aJ = 0.75 + 0.25 * Math.abs(Math.sin((k + 3) * 4.17));
      ctx.strokeStyle = `hsla(42, 46%, 95%, ${fanAlpha * aJ})`;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.fillStyle = `hsla(44, 52%, 97%, ${alpha * 0.86 * env})`;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1, L * 0.04), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// src/theme-engine/renderers/cell/draw.ts
function pathFromPoints(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1;i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();
}
function clipToCellPath(ctx, splinePoints) {
  pathFromPoints(ctx, splinePoints);
  if (typeof ctx.clip === "function")
    ctx.clip();
}
function drawCVVesicle(ctx, vx, vy, r, cvH, params) {
  ctx.fillStyle = hsla(cvH, 0.45, 0.7, params.nucleusAlpha * 0.45);
  ctx.beginPath();
  ctx.arc(vx, vy, r, 0, TAU);
  ctx.fill();
}
function drawFoodVacuole(ctx, fx, fy, drawR, fvH, fvSat, params) {
  ctx.fillStyle = hsla(fvH, fvSat, 0.5, params.nucleusAlpha * 0.4);
  ctx.beginPath();
  ctx.arc(fx, fy, drawR, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = hsla(fvH, fvSat * 1.125, 0.35, params.nucleusAlpha * 0.5);
  ctx.lineWidth = 0.8;
  ctx.stroke();
}
function drawCVCanals(ctx, vx, vy, r, cvH, params) {
  if (!params.enableCVCanals || r <= 1)
    return;
  const canalCount = 6;
  const canalLen = r * (params.canalLenMul ?? 2);
  const canalAlpha = params.nucleusAlpha * 0.45 * (params.canalAlphaMul ?? 0.3);
  ctx.strokeStyle = hsla(cvH, 0.3, 0.72, canalAlpha);
  ctx.lineWidth = params.canalLineWidth ?? 0.5;
  for (let ci = 0;ci < canalCount; ci++) {
    const angle = ci / canalCount * TAU;
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx + Math.cos(angle) * canalLen, vy + Math.sin(angle) * canalLen);
    ctx.stroke();
  }
}

// src/theme-engine/renderers/cell/views.ts
function cellPaletteView(params, baseHue) {
  return {
    cvHue: params.cvHue ?? baseHue + 20,
    foodVacuoleHue: params.foodVacuoleHue ?? baseHue - 30,
    foodVacuoleSat: params.foodVacuoleSat ?? 0.4
  };
}

// src/theme-engine/renderers/cell/renderer.ts
function ciliaBeatHzEff(activity, params) {
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  const f0 = params.ciliaBeatHz ?? 0.9;
  const f1 = params.ciliaBeatHzActive ?? 1.6;
  return f0 + (f1 - f0) * a;
}
function iridescentHue(angle, t, audioLevel, baseHue, params) {
  const norm = (angle % TAU + TAU) % TAU / TAU;
  let hue = baseHue + norm * params.hueSpread + t * params.shimmerSpeed + audioLevel * params.hueBoost;
  hue = (hue % 360 + 360) % 360;
  return hue;
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
  let trichocystAlpha = 0;
  let triPrevStartle = 0;
  let baseline = 0;
  let drift01 = 0;
  let aquarium = null;
  let heroVortDx = 0;
  let heroVortDy = 0;
  let predatorEnv = 0;
  let predatorNx = 1;
  let predatorNy = 0;
  let euglenaTouchEnv = 0;
  let euglenaTouchX = width / 2;
  let euglenaTouchY = height / 2;
  let wander = null;
  let bodyHeading = 0;
  let interiorHeading = 0;
  let motes = null;
  let granules = null;
  let interiorGranules = null;
  let foodVacuoles = null;
  let interiorFoodVacuoles = null;
  let flowCx = width / 2, flowCy = height / 2, flowHeading = 0, flowSpeed = 0;
  let lastTickMs = performance.now();
  let simTime = 0;
  let axialSpinPhase = 0;
  let cyclosisPhase = 0;
  let ciliaBeatCycles = 0;
  const PERSIST_KEY = cellPersistKey(width, height);
  let driftPhaseOffset = 0;
  let lastPersist = 0;
  let restoredPose = null;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem("talri.cell.state.v1");
      const saved = parseCellState(localStorage.getItem(PERSIST_KEY));
      if (saved) {
        growth = saved.growth;
        const seed = restoreSeed(saved, performance.now());
        simTime = saved.elapsed > 0 ? saved.elapsed : 0;
        driftPhaseOffset = seed.driftPhaseOffset;
        restoredPose = wanderPoseFromState(saved, width, height, resolveBaseRadius(width, height, params, growth), params);
      }
    } catch {}
  }
  let rafId = null;
  const tick = () => {
    const nowMs = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastTickMs) / 1000));
    lastTickMs = nowMs;
    simTime += dt;
    const t = simTime;
    const s = latestState;
    const audioLevel = sanitizeUnit(s.audioLevel);
    const spectrumBins = sanitizeBins(s.spectrumBins);
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      if (params.enableFlowField && (params.flowMoteCount ?? 0) > 0) {
        if (!motes)
          motes = seedMotes(width, height, params);
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        for (let i = 0;i < motes.length; i++) {
          motes[i] = advectMote(motes[i], flowCx, flowCy, flowHeading, flowSpeed, dt, width, height, params);
          ctx.beginPath();
          ctx.arc(motes[i].x, motes[i].y, 0.8, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
      const energyTarget = cellEnergy(s.mode, audioLevel, t, params.idle, params.levelGain);
      if (energySmoothed < 0)
        energySmoothed = energyTarget;
      energySmoothed = sanitizeUnit(smoothEnergy(energySmoothed, energyTarget, dt, params));
      const energy = energySmoothed;
      growth = sanitizeUnit(growthLevel(sanitizeUnit(growth), audioLevel, s.mode, params.growthAttack, params.growthRelease));
      const activity = cellActivity(energy, growth, params);
      const cyclPeriod = effectiveCyclosisPeriod(activity, params);
      const cyclParams = params.cyclosisActivityBoost ? { ...params, cyclosisPeriod: cyclPeriod } : params;
      cyclosisPhase = advanceCyclosisPhase(cyclosisPhase, dt, cyclParams);
      const effectiveFillAlpha = lerp(params.fillAlpha, params.fillAlphaActive ?? params.fillAlpha, activity);
      const baseMembraneLightness = params.membraneLightness ?? 0.6;
      const effectiveMembraneLightness = lerp(baseMembraneLightness, params.membraneLightnessActive ?? baseMembraneLightness, activity);
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
      if (params.enableBandLimit) {
        deform = bandLimitDeform(deform, params);
      }
      drift01 = driftActivation(drift01, s.mode === "recording", params.driftActivationRate ?? 0.02, dt);
      if (params.idleDriftMin) {
        drift01 = Math.max(params.idleDriftMin, drift01);
      }
      const baseR = resolveBaseRadius(width, height, params, growth);
      if (!wander) {
        wander = restoredPose ? { x: restoredPose.x, y: restoredPose.y, heading: restoredPose.heading, vx: 0, vy: 0, clock: 0 } : { x: width / 2, y: height / 2, heading: noise2D(7.1, 3.3) * TAU, vx: 0, vy: 0, clock: 0 };
      }
      if (useKick) {
        const kick = startleHeadingKick(startle, prevStartle, t, params);
        if (kick !== 0)
          wander = { ...wander, heading: wander.heading + kick };
      }
      if (predatorEnv > 0.02) {
        const desired = Math.atan2(predatorNy, predatorNx);
        const turn = Math.atan2(Math.sin(desired - wander.heading), Math.cos(desired - wander.heading));
        wander = { ...wander, heading: wander.heading + turn * (1 - Math.exp(-5 * dt)) };
      }
      let baseSwim = params.enableActivity ? swimSpeed(activity, width, height, params) : undefined;
      if (baseSwim !== undefined && params.idleSwimFrac) {
        const maxSwim = (params.swimSpeedMaxFrac ?? 0.06) * Math.min(width, height);
        baseSwim = Math.max(params.idleSwimFrac * maxSwim, baseSwim);
      }
      const burst = useKick ? startleBurstSpeed(startle, baseR, params) : 0;
      const predatorEscapeSpeed = predatorEnv > 0.02 ? predatorEnv * baseR * 1.65 : 0;
      const swimPx = baseSwim !== undefined ? baseSwim + burst + predatorEscapeSpeed : burst > 0 || predatorEscapeSpeed > 0 ? burst + predatorEscapeSpeed : undefined;
      wander = wanderStep(wander, dt, width, height, baseR, params, swimPx);
      const driftedX = width / 2 + (wander.x - width / 2) * drift01;
      const driftedY = height / 2 + (wander.y - height / 2) * drift01;
      let cx = driftedX + sdx;
      let cy = driftedY + sdy;
      const maxRadius = membraneMaxRadius(width, height);
      const floorRadius = baseR * 0.35;
      const sampleCount = deform.length;
      if (params.enableBodyProfile) {
        deform = bodyProfileDeform(sampleCount, bodyHeading, baseR, params);
      }
      applyOralGroove(deform, bodyHeading, params);
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
      const iTau = params.interiorHeadingTau ?? 0;
      if (iTau > 0) {
        const iAlpha = 1 - Math.exp(-dt / iTau);
        let iDelta = bodyHeading - interiorHeading;
        if (iDelta > Math.PI)
          iDelta -= TAU;
        if (iDelta < -Math.PI)
          iDelta += TAU;
        interiorHeading += iAlpha * iDelta;
      } else {
        interiorHeading = bodyHeading;
      }
      flowCx = cx;
      flowCy = cy;
      flowHeading = bodyHeading;
      flowSpeed = curSpeed;
      const squeezeK = params.enableBodyProfile ? 1 : params.enableAffine ? prolateAspect(speedNorm, params) : 1;
      axialSpinPhase = advanceAxialSpinPhase(axialSpinPhase, dt, speedNorm, params);
      const spinPhi = axialSpinPhase;
      const squeezePhi = bodyHeading + spinPhi;
      const [hdx, hdy] = helicalOffset(spinPhi, bodyHeading, baseR, params);
      if (hdx !== 0 || hdy !== 0) {
        cx += hdx;
        cy += hdy;
        for (let i = 0;i < smoothedPoints.length; i++) {
          smoothedPoints[i] = [smoothedPoints[i][0] + hdx, smoothedPoints[i][1] + hdy];
        }
      }
      if ((params.vorticellaCount ?? 0) > 0 && aquarium && aquarium.vorticella.length > 0) {
        const vview = aquariumParamsView(params);
        const heroReach = baseR * Math.sqrt(Math.max(1, params.bodyAspect ?? 1)) * 1.2;
        const circles = buildField(aquarium.vorticella.flatMap((v, idx) => vorticellaContribute(v, vview.vorticella.scale, height, idx))).obstacles.filter((obstacle) => obstacle.shape === "circle");
        const target = heroConsumeObstacles(circles, cx, cy, heroReach);
        const a = 1 - Math.exp(-10 * dt);
        const ndx = (target.dx - heroVortDx) * a;
        const ndy = (target.dy - heroVortDy) * a;
        const nLen = Math.hypot(ndx, ndy);
        const maxStep = Math.max(0.5, baseR * 0.2);
        const stepScale = nLen > maxStep && nLen > 0 ? maxStep / nLen : 1;
        heroVortDx += ndx * stepScale;
        heroVortDy += ndy * stepScale;
        if (Math.abs(heroVortDx) > 0.001 || Math.abs(heroVortDy) > 0.001) {
          cx += heroVortDx;
          cy += heroVortDy;
          for (let i = 0;i < smoothedPoints.length; i++) {
            smoothedPoints[i] = [smoothedPoints[i][0] + heroVortDx, smoothedPoints[i][1] + heroVortDy];
          }
        }
      } else if (heroVortDx !== 0 || heroVortDy !== 0) {
        const a = 1 - Math.exp(-8 * dt);
        heroVortDx += (0 - heroVortDx) * a;
        heroVortDy += (0 - heroVortDy) * a;
      }
      if (params.enableHero !== false && aquarium?.didinium?.length) {
        let targetEnv = 0;
        let nxSum = 0, nySum = 0;
        for (const d of aquarium.didinium) {
          const contact = Math.max(0, d.contactTimer ?? 0);
          if (contact <= 0)
            continue;
          const dx = cx - d.x;
          const dy = cy - d.y;
          const dl = Math.hypot(dx, dy) || 1;
          const duration = Math.max(0.001, d.contactDuration ?? contact);
          const elapsed = Math.max(0, duration - contact);
          const env = elapsed < 1.2 ? 0 : Math.min(1, (elapsed - 1.2) / 0.7);
          targetEnv = Math.max(targetEnv, env);
          nxSum += dx / dl * env;
          nySum += dy / dl * env;
        }
        const tau = targetEnv > predatorEnv ? 0.08 : 0.75;
        const a = 1 - Math.exp(-dt / tau);
        predatorEnv += (targetEnv - predatorEnv) * a;
        if (nxSum !== 0 || nySum !== 0) {
          const nl = Math.hypot(nxSum, nySum) || 1;
          predatorNx += (nxSum / nl - predatorNx) * a;
          predatorNy += (nySum / nl - predatorNy) * a;
          const pl = Math.hypot(predatorNx, predatorNy) || 1;
          predatorNx /= pl;
          predatorNy /= pl;
        }
        const kick = Math.min(12, baseR * 0.52) * predatorEnv;
        const rx = predatorNx * kick;
        const ry = predatorNy * kick;
        if (kick > 0.01) {
          cx += rx;
          cy += ry;
          for (let i = 0;i < smoothedPoints.length; i++) {
            smoothedPoints[i] = [smoothedPoints[i][0] + rx, smoothedPoints[i][1] + ry];
          }
        }
      } else if (predatorEnv > 0) {
        const a = 1 - Math.exp(-dt / 0.75);
        predatorEnv += (0 - predatorEnv) * a;
      }
      if (params.enableAquarium) {
        const aquariumFrame = {
          t,
          dt,
          width,
          height,
          mode: s.mode,
          activity,
          audioLevel,
          startle,
          baseHue,
          hero: params.enableHero === false ? undefined : (() => {
            const aspect = Math.sqrt(Math.max(1, params.bodyAspect ?? 1));
            return { x: cx, y: cy, radius: baseR, heading: bodyHeading, halfLen: baseR * aspect, halfWid: baseR / aspect };
          })()
        };
        aquarium = aquarium ?? seedAquarium(aquariumFrame, params);
        aquarium = updateAquarium(aquarium, aquariumFrame, params);
        drawAquariumBackground(ctx, aquarium, aquariumFrame, params);
      }
      if (params.enableHero !== false && aquarium?.euglena?.length) {
        const aspect = Math.sqrt(Math.max(1, params.bodyAspect ?? 1));
        const A = Math.max(1, baseR * aspect);
        const B = Math.max(1, baseR / aspect);
        let targetEnv = 0;
        let tx = euglenaTouchX, ty = euglenaTouchY;
        const ch = Math.cos(bodyHeading), sh = Math.sin(bodyHeading);
        for (const e of aquarium.euglena) {
          const dx = e.x - cx;
          const dy = e.y - cy;
          const px = dx * ch + dy * sh;
          const py = -dx * sh + dy * ch;
          const q = Math.sqrt(px * px / (A * A) + py * py / (B * B));
          if (q > 1 && q < 1.35) {
            const env = 1 - (q - 1) / 0.35;
            if (env > targetEnv) {
              targetEnv = env;
              const sx = px / q, sy = py / q;
              tx = cx + sx * ch - sy * sh;
              ty = cy + sx * sh + sy * ch;
            }
          }
        }
        const tau = targetEnv > euglenaTouchEnv ? 0.12 : 0.5;
        const a = 1 - Math.exp(-dt / tau);
        euglenaTouchEnv += (targetEnv - euglenaTouchEnv) * a;
        euglenaTouchX += (tx - euglenaTouchX) * a;
        euglenaTouchY += (ty - euglenaTouchY) * a;
      } else {
        euglenaTouchEnv += (0 - euglenaTouchEnv) * (1 - Math.exp(-dt / 0.5));
      }
      const contourPoints = affineSqueezePoints(smoothedPoints, squeezeK, squeezePhi, cx, cy, params);
      const splinePoints = catmullRom(contourPoints, 4);
      if (params.enableHero !== false && splinePoints.length >= 3) {
        {
          const baseCiliaParams = somaticCiliaParams(params);
          const effectiveCount = params.enablePerimeterCount ? perimeterCiliaCount(baseR, params) : baseCiliaParams.ciliaCount;
          const ciliaParams = params.enableActivity ? {
            ...baseCiliaParams,
            ciliaCount: effectiveCount,
            ciliaBeatHz: ciliaBeatHzEff(activity, params),
            ciliaCurl: baseCiliaParams.ciliaCurl * (1 + 0.3 * activity)
          } : params.enablePerimeterCount ? { ...baseCiliaParams, ciliaCount: effectiveCount } : baseCiliaParams;
          ciliaBeatCycles = advanceCiliaBeatCycles(ciliaBeatCycles, dt, ciliaParams.ciliaBeatHz ?? 0.9);
          const ciliaMotion = {
            tx: Math.cos(bodyHeading),
            ty: Math.sin(bodyHeading),
            speedNorm,
            beatCycles: ciliaBeatCycles,
            axisStrength: params.enableActivity ? strokeAxisStrength(activity, params) : 0,
            ...params.enableCiliaOnContour && deform ? { contour: { deform, squeezeK, squeezePhi } } : {}
          };
          const cilia = ciliaPath(cx, cy, baseR, t, energy, growth, ciliaParams, ciliaMotion);
          ctx.lineCap = "round";
          for (const hair of cilia) {
            ctx.lineWidth = hair.width;
            ctx.strokeStyle = hsla(baseHue, params.ciliaSat ?? 0.6, 0.6, 0.35 + 0.35 * energy);
            ctx.beginPath();
            ctx.moveTo(hair.points[0][0], hair.points[0][1]);
            const spline = catmullRomOpen(hair.points, 4);
            for (let i = 1;i < spline.length; i++) {
              ctx.lineTo(spline[i][0], spline[i][1]);
            }
            ctx.stroke();
          }
        }
        if (params.enableTrichocysts) {
          if (startle > triPrevStartle + 0.02) {
            trichocystAlpha = 1;
          }
          const triDecayRate = params.trichocystDecay ?? 1;
          trichocystAlpha *= Math.exp(-triDecayRate * dt);
          if (trichocystAlpha < 0.005)
            trichocystAlpha = 0;
          triPrevStartle = startle;
        }
        if (params.enableTrichocysts && trichocystAlpha > 0.005) {
          const triCount = params.trichocystCount ?? 30;
          const effectiveCiliaLen = params.enableSomaticCilia ? params.somaticCiliaLength ?? 0.15 : params.ciliaLength ?? 0.45;
          const triLen = (params.trichocystLengthMul ?? 3) * baseR * effectiveCiliaLen;
          const triAlpha = trichocystAlpha * 0.7;
          ctx.save();
          ctx.strokeStyle = hsla(0, 0, 0.95, triAlpha);
          ctx.lineWidth = params.trichocystLineWidth ?? 1.5;
          ctx.lineCap = "round";
          const cN = contourPoints.length;
          for (let i = 0;i < triCount; i++) {
            const idx = Math.round(i * cN / triCount) % cN;
            const [px, py] = contourPoints[idx];
            const prev = contourPoints[(idx - 1 + cN) % cN];
            const next = contourPoints[(idx + 1) % cN];
            const tx = next[0] - prev[0];
            const ty = next[1] - prev[1];
            let nx = ty;
            let ny = -tx;
            const nLen = Math.hypot(nx, ny);
            if (nLen < 0.000001)
              continue;
            nx /= nLen;
            ny /= nLen;
            if (nx * (px - cx) + ny * (py - cy) < 0) {
              nx = -nx;
              ny = -ny;
            }
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + nx * triLen, py + ny * triLen);
            ctx.stroke();
          }
          ctx.restore();
        }
        const palette = cellPaletteView(params, baseHue);
        const cvH = palette.cvHue;
        const fvH = palette.foodVacuoleHue;
        const fvSat = palette.foodVacuoleSat;
        ctx.fillStyle = hsla(baseHue, params.cytoplasmSat ?? 0.7, 0.55, effectiveFillAlpha);
        pathFromPoints(ctx, splinePoints);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, baseR * 0.9));
        grad.addColorStop(0, hsla(baseHue + 10, (params.cytoplasmSat ?? 0.7) * 0.71, 0.7, effectiveFillAlpha * 0.5));
        grad.addColorStop(1, hsla(baseHue, params.cytoplasmSat ?? 0.7, 0.45, effectiveFillAlpha));
        ctx.fillStyle = grad;
        ctx.fill();
        if (params.enableEctoplasm) {
          const ectoFrac = params.ectoplasmFrac ?? 0.85;
          const ectoAlpha = params.ectoplasmAlpha ?? 0.15;
          ctx.save();
          ctx.beginPath();
          const ex0 = cx + (splinePoints[0][0] - cx) * ectoFrac;
          const ey0 = cy + (splinePoints[0][1] - cy) * ectoFrac;
          ctx.moveTo(ex0, ey0);
          for (let i = 1;i < splinePoints.length; i++) {
            ctx.lineTo(cx + (splinePoints[i][0] - cx) * ectoFrac, cy + (splinePoints[i][1] - cy) * ectoFrac);
          }
          ctx.closePath();
          ctx.strokeStyle = hsla(baseHue, (params.membraneSat ?? 0.85) * 0.5, effectiveMembraneLightness, ectoAlpha);
          ctx.lineWidth = 0.5;
          ctx.stroke();
          ctx.restore();
        }
        ctx.save();
        clipToCellPath(ctx, splinePoints);
        const frameDeform = deform;
        let minMembraneR = Infinity;
        for (const dv of frameDeform)
          minMembraneR = Math.min(minMembraneR, baseR * (1 + dv));
        let interiorCtx = null;
        const getInteriorCtx = () => {
          if (interiorCtx)
            return interiorCtx;
          const next = {
            cx,
            cy,
            baseR,
            deform: frameDeform,
            squeezeK,
            squeezePhi,
            bodyHeading: interiorHeading,
            params,
            profilePts: buildProfilePts(baseR, params)
          };
          interiorCtx = next;
          return next;
        };
        const nucleus = nucleusTransform(t, audioLevel, baseR, params, minMembraneR);
        if (nucleus.r >= 2.5) {
          let nx, ny;
          let macroIctx = null;
          if (params.enableInteriorField) {
            macroIctx = getInteriorCtx();
            const uM = params.macronucleusU ?? -0.05;
            const sM = params.macronucleusS ?? 0.1;
            [nx, ny] = interiorPoint(uM, sM, macroIctx);
          } else {
            [nx, ny] = affineSqueezePoints([[cx + nucleus.cx, cy + nucleus.cy]], squeezeK, squeezePhi, cx, cy, params)[0];
          }
          const nr = nucleus.r;
          const nucGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
          const nSm = params.nucleusSatMul ?? 1;
          nucGrad.addColorStop(0, hsla(baseHue - 5, 0.8 * nSm, 0.48, params.nucleusAlpha));
          nucGrad.addColorStop(0.4, hsla(baseHue - 8, 0.75 * nSm, 0.4, params.nucleusAlpha));
          nucGrad.addColorStop(1, hsla(baseHue - 10, 0.65 * nSm, 0.3, params.nucleusAlpha * 0.7));
          ctx.fillStyle = nucGrad;
          ctx.beginPath();
          const nAspect = params.nucleusAspect ?? 1.8;
          if (params.enableInteriorField && nAspect !== 1) {
            const nIndent = params.nucleusIndent ?? 0;
            if (nIndent > 0) {
              const kSteps = 32;
              const ch = Math.cos(bodyHeading);
              const sh = Math.sin(bodyHeading);
              for (let ki = 0;ki <= kSteps; ki++) {
                const t2 = ki / kSteps * TAU;
                const ct = Math.cos(t2);
                const st = Math.sin(t2);
                const kidFrac = st > 0 ? 1 - nIndent * st * st : 1;
                const ex = ct * nr * nAspect;
                const ey = st * nr * kidFrac;
                const rx = nx + ex * ch - ey * sh;
                const ry = ny + ex * sh + ey * ch;
                if (ki === 0)
                  ctx.moveTo(rx, ry);
                else
                  ctx.lineTo(rx, ry);
              }
              ctx.closePath();
            } else {
              ctx.ellipse(nx, ny, nr * nAspect, nr, bodyHeading, 0, TAU);
            }
          } else {
            ctx.arc(nx, ny, nr, 0, TAU);
          }
          ctx.fill();
          ctx.fillStyle = hsla(baseHue + 5, 0.55, 0.72, params.nucleusAlpha * 0.8);
          ctx.beginPath();
          ctx.arc(nx, ny, nr * 0.22, 0, TAU);
          ctx.fill();
          if (params.enableOrganelles) {
            if (params.enableInteriorField && macroIctx) {
              const uM = params.macronucleusU ?? -0.05;
              const sM = params.macronucleusS ?? 0.1;
              const [mcx, mcy] = interiorPoint(uM + 0.12, sM + 0.3, macroIctx);
              const mr = nr * (params.micronucleusSizeFrac ?? 0.32);
              ctx.fillStyle = hsla(baseHue - 6, 0.82, 0.42, params.nucleusAlpha);
              ctx.beginPath();
              ctx.arc(mcx, mcy, mr, 0, TAU);
              ctx.fill();
            } else {
              const mn = micronucleusTransform(nx, ny, nr, params);
              let mcx = mn.cx;
              let mcy = mn.cy;
              const ddx = mcx - cx;
              const ddy = mcy - cy;
              const dist = Math.hypot(ddx, ddy);
              const maxDist = Math.max(0, minMembraneR - mn.r);
              if (dist > maxDist && dist > 0) {
                const s2 = maxDist / dist;
                mcx = cx + ddx * s2;
                mcy = cy + ddy * s2;
              }
              ctx.fillStyle = hsla(baseHue - 6, 0.82, 0.42, params.nucleusAlpha);
              ctx.beginPath();
              ctx.arc(mcx, mcy, mn.r, 0, TAU);
              ctx.fill();
            }
          }
        }
        if (params.enableVacuole) {
          const vac = contractileVacuole(t, baseR, params);
          if (vac.r >= 0.5) {
            const bearing = 2.3;
            const placeR = Math.max(0, Math.min(baseR * 0.6, minMembraneR - vac.r));
            const vcx0 = cx + Math.cos(bearing) * placeR;
            const vcy0 = cy + Math.sin(bearing) * placeR;
            const [vx, vy] = affineSqueezePoints([[vcx0, vcy0]], squeezeK, squeezePhi, cx, cy, params)[0];
            drawCVVesicle(ctx, vx, vy, vac.r, cvH, params);
          }
        }
        if (params.enableVacuoles) {
          const pair = contractileVacuolePair(t, baseR, squeezePhi, params);
          if (params.enableInteriorField) {
            const ictx = getInteriorCtx();
            const anchors = [
              { u: params.cvAnteriorU ?? 0.55, s: params.cvAnteriorS ?? 0.62 },
              { u: params.cvPosteriorU ?? -0.55, s: params.cvPosteriorS ?? 0.62 }
            ];
            for (let i = 0;i < pair.length; i++) {
              const e = pair[i];
              if (e.r < 0.5)
                continue;
              const [vx, vy] = interiorPoint(anchors[i].u, anchors[i].s, ictx);
              drawCVVesicle(ctx, vx, vy, e.r, cvH, params);
              drawCVCanals(ctx, vx, vy, e.r, cvH, params);
            }
          } else {
            for (const e of pair) {
              if (e.r < 0.5)
                continue;
              const placeR = Math.max(0, Math.min(baseR * 0.6, minMembraneR - e.r));
              const vcx0 = cx + Math.cos(e.bearing) * placeR;
              const vcy0 = cy + Math.sin(e.bearing) * placeR;
              const [vx, vy] = affineSqueezePoints([[vcx0, vcy0]], squeezeK, squeezePhi, cx, cy, params)[0];
              drawCVVesicle(ctx, vx, vy, e.r, cvH, params);
              drawCVCanals(ctx, vx, vy, e.r, cvH, params);
            }
          }
        }
        if (params.enableCyclosis && (params.cyclosisGranuleCount ?? 0) > 0) {
          const granuleSizePx = params.granuleSizePx ?? 1.3;
          ctx.fillStyle = hsla(baseHue + 25, params.granuleSat ?? 0.6, 0.6, params.nucleusAlpha * 0.6);
          if (params.enableInteriorField) {
            if (!interiorGranules) {
              interiorGranules = seedInteriorGranules(params.cyclosisGranuleCount ?? 0, 0, params);
            }
            const ictx = getInteriorCtx();
            for (let i = 0;i < interiorGranules.length; i++) {
              const g = interiorGranules[i];
              const loop = cyclosisLoopPointAtPhase(g, cyclosisPhase);
              const [gx, gy] = interiorPoint(loop.u, loop.s, ictx);
              ctx.beginPath();
              ctx.arc(gx, gy, granuleSizePx, 0, TAU);
              ctx.fill();
            }
          } else {
            if (!granules)
              granules = seedGranules(baseR, params);
            for (let i = 0;i < granules.length; i++) {
              granules[i] = advectGranule(granules[i], baseR, dt, cyclParams);
              const off = granules[i];
              const maxRad = Math.min((params.granuleMaxRadiusFrac ?? 0.75) * baseR, Math.max(0, minMembraneR - granuleSizePx));
              const rad = Math.hypot(off.x, off.y);
              const scale = rad > maxRad && rad > 0 ? maxRad / rad : 1;
              const [gx, gy] = affineSqueezePoints([[cx + off.x * scale, cy + off.y * scale]], squeezeK, squeezePhi, cx, cy, params)[0];
              ctx.beginPath();
              ctx.arc(gx, gy, granuleSizePx, 0, TAU);
              ctx.fill();
            }
          }
        }
        if (params.enableOrganelles && (params.foodVacuoleCount ?? 0) > 0) {
          const fvSizePx = (params.foodVacuoleSizePx ?? 3) * (params.foodVacuoleSizeMul ?? 1);
          if (params.enableInteriorField) {
            if (!interiorFoodVacuoles) {
              interiorFoodVacuoles = seedInteriorFoodVacuoles(params.foodVacuoleCount ?? 0, params);
            }
            const ictx = getInteriorCtx();
            for (let i = 0;i < interiorFoodVacuoles.length; i++) {
              const fv = interiorFoodVacuoles[i];
              const loopRaw = cyclosisLoopPointAtPhase(fv, cyclosisPhase);
              const fvMaxAmp = params.foodVacuoleLoopMaxAmp ?? 0.82;
              const fvAmp = Math.hypot(loopRaw.u, loopRaw.s);
              const fvScale = fvAmp > fvMaxAmp && fvAmp > 0 ? fvMaxAmp / fvAmp : 1;
              const loop = { u: loopRaw.u * fvScale, s: loopRaw.s * fvScale };
              const size = foodVacuoleSize(t, fv.digestPhase, params);
              const drawR = fvSizePx * (0.4 + 0.6 * size);
              const [fx, fy] = interiorPoint(loop.u, loop.s, ictx);
              drawFoodVacuole(ctx, fx, fy, drawR, fvH, fvSat, params);
            }
          } else {
            if (!foodVacuoles)
              foodVacuoles = seedFoodVacuoles(baseR, params);
            for (let i = 0;i < foodVacuoles.length; i++) {
              foodVacuoles[i] = advectFoodVacuole(foodVacuoles[i], baseR, dt, params);
              const v = foodVacuoles[i];
              const size = foodVacuoleSize(t, v.phase, params);
              const drawR = fvSizePx * (0.4 + 0.6 * size);
              const maxRad = Math.min((params.foodVacuoleMaxRadiusFrac ?? 0.62) * baseR, Math.max(0, minMembraneR - drawR));
              const rad = Math.hypot(v.x, v.y);
              const scale = rad > maxRad && rad > 0 ? maxRad / rad : 1;
              const [fx, fy] = affineSqueezePoints([[cx + v.x * scale, cy + v.y * scale]], squeezeK, squeezePhi, cx, cy, params)[0];
              drawFoodVacuole(ctx, fx, fy, drawR, fvH, fvSat, params);
            }
          }
        }
        ctx.restore();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        const mSat = params.membraneSat ?? 0.85;
        ctx.strokeStyle = hsla(baseHue, mSat * 0.94, effectiveMembraneLightness, 0.9);
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
          ctx.strokeStyle = hsla(hue, mSat, effectiveMembraneLightness, 0.85);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(splinePoints[segStart][0], splinePoints[segStart][1]);
          for (let i = segStart + 1;i < segEnd; i++) {
            ctx.lineTo(splinePoints[i][0], splinePoints[i][1]);
          }
          ctx.stroke();
        }
      }
      if (params.enableHero !== false && euglenaTouchEnv > 0.02) {
        ctx.save();
        ctx.strokeStyle = `hsla(${baseHue + 55}, 35%, 88%, ${0.28 * euglenaTouchEnv})`;
        ctx.lineWidth = 0.7;
        for (let k = 0;k < 5; k++) {
          const a = bodyHeading + Math.PI / 2 + (k - 2) * 0.22;
          const len = 2 + k % 2 * 1;
          ctx.beginPath();
          ctx.moveTo(euglenaTouchX, euglenaTouchY);
          ctx.lineTo(euglenaTouchX + Math.cos(a) * len, euglenaTouchY + Math.sin(a) * len);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (params.enableAquarium && aquarium) {
        const fgFrame = {
          t,
          dt,
          width,
          height,
          mode: s.mode,
          activity,
          audioLevel,
          startle,
          baseHue,
          hero: params.enableHero === false ? undefined : (() => {
            const aspect = Math.sqrt(Math.max(1, params.bodyAspect ?? 1));
            return { x: cx, y: cy, radius: baseR, heading: bodyHeading, halfLen: baseR * aspect, halfWid: baseR / aspect };
          })()
        };
        drawAquariumForeground(ctx, aquarium, fgFrame, params);
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
// src/theme-engine/builtin/didinium_drift/index.ts
function mount(container, api) {
  const userParams = api.params && typeof api.params === "object" ? api.params : {};
  const renderer = createCellRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: 50,
    params: {
      enableHero: false,
      enableAquarium: true,
      aquariumSeed: 5,
      aquariumAlpha: 0.92,
      aquariumActivityBoost: 0.6,
      diatomCount: 0,
      euglenaCount: 0,
      vorticellaCount: 0,
      didiniumCount: 1,
      didiniumSpeed: 0.9,
      didiniumSpeedActive: 1.6,
      didiniumScale: 2.7,
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
