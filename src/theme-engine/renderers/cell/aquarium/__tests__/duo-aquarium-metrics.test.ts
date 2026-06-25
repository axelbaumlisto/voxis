import { describe, expect, it } from "vitest";
import { PARAMECIUM_CELL_PARAMS } from "../../../../builtin/_shared/paramecium";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { sourceId } from "../interaction";
import { euglenaDisplayLength, euglenaPose } from "../euglena";
import { buildAquariumInteractionField, seedAquarium, updateAquarium } from "../layer";
import type { AquariumFrame, EuglenaState } from "../types";

const TAU = Math.PI * 2;
type EuglenaMotorPhase = "run" | "photoCheck" | "commitTurn" | "recover";
type MotorEuglenaState = EuglenaState & {
  readonly motorPhase?: EuglenaMotorPhase;
  readonly turnFrom?: number;
  readonly turnTo?: number;
  readonly photoTargetIndex?: number;
  readonly photoTargetAge?: number;
};

interface DuoSample {
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
}

function duoAquariumParams(): CellParams {
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
    euglenaSpeed: 0.29,
    euglenaSpeedActive: 0.62,
    euglenaScale: 2.7,
    euglenaFlagellumRateScale: 0.55,
    euglenaGravitaxis: 0.02,
    euglenaPhototaxis: 0,
    euglenaPhotoIntent: 0.8,
    euglenaMotorEnabled: true,
    euglenaLoiter: 0,
    euglenaWake: 0,
    euglenaRotDiffusion: 0,
    vorticellaCount: 0,
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

function metabolyEnvelope(burstPhase: number): number {
  const p = wrapUnit(burstPhase);
  if (p < 0.6) return 0;
  return Math.sin(((p - 0.6) / 0.4) * Math.PI);
}

function euglenaRenderedVisualBounds(cell: EuglenaState, scale: number, width: number, height: number): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  finite: boolean;
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
  const pts = [...pose.outline, ...pose.flagellumPoints];
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
    finite: pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    minBodyHeroQ: Math.min(...pose.outline.map((p) => heroQ(p.x, p.y, 0))),
  };
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

function maxConsecutiveSeconds(samples: readonly DuoSample[], predicate: (sample: DuoSample) => boolean): number {
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

function maxWindowMetric(samples: readonly DuoSample[], windowFrames: number, metric: (window: readonly DuoSample[]) => number): number {
  let max = 0;
  for (let start = 0; start + windowFrames <= samples.length; start++) {
    max = Math.max(max, metric(samples.slice(start, start + windowFrames)));
  }
  return max;
}

function simulateDuoAquarium(seconds = 90): readonly DuoSample[] {
  const params = duoAquariumParams();
  const dt = 1 / 60;
  const width = 320;
  const height = 160;
  let state = seedAquarium(frame({ t: 0, dt, width, height }), params);
  let previous = state.euglena[0];
  const samples: DuoSample[] = [];

  for (let i = 1; i <= Math.round(seconds / dt); i++) {
    const t = i * dt;
    state = updateAquarium(state, frame({ t, dt, width, height }), params);
    const euglena = state.euglena[0] as MotorEuglenaState;
    const hero = frame().hero!;
    const dx = euglena.x - hero.x;
    const dy = euglena.y - hero.y;
    const visual = euglenaRenderedVisualBounds(euglena, params.euglenaScale ?? 1, width, height);
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
    });
    previous = euglena;
  }

  return samples;
}

function summarizeDuo(samples: readonly DuoSample[]) {
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
  const edgePredicate = (sample: DuoSample) => sample.x < 45 || sample.x > 275 || sample.y < 30 || sample.y > 130;
  const visualEdgePredicate = (sample: DuoSample) => (
    sample.visualMinX < 0 || sample.visualMaxX > width || sample.visualMinY < 0 || sample.visualMaxY > height
  );
  const heroInterestPredicate = (sample: DuoSample) => sample.heroQ < 2.2;
  const maxHeroCirculation10s = maxWindowMetric(samples, 10 * 60, (window) => {
    let bearingTravel = 0;
    for (let i = 1; i < window.length; i++) bearingTravel += Math.abs(wrapPi(window[i].heroBearing - window[i - 1].heroBearing));
    return bearingTravel / (2 * Math.PI);
  });

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
    maxHeroCirculation10s,
    totalHeroCirculation: heroBearingTravel / (2 * Math.PI),
    heroInterestZoneRatio: samples.filter(heroInterestPredicate).length / samples.length,
    headingHeroBearingCorrelation: Math.abs(heroBearingTravel) / Math.max(1e-9, euglenaPath),
    xCoverage: (Math.max(...samples.map((sample) => sample.x)) - Math.min(...samples.map((sample) => sample.x))) / width,
    yCoverage: (Math.max(...samples.map((sample) => sample.y)) - Math.min(...samples.map((sample) => sample.y))) / height,
    legacyWaypointRouteFrames: samples.filter((sample) => sample.photoTargetIndex !== undefined || sample.photoTargetAge !== undefined).length,
  };
}

describe("duo_aquarium 90s independent motor metrics", () => {
  it("keeps Euglena neutral and independent from the Paramecium hero", () => {
    const params = duoAquariumParams();
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
    const samples = simulateDuoAquarium(90);
    const summary = summarizeDuo(samples);

    expect(field.motiles[0]).toMatchObject({ kind: "motile", role: "neutral", sourceId: sourceId("euglena", 0) });
    expect(summary.phaseCounts.run ?? 0, "motorPhase=run should exist").toBeGreaterThan(0);
    expect(summary.phaseCounts.photoCheck ?? 0, "motorPhase=photoCheck should exist").toBeGreaterThan(0);
    expect(summary.phaseCounts.commitTurn ?? 0, "motorPhase=commitTurn should exist").toBeGreaterThan(0);
    expect(summary.phaseCounts.recover ?? 0, "motorPhase=recover should exist").toBeGreaterThan(0);
    expect(summary.photoCheckRatio, "photoCheck ratio should stay calm").toBeGreaterThanOrEqual(0.03);
    expect(summary.photoCheckRatio, "photoCheck ratio should stay calm").toBeLessThanOrEqual(0.15);
    expect(summary.commitTurnEvents, "duo Euglena should make calm committed turns").toBeGreaterThanOrEqual(5);
    expect(summary.commitTurnEvents, "duo Euglena should not route-correct constantly").toBeLessThanOrEqual(9);
    expect(summary.medianCommitTurnDeg, "median committed turns should remain readable").toBeGreaterThanOrEqual(25);
    expect(summary.medianCommitTurnDeg, "median committed turns should remain readable").toBeLessThanOrEqual(60);
    expect(summary.speedP90 - summary.speedP10, "motor phases should create visible speed variance").toBeGreaterThan(0.5);
    expect(summary.edgeDwellSeconds, "Euglena centroid should not dwell near edges").toBe(0);
    expect(summary.visualEdgeDwellSeconds, "Euglena body+flagellum should not dwell at visual edges").toBe(0);
    expect(summary.visualNonFiniteFrames, "rendered body+flagellum bbox should stay finite").toBe(0);
    expect(summary.stillRunSeconds, "Euglena should not be still outside photoCheck").toBeLessThan(0.5);
    expect(summary.heroOverlapFrames, "centroid should stay outside Paramecium body ellipse").toBe(0);
    expect(summary.euglenaBodyOverlapFrames, "visible Euglena body outline should not overlap the Paramecium body ellipse").toBe(0);
    expect(summary.minEuglenaBodyHeroQ, "visible Euglena body should keep clearance from the Paramecium body").toBeGreaterThan(1.1);
    expect(summary.legacyWaypointRouteFrames, "motor-on mode should not expose the legacy photoTarget waypoint route").toBe(0);
    expect(summary.heroDistanceCv, "distance to Paramecium should vary instead of fixed escort spacing").toBeGreaterThan(0.15);
    expect(summary.maxHeroCirculation10s, "Euglena should not companion-orbit around Paramecium for 10s").toBeLessThan(0.35);
    expect(summary.heroInterestZoneRatio, "time in the Paramecium interest zone should stay bounded").toBeLessThan(0.25);
    expect(summary.headingHeroBearingCorrelation, "heading/displacement should not track Paramecium bearing like an escort").toBeLessThan(0.08);
    expect(summary.xCoverage, "Euglena should move broadly enough across the tank width").toBeGreaterThan(0.25);
    expect(summary.yCoverage, "Euglena should move broadly enough across tank lanes").toBeGreaterThan(0.35);
  });
});
