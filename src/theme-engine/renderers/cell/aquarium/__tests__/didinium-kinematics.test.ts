import { describe, expect, it } from "vitest";
import { PARAMECIUM_CELL_PARAMS } from "../../../../builtin/_shared/paramecium";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { didiniumDisplayLength } from "../didinium";
import { sourceId } from "../interaction";
import { buildAquariumInteractionField, seedAquarium, updateAquarium } from "../layer";
import type { AquariumFrame, DidiniumState } from "../types";

const DT = 1 / 60;
const WIDTH = 340;
const HEIGHT = 170;
const SECONDS = 90;
const FRAMES = Math.round(SECONDS / DT);

type Scenario = "didinium_drift" | "all_aquarium";

interface FieldCounts {
  readonly obstacles: number;
  readonly wakes: number;
  readonly motiles: number;
  readonly socialObstacles: number;
  readonly preyMotiles: number;
  readonly didiniumMotiles: number;
}

interface Sample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly speed: number;
  readonly heading: number;
  readonly phase: number;
  readonly rollPhase: number;
  readonly rollRate: number;
  readonly euglenaSpeed?: number;
  readonly avoidIndex: number;
  readonly avoidProgress: number;
  readonly contactTimer: number;
  readonly contactDuration: number;
  readonly huntCooldown: number;
  readonly clamp: boolean;
}

interface SeriesSummary {
  readonly p10?: number;
  readonly p50?: number;
  readonly p90: number;
  readonly p99: number;
  readonly max: number;
}

interface DirectedRunSummary {
  readonly count: number;
  readonly acceptedCount: number;
  readonly longestSeconds: number;
  readonly bestNetPath: number;
  readonly worstAcceptedNetPath: number;
  readonly maxAcceptedMedianTurn: number;
}

interface RollSummary {
  readonly rateP50: number;
  readonly maxStep: number;
  readonly maxStepInEvent: number;
}

interface KinematicSummary {
  readonly scenario: Scenario;
  readonly hasHero: boolean;
  readonly firstField: FieldCounts;
  readonly maxField: FieldCounts;
  readonly speed: SeriesSummary;
  readonly speedCruise: SeriesSummary;
  readonly speedNoAvoidContact: SeriesSummary;
  readonly euglenaSpeedNoAvoidContact?: SeriesSummary;
  readonly didiniumEuglenaSpeedRatio?: number;
  readonly accel: SeriesSummary;
  readonly accelCruise: SeriesSummary;
  readonly jerk: SeriesSummary;
  readonly jerkCruise: SeriesSummary;
  readonly turn: SeriesSummary;
  readonly turnCruise: SeriesSummary;
  readonly avoidStarts: number;
  readonly avoidDuty: number;
  readonly maxAvoidRun: number;
  readonly contactStarts: number;
  readonly contactDuty: number;
  readonly maxContactTimer: number;
  readonly clampFrames: number;
  readonly clampDuty: number;
  readonly maxClampRun: number;
  readonly path: number;
  readonly net: number;
  readonly pathNet: number;
  readonly directedRuns: DirectedRunSummary;
  readonly roll: RollSummary;
}

function didiniumDriftParams(): CellParams {
  return {
    ...CELL_DEFAULTS,
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
  };
}

function allAquariumParams(): CellParams {
  return {
    ...CELL_DEFAULTS,
    ...PARAMECIUM_CELL_PARAMS,
    radiusFraction: 0.19,
    enableAquarium: true,
    aquariumSeed: 13,
    aquariumAlpha: 0.70,
    aquariumActivityBoost: 0.65,
    diatomCount: 0,
    euglenaCount: 1,
    euglenaSpeed: 0.34,
    euglenaSpeedActive: 0.65,
    euglenaScale: 2.2,
    euglenaFlagellumRateScale: 0.45,
    euglenaGravitaxis: 0.03,
    euglenaPhototaxis: 0,
    euglenaPhotoIntent: 2.4,
    euglenaMotorEnabled: true,
    euglenaLoiter: 0,
    euglenaWake: 0.12,
    euglenaRotDiffusion: 0,
    vorticellaCount: 1,
    vorticellaAlongFrac: 0.30,
    vorticellaScale: 1.12,
    vorticellaContractRate: 1.0,
    didiniumCount: 1,
    didiniumSpeed: 1.55,
    didiniumSpeedActive: 2.2,
    didiniumScale: 1.60,
  };
}

function paramsFor(scenario: Scenario): CellParams {
  return scenario === "didinium_drift" ? didiniumDriftParams() : allAquariumParams();
}

function frameFor(params: CellParams, overrides: Partial<AquariumFrame> = {}): AquariumFrame {
  return {
    t: 0,
    dt: DT,
    width: WIDTH,
    height: HEIGHT,
    mode: "recording",
    activity: 0.45,
    audioLevel: 0.30,
    startle: 0,
    baseHue: 50,
    hero: params.enableHero === false
      ? undefined
      : { x: 155, y: 87, radius: 23, heading: 0.28, halfLen: 37, halfWid: 14 },
    ...overrides,
  };
}

function fieldCounts(params: CellParams, state: ReturnType<typeof seedAquarium>, frame: AquariumFrame): FieldCounts {
  const field = buildAquariumInteractionField(
    state.euglena.length > 0 ? state.euglena : undefined,
    state.vorticella.length > 0 ? state.vorticella : undefined,
    frame.hero,
    params.vorticellaScale ?? 1,
    frame.height,
    state.didinium.length > 0 ? state.didinium : undefined,
    params.euglenaScale ?? 1,
    params.didiniumScale ?? 1,
  );
  return {
    obstacles: field.obstacles.length,
    wakes: field.wakes.length,
    motiles: field.motiles.length,
    socialObstacles: field.obstacles.filter((obstacle) => obstacle.social).length,
    preyMotiles: field.motiles.filter((motile) => motile.role === "prey").length,
    didiniumMotiles: field.motiles.filter((motile) => motile.sourceId === sourceId("didinium", 0)).length,
  };
}

function didiniumClamp(cell: DidiniumState, params: CellParams): boolean {
  const length = didiniumDisplayLength(cell.size, params.didiniumScale ?? 1);
  const margin = Math.min(length * 0.55, WIDTH * 0.45, HEIGHT * 0.45);
  return cell.x <= margin + 1e-6
    || cell.x >= WIDTH - margin - 1e-6
    || cell.y <= margin + 1e-6
    || cell.y >= HEIGHT - margin - 1e-6;
}

function simulate(scenario: Scenario): {
  readonly params: CellParams;
  readonly hasHero: boolean;
  readonly samples: readonly Sample[];
  readonly fieldCounts: readonly FieldCounts[];
} {
  const params = paramsFor(scenario);
  const seedFrame = frameFor(params, { t: 0, dt: DT });
  let state = seedAquarium(seedFrame, params);
  let previous = state.didinium[0];
  let previousEuglena = state.euglena[0];
  const samples: Sample[] = [];
  const fields: FieldCounts[] = [];

  for (let i = 1; i <= FRAMES; i++) {
    const t = i * DT;
    const f = frameFor(params, { t, dt: DT });
    fields.push(fieldCounts(params, state, f));
    state = updateAquarium(state, f, params);
    const didinium = state.didinium[0];
    const euglena = state.euglena[0];
    const vx = (didinium.x - previous.x) / DT;
    const vy = (didinium.y - previous.y) / DT;
    const euglenaSpeed = euglena && previousEuglena
      ? Math.hypot(euglena.x - previousEuglena.x, euglena.y - previousEuglena.y) / DT
      : undefined;
    samples.push({
      t,
      x: didinium.x,
      y: didinium.y,
      vx,
      vy,
      speed: Math.hypot(vx, vy),
      heading: didinium.heading,
      phase: didinium.phase,
      rollPhase: didinium.rollPhase,
      rollRate: didinium.rollRate,
      euglenaSpeed,
      avoidIndex: didinium.avoidIndex ?? 0,
      avoidProgress: didinium.avoidProgress ?? 1,
      contactTimer: didinium.contactTimer ?? 0,
      contactDuration: didinium.contactDuration ?? 0,
      huntCooldown: didinium.huntCooldown ?? 0,
      clamp: didiniumClamp(didinium, params),
    });
    previous = didinium;
    previousEuglena = euglena;
  }

  return { params, hasHero: seedFrame.hero !== undefined, samples, fieldCounts: fields };
}

function wrapPi(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

function summarizeSeries(values: readonly number[], withLow = false): SeriesSummary {
  return {
    ...(withLow ? { p10: percentile(values, 0.10), p50: percentile(values, 0.50) } : {}),
    p90: percentile(values, 0.90),
    p99: percentile(values, 0.99),
    max: values.length > 0 ? Math.max(...values) : 0,
  };
}

function maxConsecutiveSeconds(samples: readonly Sample[], predicate: (sample: Sample) => boolean): number {
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

function inEventWindow(samples: readonly Sample[], index: number, radius = 2): boolean {
  for (let i = Math.max(0, index - radius); i <= Math.min(samples.length - 1, index + radius); i++) {
    const sample = samples[i];
    if (sample.avoidProgress < 1 || sample.contactTimer > 0 || sample.clamp) return true;
  }
  return false;
}

function inAvoidContactWindow(samples: readonly Sample[], index: number, radius = 2): boolean {
  for (let i = Math.max(0, index - radius); i <= Math.min(samples.length - 1, index + radius); i++) {
    const sample = samples[i];
    if (sample.avoidProgress < 1 || sample.contactTimer > 0) return true;
  }
  return false;
}

function maxFieldCounts(counts: readonly FieldCounts[]): FieldCounts {
  return counts.reduce<FieldCounts>((max, count) => ({
    obstacles: Math.max(max.obstacles, count.obstacles),
    wakes: Math.max(max.wakes, count.wakes),
    motiles: Math.max(max.motiles, count.motiles),
    socialObstacles: Math.max(max.socialObstacles, count.socialObstacles),
    preyMotiles: Math.max(max.preyMotiles, count.preyMotiles),
    didiniumMotiles: Math.max(max.didiniumMotiles, count.didiniumMotiles),
  }), { obstacles: 0, wakes: 0, motiles: 0, socialObstacles: 0, preyMotiles: 0, didiniumMotiles: 0 });
}

function rollDeltaCycles(from: number, to: number): number {
  const delta = to - from;
  return delta - Math.round(delta);
}

function summarizeRoll(samples: readonly Sample[]): RollSummary {
  const rates: number[] = [];
  let maxStep = 0;
  let maxStepInEvent = 0;
  for (let i = 1; i < samples.length; i++) {
    const step = Math.abs(rollDeltaCycles(samples[i - 1].rollPhase, samples[i].rollPhase));
    const rate = step / DT;
    rates.push(rate);
    maxStep = Math.max(maxStep, step);
    if (inEventWindow(samples, i, 0)) maxStepInEvent = Math.max(maxStepInEvent, step);
  }
  return {
    rateP50: percentile(rates, 0.50),
    maxStep,
    maxStepInEvent,
  };
}

function directedRuns(samples: readonly Sample[]): DirectedRunSummary {
  const minFrames = 2 * 60;
  let count = 0;
  let acceptedCount = 0;
  let longestFrames = 0;
  let bestNetPath = 0;
  let worstAcceptedNetPath = Infinity;
  let maxAcceptedMedianTurn = 0;
  let start = 0;

  const measureSegment = (from: number, end: number): { readonly netPath: number; readonly medianTurn: number } => {
    let path = 0;
    const pathHeadings: number[] = [];
    const turns: number[] = [];
    for (let i = from + 1; i < end; i++) {
      const dx = samples[i].x - samples[i - 1].x;
      const dy = samples[i].y - samples[i - 1].y;
      const step = Math.hypot(dx, dy);
      path += step;
      if (step > 1e-6) pathHeadings.push(Math.atan2(dy, dx));
    }
    for (let i = 1; i < pathHeadings.length; i++) {
      turns.push(Math.abs(wrapPi(pathHeadings[i] - pathHeadings[i - 1])) / DT);
    }
    const net = Math.hypot(samples[end - 1].x - samples[from].x, samples[end - 1].y - samples[from].y);
    return {
      netPath: path > 0 ? net / path : 0,
      medianTurn: percentile(turns, 0.50),
    };
  };

  const recordAccepted = (netPath: number, medianTurn: number) => {
    acceptedCount += 1;
    worstAcceptedNetPath = Math.min(worstAcceptedNetPath, netPath);
    maxAcceptedMedianTurn = Math.max(maxAcceptedMedianTurn, medianTurn);
  };

  const flush = (end: number) => {
    const length = end - start;
    if (length < minFrames) return;
    longestFrames = Math.max(longestFrames, length);
    const whole = measureSegment(start, end);
    bestNetPath = Math.max(bestNetPath, whole.netPath);

    // Count non-overlapping ≥2s directed subsegments inside a longer uninterrupted
    // avoid/contact-free run. A 5–6s fast ciliate run is visibly multiple 2s gates,
    // even if the maximal interval gently bends across its full length.
    let cursor = start;
    while (cursor + minFrames <= end) {
      let acceptedAt: number | null = null;
      for (let windowStart = cursor; windowStart + minFrames <= end; windowStart++) {
        const segment = measureSegment(windowStart, windowStart + minFrames);
        count += 1;
        bestNetPath = Math.max(bestNetPath, segment.netPath);
        if (segment.netPath > 0.65 && segment.medianTurn < 0.6) {
          recordAccepted(segment.netPath, segment.medianTurn);
          acceptedAt = windowStart;
          break;
        }
      }
      if (acceptedAt === null) break;
      cursor = acceptedAt + minFrames;
    }
  };

  for (let i = 0; i < samples.length; i++) {
    if (inAvoidContactWindow(samples, i, 2)) {
      flush(i);
      start = i + 1;
    }
  }
  flush(samples.length);

  return {
    count,
    acceptedCount,
    longestSeconds: longestFrames / 60,
    bestNetPath,
    worstAcceptedNetPath: Number.isFinite(worstAcceptedNetPath) ? worstAcceptedNetPath : 0,
    maxAcceptedMedianTurn,
  };
}

function summarizeKinematics(scenario: Scenario): KinematicSummary {
  const { hasHero, samples, fieldCounts: fields } = simulate(scenario);
  const accel: Array<{ readonly idx: number; readonly ax: number; readonly ay: number; readonly value: number }> = [];
  const jerk: Array<{ readonly idx: number; readonly value: number }> = [];
  const turn: Array<{ readonly idx: number; readonly value: number }> = [];

  for (let i = 1; i < samples.length; i++) {
    const ax = (samples[i].vx - samples[i - 1].vx) / DT;
    const ay = (samples[i].vy - samples[i - 1].vy) / DT;
    accel.push({ idx: i, ax, ay, value: Math.hypot(ax, ay) });
    turn.push({ idx: i, value: Math.abs(wrapPi(samples[i].phase - samples[i - 1].phase)) / DT });
  }
  for (let i = 1; i < accel.length; i++) {
    jerk.push({
      idx: accel[i].idx,
      value: Math.hypot((accel[i].ax - accel[i - 1].ax) / DT, (accel[i].ay - accel[i - 1].ay) / DT),
    });
  }

  const cruiseSample = (sample: Sample) => sample.avoidProgress >= 1 && sample.contactTimer <= 0 && !sample.clamp;
  const noAvoidContactSample = (sample: Sample) => sample.avoidProgress >= 1 && sample.contactTimer <= 0;
  const cruiseDerivative = (idx: number) => !inEventWindow(samples, idx, 2);
  const speed = samples.map((sample) => sample.speed);
  const speedCruise = samples.filter(cruiseSample).map((sample) => sample.speed);
  const speedNoAvoidContact = samples.filter(noAvoidContactSample).map((sample) => sample.speed);
  const euglenaSpeedNoAvoidContact = samples
    .filter(noAvoidContactSample)
    .map((sample) => sample.euglenaSpeed)
    .filter((speed): speed is number => speed !== undefined);
  const didiniumEuglenaSpeedRatio = euglenaSpeedNoAvoidContact.length > 0
    ? percentile(speedNoAvoidContact, 0.50) / Math.max(1e-9, percentile(euglenaSpeedNoAvoidContact, 0.50))
    : undefined;
  const accelRaw = accel.map((entry) => entry.value);
  const accelCruise = accel.filter((entry) => cruiseDerivative(entry.idx)).map((entry) => entry.value);
  const jerkRaw = jerk.map((entry) => entry.value);
  const jerkCruise = jerk.filter((entry) => cruiseDerivative(entry.idx)).map((entry) => entry.value);
  const turnRaw = turn.map((entry) => entry.value);
  const turnCruise = turn.filter((entry) => cruiseDerivative(entry.idx)).map((entry) => entry.value);

  let avoidStarts = 0;
  let contactStarts = 0;
  let path = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].avoidIndex > samples[i - 1].avoidIndex) avoidStarts += 1;
    if (samples[i].contactTimer > 0 && samples[i - 1].contactTimer <= 0) contactStarts += 1;
    path += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
  }
  const net = Math.hypot(
    samples[samples.length - 1].x - samples[0].x,
    samples[samples.length - 1].y - samples[0].y,
  );

  return {
    scenario,
    hasHero,
    firstField: fields[0],
    maxField: maxFieldCounts(fields),
    speed: summarizeSeries(speed, true),
    speedCruise: summarizeSeries(speedCruise, true),
    speedNoAvoidContact: summarizeSeries(speedNoAvoidContact, true),
    euglenaSpeedNoAvoidContact: euglenaSpeedNoAvoidContact.length > 0 ? summarizeSeries(euglenaSpeedNoAvoidContact, true) : undefined,
    didiniumEuglenaSpeedRatio,
    accel: summarizeSeries(accelRaw),
    accelCruise: summarizeSeries(accelCruise),
    jerk: summarizeSeries(jerkRaw),
    jerkCruise: summarizeSeries(jerkCruise),
    turn: summarizeSeries(turnRaw),
    turnCruise: summarizeSeries(turnCruise),
    avoidStarts,
    avoidDuty: samples.filter((sample) => sample.avoidProgress < 1).length / samples.length,
    maxAvoidRun: maxConsecutiveSeconds(samples, (sample) => sample.avoidProgress < 1),
    contactStarts,
    contactDuty: samples.filter((sample) => sample.contactTimer > 0).length / samples.length,
    maxContactTimer: Math.max(...samples.map((sample) => sample.contactTimer)),
    clampFrames: samples.filter((sample) => sample.clamp).length,
    clampDuty: samples.filter((sample) => sample.clamp).length / samples.length,
    maxClampRun: maxConsecutiveSeconds(samples, (sample) => sample.clamp),
    path,
    net,
    pathNet: path / Math.max(1e-9, net),
    directedRuns: directedRuns(samples),
    roll: summarizeRoll(samples),
  };
}

const summaryCache = new Map<Scenario, KinematicSummary>();

function summaryFor(scenario: Scenario): KinematicSummary {
  const cached = summaryCache.get(scenario);
  if (cached) return cached;
  const summary = summarizeKinematics(scenario);
  summaryCache.set(scenario, summary);
  return summary;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function metricLine(summary: KinematicSummary): string {
  return [
    `${summary.scenario}:`,
    `hero=${summary.hasHero}`,
    `field(first=${JSON.stringify(summary.firstField)}, max=${JSON.stringify(summary.maxField)})`,
    `speed[p50=${fmt(summary.speed.p50 ?? 0)},p90=${fmt(summary.speed.p90)},p99=${fmt(summary.speed.p99)},max=${fmt(summary.speed.max)}]`,
    `speedCruise[p50=${fmt(summary.speedCruise.p50 ?? 0)},p99=${fmt(summary.speedCruise.p99)},max=${fmt(summary.speedCruise.max)}]`,
    `speedNoAvoidContact[p50=${fmt(summary.speedNoAvoidContact.p50 ?? 0)}]`,
    `euglenaSpeedNoAvoidContact[p50=${fmt(summary.euglenaSpeedNoAvoidContact?.p50 ?? 0)},ratio=${fmt(summary.didiniumEuglenaSpeedRatio ?? 0)}]`,
    `accel[p90=${fmt(summary.accel.p90)},p99=${fmt(summary.accel.p99)},max=${fmt(summary.accel.max)}]`,
    `accelCruise[p99=${fmt(summary.accelCruise.p99)},max=${fmt(summary.accelCruise.max)}]`,
    `jerk[p90=${fmt(summary.jerk.p90)},p99=${fmt(summary.jerk.p99)},max=${fmt(summary.jerk.max)}]`,
    `jerkCruise[p99=${fmt(summary.jerkCruise.p99)},max=${fmt(summary.jerkCruise.max)}]`,
    `turn[p90=${fmt(summary.turn.p90)},p99=${fmt(summary.turn.p99)},max=${fmt(summary.turn.max)}]`,
    `turnCruise[p99=${fmt(summary.turnCruise.p99)},max=${fmt(summary.turnCruise.max)}]`,
    `avoid[starts=${summary.avoidStarts},duty=${fmt(summary.avoidDuty)},maxRun=${fmt(summary.maxAvoidRun)}s]`,
    `contact[starts=${summary.contactStarts},duty=${fmt(summary.contactDuty)},maxTimer=${fmt(summary.maxContactTimer)}s]`,
    `clamp[frames=${summary.clampFrames},duty=${fmt(summary.clampDuty)},maxRun=${fmt(summary.maxClampRun)}s]`,
    `path/net[path=${fmt(summary.path)},net=${fmt(summary.net)},ratio=${fmt(summary.pathNet)}]`,
    `directedRuns[count=${summary.directedRuns.count},accepted=${summary.directedRuns.acceptedCount},longest=${fmt(summary.directedRuns.longestSeconds)}s,bestNetPath=${fmt(summary.directedRuns.bestNetPath)},worstAcceptedNetPath=${fmt(summary.directedRuns.worstAcceptedNetPath)},maxAcceptedMedianTurn=${fmt(summary.directedRuns.maxAcceptedMedianTurn)}]`,
    `roll[rateP50=${fmt(summary.roll.rateP50)}rev/s,maxStep=${fmt(summary.roll.maxStep)},maxEventStep=${fmt(summary.roll.maxStepInEvent)}]`,
  ].join(" ");
}

describe("Didinium production-equivalent kinematic metrics (Task 0 red tests)", () => {
  it("validates didinium_drift is a true solo scenario with no hero/prey/contact false positive", () => {
    const solo = summaryFor("didinium_drift");

    expect(solo.hasHero, metricLine(solo)).toBe(false);
    expect(solo.firstField.socialObstacles, metricLine(solo)).toBe(0);
    expect(solo.firstField.preyMotiles, metricLine(solo)).toBe(0);
    expect(solo.maxField.socialObstacles, metricLine(solo)).toBe(0);
    expect(solo.maxField.preyMotiles, metricLine(solo)).toBe(0);
    expect(solo.contactStarts, metricLine(solo)).toBe(0);
    expect(solo.contactDuty, metricLine(solo)).toBe(0);
  });

  it("validates all_aquarium uses the full interaction field including hero prey, Euglena, Vorticella, and Didinium", () => {
    const all = summaryFor("all_aquarium");

    expect(all.hasHero, metricLine(all)).toBe(true);
    expect(all.firstField.socialObstacles, metricLine(all)).toBe(1);
    expect(all.firstField.preyMotiles, metricLine(all)).toBe(1);
    expect(all.firstField.didiniumMotiles, metricLine(all)).toBe(1);
    expect(all.firstField.obstacles, metricLine(all)).toBe(2);
    expect(all.firstField.wakes, metricLine(all)).toBe(2);
    expect(all.firstField.motiles, metricLine(all)).toBe(3);
  });

  it("red: avoids should be rare and brief instead of chattering through the run", () => {
    const solo = summaryFor("didinium_drift");
    const all = summaryFor("all_aquarium");
    console.info(metricLine(solo));
    console.info(metricLine(all));

    expect(solo.avoidStarts, metricLine(solo)).toBeLessThanOrEqual(30);
    expect(solo.avoidDuty, metricLine(solo)).toBeLessThan(0.12);
    expect(solo.maxAvoidRun, metricLine(solo)).toBeLessThanOrEqual(0.28);
    expect(all.avoidStarts, metricLine(all)).toBeLessThanOrEqual(30);
    expect(all.avoidDuty, metricLine(all)).toBeLessThan(0.12);
    expect(all.maxAvoidRun, metricLine(all)).toBeLessThanOrEqual(0.28);
  });

  it("keeps wall clamp dwell near zero instead of rail-gliding on the body margin", () => {
    const solo = summaryFor("didinium_drift");
    const all = summaryFor("all_aquarium");
    console.info(metricLine(solo));
    console.info(metricLine(all));

    expect(solo.clampDuty, metricLine(solo)).toBeLessThanOrEqual(0.005);
    expect(solo.maxClampRun, metricLine(solo)).toBeLessThanOrEqual(0.05);
    expect(all.clampDuty, metricLine(all)).toBeLessThanOrEqual(0.005);
    expect(all.maxClampRun, metricLine(all)).toBeLessThanOrEqual(0.05);
  });

  it("red: raw derivative tails should not contain correction-scale acceleration/jerk spikes", () => {
    const solo = summaryFor("didinium_drift");
    const all = summaryFor("all_aquarium");
    console.info(metricLine(solo));
    console.info(metricLine(all));

    expect(solo.accel.p99, metricLine(solo)).toBeLessThan(2000);
    expect(solo.jerk.p99, metricLine(solo)).toBeLessThan(120_000);
    expect(all.accel.p99, metricLine(all)).toBeLessThan(2000);
    expect(all.jerk.p99, metricLine(all)).toBeLessThan(120_000);
  });

  it("red: visible body-axis turn spikes should stay below the event ceiling", () => {
    const solo = summaryFor("didinium_drift");
    const all = summaryFor("all_aquarium");
    console.info(metricLine(solo));
    console.info(metricLine(all));

    expect(solo.turn.max, metricLine(solo)).toBeLessThanOrEqual(12);
    expect(all.turn.max, metricLine(all)).toBeLessThanOrEqual(12);
    expect(all.turn.p90, metricLine(all)).toBeLessThanOrEqual(1.5);
    expect(all.turnCruise.p99, metricLine(all)).toBeLessThanOrEqual(3.0);
  });

  it("Task 4: preserves fast Didinium median speed floors", () => {
    const solo = summaryFor("didinium_drift");
    const all = summaryFor("all_aquarium");
    console.info(metricLine(solo));
    console.info(metricLine(all));

    expect(solo.speed.p50 ?? 0, metricLine(solo)).toBeGreaterThanOrEqual(45);
    expect(solo.speed.p50 ?? 0, metricLine(solo)).toBeLessThanOrEqual(70);
    expect(solo.speed.p50 ?? 0, metricLine(solo)).toBeGreaterThanOrEqual(35);
    expect(all.speed.p50 ?? 0, metricLine(all)).toBeGreaterThanOrEqual(45);
    expect(all.speed.p50 ?? 0, metricLine(all)).toBeLessThanOrEqual(70);
    expect(all.speed.p50 ?? 0, metricLine(all)).toBeGreaterThanOrEqual(35);
    expect(all.euglenaSpeedNoAvoidContact?.p50, metricLine(all)).toBeGreaterThan(0);
    expect(all.didiniumEuglenaSpeedRatio ?? 0, metricLine(all)).toBeGreaterThanOrEqual(1.8);
  });

  it("Task 4: preserves frequent directed fast runs outside avoid/contact", () => {
    const solo = summaryFor("didinium_drift");
    const all = summaryFor("all_aquarium");
    console.info(metricLine(solo));
    console.info(metricLine(all));

    expect(solo.directedRuns.acceptedCount, metricLine(solo)).toBeGreaterThanOrEqual(8);
    expect(solo.directedRuns.worstAcceptedNetPath, metricLine(solo)).toBeGreaterThan(0.65);
    expect(solo.directedRuns.maxAcceptedMedianTurn, metricLine(solo)).toBeLessThan(0.6);
    expect(all.directedRuns.acceptedCount, metricLine(all)).toBeGreaterThanOrEqual(8);
    expect(all.directedRuns.worstAcceptedNetPath, metricLine(all)).toBeGreaterThan(0.65);
    expect(all.directedRuns.maxAcceptedMedianTurn, metricLine(all)).toBeLessThan(0.6);
  });

  it("Task 4: preserves continuous axial roll across avoid/contact events", () => {
    const solo = summaryFor("didinium_drift");
    const all = summaryFor("all_aquarium");
    console.info(metricLine(solo));
    console.info(metricLine(all));

    expect(solo.roll.rateP50, metricLine(solo)).toBeGreaterThanOrEqual(0.55);
    expect(solo.roll.rateP50, metricLine(solo)).toBeLessThanOrEqual(0.90);
    expect(solo.roll.maxStep, metricLine(solo)).toBeLessThanOrEqual(0.025);
    expect(solo.roll.maxStepInEvent, metricLine(solo)).toBeGreaterThan(0);
    expect(solo.roll.maxStepInEvent, metricLine(solo)).toBeLessThanOrEqual(0.025);
    expect(all.roll.rateP50, metricLine(all)).toBeGreaterThanOrEqual(0.55);
    expect(all.roll.rateP50, metricLine(all)).toBeLessThanOrEqual(0.90);
    expect(all.roll.maxStep, metricLine(all)).toBeLessThanOrEqual(0.025);
    expect(all.roll.maxStepInEvent, metricLine(all)).toBeGreaterThan(0);
    expect(all.roll.maxStepInEvent, metricLine(all)).toBeLessThanOrEqual(0.025);
  });
});
