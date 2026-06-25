import { describe, expect, it } from "vitest";
import { PARAMECIUM_CELL_PARAMS } from "../../../../builtin/_shared/paramecium";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { sourceId } from "../interaction";
import { buildAquariumInteractionField, seedAquarium, updateAquarium } from "../layer";
import type { AquariumFrame, EuglenaState, VorticellaState, DidiniumState } from "../types";

type EuglenaMotorPhase = "run" | "photoCheck" | "commitTurn" | "recover";
type MotorCellParams = CellParams & { readonly euglenaMotorEnabled?: boolean };
type MotorEuglenaState = EuglenaState & {
  readonly motorPhase?: EuglenaMotorPhase;
  readonly motorAge?: number;
  readonly motorDuration?: number;
};

interface MotorSample {
  readonly t: number;
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
}

function allAquariumBaseParams(): CellParams {
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

function allAquariumParams(): CellParams {
  return allAquariumBaseParams();
}

function allAquariumLegacyDefaultOffParams(): MotorCellParams {
  return {
    ...allAquariumBaseParams(),
    euglenaMotorEnabled: false,
  };
}

function frame(overrides: Partial<AquariumFrame> = {}): AquariumFrame {
  return {
    t: 0,
    dt: 1 / 60,
    width: 340,
    height: 170,
    mode: "recording",
    activity: 0.45,
    audioLevel: 0.30,
    startle: 0,
    baseHue: 50,
    hero: { x: 155, y: 87, radius: 23, heading: 0.28, halfLen: 37, halfWid: 14 },
    ...overrides,
  };
}

function allAquariumMotorOnParams(): MotorCellParams {
  return allAquariumParams();
}

function wrapPi(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
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

function maxWindowMetric(samples: readonly MotorSample[], windowFrames: number, metric: (window: readonly MotorSample[]) => number): number {
  let max = 0;
  for (let start = 0; start + windowFrames <= samples.length; start++) {
    max = Math.max(max, metric(samples.slice(start, start + windowFrames)));
  }
  return max;
}

function simulateAllAquariumMotorOn(seconds = 90): readonly MotorSample[] {
  const params = allAquariumMotorOnParams();
  const dt = 1 / 60;
  let state = seedAquarium(frame({ t: 0, dt, width: 340, height: 170, mode: "recording" }), params);
  let previous = state.euglena[0];
  const samples: MotorSample[] = [];

  for (let i = 1; i <= Math.round(seconds / dt); i++) {
    const t = i * dt;
    state = updateAquarium(state, frame({ t, dt, width: 340, height: 170, mode: "recording", activity: 0.45, audioLevel: 0.30 }), params);
    const euglena = state.euglena[0] as MotorEuglenaState;
    const hero = frame().hero;
    const heroDx = euglena.x - hero.x;
    const heroDy = euglena.y - hero.y;
    samples.push({
      t,
      x: euglena.x,
      y: euglena.y,
      heading: euglena.heading,
      speed: Math.hypot(euglena.x - previous.x, euglena.y - previous.y) / dt,
      phase: euglena.motorPhase,
      turnFrom: euglena.turnFrom,
      turnTo: euglena.turnTo,
      photoTargetIndex: euglena.photoTargetIndex,
      photoTargetAge: euglena.photoTargetAge,
      heroDistance: Math.hypot(heroDx, heroDy) / hero.radius,
      heroBearing: Math.atan2(heroDy, heroDx),
    });
    previous = euglena;
  }

  return samples;
}

function maxConsecutiveSeconds(samples: readonly MotorSample[], predicate: (sample: MotorSample) => boolean): number {
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

function summarizeMotorSamples(samples: readonly MotorSample[]) {
  const phaseCounts: Partial<Record<EuglenaMotorPhase, number>> = {};
  let commitTurnEvents = 0;
  let path = 0;
  let headingAbs = 0;
  let previous = samples[0];
  const commitTurnAngles: number[] = [];

  for (const sample of samples) {
    if (sample.phase) phaseCounts[sample.phase] = (phaseCounts[sample.phase] ?? 0) + 1;
    if (sample.phase === "commitTurn" && previous?.phase !== "commitTurn") {
      commitTurnEvents += 1;
      const turn = Math.abs(wrapPi(finiteNumber(sample.turnTo, sample.heading) - finiteNumber(sample.turnFrom, previous.heading)));
      if (turn > 1e-6) commitTurnAngles.push(turn * 180 / Math.PI);
    }
    if (previous) {
      path += Math.hypot(sample.x - previous.x, sample.y - previous.y);
      headingAbs += Math.abs(wrapPi(sample.heading - previous.heading));
    }
    previous = sample;
  }

  const speeds = samples.map((sample) => sample.speed);
  const photoCheckRatio = (phaseCounts.photoCheck ?? 0) / Math.max(1, samples.length);
  const edgeDwellSeconds = maxConsecutiveSeconds(samples, (sample) => (
    sample.x < 55 || sample.x > 285 || sample.y < 32 || sample.y > 138
  ));
  const stillRunSeconds = maxConsecutiveSeconds(samples, (sample) => sample.speed < 0.5 && sample.phase !== "photoCheck");
  const heroDistanceCv = coefficientOfVariation(samples.map((sample) => sample.heroDistance));
  const maxHeroCirculation10s = maxWindowMetric(samples, 10 * 60, (window) => {
    let bearingTravel = 0;
    for (let i = 1; i < window.length; i++) bearingTravel += Math.abs(wrapPi(window[i].heroBearing - window[i - 1].heroBearing));
    return bearingTravel / (2 * Math.PI);
  });

  const laneBins = new Map<number, number>();
  for (const sample of samples) {
    const bin = Math.floor(sample.y / 10);
    laneBins.set(bin, (laneBins.get(bin) ?? 0) + 1);
  }

  return {
    phaseCounts,
    photoCheckRatio,
    commitTurnEvents,
    medianCommitTurnDeg: percentile(commitTurnAngles, 0.50),
    p90CommitTurnDeg: percentile(commitTurnAngles, 0.90),
    speedP10: percentile(speeds, 0.10),
    speedP90: percentile(speeds, 0.90),
    edgeDwellSeconds,
    stillRunSeconds,
    pathPerHeadingRad: path / Math.max(1e-9, headingAbs),
    dominantLaneRatio: Math.max(0, ...laneBins.values()) / Math.max(1, samples.length),
    legacyWaypointRouteFrames: samples.filter((sample) => sample.photoTargetIndex !== undefined || sample.photoTargetAge !== undefined).length,
    heroDistanceCv,
    maxHeroCirculation10s,
  };
}

function expectCloseState<T extends Record<string, unknown>>(
  actual: T,
  expected: Partial<Record<keyof T, number>>,
  digits = 10,
): void {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key], key).toBeCloseTo(value, digits);
  }
}

describe("all_aquarium update oracle", () => {
  it("freezes one seeded hero/Euglena/Vorticella/Didinium update step with the legacy default-off motor path", () => {
    const params = allAquariumLegacyDefaultOffParams();
    const seedFrame = frame();
    const updateFrame = frame({ t: 1.25, dt: 0.05 });

    const initial = seedAquarium(seedFrame, params);
    const next = updateAquarium(initial, updateFrame, params);
    const field = buildAquariumInteractionField(
      initial.euglena,
      initial.vorticella,
      seedFrame.hero,
      params.vorticellaScale,
      seedFrame.height,
      initial.didinium,
      params.euglenaScale,
      params.didiniumScale,
    );

    expect(initial.seed).toBe(13);
    expect({
      diatoms: initial.diatoms.length,
      euglena: initial.euglena.length,
      vorticella: initial.vorticella.length,
      didinium: initial.didinium.length,
    }).toEqual({ diatoms: 0, euglena: 1, vorticella: 1, didinium: 1 });

    expect(field.obstacles.map((contrib) => contrib.sourceId)).toEqual([
      sourceId("vorticella", 0),
      sourceId("hero", 0),
    ]);
    expect(field.wakes.map((contrib) => contrib.sourceId)).toEqual([
      sourceId("vorticella", 0),
      sourceId("hero", 0),
    ]);
    expect(field.motiles.map((contrib) => contrib.sourceId)).toEqual([
      sourceId("euglena", 0),
      sourceId("didinium", 0),
      sourceId("hero", 0),
    ]);
    expect(field.obstacles[1]).toMatchObject({
      kind: "obstacle",
      shape: "ellipse",
      social: true,
      x: 155,
      y: 87,
      halfLen: 37,
      halfWid: 14,
      heading: 0.28,
      sourceId: sourceId("hero", 0),
    });
    expect(field.motiles[0]).toMatchObject({ kind: "motile", role: "neutral", strength: 0.35, sourceId: sourceId("euglena", 0) });
    expect(field.motiles[1]).toMatchObject({ kind: "motile", role: "predator", strength: 0.75, sourceId: sourceId("didinium", 0) });
    expect(field.motiles[2]).toMatchObject({ kind: "motile", role: "prey", strength: 1, sourceId: sourceId("hero", 0) });

    const seededEuglena = initial.euglena[0];
    const seededVorticella = initial.vorticella[0];
    const seededDidinium = initial.didinium[0];
    const nextEuglena = next.euglena[0];
    const nextVorticella = next.vorticella[0];
    const nextDidinium = next.didinium[0];

    expectCloseState<EuglenaState>(seededEuglena, {
      x: 211.04196859989315,
      y: 38.29646807862446,
      heading: -0.1105549210915342,
      swimSpeed: 0.8563175361836329,
      startle: 0,
      rollPhase: 0.6871909701731056,
      flagellumPhase: 0.3403015062212944,
      burstPhase: 0.45452829520218074,
    });
    expectCloseState<EuglenaState>(nextEuglena, {
      x: 211.45126181078513,
      y: 38.340639308785356,
      heading: 0.10750467313452511,
      startle: 0,
      tumbleProgress: 1,
      rollPhase: 0.7204900612203637,
      flagellumPhase: 0.7132527723538029,
      burstPhase: 0.45764558582718085,
    });

    expectCloseState<VorticellaState>(seededVorticella, {
      anchorX: 102,
      anchorY: 169.5,
      directionAngle: -1.3307963267948966,
      restLength: 10.673460966791026,
      contractPhase: 0.27815343433221307,
      contractLeg: 0,
      contractTimer: 0.16971843678038567,
      voiceEnv: 0,
    });
    expectCloseState<VorticellaState>(nextVorticella, {
      anchorX: 102,
      anchorY: 169.5,
      directionAngle: -1.3307963267948966,
      restLength: 10.673460966791026,
      contractPhase: 0,
      contractLeg: 0,
      contractTimer: 0.21971843678038566,
      voiceEnv: 0.0690832237992237,
      oralWreathPhase: 0.5368392523378134,
    });

    expectCloseState<DidiniumState>(seededDidinium, {
      x: 262.5033293776214,
      y: 61.522804194828495,
      heading: 0.3380968844637555,
      swimSpeed: 0.9025290206074714,
      avoidProgress: 1,
      rollPhase: 0.04422531882300973,
      beatPhase: 0.9008368987124413,
    });
    expectCloseState<DidiniumState>(nextDidinium, {
      x: 264.94737852926033,
      y: 61.77720621949277,
      heading: 0.3380968844637555,
      swimSpeed: 0.9025290206074714,
      contactTimer: 0,
      huntCooldown: 0,
      avoidProgress: 1,
      rollPhase: 0.08467072853539137,
      beatPhase: 0.20083689871244137,
    });
  });

  it("keeps the legacy default-off all_aquarium Euglena visibly traversing instead of station-keeping", () => {
    const params = allAquariumLegacyDefaultOffParams();
    let state = seedAquarium(frame({ t: 0, mode: "recording", activity: 0.4, audioLevel: 0.4 }), params);
    const xs: number[] = [];
    const ys: number[] = [];

    for (let i = 0; i < 60 * 36; i++) {
      state = updateAquarium(state, frame({ t: i / 60, dt: 1 / 60, mode: "recording", activity: 0.4, audioLevel: 0.4 }), params);
      if (i % 120 === 0) {
        xs.push(state.euglena[0].x);
        ys.push(state.euglena[0].y);
      }
    }

    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(120);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(60);
  });

  it("does not wait at an edge during long legacy default-off all_aquarium photo-intent transit", () => {
    const params = allAquariumLegacyDefaultOffParams();
    let state = seedAquarium(frame({ t: 0, mode: "recording", activity: 0.4, audioLevel: 0.4 }), params);
    let leftEdgeFrames = 0;
    let rightEdgeFrames = 0;
    let stillRunFrames = 0;
    let maxStillRunFrames = 0;
    let previous = state.euglena[0];
    const sampledX: number[] = [];
    const sampledY: number[] = [];

    for (let i = 0; i < 60 * 90; i++) {
      state = updateAquarium(state, frame({ t: i / 60, dt: 1 / 60, mode: "recording", activity: 0.4, audioLevel: 0.4 }), params);
      const euglena = state.euglena[0];
      if (euglena.x < 55) leftEdgeFrames++;
      if (euglena.x > 285) rightEdgeFrames++;
      const step = Math.hypot(euglena.x - previous.x, euglena.y - previous.y);
      if (step < 0.02) {
        stillRunFrames++;
      } else {
        maxStillRunFrames = Math.max(maxStillRunFrames, stillRunFrames);
        stillRunFrames = 0;
      }
      previous = euglena;
      if (i % 60 === 0) {
        sampledX.push(euglena.x);
        sampledY.push(euglena.y);
      }
    }
    maxStillRunFrames = Math.max(maxStillRunFrames, stillRunFrames);

    expect(leftEdgeFrames / 60).toBeLessThan(2);
    expect(rightEdgeFrames / 60).toBeLessThan(2);
    expect(maxStillRunFrames / 60).toBeLessThan(0.5);
    expect(Math.max(...sampledX) - Math.min(...sampledX)).toBeGreaterThan(130);
    expect(Math.max(...sampledY) - Math.min(...sampledY)).toBeGreaterThan(60);
  });

  it("all_aquarium motor-on exposes living Euglena motor phases and acceptance metrics", () => {
    const params = allAquariumMotorOnParams();
    const initial = seedAquarium(frame(), params);
    const field = buildAquariumInteractionField(
      initial.euglena,
      initial.vorticella,
      frame().hero,
      params.vorticellaScale,
      frame().height,
      initial.didinium,
      params.euglenaScale,
      params.didiniumScale,
    );
    const samples = simulateAllAquariumMotorOn(90);
    const summary = summarizeMotorSamples(samples);

    expect(field.motiles[0]).toMatchObject({ kind: "motile", role: "neutral", sourceId: sourceId("euglena", 0) });
    expect(summary.phaseCounts.run ?? 0, "motorPhase=run should exist when euglenaMotorEnabled is true").toBeGreaterThan(0);
    expect(summary.phaseCounts.photoCheck ?? 0, "motorPhase=photoCheck should exist when euglenaMotorEnabled is true").toBeGreaterThan(0);
    expect(summary.phaseCounts.commitTurn ?? 0, "motorPhase=commitTurn should exist when euglenaMotorEnabled is true").toBeGreaterThan(0);
    expect(summary.phaseCounts.recover ?? 0, "motorPhase=recover should exist when euglenaMotorEnabled is true").toBeGreaterThan(0);
    expect(summary.photoCheckRatio, "photoCheck/slow assessment frames should be 3–15% of motor-on runtime").toBeGreaterThanOrEqual(0.03);
    expect(summary.photoCheckRatio, "photoCheck/slow assessment frames should be 3–15% of motor-on runtime").toBeLessThanOrEqual(0.15);
    expect(summary.commitTurnEvents, "calm motor-on Euglena should commit about 5–9 visible turns in 90s").toBeGreaterThanOrEqual(5);
    expect(summary.commitTurnEvents, "calm motor-on Euglena should not read as a frequent route-correction follower").toBeLessThanOrEqual(9);
    expect(summary.medianCommitTurnDeg, "calm motor-on median commit turn should stay in a biological 25–60° band").toBeGreaterThanOrEqual(25);
    expect(summary.medianCommitTurnDeg, "calm motor-on median commit turn should stay in a biological 25–60° band").toBeLessThanOrEqual(60);
    expect(summary.p90CommitTurnDeg, "calm motor-on p90 commit turn should avoid hard reversals").toBeLessThan(110);
    expect(summary.speedP90 - summary.speedP10, "motor-on Euglena should have visible speed variance").toBeGreaterThan(0.5);
    expect(summary.edgeDwellSeconds, "motor-on Euglena should not dwell at any edge for more than 2s").toBeLessThan(2);
    expect(summary.stillRunSeconds, "motor-on Euglena should not be still in run/recover/turn phases for more than 0.5s").toBeLessThan(0.5);
  });

  it("motor-on all_aquarium rejects fixed waypoint rails, orbiting, and companion-like circulation", () => {
    const samples = simulateAllAquariumMotorOn(90);
    const summary = summarizeMotorSamples(samples);

    expect(summary.legacyWaypointRouteFrames, "motor-on mode should not expose the legacy photoTarget waypoint rail signature").toBe(0);
    expect(summary.pathPerHeadingRad, "motor-on path should materially improve over the ~11px/rad route-following baseline").toBeGreaterThanOrEqual(18);
    expect(summary.dominantLaneRatio, "motor-on path should not repeatedly occupy one artificial horizontal band").toBeLessThan(0.25);
    expect(summary.heroDistanceCv, "motor-on Euglena should not hold a fixed normalized distance around the hero").toBeGreaterThan(0.12);
    expect(summary.maxHeroCirculation10s, "motor-on Euglena should not companion-orbit around the hero for a sustained 10s window").toBeLessThan(0.5);
  });
});
