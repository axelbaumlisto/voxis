import { describe, expect, it } from "vitest";
import { PARAMECIUM_CELL_PARAMS } from "../../../../builtin/_shared/paramecium";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { sourceId } from "../interaction";
import { euglenaDisplayLength, euglenaPose } from "../euglena";
import { vorticellaBellMetrics, vorticellaGeometry } from "../vorticella-parts/geometry";
import { buildAquariumInteractionField, seedAquarium, updateAquarium } from "../layer";
import type { AquariumFrame, EuglenaState, VorticellaState } from "../types";

const TAU = Math.PI * 2;
type EuglenaMotorPhase = "run" | "photoCheck" | "commitTurn" | "recover";
type MotorEuglenaState = EuglenaState & {
  readonly motorPhase?: EuglenaMotorPhase;
  readonly turnFrom?: number;
  readonly turnTo?: number;
  readonly photoTargetIndex?: number;
  readonly photoTargetAge?: number;
};

interface TrioSample {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly speed: number;
  readonly phase?: EuglenaMotorPhase;
  readonly turnFrom?: number;
  readonly turnTo?: number;
  readonly photoTargetIndex?: number;
  readonly photoTargetAge?: number;
  readonly heroDistance: number;
  readonly heroBearing: number;
  readonly heroQ: number;
  readonly heroBodyQ: number;
  readonly visualMinX: number;
  readonly visualMaxX: number;
  readonly visualMinY: number;
  readonly visualMaxY: number;
  readonly visualFinite: boolean;
  readonly vorticellaBearing: number;
  readonly vorticellaBodyQ: number;
  readonly vorticellaGeometryDistance: number;
  readonly vorticellaAnchorX: number;
  readonly vorticellaAnchorY: number;
}

function driftingContourParams(): CellParams {
  return {
    ...CELL_DEFAULTS,
    ...PARAMECIUM_CELL_PARAMS,
    enableAquarium: true,
    aquariumSeed: 2,
    aquariumAlpha: 0.68,
    aquariumActivityBoost: 1.0,
    diatomCount: 0,
    diatomAlpha: 0.16,
    diatomDriftSpeed: 0.35,
    euglenaCount: 1,
    euglenaSpeed: 0.25,
    euglenaSpeedActive: 0.5,
    euglenaScale: 2.4,
    euglenaFlagellumRateScale: 0.45,
    euglenaGravitaxis: 0.01,
    euglenaPhototaxis: 0,
    euglenaPhotoIntent: 0.55,
    euglenaMotorEnabled: true,
    euglenaLoiter: 0,
    euglenaWake: 0,
    euglenaRotDiffusion: 0,
    vorticellaCount: 1,
    vorticellaScale: 2.6,
    vorticellaAlongFrac: 0.35,
    vorticellaContractRate: 1.2,
  };
}

function frame(overrides: Partial<AquariumFrame> = {}): AquariumFrame {
  return {
    t: 0,
    dt: 1 / 60,
    width: 320,
    height: 160,
    mode: "recording",
    activity: 0.4,
    audioLevel: 0.4,
    startle: 0,
    baseHue: 50,
    hero: {
      x: 160,
      y: 80,
      radius: 17,
      heading: 0.28,
      halfLen: 17 * Math.sqrt(3),
      halfWid: 17 / Math.sqrt(3),
    },
    ...overrides,
  };
}

function wrapUnit(value: number): number {
  return ((value % 1) + 1) % 1;
}

function wrapPi(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function metabolyEnvelope(burstPhase: number): number {
  const p = wrapUnit(burstPhase);
  if (p < 0.6) return 0;
  return Math.sin(((p - 0.6) / 0.4) * Math.PI);
}

function heroQ(x: number, y: number, margin: number): number {
  const hero = frame().hero!;
  const heading = hero.heading ?? 0;
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  const dx = x - hero.x;
  const dy = y - hero.y;
  const localX = dx * ch + dy * sh;
  const localY = -dx * sh + dy * ch;
  const a = (hero.halfLen ?? hero.radius) + margin;
  const b = (hero.halfWid ?? hero.radius) + margin;
  return Math.sqrt((localX * localX) / (a * a) + (localY * localY) / (b * b));
}

function euglenaRenderedVisual(cell: EuglenaState, scale: number, width: number, height: number): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  finite: boolean;
  outline: readonly { x: number; y: number }[];
  allPoints: readonly { x: number; y: number }[];
  minBodyHeroQ: number;
} {
  const turnProgress = Number.isFinite(cell.turnProgress) ? cell.turnProgress! : 2;
  const turnShrink = turnProgress < 1 ? 0.5 + 0.5 * Math.abs(Math.cos(turnProgress * Math.PI)) : 1;
  const fullLength = euglenaDisplayLength(cell.size, scale);
  const length = fullLength * turnShrink;
  const bodyWidth = fullLength * 0.22 * (1 + 0.9 * (1 - turnShrink));
  const heading = cell.heading;
  const roll = wrapUnit(cell.rollPhase);
  const apparentW = bodyWidth * (0.85 + 0.15 * Math.abs(Math.cos(roll * TAU)));
  const lmax = Math.max(0, 0.4 * height - apparentW / 2);
  const aFit = Math.min((cell.spiralAmplitude ?? 0.15) * length, 0.9 * lmax);
  const lateral = lmax > 0 ? lmax * Math.tanh((aFit * Math.sin(roll * TAU + heading)) / lmax) : 0;
  const cx = cell.x - Math.sin(heading) * lateral;
  const cy = cell.y + Math.cos(heading) * lateral;
  const burstPhase = wrapUnit(cell.burstPhase ?? 0);
  const flick = burstPhase < 0.08 ? Math.sin((burstPhase / 0.08) * Math.PI) : 0;
  const vigour = 0.80
    + 0.12 * Math.sin(TAU * burstPhase + heading)
    + 0.08 * Math.sin(TAU * burstPhase * 2.7 + heading * 1.7)
    + 0.30 * flick;
  const ampTip = clamp(length * 0.22, 2, 0.40 * height) * vigour;
  const pose = euglenaPose(cell.rollPhase, cell.metabolyPhase, {
    centerX: cx,
    centerY: cy,
    length,
    baseWidth: bodyWidth,
    heading,
    flagellumLength: length * 0.95,
    flagellumPhase: cell.flagellumPhase,
    flagellumAmp: ampTip,
    maxFlagellumLateral: 0.40 * height,
    flagellumSegments: clamp(Math.round(length / 3), 10, 24),
    flagellumWaves: 1.5,
    metabolyEnvelope: metabolyEnvelope(cell.burstPhase ?? 0),
  });
  const allPoints = [...pose.outline, ...pose.flagellumPoints];
  return {
    minX: Math.min(...allPoints.map((p) => p.x)),
    maxX: Math.max(...allPoints.map((p) => p.x)),
    minY: Math.min(...allPoints.map((p) => p.y)),
    maxY: Math.max(...allPoints.map((p) => p.y)),
    finite: allPoints.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    outline: pose.outline,
    allPoints,
    minBodyHeroQ: Math.min(...pose.outline.map((p) => heroQ(p.x, p.y, 0))),
  };
}

function vorticellaRenderedGeometry(cell: VorticellaState, scale: number, height: number): {
  centerX: number;
  centerY: number;
  radius: number;
  points: readonly { x: number; y: number }[];
} {
  const s = clamp(cell.contractPhase, 0, 1);
  const attach = clamp(cell.attach ?? 1, 0, 1);
  const sway = 0.07 * (1 - 0.8 * s) * attach * Math.sin(TAU * wrapUnit(cell.swayPhase ?? 0));
  const dir = cell.directionAngle + sway;
  const ux = Math.cos(dir);
  const uy = Math.sin(dir);
  const nx = -uy;
  const ny = ux;
  const { D, bellHeight, restStalk } = vorticellaBellMetrics(cell, scale, height);
  const drawBellH = bellHeight * (1 - 0.25 * s);
  const geom = vorticellaGeometry(s, {
    anchorX: cell.anchorX,
    anchorY: cell.anchorY,
    restLength: restStalk * attach,
    directionAngle: dir,
    minLengthFrac: 0.32,
    coilSampleCount: 40,
    coilTurnsContracted: 6.5,
    coilRadius: D * 0.4,
  });
  const neck = geom.bellCenter;
  const open = 1 - 0.7 * s;
  const halfW = (u: number): number => {
    const um = 0.66;
    const w0 = 0.16 + 0.34 * s;
    const wMax = 0.66;
    const wRim = 0.42;
    const base = u <= um
      ? w0 + (wMax - w0) * Math.pow(smoothstep(u / um), 0.6)
      : wMax - (wMax - wRim) * smoothstep((u - um) / (1 - um));
    const lipGate = 1 - (1 - (0.55 + 0.45 * open)) * smoothstep((u - 0.82) / 0.18);
    return D * base * lipGate;
  };
  const points = [...geom.stalkPath];
  for (let i = 0; i <= 32; i++) {
    const u = i / 32;
    const hw = halfW(u);
    points.push(
      { x: neck.x + ux * drawBellH * u - nx * hw, y: neck.y + uy * drawBellH * u - ny * hw },
      { x: neck.x + ux * drawBellH * u + nx * hw, y: neck.y + uy * drawBellH * u + ny * hw },
    );
  }
  return {
    centerX: cell.anchorX,
    centerY: cell.anchorY - (restStalk + bellHeight * 0.5),
    radius: 1.1 * D,
    points,
  };
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

function coefficientOfVariation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function maxConsecutiveSeconds(samples: readonly TrioSample[], predicate: (sample: TrioSample) => boolean): number {
  let current = 0;
  let max = 0;
  for (const sample of samples) {
    if (predicate(sample)) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max / 60;
}

function maxWindowMetric(samples: readonly TrioSample[], windowFrames: number, metric: (window: readonly TrioSample[]) => number): number {
  let max = 0;
  for (let start = 0; start + windowFrames <= samples.length; start++) {
    max = Math.max(max, metric(samples.slice(start, start + windowFrames)));
  }
  return max;
}

function simulateDriftingContour(seconds = 90): readonly TrioSample[] {
  const params = driftingContourParams();
  const dt = 1 / 60;
  const width = 320;
  const height = 160;
  let state = seedAquarium(frame({ t: 0, dt, width, height }), params);
  let previous = state.euglena[0];
  const samples: TrioSample[] = [];

  for (let i = 1; i <= Math.round(seconds / dt); i++) {
    const t = i * dt;
    state = updateAquarium(state, frame({ t, dt, width, height }), params);
    const euglena = state.euglena[0] as MotorEuglenaState;
    const vorticella = state.vorticella[0];
    const hero = frame().hero!;
    const dx = euglena.x - hero.x;
    const dy = euglena.y - hero.y;
    const visual = euglenaRenderedVisual(euglena, params.euglenaScale ?? 1, width, height);
    const sessile = vorticellaRenderedGeometry(vorticella, params.vorticellaScale ?? 1, height);
    const vdx = euglena.x - sessile.centerX;
    const vdy = euglena.y - sessile.centerY;
    samples.push({
      x: euglena.x,
      y: euglena.y,
      heading: euglena.heading,
      speed: Math.hypot(euglena.x - previous.x, euglena.y - previous.y) / dt,
      phase: euglena.motorPhase,
      turnFrom: euglena.turnFrom,
      turnTo: euglena.turnTo,
      photoTargetIndex: euglena.photoTargetIndex,
      photoTargetAge: euglena.photoTargetAge,
      heroDistance: Math.hypot(dx, dy) / hero.radius,
      heroBearing: Math.atan2(dy, dx),
      heroQ: heroQ(euglena.x, euglena.y, 0),
      heroBodyQ: visual.minBodyHeroQ,
      visualMinX: visual.minX,
      visualMaxX: visual.maxX,
      visualMinY: visual.minY,
      visualMaxY: visual.maxY,
      visualFinite: visual.finite,
      vorticellaBearing: Math.atan2(vdy, vdx),
      vorticellaBodyQ: Math.min(...visual.outline.map((p) => Math.hypot(p.x - sessile.centerX, p.y - sessile.centerY) / sessile.radius)),
      vorticellaGeometryDistance: Math.min(
        ...visual.allPoints.flatMap((p) => sessile.points.map((q) => Math.hypot(p.x - q.x, p.y - q.y))),
      ),
      vorticellaAnchorX: vorticella.anchorX,
      vorticellaAnchorY: vorticella.anchorY,
    });
    previous = euglena;
  }

  return samples;
}

function circulation(window: readonly TrioSample[], bearing: (sample: TrioSample) => number): number {
  let bearingTravel = 0;
  for (let i = 1; i < window.length; i++) bearingTravel += Math.abs(wrapPi(bearing(window[i]) - bearing(window[i - 1])));
  return bearingTravel / (2 * Math.PI);
}

function summarizeTrio(samples: readonly TrioSample[]) {
  const phaseCounts: Partial<Record<EuglenaMotorPhase, number>> = {};
  let commitTurnEvents = 0;
  let previous = samples[0];
  const turnAngles: number[] = [];
  const speeds = samples.map((sample) => sample.speed);
  let euglenaPath = 0;
  let heroBearingTravel = 0;

  for (const sample of samples) {
    if (sample.phase) phaseCounts[sample.phase] = (phaseCounts[sample.phase] ?? 0) + 1;
    if (sample.phase === "commitTurn" && previous?.phase !== "commitTurn") {
      commitTurnEvents += 1;
      turnAngles.push(Math.abs(wrapPi((sample.turnTo ?? sample.heading) - (sample.turnFrom ?? previous.heading))) * 180 / Math.PI);
    }
    if (previous) {
      euglenaPath += Math.hypot(sample.x - previous.x, sample.y - previous.y);
      heroBearingTravel += Math.abs(wrapPi(sample.heroBearing - previous.heroBearing));
    }
    previous = sample;
  }

  const width = 320;
  const height = 160;
  const edgePredicate = (sample: TrioSample) => sample.x < 45 || sample.x > 275 || sample.y < 30 || sample.y > 130;
  const visualEdgePredicate = (sample: TrioSample) => (
    sample.visualMinX < 0 || sample.visualMaxX > width || sample.visualMinY < 0 || sample.visualMaxY > height
  );
  const heroInterestPredicate = (sample: TrioSample) => sample.heroQ < 2.2;
  const vorticellaPinningPredicate = (sample: TrioSample) => sample.vorticellaBodyQ < 1.2;

  return {
    phaseCounts,
    commitTurnEvents,
    photoCheckRatio: (phaseCounts.photoCheck ?? 0) / Math.max(1, samples.length),
    medianCommitTurnDeg: percentile(turnAngles, 0.50),
    speedP10: percentile(speeds, 0.10),
    speedP90: percentile(speeds, 0.90),
    edgeDwellSeconds: maxConsecutiveSeconds(samples, edgePredicate),
    visualEdgeDwellSeconds: maxConsecutiveSeconds(samples, visualEdgePredicate),
    visualNonFiniteFrames: samples.filter((sample) => !sample.visualFinite).length,
    stillRunSeconds: maxConsecutiveSeconds(samples, (sample) => sample.speed < 0.5 && sample.phase !== "photoCheck"),
    heroOverlapFrames: samples.filter((sample) => sample.heroQ < 1).length,
    euglenaBodyOverlapFrames: samples.filter((sample) => sample.heroBodyQ < 1).length,
    minEuglenaBodyHeroQ: Math.min(...samples.map((sample) => sample.heroBodyQ)),
    heroDistanceCv: coefficientOfVariation(samples.map((sample) => sample.heroDistance)),
    maxHeroCirculation10s: maxWindowMetric(samples, 10 * 60, (window) => circulation(window, (sample) => sample.heroBearing)),
    totalHeroCirculation: heroBearingTravel / (2 * Math.PI),
    heroInterestZoneRatio: samples.filter(heroInterestPredicate).length / samples.length,
    headingHeroBearingCorrelation: Math.abs(heroBearingTravel) / Math.max(1e-9, euglenaPath),
    euglenaBodyVorticellaOverlapFrames: samples.filter((sample) => sample.vorticellaBodyQ < 1).length,
    minEuglenaBodyVorticellaQ: Math.min(...samples.map((sample) => sample.vorticellaBodyQ)),
    minVorticellaGeometryDistance: Math.min(...samples.map((sample) => sample.vorticellaGeometryDistance)),
    vorticellaPinningSeconds: maxConsecutiveSeconds(samples, vorticellaPinningPredicate),
    maxVorticellaCirculation10s: maxWindowMetric(samples, 10 * 60, (window) => circulation(window, (sample) => sample.vorticellaBearing)),
    vorticellaAnchorDriftPx: Math.max(
      ...samples.map((sample) => Math.hypot(sample.vorticellaAnchorX - samples[0].vorticellaAnchorX, sample.vorticellaAnchorY - samples[0].vorticellaAnchorY)),
    ),
    legacyWaypointRouteFrames: samples.filter((sample) => sample.photoTargetIndex !== undefined || sample.photoTargetAge !== undefined).length,
    xCoverage: (Math.max(...samples.map((sample) => sample.x)) - Math.min(...samples.map((sample) => sample.x))) / width,
    yCoverage: (Math.max(...samples.map((sample) => sample.y)) - Math.min(...samples.map((sample) => sample.y))) / height,
  };
}

describe("drifting_contour 90s trio motor metrics", () => {
  it("keeps Paramecium primary, Vorticella sessile, and Euglena secondary/non-orbiting", () => {
    const params = driftingContourParams();
    const initial = seedAquarium(frame(), params);
    const field = buildAquariumInteractionField(
      initial.euglena,
      initial.vorticella,
      frame().hero,
      params.vorticellaScale ?? 1,
      frame().height,
      initial.didinium,
      params.euglenaScale,
      params.didiniumScale,
    );
    const samples = simulateDriftingContour(90);
    const summary = summarizeTrio(samples);

    expect(field.motiles[0]).toMatchObject({ kind: "motile", role: "neutral", sourceId: sourceId("euglena", 0) });
    expect(field.obstacles.some((obstacle) => obstacle.sourceId === sourceId("vorticella", 0))).toBe(true);
    expect(field.wakes.some((wake) => wake.sourceId === sourceId("vorticella", 0))).toBe(true);
    expect(summary.phaseCounts.run ?? 0, "motorPhase=run should exist").toBeGreaterThan(0);
    expect(summary.phaseCounts.photoCheck ?? 0, "motorPhase=photoCheck should exist").toBeGreaterThan(0);
    expect(summary.phaseCounts.commitTurn ?? 0, "motorPhase=commitTurn should exist").toBeGreaterThan(0);
    expect(summary.phaseCounts.recover ?? 0, "motorPhase=recover should exist").toBeGreaterThan(0);
    expect(summary.photoCheckRatio, "trio photoCheck ratio should stay calm").toBeGreaterThanOrEqual(0.03);
    expect(summary.photoCheckRatio, "trio photoCheck ratio should stay calmer than solo and within duo baseline").toBeLessThanOrEqual(0.08);
    expect(summary.commitTurnEvents, "secondary Euglena should make occasional committed turns").toBeGreaterThanOrEqual(4);
    expect(summary.commitTurnEvents, "secondary Euglena should not be busier than accepted duo").toBeLessThanOrEqual(7);
    expect(summary.medianCommitTurnDeg, "committed turns should remain readable").toBeGreaterThanOrEqual(25);
    expect(summary.medianCommitTurnDeg, "committed turns should remain calm").toBeLessThanOrEqual(55);
    expect(summary.speedP90 - summary.speedP10, "motor phases should create visible speed variance").toBeGreaterThan(0.5);
    expect(summary.speedP90, "trio Euglena should stay calmer/slower than accepted duo P90").toBeLessThan(17.8);
    expect(summary.edgeDwellSeconds, "Euglena centroid should not dwell near edges").toBe(0);
    expect(summary.visualEdgeDwellSeconds, "Euglena body+flagellum should not dwell at visual edges").toBe(0);
    expect(summary.visualNonFiniteFrames, "rendered body+flagellum bbox should stay finite").toBe(0);
    expect(summary.stillRunSeconds, "Euglena should not be still outside photoCheck").toBeLessThan(0.5);
    expect(summary.heroOverlapFrames, "centroid should stay outside Paramecium body ellipse").toBe(0);
    expect(summary.euglenaBodyOverlapFrames, "visible Euglena body outline should not overlap Paramecium").toBe(0);
    expect(summary.minEuglenaBodyHeroQ, "visible Euglena body should keep clearance from Paramecium").toBeGreaterThan(1.1);
    expect(summary.legacyWaypointRouteFrames, "motor-on mode should not expose the legacy photoTarget waypoint route").toBe(0);
    expect(summary.heroDistanceCv, "distance to Paramecium should vary instead of fixed escort spacing").toBeGreaterThan(0.15);
    expect(summary.maxHeroCirculation10s, "Euglena should not companion-orbit around Paramecium for 10s").toBeLessThan(0.35);
    expect(summary.heroInterestZoneRatio, "time in the Paramecium interest zone should stay bounded").toBeLessThan(0.25);
    expect(summary.headingHeroBearingCorrelation, "heading/displacement should not track Paramecium bearing like an escort").toBeLessThan(0.08);
    expect(summary.euglenaBodyVorticellaOverlapFrames, "Euglena body should not overlap the Vorticella bell envelope").toBe(0);
    expect(summary.minEuglenaBodyVorticellaQ, "Euglena body should keep Vorticella bell clearance").toBeGreaterThan(1.2);
    expect(summary.minVorticellaGeometryDistance, "Euglena body+flagellum should not touch the Vorticella bell/stalk geometry").toBeGreaterThan(8);
    expect(summary.vorticellaPinningSeconds, "Euglena should not pin to Vorticella").toBeLessThan(1);
    expect(summary.maxVorticellaCirculation10s, "Euglena should not circle the Vorticella for 10s").toBeLessThan(0.35);
    expect(summary.vorticellaAnchorDriftPx, "Vorticella should remain sessile").toBe(0);
    expect(summary.xCoverage, "secondary Euglena should still move across the shared water").toBeGreaterThan(0.20);
    expect(summary.yCoverage, "secondary Euglena should still move across tank lanes").toBeGreaterThan(0.35);
  });
});
