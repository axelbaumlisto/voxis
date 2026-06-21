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
  vorticellaCount: 0,
  vorticellaContractRate: 1,
  vorticellaContractRateActive: 2,
  vorticellaScale: 1,
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
// src/theme-engine/renderers/cell/aquarium/params.ts
function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function nonNegativeInt(value, fallback) {
  return Math.max(0, Math.floor(finiteOr(value, fallback)));
}
function nonNegative(value, fallback) {
  return Math.max(0, finiteOr(value, fallback));
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
      scale: nonNegative(params.euglenaScale, 1)
    },
    vorticella: {
      count: nonNegativeInt(params.vorticellaCount, 0),
      contractRate: nonNegative(params.vorticellaContractRate, 1),
      contractRateActive: nonNegative(params.vorticellaContractRateActive, 2),
      scale: nonNegative(params.vorticellaScale, 1)
    }
  };
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

// src/theme-engine/renderers/cell/aquarium/diatoms.ts
function finiteOr2(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function positive(value, fallback) {
  return Math.max(0.001, finiteOr2(value, fallback));
}
var TAU2 = Math.PI * 2;
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
  const cx = finiteOr2(options.centerX, 0);
  const cy = finiteOr2(options.centerY, 0);
  const length = positive(options.length, shape === "navicula" ? 7 : 5);
  const width = positive(options.width, shape === "navicula" ? length * 0.32 : length * 0.62);
  const heading = finiteOr2(options.heading, 0);
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
function finiteOr3(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function finite2(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function positive2(value, fallback) {
  return Math.max(0.001, finiteOr3(value, fallback));
}
var TAU3 = Math.PI * 2;
var METABOLY_AMP = 0.045;
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
function wrapUnit(value) {
  if (!Number.isFinite(value))
    return 0;
  return (value % 1 + 1) % 1;
}
function wrap2(value, max) {
  if (!(max > 0))
    return 0;
  const wrapped = value % max;
  return wrapped < 0 ? wrapped + max : wrapped;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function clamp01(value) {
  return Math.max(0, Math.min(1, finite2(value, 0)));
}
function point(cx, cy, ux, uy, along) {
  return { x: cx + ux * along, y: cy + uy * along };
}
function transform2(cx, cy, ux, uy, along, lateral) {
  const nx = -uy;
  const ny = ux;
  return { x: cx + ux * along + nx * lateral, y: cy + uy * along + ny * lateral };
}
function euglenaPose(rollPhase, metabolyPhase, options = {}) {
  const cx = finiteOr3(options.centerX, 0);
  const cy = finiteOr3(options.centerY, 0);
  const length = positive2(options.length, 8);
  const baseWidth = positive2(options.baseWidth, length * 0.28);
  const heading = finiteOr3(options.heading, 0);
  const flagellumLength = positive2(options.flagellumLength, length * 0.45);
  const stripeCount = Math.max(1, Math.floor(finiteOr3(options.stripeCount, 6)));
  const roll = wrapUnit(rollPhase);
  const metaboly = wrapUnit(metabolyPhase);
  const flagellum = wrapUnit(options.flagellumPhase ?? roll * 1.7);
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const lengthScale = 1 + METABOLY_AMP * Math.sin(metaboly * TAU3);
  const widthScale = 1 / lengthScale;
  const halfLength = length * lengthScale / 2;
  const rollCos = Math.cos(roll * TAU3);
  const apparentWidth = baseWidth * widthScale * (0.72 + 0.28 * Math.abs(rollCos));
  const stripePhase = wrapUnit(roll * stripeCount + metaboly * 0.18);
  const anterior = point(cx, cy, ux, uy, halfLength);
  const posterior = point(cx, cy, ux, uy, -halfLength);
  const eyespot = point(cx, cy, ux, uy, halfLength - length * 0.08);
  const flagellumPoints = [eyespot];
  const waveAmp = Math.min(1.25, Math.max(0.35, apparentWidth * 0.34));
  for (let i = 1;i <= 4; i++) {
    const q = i / 4;
    const along = halfLength - length * 0.08 + flagellumLength * q;
    const taper = 1 - q * 0.35;
    const lateral = Math.sin(flagellum * TAU3 + q * Math.PI * 1.35) * waveAmp * taper;
    flagellumPoints.push(transform2(cx, cy, ux, uy, along, lateral));
  }
  const flagellumEnd = flagellumPoints[flagellumPoints.length - 1];
  const bodySamples = [-1, -0.5, 0, 0.5, 1].map((u) => {
    const taper = Math.max(0, 1 - u * u);
    const anteriorTaper = 1 - 0.12 * Math.max(0, u);
    return { u, halfWidth: apparentWidth / 2 * Math.sqrt(taper) * anteriorTaper };
  });
  return {
    center: { x: cx, y: cy },
    anterior,
    posterior,
    eyespot,
    flagellumEnd,
    flagellumPoints,
    apparentWidth,
    stripePhase,
    bodySamples
  };
}
function seedEuglena(count, seed, frame, salt = 235478698) {
  if (count <= 0)
    return [];
  const euglena = [];
  const safeWidth = Math.max(0, finite2(frame.width, 0));
  const safeHeight = Math.max(0, finite2(frame.height, 0));
  for (let i = 0;i < count; i++) {
    const heading = seededUnit(seed, i, salt ^ 1757159915) * TAU3;
    euglena.push({
      x: seededUnit(seed, i, salt) * safeWidth,
      y: seededUnit(seed, i, salt ^ 1374496523) * safeHeight,
      phase: heading,
      size: 0.5 + seededUnit(seed, i, salt ^ 48610963),
      heading,
      swimSpeed: 0.55 + seededUnit(seed, i, salt ^ 802853537) * 0.75,
      rollPhase: seededUnit(seed, i, salt ^ 1107813911),
      metabolyPhase: seededUnit(seed, i, salt ^ 972076277),
      flagellumPhase: seededUnit(seed, i, salt ^ 668265263),
      rollRate: 0.18 + seededUnit(seed, i, salt ^ 348696353) * 0.12,
      metabolyRate: 0.028 + seededUnit(seed, i, salt ^ 1002986003) * 0.024,
      flagellumRate: 1.05 + seededUnit(seed, i, salt ^ 1966046297) * 0.55,
      spiralAmplitude: 0.28 + seededUnit(seed, i, salt ^ 1638598935) * 0.34
    });
  }
  return euglena;
}
function updateEuglena(euglena, frame, view) {
  if (euglena.length === 0)
    return euglena;
  const dt = Math.max(0, finite2(frame.dt, 0));
  const safeWidth = Math.max(0, finite2(frame.width, 0));
  const safeHeight = Math.max(0, finite2(frame.height, 0));
  const activityMix = clamp01(finite2(frame.activity, 0) * finite2(view.activityBoost, 0));
  const idleRate = Math.max(0, finite2(view.euglena.speed, 0));
  const activeRate = Math.max(0, finite2(view.euglena.speedActive, idleRate));
  const activityRate = idleRate + (activeRate - idleRate) * activityMix;
  const modeView = euglenaModeView(frame.mode);
  const rate = activityRate * modeView.motionMul;
  return euglena.map((cell) => {
    const rollRate = Math.max(0, finite2(cell.rollRate, 0)) * rate;
    const rollDelta = rollRate * dt;
    const oldRoll = wrapUnit(cell.rollPhase);
    const nextRoll = wrapUnit(oldRoll + rollDelta);
    const heading = finite2(cell.heading, 0);
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const nx = -uy;
    const ny = ux;
    const swim = Math.max(0, finite2(cell.swimSpeed, 0)) * rate;
    const lateralDelta = rollDelta === 0 ? 0 : finite2(cell.spiralAmplitude, 0) * (Math.cos(oldRoll * TAU3) - Math.cos((oldRoll + rollDelta) * TAU3)) / TAU3;
    let nextX = finite2(cell.x, 0) + ux * swim * dt + nx * lateralDelta;
    let nextY = finite2(cell.y, 0) + uy * swim * dt + ny * lateralDelta;
    if (frame.hero) {
      const hx = finite2(frame.hero.x, safeWidth / 2);
      const hy = finite2(frame.hero.y, safeHeight / 2);
      const exclusion = Math.max(0, finite2(frame.hero.radius, 0)) * 2.2;
      const dx = nextX - hx;
      const dy = nextY - hy;
      const dist = Math.hypot(dx, dy);
      if (dist < exclusion && exclusion > 0) {
        const angle = dist > 0.000001 ? Math.atan2(dy, dx) : heading;
        const penetration = exclusion - dist;
        const repelSpeed = Math.max(10, finite2(frame.hero.radius, 0) * 2.4);
        const step = Math.min(penetration, repelSpeed * dt);
        nextX += Math.cos(angle) * step;
        nextY += Math.sin(angle) * step;
      }
    }
    return {
      ...cell,
      x: clamp(wrap2(nextX, safeWidth), 0, safeWidth),
      y: clamp(wrap2(nextY, safeHeight), 0, safeHeight),
      phase: heading,
      rollPhase: nextRoll,
      metabolyPhase: wrapUnit(cell.metabolyPhase + Math.max(0, finite2(cell.metabolyRate, 0)) * rate * dt),
      flagellumPhase: wrapUnit(cell.flagellumPhase + Math.max(0, finite2(cell.flagellumRate, 0)) * rate * dt)
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
function euglenaBodyOutline(pose, heading) {
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const halfLength = Math.hypot(pose.anterior.x - pose.center.x, pose.anterior.y - pose.center.y);
  const upper = [];
  const lower = [];
  for (let i = 0;i <= 10; i++) {
    const u = -1 + i / 10 * 2;
    const sampleTaper = Math.max(0, 1 - u * u);
    const anteriorTaper = 1 - 0.12 * Math.max(0, u);
    const halfWidth = pose.apparentWidth / 2 * Math.sqrt(sampleTaper) * anteriorTaper;
    upper.push(transform2(pose.center.x, pose.center.y, ux, uy, halfLength * u, halfWidth));
    lower.push(transform2(pose.center.x, pose.center.y, ux, uy, halfLength * u, -halfWidth));
  }
  return [...upper, ...lower.reverse()];
}
function drawEuglena(ctx, euglena, frame, view) {
  if (!view.enabled || euglena.length === 0 || view.euglena.count <= 0)
    return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.72 * euglenaModeView(frame.mode).alphaMul));
  if (alpha <= 0)
    return;
  const scale = Math.max(0.1, finite2(view.euglena.scale, 1));
  const hue = finite2(frame.baseHue, 50) + 42;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const cell of euglena) {
    const length = Math.max(5, Math.min(16 * scale, (7.2 + finite2(cell.size, 1) * 1.6) * scale));
    const width = Math.max(1.4, Math.min(7.2 * scale, length * 0.45));
    const flagellumLength = Math.max(2.2, Math.min(7.5 * scale, length * 0.55));
    const heading = finite2(cell.heading, 0);
    const pose = euglenaPose(cell.rollPhase, cell.metabolyPhase, {
      centerX: finite2(cell.x, 0),
      centerY: finite2(cell.y, 0),
      length,
      baseWidth: width,
      heading,
      flagellumLength,
      flagellumPhase: cell.flagellumPhase,
      stripeCount: 5
    });
    const outline = euglenaBodyOutline(pose, heading);
    const detailCount = length >= 9 ? 3 : length >= 7 ? 2 : 0;
    drawPolyline2(ctx, outline, true);
    ctx.fillStyle = `hsla(${hue}, 24%, 48%, ${alpha * 0.34})`;
    ctx.strokeStyle = `hsla(${hue + 8}, 22%, 66%, ${alpha * 0.55})`;
    ctx.lineWidth = Math.max(0.48, Math.min(0.9, width * 0.12));
    ctx.fill();
    ctx.stroke();
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    if (detailCount > 0) {
      ctx.fillStyle = `hsla(${hue - 12}, 30%, 42%, ${alpha * 0.34})`;
      for (let i = 0;i < detailCount; i++) {
        const q = i / (detailCount - 1);
        const along = length * (-0.17 + q * 0.34);
        const lateralSign = i % 2 === 0 ? 1 : -1;
        const p = transform2(pose.center.x, pose.center.y, ux, uy, along, width * 0.13 * lateralSign);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 0.5, 0.3, heading, 0, TAU3);
        ctx.fill();
      }
      const stripeAlpha = alpha * 0.3;
      ctx.strokeStyle = `hsla(${hue - 8}, 24%, 36%, ${stripeAlpha})`;
      ctx.lineWidth = Math.max(0.24, Math.min(0.55, width * 0.08));
      for (let i = 0;i < detailCount; i++) {
        const q = i / (detailCount - 1);
        const bandOffset = -0.16 + q * 0.32;
        const along = length * (bandOffset + (pose.stripePhase - 0.5) * 0.08);
        const band = [
          transform2(pose.center.x, pose.center.y, ux, uy, along - length * 0.16, -width * 0.18),
          transform2(pose.center.x, pose.center.y, ux, uy, along + length * 0.16, width * 0.18)
        ];
        drawPolyline2(ctx, band, false);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = `hsla(${hue + 10}, 18%, 70%, ${alpha * 0.48})`;
    ctx.lineWidth = Math.max(0.34, Math.min(0.65, width * 0.08));
    drawPolyline2(ctx, pose.flagellumPoints, false);
    ctx.stroke();
    if (length >= 7) {
      const reservoir = transform2(pose.center.x, pose.center.y, ux, uy, length * 0.33, -width * 0.11);
      ctx.fillStyle = `hsla(175, 22%, 80%, ${alpha * 0.46})`;
      ctx.beginPath();
      ctx.arc(reservoir.x, reservoir.y, Math.min(0.8, Math.max(0.34, width * 0.18)), 0, TAU3);
      ctx.fill();
    }
    ctx.fillStyle = `hsla(20, 48%, 50%, ${alpha * 0.78})`;
    ctx.beginPath();
    ctx.arc(pose.eyespot.x, pose.eyespot.y, Math.min(1, Math.max(0.45, width * 0.22)), 0, TAU3);
    ctx.fill();
  }
  ctx.restore();
}

// src/theme-engine/renderers/cell/aquarium/vorticella.ts
function finiteOr4(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function finite3(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function clamp012(value) {
  if (!Number.isFinite(value))
    return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
function wrapUnit2(value) {
  if (!Number.isFinite(value))
    return 0;
  return (value % 1 + 1) % 1;
}
var TAU4 = Math.PI * 2;
var CONTRACT_FRACTION = 0.16;
function vorticellaContractPhase(cyclePhase) {
  const phase = wrapUnit2(cyclePhase);
  if (phase < CONTRACT_FRACTION) {
    const q2 = phase / CONTRACT_FRACTION;
    return 1 - Math.pow(1 - q2, 3);
  }
  const q = (phase - CONTRACT_FRACTION) / (1 - CONTRACT_FRACTION);
  return Math.pow(1 - q, 2);
}
function vorticellaGeometry(contractPhase, options = {}) {
  const phase = clamp012(contractPhase);
  const anchorX = finiteOr4(options.anchorX, 0);
  const anchorY = finiteOr4(options.anchorY, 0);
  const restLength = Math.max(0.001, finiteOr4(options.restLength, 10));
  const minLengthFrac = Math.min(1, Math.max(0.12, finiteOr4(options.minLengthFrac, 0.32)));
  const angle = finiteOr4(options.directionAngle, Math.PI / 2);
  const coilTurnsRest = Math.max(0, finiteOr4(options.coilTurnsRest, 0.15));
  const coilTurnsContracted = Math.max(coilTurnsRest, finiteOr4(options.coilTurnsContracted, 3.2));
  const sampleCount = Math.max(2, Math.floor(finiteOr4(options.coilSampleCount, 16)));
  const stalkLength = restLength * (1 - phase * (1 - minLengthFrac));
  const coilTurns = coilTurnsRest + (coilTurnsContracted - coilTurnsRest) * phase;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const nx = -uy;
  const ny = ux;
  const coilAmplitude = restLength * 0.035 * phase;
  const stalkPath = [];
  for (let i = 0;i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    const along = stalkLength * t;
    const wave = Math.sin(t * coilTurns * TAU4) * coilAmplitude;
    stalkPath.push({
      x: anchorX + ux * along + nx * wave,
      y: anchorY + uy * along + ny * wave
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
function seedVorticella(count, seed, frame, salt = 117600714) {
  if (count <= 0)
    return [];
  const vorticella = [];
  const safeWidth = Math.max(0, finite3(frame.width, 0));
  const safeHeight = Math.max(0, finite3(frame.height, 0));
  for (let i = 0;i < count; i++) {
    const side = Math.floor(seededUnit(seed, i, salt ^ 523543229) * 4) % 4;
    const along = seededUnit(seed, i, salt ^ 1164169887);
    const inset = 0.5;
    let anchorX = along * safeWidth;
    let anchorY = inset;
    let directionAngle = Math.PI / 2;
    if (side === 1) {
      anchorX = safeWidth - inset;
      anchorY = along * safeHeight;
      directionAngle = Math.PI;
    } else if (side === 2) {
      anchorX = along * safeWidth;
      anchorY = safeHeight - inset;
      directionAngle = -Math.PI / 2;
    } else if (side === 3) {
      anchorX = inset;
      anchorY = along * safeHeight;
      directionAngle = 0;
    }
    const restLength = Math.max(5.5, Math.min(12, (7.5 + seededUnit(seed, i, salt ^ 48610963) * 3.5) * Math.min(1, safeHeight / 36)));
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
      contractRate: 0.055 + seededUnit(seed, i, salt ^ 802853537) * 0.06,
      oralRate: 0.42 + seededUnit(seed, i, salt ^ 348696353) * 0.18
    });
  }
  return vorticella;
}
function updateVorticella(vorticella, frame, view) {
  if (vorticella.length === 0)
    return vorticella;
  const dt = Math.max(0, finite3(frame.dt, 0));
  const activityMix = clamp012(finite3(frame.activity, 0) * finite3(view.activityBoost, 0));
  const idleRate = Math.max(0, finite3(view.vorticella.contractRate, 0));
  const activeRate = Math.max(0, finite3(view.vorticella.contractRateActive, idleRate));
  const rate = idleRate + (activeRate - idleRate) * activityMix;
  const modeMul = frame.mode === "recording" ? 1.18 : frame.mode === "transcribing" ? 0.35 : frame.mode === "error" ? 0.15 : 1;
  const startleBoost = 1 + Math.min(0.35, Math.max(0, finite3(frame.startle, 0)) * 0.35);
  const cycleRateMul = Math.min(1.45, rate * modeMul * startleBoost);
  const oralRateMul = frame.mode === "error" ? 0.2 : frame.mode === "transcribing" ? 0.45 : 1 + activityMix * 0.18;
  return vorticella.map((cell) => {
    const cyclePhase = wrapUnit2(cell.contractCyclePhase + Math.max(0, finite3(cell.contractRate, 0)) * cycleRateMul * dt);
    return {
      ...cell,
      x: cell.anchorX,
      y: cell.anchorY,
      phase: cyclePhase,
      contractCyclePhase: cyclePhase,
      contractPhase: vorticellaContractPhase(cyclePhase),
      oralWreathPhase: wrapUnit2(cell.oralWreathPhase + Math.max(0, finite3(cell.oralRate, 0)) * oralRateMul * dt)
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
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.62));
  if (alpha <= 0)
    return;
  const scale = Math.max(0.1, finite3(view.vorticella.scale, 1));
  const hue = finite3(frame.baseHue, 50) + 110;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const cell of vorticella) {
    const bellRadius = Math.max(2.4, Math.min(6.2, (3.8 + finite3(cell.size, 1) * 1.4) * scale));
    const restLength = Math.max(5.5, Math.min(12, finite3(cell.restLength, 9) * scale));
    const geometry = vorticellaGeometry(cell.contractPhase, {
      anchorX: finite3(cell.anchorX, 0),
      anchorY: finite3(cell.anchorY, 0),
      restLength,
      directionAngle: finite3(cell.directionAngle, Math.PI / 2),
      minLengthFrac: 0.26,
      coilSampleCount: 14
    });
    const ux = Math.cos(cell.directionAngle);
    const uy = Math.sin(cell.directionAngle);
    const nx = -uy;
    const ny = ux;
    const bellCx = geometry.bellCenter.x;
    const bellCy = geometry.bellCenter.y;
    const cupDepth = bellRadius * 0.88;
    const cupWidth = bellRadius * (1.18 - cell.contractPhase * 0.18);
    const cup = [
      { x: bellCx + nx * -cupWidth * 0.72 - ux * cupDepth * 0.3, y: bellCy + ny * -cupWidth * 0.72 - uy * cupDepth * 0.3 },
      { x: bellCx + nx * -cupWidth * 0.38 + ux * cupDepth * 0.42, y: bellCy + ny * -cupWidth * 0.38 + uy * cupDepth * 0.42 },
      { x: bellCx + ux * cupDepth * 0.64, y: bellCy + uy * cupDepth * 0.64 },
      { x: bellCx + nx * cupWidth * 0.38 + ux * cupDepth * 0.42, y: bellCy + ny * cupWidth * 0.38 + uy * cupDepth * 0.42 },
      { x: bellCx + nx * cupWidth * 0.72 - ux * cupDepth * 0.3, y: bellCy + ny * cupWidth * 0.72 - uy * cupDepth * 0.3 }
    ];
    drawPolyline3(ctx, geometry.stalkPath, false);
    ctx.strokeStyle = `hsla(${hue}, 20%, 72%, ${alpha * 0.46})`;
    ctx.lineWidth = 0.44;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(geometry.anchor.x, geometry.anchor.y, 0.65, 0, TAU4);
    ctx.fillStyle = `hsla(${hue - 12}, 14%, 74%, ${alpha * 0.35})`;
    ctx.fill();
    drawPolyline3(ctx, cup, true);
    ctx.fillStyle = `hsla(${hue}, 18%, 70%, ${alpha * 0.12})`;
    ctx.strokeStyle = `hsla(${hue + 8}, 22%, 78%, ${alpha * 0.42})`;
    ctx.lineWidth = 0.48;
    ctx.fill();
    ctx.stroke();
    const mouthX = bellCx - ux * cupDepth * 0.3;
    const mouthY = bellCy - uy * cupDepth * 0.3;
    ctx.beginPath();
    ctx.ellipse(mouthX, mouthY, cupWidth * 0.78, Math.max(0.55, bellRadius * 0.28), cell.directionAngle, 0, TAU4);
    ctx.strokeStyle = `hsla(${hue + 18}, 18%, 82%, ${alpha * 0.52})`;
    ctx.lineWidth = 0.36;
    ctx.stroke();
    ctx.strokeStyle = `hsla(${hue + 20}, 18%, 84%, ${alpha * 0.38})`;
    ctx.lineWidth = 0.24;
    for (let i = 0;i < 7; i++) {
      const q = (i / 7 + cell.oralWreathPhase) % 1;
      const lateral = (q - 0.5) * cupWidth * 1.35;
      const beat = Math.sin((q + cell.oralWreathPhase) * TAU4) * bellRadius * 0.12;
      const base = { x: mouthX + nx * lateral, y: mouthY + ny * lateral };
      const tip = { x: base.x - ux * (0.85 + beat), y: base.y - uy * (0.85 + beat) };
      drawPolyline3(ctx, [base, tip], false);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// src/theme-engine/renderers/cell/aquarium/layer.ts
function seedAquarium(frame, params) {
  const view = aquariumParamsView(params);
  const seed = view.seed | 0;
  return {
    seed,
    diatoms: seedDiatoms(view.diatoms.count, seed, frame),
    euglena: seedEuglena(view.euglena.count, seed, frame),
    vorticella: seedVorticella(view.vorticella.count, seed, frame)
  };
}
function updateAquarium(aquarium, frame, params) {
  const view = aquariumParamsView(params);
  if (!view.enabled)
    return aquarium;
  const diatoms = view.diatoms.count > 0 ? updateDiatoms(aquarium.diatoms, frame, view) : aquarium.diatoms;
  const euglena = view.euglena.count > 0 ? updateEuglena(aquarium.euglena, frame, view) : aquarium.euglena;
  const vorticella = view.vorticella.count > 0 ? updateVorticella(aquarium.vorticella, frame, view) : aquarium.vorticella;
  return diatoms === aquarium.diatoms && euglena === aquarium.euglena && vorticella === aquarium.vorticella ? aquarium : { ...aquarium, diatoms, euglena, vorticella };
}
function drawAquariumBackground(ctx, aquarium, frame, params) {
  const view = aquariumParamsView(params);
  if (!view.enabled)
    return;
  drawDiatoms(ctx, aquarium.diatoms, frame, view);
  drawEuglena(ctx, aquarium.euglena, frame, view);
  drawVorticella(ctx, aquarium.vorticella, frame, view);
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
      let baseSwim = params.enableActivity ? swimSpeed(activity, width, height, params) : undefined;
      if (baseSwim !== undefined && params.idleSwimFrac) {
        const maxSwim = (params.swimSpeedMaxFrac ?? 0.06) * Math.min(width, height);
        baseSwim = Math.max(params.idleSwimFrac * maxSwim, baseSwim);
      }
      const burst = useKick ? startleBurstSpeed(startle, baseR, params) : 0;
      const swimPx = baseSwim !== undefined ? baseSwim + burst : burst > 0 ? burst : undefined;
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
          hero: { x: cx, y: cy, radius: baseR }
        };
        aquarium = aquarium ?? seedAquarium(aquariumFrame, params);
        aquarium = updateAquarium(aquarium, aquariumFrame, params);
        drawAquariumBackground(ctx, aquarium, aquariumFrame, params);
      }
      const contourPoints = affineSqueezePoints(smoothedPoints, squeezeK, squeezePhi, cx, cy, params);
      const splinePoints = catmullRom(contourPoints, 4);
      if (splinePoints.length >= 3) {
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
    baseHue: 50,
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
      hueSpread: 8,
      shimmerSpeed: 0.04,
      hueBoost: 4,
      fillAlpha: 0.12,
      fillAlphaActive: 0.45,
      membraneSat: 0.12,
      membraneLightness: 0.75,
      membraneLightnessActive: 0.88,
      cytoplasmSat: 0.1,
      ciliaSat: 0.08,
      granuleSat: 0.1,
      nucleusSatMul: 0.25,
      foodVacuoleHue: 38,
      cvHue: 170,
      vacuoleMaxFrac: 0.13,
      cvAnteriorS: 0.52,
      cvPosteriorS: 0.52,
      tension: 0.15,
      ciliaCount: 18,
      ciliaLength: 0.4,
      ciliaWave: 0.5,
      ciliaWaveSpeed: 1.6,
      growthAttack: 0.05,
      growthRelease: 0.012,
      baseRadiusPx: 17,
      driftSpeed: 0.08,
      idleSwimFrac: 0.3,
      bodyHeadingTau: 1.5,
      interiorHeadingTau: 5,
      idleDriftMin: 0.7,
      driftMargin: 30,
      idleMorphAmplitude: 0.16,
      idleMorphSpeed: 0.22,
      idleMorphPeriod: 7,
      idleMorphFloor: 0.3,
      growthSwell: 0,
      swimSpeedMaxFrac: 0.045,
      startleSensitivity: 2.8,
      startleDecay: 0.96,
      startleMaxPx: 5,
      startleBaselineRate: 0.08,
      enableSomaticCilia: true,
      somaticCiliaCount: 104,
      ciliaGrowthBoost: 0,
      ciliaCurl: 0.32,
      ciliaLengthVar: 0.35,
      enableCiliaOnContour: true,
      enableRigidMembrane: true,
      enableBodyProfile: true,
      bodyProfileType: "egg",
      bodyProfileTaper: 0.2,
      bodyAspect: 3,
      bodyVentralBend: 0.18,
      enableAffine: true,
      enableCiliaStructure: true,
      enableAxialSpin: true,
      axialSpinMax: 1,
      nucleusAlpha: 0.85,
      enableVacuoles: true,
      enableCVCanals: true,
      canalLenMul: 2.5,
      canalLineWidth: 1,
      canalAlphaMul: 0.25,
      enableOralGroove: true,
      oralGrooveDepth: 0.08,
      oralGrooveWidth: 0.8,
      cyclosisActivityBoost: 0.4,
      enableEctoplasm: true,
      ectoplasmFrac: 0.93,
      ectoplasmAlpha: 0.22,
      helicalAmplitude: 0.3,
      enableWallReorient: true,
      enableRotationalBrownian: true,
      rotationalDiffusion: 0.02,
      foodVacuoleSizeMul: 1.4,
      foodVacuoleLoopMaxAmp: 0.78,
      enableTrichocysts: false,
      trichocystCount: 30,
      trichocystLengthMul: 3,
      trichocystDecay: 3,
      trichocystLineWidth: 1.5,
      enableMetachronal: true,
      metachronalWavelength: 20,
      metachronalSpeed: 1.5,
      metachronalDepth: 0.35,
      ciliaBeatHz: 0.5,
      ciliaBeatHzActive: 0.9,
      caudalTuftLength: 1.2,
      nucleusIndent: 0.3,
      foodVacuoleSat: 0.25,
      enableCyclosis: true,
      cyclosisGranuleCount: 40,
      granuleSizePx: 1.6,
      enableOrganelles: true,
      foodVacuoleCount: 8,
      enableInteriorField: true,
      cyclosisPeriod: 65,
      enableAquarium: true,
      aquariumSeed: 5,
      aquariumAlpha: 0.68,
      aquariumActivityBoost: 0.25,
      diatomCount: 0,
      diatomAlpha: 0.16,
      diatomDriftSpeed: 0.35,
      euglenaCount: 1,
      euglenaSpeed: 0.75,
      euglenaSpeedActive: 1,
      euglenaScale: 2.15,
      vorticellaCount: 0,
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
