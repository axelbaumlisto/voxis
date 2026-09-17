import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CELL_DEFAULTS, createCellRenderer } from "../cell";
import type { CellOptions, CellParams } from "../cell";
import type { ThemeState } from "../../contract";
import { installRecordingCanvas, summarize, type DrawOp, type GoldenSummary } from "./helpers/recordingCanvas";

type RafCallback = () => void;

const SIZE = 160;
const FRAME_MS = 16;

const IDLE_STATE: ThemeState = {
  mode: "idle",
  audioLevel: 0,
  spectrumBins: new Array(32).fill(0),
};

const RECORDING_STATE: ThemeState = {
  mode: "recording",
  audioLevel: 0.68,
  spectrumBins: Array.from({ length: 32 }, (_, i) => 0.2 + (i % 8) * 0.07),
};

// Mirrors the locked drifting_contour v1.0 renderer params closely enough to
// guard the draw-order/style surface without importing the theme mount layer.
const DRIFTING_CONTOUR_V1_PARAMS: Partial<CellParams> = {
  noiseScale: 0.9,
  octaves: 4,
  lacunarity: 2.3,
  gain: 0.55,
  timeScale: 0.3,
  membraneAmplitude: 0.35,
  energyDrive: 0.8,
  push: 3.0,
  sharpness: 4,
  intentDrift: 0.08,
  idle: 0.10,
  levelGain: 0.7,
  hueSpread: 8,
  shimmerSpeed: 0.04,
  hueBoost: 4,
  fillAlpha: 0.12,
  fillAlphaActive: 0.45,
  membraneSat: 0.12,
  membraneLightness: 0.75,
  membraneLightnessActive: 0.88,
  cytoplasmSat: 0.10,
  ciliaSat: 0.08,
  granuleSat: 0.10,
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
  idleSwimFrac: 0.30,
  bodyHeadingTau: 1.5,
  interiorHeadingTau: 5.0,
  idleDriftMin: 0.70,
  driftMargin: 30,
  idleMorphAmplitude: 0.16,
  idleMorphSpeed: 0.22,
  idleMorphPeriod: 7,
  idleMorphFloor: 0.3,
  growthSwell: 0.0,
  swimSpeedMaxFrac: 0.045,
  startleSensitivity: 2.8,
  startleDecay: 0.96,
  startleMaxPx: 5,
  startleBaselineRate: 0.08,
  enableSomaticCilia: true,
  somaticCiliaCount: 104,
  ciliaGrowthBoost: 0.0,
  ciliaCurl: 0.32,
  ciliaLengthVar: 0.35,
  enableCiliaOnContour: true,
  enableRigidMembrane: true,
  enableBodyProfile: true,
  bodyProfileType: "egg",
  bodyProfileTaper: 0.20,
  bodyAspect: 3,
  bodyVentralBend: 0.18,
  enableAffine: true,
  enableCiliaStructure: true,
  enableAxialSpin: true,
  axialSpinMax: 1.0,
  nucleusAlpha: 0.85,
  enableVacuoles: true,
  enableCVCanals: true,
  canalLenMul: 2.5,
  canalLineWidth: 1.0,
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
  trichocystLengthMul: 3.0,
  trichocystDecay: 3.0,
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
};

const INTERIOR_HEAVY_PARAMS: Partial<CellParams> = {
  ...DRIFTING_CONTOUR_V1_PARAMS,
  enableInteriorField: true,
  enableCyclosis: true,
  enableOrganelles: true,
  enableVacuoles: true,
  cyclosisGranuleCount: 56,
  foodVacuoleCount: 10,
  granuleSizePx: 1.8,
  foodVacuoleSizeMul: 1.6,
  nucleusIndent: 0.25,
};

const CILIA_HEAVY_PARAMS: Partial<CellParams> = {
  ...CELL_DEFAULTS,
  baseRadiusPx: 28,
  enableSomaticCilia: true,
  somaticCiliaCount: 128,
  somaticCiliaLength: 0.16,
  enableCiliaOnContour: true,
  enableCiliaStructure: true,
  enableRigidMembrane: true,
  enableBodyProfile: true,
  bodyProfileType: "egg",
  bodyProfileTaper: 0.2,
  bodyAspect: 3,
  bodyVentralBend: 0.14,
  enableAffine: true,
  enableActivity: true,
  ciliaGrowthBoost: 0,
  ciliaLengthVar: 0.35,
  ciliaCurl: 0.32,
  ciliaBeatHz: 0.5,
  ciliaBeatHzActive: 0.9,
  enableMetachronal: true,
  metachronalWavelength: 20,
  metachronalSpeed: 1.5,
  metachronalDepth: 0.35,
};

function renderFrame(options: CellOptions, state: ThemeState, frameCount = 1): GoldenSummary {
  localStorage.clear();
  const ops: DrawOp[] = [];
  const restoreCanvas = installRecordingCanvas(ops);
  const rafCalls: RafCallback[] = [];
  let rafId = 0;
  let now = 1000;
  const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: RafCallback) => {
    rafCalls.push(cb);
    return ++rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  try {
    const renderer = createCellRenderer(document.createElement("div"), options);
    renderer.update(state);
    for (let i = 0; i < frameCount; i++) {
      now = 1000 + FRAME_MS * (i + 1);
      const cb = rafCalls.shift();
      if (!cb) throw new Error("expected queued RAF callback");
      cb();
    }
    renderer.destroy();
    return { summary: summarize(ops), ops: [...ops] };
  } finally {
    nowSpy.mockRestore();
    restoreCanvas();
    vi.unstubAllGlobals();
    localStorage.clear();
  }
}

const GOLDEN_CASES = [
    {
      name: "CELL_DEFAULTS idle 160x160",
      options: { width: SIZE, height: SIZE, params: { ...CELL_DEFAULTS } },
      state: IDLE_STATE,
      expected: {
        hash: "1225ecb27ede31d9",
        opCount: 1845,
        counts: { beginPath: 118, moveTo: 116, lineTo: 1486, stroke: 115, closePath: 2, fill: 3, save: 1, clip: 1, arc: 2, restore: 1 },
      },
    },
    {
      name: "drifting_contour v1.0-like idle 160x160",
      options: { width: SIZE, height: SIZE, baseHue: 50, params: DRIFTING_CONTOUR_V1_PARAMS },
      state: IDLE_STATE,
      expected: {
        hash: "497bd1b1104cd9a5",
        opCount: 4690,
        counts: { beginPath: 258, moveTo: 207, lineTo: 3899, stroke: 213, closePath: 4, fill: 53, save: 2, clip: 1, arc: 51, restore: 2 },
      },
    },
    {
      name: "drifting_contour v1.0-like recording 160x160",
      options: { width: SIZE, height: SIZE, baseHue: 50, params: DRIFTING_CONTOUR_V1_PARAMS },
      state: RECORDING_STATE,
      expected: {
        hash: "ec644f00d481ea7e",
        opCount: 4690,
        counts: { beginPath: 258, moveTo: 207, lineTo: 3899, stroke: 213, closePath: 4, fill: 53, save: 2, clip: 1, arc: 51, restore: 2 },
      },
    },
    {
      name: "interior-heavy 160x160",
      options: { width: SIZE, height: SIZE, baseHue: 50, params: INTERIOR_HEAVY_PARAMS },
      state: RECORDING_STATE,
      expected: {
        hash: "0f0991e443f4858b",
        opCount: 4746,
        counts: { beginPath: 276, moveTo: 207, lineTo: 3899, stroke: 215, closePath: 4, fill: 71, save: 2, clip: 1, arc: 69, restore: 2 },
      },
    },
    {
      name: "cilia-heavy 160x160",
      options: { width: SIZE, height: SIZE, baseHue: 50, params: CILIA_HEAVY_PARAMS },
      state: RECORDING_STATE,
      expected: {
        hash: "abad4c28d0df6390",
        opCount: 4734,
        counts: { beginPath: 225, moveTo: 223, lineTo: 4054, stroke: 222, closePath: 2, fill: 3, save: 1, clip: 1, arc: 2, restore: 1 },
      },
    },
  ] as const;

describe("cell renderer draw-call golden", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it.each(GOLDEN_CASES)("keeps draw operations stable: $name", ({ name, options, state, expected }) => {
    const { summary, ops } = renderFrame(options, state);
    // Op TYPES and COUNTS are exact everywhere. The COORDINATES are not: the
    // renderer's trig runs through the platform libm, and macOS-arm64 vs the
    // Linux CI image disagree in the last place often enough to flip a
    // 3-decimal rounding and therefore the sha256 (two cases failed on every
    // Mac since 52cf460, passed on CI, and vice versa after each "refresh").
    // So the hash is checked only when it matches; otherwise every op is
    // compared numerically against the stored golden with a 2e-3 tolerance.
    expect({ opCount: summary.opCount, counts: summary.counts }).toEqual({ opCount: expected.opCount, counts: expected.counts });
    if (summary.hash === expected.hash) return;
    const goldenPath = goldenOpsPath(name);
    if (!existsSync(goldenPath)) {
      throw new Error(`hash ${summary.hash} != ${expected.hash} and no ops golden at ${goldenPath}; run with VOXIS_WRITE_GOLDEN=1 on the reference machine`);
    }
    const golden = readFileSync(goldenPath, "utf8").split("\n").filter((l) => l.length > 0);
    expect(ops.length).toBe(golden.length);
    for (let i = 0; i < ops.length; i++) {
      expectOpClose(ops[i], golden[i], i);
    }
  });
});

const OPS_GOLDEN_DIR = join(process.cwd(), "src/theme-engine/renderers/__tests__/__golden__");

function goldenOpsPath(name: string): string {
  return join(OPS_GOLDEN_DIR, `${name.replace(/[^a-z0-9]+/gi, "_")}.ops.txt`);
}

/** Same op name/arity; every number within 2e-3 (one 3-decimal rounding step
 * on either side of a libm difference). */
function expectOpClose(actual: string, golden: string, index: number): void {
  const num = /-?\d+(?:\.\d+)?/g;
  const shape = (op: string) => op.replace(num, "#");
  if (shape(actual) !== shape(golden)) {
    throw new Error(`op ${index} shape differs:\n  actual ${actual}\n  golden ${golden}`);
  }
  const a = actual.match(num) ?? [];
  const g = golden.match(num) ?? [];
  for (let k = 0; k < a.length; k++) {
    const d = Math.abs(Number(a[k]) - Number(g[k]));
    if (d > 2e-3) {
      throw new Error(`op ${index} number ${k} differs by ${d}:\n  actual ${actual}\n  golden ${golden}`);
    }
  }
}

// One-time generation of the numeric goldens (kept in the repo):
//   VOXIS_WRITE_GOLDEN=1 bunx vitest run src/theme-engine/renderers/__tests__/cell-render-golden.test.ts
if (process.env.VOXIS_WRITE_GOLDEN === "1") {
  describe("write ops goldens", () => {
    it("writes", () => {
      mkdirSync(OPS_GOLDEN_DIR, { recursive: true });
      for (const c of GOLDEN_CASES) {
        const { ops } = renderFrame(c.options, c.state);
        writeFileSync(goldenOpsPath(c.name), ops.join("\n") + "\n");
      }
    });
  });
}
