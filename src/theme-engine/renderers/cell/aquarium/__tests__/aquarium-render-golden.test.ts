import { describe, expect, it } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { drawEuglena } from "../euglena";
import { drawAquariumBackground, seedAquarium } from "../layer";
import { aquariumParamsView } from "../params";
import type { AquariumFrame, AquariumLayerState } from "../types";
import { RecordingCanvasContext2D, summarize, expectGoldenSummary, type GoldenSummary } from "../../../__tests__/helpers/recordingCanvas";

const GOLDEN_FRAME: AquariumFrame = {
  t: 4.0,
  dt: 1 / 60,
  width: 240,
  height: 80,
  mode: "recording",
  activity: 0.6,
  audioLevel: 0.4,
  startle: 0,
  baseHue: 50,
};

function aquariumGoldenParams(): CellParams {
  return {
    ...CELL_DEFAULTS,
    enableAquarium: true,
    aquariumSeed: 67,
    aquariumAlpha: 0.55,
    diatomCount: 3,
    diatomAlpha: 0.35,
    euglenaCount: 1,
    euglenaScale: 1.4,
    vorticellaCount: 1,
    vorticellaScale: 1.2,
    baseHue: 50,
  };
}

function goldenFor(contractPhase: number): GoldenSummary {
  const params = aquariumGoldenParams();
  const base = seedAquarium(GOLDEN_FRAME, params);
  const state: AquariumLayerState = {
    ...base,
    euglena: base.euglena.map((cell) => ({
      ...cell,
      rollPhase: 0.3,
      metabolyPhase: 0.4,
      flagellumPhase: 0.2,
    })),
    vorticella: base.vorticella.map((cell) => ({
      ...cell,
      contractPhase,
      contractCyclePhase: 0.2,
      oralWreathPhase: 0.5,
    })),
  };
  const ops: string[] = [];
  drawAquariumBackground(
    new RecordingCanvasContext2D(ops) as unknown as CanvasRenderingContext2D,
    state,
    GOLDEN_FRAME,
    params,
  );
  return summarize(ops);
}

function euglenaHueSummary(hueOffset: number): GoldenSummary {
  const params: CellParams = {
    ...CELL_DEFAULTS,
    enableAquarium: true,
    aquariumSeed: 17,
    aquariumAlpha: 0.55,
    euglenaCount: 1,
    euglenaScale: 2.8,
    euglenaHueOffset: hueOffset,
  };
  const seeded = seedAquarium(GOLDEN_FRAME, params).euglena.map((cell) => ({
    ...cell,
    rollPhase: 0.3,
    metabolyPhase: 0.4,
    flagellumPhase: 0.2,
  }));
  const ops: string[] = [];
  drawEuglena(
    new RecordingCanvasContext2D(ops) as unknown as CanvasRenderingContext2D,
    seeded,
    GOLDEN_FRAME,
    aquariumParamsView(params),
  );
  return summarize(ops);
}

describe("aquarium draw-op golden (Epic 1 P0)", () => {
  it("keeps the three-species CONTRACTED draw byte-stable", () => {
    expectGoldenSummary(goldenFor(0.5), {
      // Rebased for the vorticella framing + organelle-readability pass: 6 rimmed food
      // vacuoles + bigger CV + taller bell (bellHeight 1.45D, restStalk 3.1D) change ops/hash.
      hash: "67b928e64e8382bf",
      opCount: 1580,
      counts: {
        beginPath: 250,
        moveTo: 98,
        lineTo: 804,
        closePath: 12,
        fill: 158,
        stroke: 94,
        save: 5,
        ellipse: 6,
        arc: 146,
        restore: 5,
        clip: 2,
      },
    });
  });

  it("keeps the three-species RESTING draw byte-stable", () => {
    expectGoldenSummary(goldenFor(0), {
      // Rebased for the vorticella framing + organelle-readability pass (6 rimmed food
      // vacuoles + bigger CV + taller bell change ops/hash).
      hash: "0dd685e0104d02bd",
      opCount: 1456,
      counts: {
        beginPath: 217,
        moveTo: 65,
        lineTo: 777,
        closePath: 12,
        fill: 158,
        stroke: 61,
        save: 6,
        ellipse: 6,
        arc: 146,
        restore: 6,
        clip: 2,
      },
    });
  });

  it("changes euglena draw ops when the per-instance hue offset changes", () => {
    const defaultHue = euglenaHueSummary(42);
    const shiftedHue = euglenaHueSummary(80);

    expect(defaultHue.hash).not.toEqual(shiftedHue.hash);
    expect(defaultHue.opCount).toBe(shiftedHue.opCount);
    expect(defaultHue.counts).toEqual(shiftedHue.counts);
  });
});
