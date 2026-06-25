import type { EuglenaState } from "../types";
import { mix32 } from "../seeds";
import { clamp01, finite, finiteOr } from "../util";

export type EuglenaMotorPhase = "run" | "photoCheck" | "commitTurn" | "recover";

export interface EuglenaMotorContext {
  readonly dt: number;
  readonly currentHeading: number;
  readonly noiseSeed: number;
  readonly rollPhase: number;
  readonly activity?: number;
  readonly audioLevel?: number;
  readonly stimulus?: number;
  readonly stimulusBearing?: number;
  readonly edgePressure?: boolean;
  readonly edgeBearing?: number;
  readonly heroPressure?: boolean;
  readonly obstaclePressure?: boolean;
  readonly hazardPressure?: boolean;
  readonly safetyPressure?: number;
}

export interface EuglenaMotorOutput {
  readonly phase: EuglenaMotorPhase;
  readonly motorAge: number;
  readonly motorDuration: number;
  readonly motorIndex: number;
  readonly intentHeading: number;
  readonly photoAdapt: number;
  readonly lastStimulus: number;
  readonly speedMul: number;
  readonly beatMul: number;
  readonly turnProgress: number;
  readonly turnFrom: number;
  readonly turnTo: number;
  readonly scanCue?: number;
  readonly metabolyCue?: number;
}

const RUN_MIN_SECONDS = 6;
const RUN_MAX_SECONDS = 22;
const PHOTO_CHECK_MIN_SECONDS = 0.40;
const PHOTO_CHECK_MAX_SECONDS = 0.90;
const COMMIT_TURN_MIN_SECONDS = 0.35;
const COMMIT_TURN_MAX_SECONDS = 0.8;
const RECOVER_MIN_SECONDS = 0.6;
const RECOVER_MAX_SECONDS = 1.4;
const PHOTO_PREFERRED_STIMULUS = 0.58;
const PHOTO_STRESS_STIMULUS = 0.78;

function unit(seed: number, index: number, salt: number): number {
  return mix32((seed | 0) ^ Math.imul((index | 0) + 1, 0x9e3779b1) ^ (salt | 0)) / 0x100000000;
}

function wrapPi(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function durationFor(phase: EuglenaMotorPhase, seed: number, index: number): number {
  const u = unit(seed, index, 0x6d2b79f5);
  switch (phase) {
    case "run": {
      // Concave mapping clusters typical runs around ~9–14s while retaining a 6–22s range.
      return RUN_MIN_SECONDS + (RUN_MAX_SECONDS - RUN_MIN_SECONDS) * Math.pow(u, 1.35);
    }
    case "photoCheck":
      return PHOTO_CHECK_MIN_SECONDS + (PHOTO_CHECK_MAX_SECONDS - PHOTO_CHECK_MIN_SECONDS) * u;
    case "commitTurn":
      return COMMIT_TURN_MIN_SECONDS + (COMMIT_TURN_MAX_SECONDS - COMMIT_TURN_MIN_SECONDS) * u;
    case "recover":
      return RECOVER_MIN_SECONDS + (RECOVER_MAX_SECONDS - RECOVER_MIN_SECONDS) * u;
  }
}

function stimulusFrom(context: EuglenaMotorContext): number {
  const explicit = context.stimulus;
  if (explicit !== undefined) return clamp01(finite(explicit, 0));
  return clamp01(finiteOr(context.activity, 0) + 0.5 * finiteOr(context.audioLevel, 0));
}

function sensoryPressureFor(stimulus: number, stimulusStep: number, photoAdapt: number): number {
  const stepDrive = clamp01(stimulusStep / 0.24);
  const highDrive = clamp01((stimulus - PHOTO_STRESS_STIMULUS) / (1 - PHOTO_STRESS_STIMULUS));
  return Math.max(stepDrive, highDrive) * (1 - 0.78 * clamp01(photoAdapt));
}

function nextPhaseAfterRun(stimulusPressure: number, pressure: number): EuglenaMotorPhase {
  return stimulusPressure > 0.30 || pressure > 0.45 ? "photoCheck" : "commitTurn";
}

function runIntentHeading(context: EuglenaMotorContext, stimulus: number, photoAdapt: number): number {
  const base = finite(context.currentHeading, 0);
  if (context.edgePressure && context.edgeBearing !== undefined && Number.isFinite(context.edgeBearing)) {
    const inwardDelta = Math.max(-0.58, Math.min(0.58, wrapPi(context.edgeBearing - base)));
    return wrapPi(base + inwardDelta);
  }
  const bearing = context.stimulusBearing;
  if (bearing === undefined || !Number.isFinite(bearing)) return base;
  if (context.heroPressure || context.obstaclePressure || context.hazardPressure) return base;
  if (finiteOr(context.safetyPressure, 0) > 0.15) return base;
  const lowDrive = clamp01((PHOTO_PREFERRED_STIMULUS - stimulus) / PHOTO_PREFERRED_STIMULUS) * (1 - 0.45 * clamp01(photoAdapt));
  const comfortDrive = 0.80;
  return wrapPi(base + wrapPi(bearing - base) * (comfortDrive + 0.18 * lowDrive));
}

function nextIntentHeading(context: EuglenaMotorContext, phaseIndex: number, photoAdapt: number): number {
  const seed = context.noiseSeed | 0;
  const base = finite(context.currentHeading, 0);
  const bearing = context.stimulusBearing;
  const hasBearing = bearing !== undefined && Number.isFinite(bearing);
  const signed = unit(seed, phaseIndex, 0x1b873593) < 0.5 ? -1 : 1;
  const rawAmplitude = 0.34 + unit(seed, phaseIndex, 0x85ebca6b) * 0.62;
  const stimulusAmplitude = rawAmplitude * (1 + 0.32 * clamp01(finiteOr(context.stimulus, 0) - PHOTO_PREFERRED_STIMULUS));
  const amplitude = stimulusAmplitude * (1 - 0.55 * clamp01(photoAdapt));
  const safety = clamp01(finiteOr(context.safetyPressure, 0));
  if (context.edgePressure && context.edgeBearing !== undefined && Number.isFinite(context.edgeBearing)) {
    const inward = finiteOr(context.edgeBearing, base);
    const inwardDelta = Math.max(-0.95, Math.min(0.95, wrapPi(inward - base)));
    const wobble = signed * Math.min(0.18, rawAmplitude * 0.12) * (1 - 0.35 * safety);
    return wrapPi(base + inwardDelta + wobble);
  }
  if (context.hazardPressure || safety > 0.7) return wrapPi(base + signed * Math.min(1.25, amplitude * 1.35));
  if (hasBearing && !context.edgePressure && !context.heroPressure && !context.obstaclePressure) {
    const target = finiteOr(bearing, base);
    const bias = wrapPi(target - base) * (0.12 + 0.26 * (1 - photoAdapt));
    return wrapPi(base + bias + signed * amplitude * 0.50);
  }
  return wrapPi(base + signed * amplitude);
}

function outputFor(
  phase: EuglenaMotorPhase,
  age: number,
  duration: number,
  index: number,
  intentHeading: number,
  turnFrom: number,
  photoAdapt: number,
  lastStimulus: number,
): EuglenaMotorOutput {
  const progress = duration > 0 ? clamp01(age / duration) : 1;
  switch (phase) {
    case "run":
      return {
        phase,
        motorAge: age,
        motorDuration: duration,
        motorIndex: index,
        intentHeading,
        photoAdapt,
        lastStimulus,
        speedMul: 1,
        beatMul: 1,
        turnProgress: 0,
        turnFrom,
        turnTo: intentHeading,
      };
    case "photoCheck":
      return {
        phase,
        motorAge: age,
        motorDuration: duration,
        motorIndex: index,
        intentHeading,
        photoAdapt,
        lastStimulus,
        speedMul: 0.62,
        beatMul: 1.06,
        turnProgress: 0,
        turnFrom,
        turnTo: intentHeading,
        scanCue: Math.sin(progress * Math.PI),
        metabolyCue: 0.08,
      };
    case "commitTurn":
      return {
        phase,
        motorAge: age,
        motorDuration: duration,
        motorIndex: index,
        intentHeading,
        photoAdapt,
        lastStimulus,
        speedMul: 0.74,
        beatMul: 1.32,
        turnProgress: progress,
        turnFrom,
        turnTo: intentHeading,
        metabolyCue: 0.28,
      };
    case "recover":
      return {
        phase,
        motorAge: age,
        motorDuration: duration,
        motorIndex: index,
        intentHeading,
        photoAdapt,
        lastStimulus,
        speedMul: 0.65 + 0.35 * progress,
        beatMul: 1.2 - 0.2 * progress,
        turnProgress: 1,
        turnFrom,
        turnTo: intentHeading,
        metabolyCue: 0.15 * (1 - progress),
      };
  }
}

/** Pure deterministic Euglena motor step. Does not resolve walls/obstacles or mutate input state. */
export function advanceEuglenaMotor(cell: EuglenaState, context: EuglenaMotorContext): EuglenaMotorOutput {
  const dt = Math.max(0, finite(context.dt, 0));
  const seed = context.noiseSeed | 0;
  const stimulus = stimulusFrom(context);
  const lastStimulus0 = clamp01(finiteOr(cell.lastStimulus, stimulus));
  const phase0 = cell.motorPhase ?? "run";
  const index0 = Math.max(0, Math.floor(finiteOr(cell.motorIndex, 0)));
  const duration0 = Math.max(0.001, finiteOr(cell.motorDuration, durationFor(phase0, seed, index0)));
  const age0 = Math.max(0, finiteOr(cell.motorAge, 0));
  const currentHeading = finite(context.currentHeading, finiteOr(cell.heading, 0));
  const intentFallback = phase0 === "commitTurn" || phase0 === "recover"
    ? finiteOr(cell.turnTo, currentHeading)
    : currentHeading;
  const intent0 = finiteOr(cell.intentHeading, intentFallback);
  const turnFrom0 = finiteOr(cell.turnFrom, currentHeading);
  const stimulusStep0 = Math.max(0, stimulus - lastStimulus0);
  const pressure = (context.edgePressure || context.heroPressure || context.obstaclePressure || context.hazardPressure)
    ? 1
    : clamp01(finiteOr(context.safetyPressure, 0));
  const recoveryTau = 55;
  const adaptationTau = 28;
  const photoAdapt0 = clamp01(finiteOr(cell.photoAdapt, 0));
  const targetAdapt = Math.max(
    clamp01(stimulusStep0 / 0.30),
    clamp01((stimulus - PHOTO_PREFERRED_STIMULUS) / (1 - PHOTO_PREFERRED_STIMULUS)),
  );
  const adaptAlpha = dt <= 0 ? 0 : 1 - Math.exp(-dt / (targetAdapt > photoAdapt0 ? adaptationTau : recoveryTau));
  const photoAdapt = clamp01(photoAdapt0 + (targetAdapt - photoAdapt0) * adaptAlpha);

  if (dt === 0) {
    return outputFor(phase0, age0, duration0, index0, intent0, turnFrom0, photoAdapt0, lastStimulus0);
  }

  let phase = phase0;
  let index = index0;
  let duration = duration0;
  let age = age0 + dt;
  let intentHeading = intent0;
  let turnFrom = turnFrom0;
  const stimulusStep = Math.max(0, stimulus - lastStimulus0);
  const stimulusPressure = sensoryPressureFor(stimulus, stimulusStep, photoAdapt);
  const hasEdgeBearing = context.edgePressure && context.edgeBearing !== undefined && Number.isFinite(context.edgeBearing);

  if (!hasEdgeBearing && phase === "run" && stimulusPressure > 0.42) {
    const earlyAge = duration * (1 - 0.38 * stimulusPressure);
    if (age >= Math.max(0.35, earlyAge)) {
      phase = "photoCheck";
      index += 1;
      duration = durationFor(phase, seed, index);
      age = Math.min(dt, duration);
    }
  }

  if (hasEdgeBearing && phase === "photoCheck" && age > Math.min(duration, PHOTO_CHECK_MIN_SECONDS)) {
    age = duration;
  }

  for (let guard = 0; guard < 8 && age >= duration; guard++) {
    age -= duration;
    index += 1;
    if (phase === "run") {
      phase = nextPhaseAfterRun(stimulusPressure, pressure);
      duration = durationFor(phase, seed, index);
      if (phase === "commitTurn") {
        turnFrom = currentHeading;
        intentHeading = nextIntentHeading(context, index, photoAdapt);
      }
    } else if (phase === "photoCheck") {
      phase = "commitTurn";
      duration = durationFor(phase, seed, index);
      turnFrom = currentHeading;
      intentHeading = nextIntentHeading(context, index, photoAdapt);
    } else if (phase === "commitTurn") {
      phase = "recover";
      duration = durationFor(phase, seed, index);
      turnFrom = intentHeading;
    } else {
      phase = "run";
      duration = durationFor(phase, seed, index);
      turnFrom = intentHeading;
    }
  }

  if (age >= duration) age = duration;
  if (phase === "run") {
    intentHeading = runIntentHeading(context, stimulus, photoAdapt);
    turnFrom = currentHeading;
  }
  return outputFor(phase, age, duration, index, intentHeading, turnFrom, photoAdapt, stimulus);
}

export const EUGLENA_MOTOR_PHASES: readonly EuglenaMotorPhase[] = ["run", "photoCheck", "commitTurn", "recover"];
