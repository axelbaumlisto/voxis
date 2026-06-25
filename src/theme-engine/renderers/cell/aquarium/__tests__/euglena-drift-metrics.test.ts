import { describe, expect, it } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { euglenaDisplayLength, euglenaPose } from "../euglena";
import { seedAquarium, updateAquarium } from "../layer";
import type { AquariumFrame, EuglenaState } from "../types";

const TAU = Math.PI * 2;
const BLANK_LIKE_MIN_VISIBLE_AREA = 425;
const BLANK_LIKE_MIN_SHORT_SIDE = 7.25;
type EuglenaMotorPhase = "run" | "photoCheck" | "commitTurn" | "recover";
type MotorEuglenaState = EuglenaState & {
  readonly motorPhase?: EuglenaMotorPhase;
  readonly turnFrom?: number;
  readonly turnTo?: number;
  readonly photoTargetIndex?: number;
  readonly photoTargetAge?: number;
};

interface SoloSample {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly speed: number;
  readonly phase?: EuglenaMotorPhase;
  readonly turnFrom?: number;
  readonly turnTo?: number;
  readonly photoTargetIndex?: number;
  readonly photoTargetAge?: number;
  readonly visualMinX: number;
  readonly visualMaxX: number;
  readonly visualMinY: number;
  readonly visualMaxY: number;
  readonly visualFinite: boolean;
  readonly visibleWidth: number;
  readonly visibleHeight: number;
  readonly visibleArea: number;
}

function euglenaDriftParams(): CellParams {
  return {
    ...CELL_DEFAULTS,
    enableHero: false,
    enableAquarium: true,
    aquariumSeed: 17,
    aquariumAlpha: 1.0,
    aquariumActivityBoost: 0.6,
    diatomCount: 0,
    euglenaCount: 1,
    euglenaSpeed: 0.19,
    euglenaSpeedActive: 0.54,
    euglenaScale: 4.05,
    euglenaFlagellumRateScale: 0.45,
    euglenaGravitaxis: 0.02,
    euglenaPhototaxis: 0,
    euglenaPhotoIntent: 1.2,
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
  visibleWidth: number;
  visibleHeight: number;
  visibleArea: number;
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
  const finite = pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const visibleWidth = Math.max(0, Math.min(width, maxX) - Math.max(0, minX));
  const visibleHeight = Math.max(0, Math.min(height, maxY) - Math.max(0, minY));
  return {
    minX,
    maxX,
    minY,
    maxY,
    finite,
    visibleWidth,
    visibleHeight,
    visibleArea: visibleWidth * visibleHeight,
  };
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

function maxConsecutiveSeconds(samples: readonly SoloSample[], predicate: (sample: SoloSample) => boolean): number {
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

function simulateSoloEuglena(seconds = 90): readonly SoloSample[] {
  const params = euglenaDriftParams();
  const width = 320;
  const height = 160;
  const dt = 1 / 60;
  let state = seedAquarium(frame({ t: 0, dt, width, height }), params);
  let previous = state.euglena[0];
  const samples: SoloSample[] = [];

  for (let i = 1; i <= Math.round(seconds / dt); i++) {
    const t = i * dt;
    state = updateAquarium(state, frame({ t, dt, width, height }), params);
    const euglena = state.euglena[0] as MotorEuglenaState;
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
      visualMinX: visual.minX,
      visualMaxX: visual.maxX,
      visualMinY: visual.minY,
      visualMaxY: visual.maxY,
      visualFinite: visual.finite,
      visibleWidth: visual.visibleWidth,
      visibleHeight: visual.visibleHeight,
      visibleArea: visual.visibleArea,
    });
    previous = euglena;
  }

  return samples;
}

function summarizeSolo(samples: readonly SoloSample[]) {
  const phaseCounts: Partial<Record<EuglenaMotorPhase, number>> = {};
  let commitTurnEvents = 0;
  let previous = samples[0];
  const turnAngles: number[] = [];
  const speeds = samples.map((sample) => sample.speed);

  for (const sample of samples) {
    if (sample.phase) phaseCounts[sample.phase] = (phaseCounts[sample.phase] ?? 0) + 1;
    if (sample.phase === "commitTurn" && previous?.phase !== "commitTurn") {
      commitTurnEvents += 1;
      turnAngles.push(Math.abs(wrapPi((sample.turnTo ?? sample.heading) - (sample.turnFrom ?? previous.heading))) * 180 / Math.PI);
    }
    previous = sample;
  }

  const width = 320;
  const height = 160;
  const visualEdgePredicate = (sample: SoloSample) => (
    sample.visualMinX < 0 || sample.visualMaxX > width || sample.visualMinY < 0 || sample.visualMaxY > height
  );
  const visibleShortSides = samples.map((sample) => Math.min(sample.visibleWidth, sample.visibleHeight));
  const blankLikePredicate = (sample: SoloSample) => (
    sample.visibleArea <= BLANK_LIKE_MIN_VISIBLE_AREA
    || Math.min(sample.visibleWidth, sample.visibleHeight) <= BLANK_LIKE_MIN_SHORT_SIDE
  );

  return {
    phaseCounts,
    commitTurnEvents,
    photoCheckRatio: (phaseCounts.photoCheck ?? 0) / Math.max(1, samples.length),
    medianCommitTurnDeg: percentile(turnAngles, 0.50),
    speedP10: percentile(speeds, 0.10),
    speedP90: percentile(speeds, 0.90),
    renderedVisualEdgeFrames: samples.filter(visualEdgePredicate).length,
    renderedVisualEdgeDwellSeconds: maxConsecutiveSeconds(samples, visualEdgePredicate),
    visualNonFiniteFrames: samples.filter((sample) => !sample.visualFinite).length,
    blankLikeRenderedFrames: samples.filter(blankLikePredicate).length,
    blankLikeRenderedDwellSeconds: maxConsecutiveSeconds(samples, blankLikePredicate),
    minVisibleArea: Math.min(...samples.map((sample) => sample.visibleArea)),
    minVisibleShortSide: Math.min(...visibleShortSides),
    stillRunSeconds: maxConsecutiveSeconds(samples, (sample) => sample.speed < 0.5 && sample.phase !== "photoCheck"),
    centroidWidthCoverage: (Math.max(...samples.map((sample) => sample.x)) - Math.min(...samples.map((sample) => sample.x))) / width,
    renderedWidthCoverage: (Math.max(...samples.map((sample) => sample.visualMaxX)) - Math.min(...samples.map((sample) => sample.visualMinX))) / width,
    legacyWaypointRouteFrames: samples.filter((sample) => sample.photoTargetIndex !== undefined || sample.photoTargetAge !== undefined).length,
  };
}

describe("euglena_drift 90s solo motor metrics", () => {
  it("exposes calm motor phases without legacy waypoint rails, clipping, or still runs", () => {
    const samples = simulateSoloEuglena(90);
    const summary = summarizeSolo(samples);

    expect(summary.phaseCounts.run ?? 0, "motorPhase=run should exist").toBeGreaterThan(0);
    expect(summary.phaseCounts.photoCheck ?? 0, "motorPhase=photoCheck should exist").toBeGreaterThan(0);
    expect(summary.phaseCounts.commitTurn ?? 0, "motorPhase=commitTurn should exist").toBeGreaterThan(0);
    expect(summary.phaseCounts.recover ?? 0, "motorPhase=recover should exist").toBeGreaterThan(0);
    expect(summary.commitTurnEvents, "solo Euglena should make 2–8 committed turns in 90s").toBeGreaterThanOrEqual(2);
    expect(summary.commitTurnEvents, "solo Euglena should stay calm, not route-correct constantly").toBeLessThanOrEqual(8);
    expect(summary.photoCheckRatio, "photoCheck ratio should stay in the calm 3–15% band").toBeGreaterThanOrEqual(0.03);
    expect(summary.photoCheckRatio, "photoCheck ratio should stay in the calm 3–15% band").toBeLessThanOrEqual(0.15);
    expect(summary.speedP90 - summary.speedP10, "motor phases should create visible speed variance").toBeGreaterThan(2.0);
    expect(summary.medianCommitTurnDeg, "median committed turns should remain readable but not frantic").toBeGreaterThanOrEqual(25);
    expect(summary.medianCommitTurnDeg, "median committed turns should remain readable but not frantic").toBeLessThanOrEqual(60);
    expect(summary.renderedVisualEdgeFrames, "rendered body+flagellum should not clip the actual overlay").toBe(0);
    expect(summary.renderedVisualEdgeDwellSeconds, "rendered body+flagellum should not dwell at any visual edge").toBe(0);
    expect(summary.visualNonFiniteFrames, "rendered body+flagellum bbox should stay finite").toBe(0);
    expect(summary.blankLikeRenderedFrames, "rendered visible footprint should never produce blank-like frames").toBe(0);
    expect(summary.blankLikeRenderedDwellSeconds, "rendered visible footprint should never dwell blank-like").toBe(0);
    expect(summary.minVisibleArea, "projected body+flagellum bbox should never collapse into a blank-like frame").toBeGreaterThan(BLANK_LIKE_MIN_VISIBLE_AREA);
    expect(summary.minVisibleShortSide, "projected body+flagellum bbox should stay readable, not a 1px sliver").toBeGreaterThan(BLANK_LIKE_MIN_SHORT_SIDE);
    expect(summary.stillRunSeconds, "solo Euglena should not be still outside photoCheck for >0.5s").toBeLessThan(0.5);
    expect(summary.renderedWidthCoverage, "body+flagellum should use a broad width over 90s").toBeGreaterThanOrEqual(0.65);
    expect(summary.centroidWidthCoverage, "centroid coverage is intentionally lower than visual coverage at safe scale").toBeGreaterThan(0.30);
    expect(summary.legacyWaypointRouteFrames, "motor-on mode should not expose the legacy photoTarget waypoint route").toBe(0);
  });
});
