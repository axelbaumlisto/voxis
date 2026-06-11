// src/harness/scenarios.ts
/**
 * Pure ThemeState frame generators for the visual harness. No DOM, no time —
 * each scenario maps a frame index to a ThemeState, so behaviors (speech
 * growth, startle, idle morph) are deterministic and unit-testable, and the
 * harness can scrub/replay them at any speed.
 */
import type { ThemeMode, ThemeState } from "../theme-engine/contract";

/** Build a 32-bin spectrum for a given level, animated by frame f. */
export function makeSpectrum(level: number, f: number): number[] {
  const bins: number[] = [];
  for (let i = 0; i < 32; i++) {
    // smooth pseudo-spectral shape; deterministic in (i, f)
    const wave = 0.5 + 0.5 * Math.sin(i * 0.5 + f * 0.25);
    const falloff = 1 - i / 48; // gentle high-freq rolloff
    const v = level * wave * falloff;
    bins.push(Math.max(0, Math.min(1, v)));
  }
  return bins;
}

export interface Scenario {
  id: string;
  label: string;
  /** Total frames (at ~12.5 fps ≈ the 80ms backend cadence). */
  frames: number;
  at(frame: number): ThemeState;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function state(mode: ThemeMode, level: number, f: number): ThemeState {
  const lvl = clamp01(level);
  return { mode, audioLevel: lvl, spectrumBins: makeSpectrum(lvl, f) };
}

// Speech that ramps up, sustains loud, then trails into silence (idle).
const speechGrowth: Scenario = {
  id: "speech_growth",
  label: "Speech → grow → silence",
  frames: 160,
  at(f) {
    if (f < 90) {
      // rising then loud sustained speech
      const ramp = Math.min(1, f / 30);
      const lvl = 0.45 + 0.4 * ramp * (0.7 + 0.3 * Math.abs(Math.sin(f * 0.3)));
      return state("recording", lvl, f);
    }
    // silence / rest — let the held growth + idle morph show
    return state("idle", 0, f);
  },
};

// Quiet, then a single sharp loud spike (startle), then quiet again.
const startleBurst: Scenario = {
  id: "startle_burst",
  label: "Startle burst",
  frames: 120,
  at(f) {
    const spike = f >= 40 && f < 46; // ~0.5s loud burst after quiet
    const lvl = spike ? 0.95 : 0.12;
    return state("recording", lvl, f);
  },
};

// Rest only — exercises the idle morphing of the living cell.
const idleMorphSc: Scenario = {
  id: "idle_morph",
  label: "Idle morph (rest)",
  frames: 200,
  at(f) {
    return state("idle", 0, f);
  },
};

// Steady, continuous speech at a moderate level.
const steadySpeech: Scenario = {
  id: "steady_speech",
  label: "Steady speech",
  frames: 120,
  at(f) {
    const lvl = 0.55 + 0.2 * Math.sin(f * 0.4);
    return state("recording", lvl, f);
  },
};

export const SCENARIOS: Scenario[] = [
  speechGrowth,
  startleBurst,
  idleMorphSc,
  steadySpeech,
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}