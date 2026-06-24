import { describe, expect, it } from "vitest";
import { PARAMECIUM_CELL_PARAMS } from "../../../../builtin/_shared/paramecium";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { sourceId } from "../interaction";
import { buildAquariumInteractionField, seedAquarium, updateAquarium } from "../layer";
import type { AquariumFrame, EuglenaState, VorticellaState, DidiniumState } from "../types";

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
    euglenaSpeed: 0.18,
    euglenaSpeedActive: 0.34,
    euglenaScale: 2.2,
    euglenaGravitaxis: 0.03,
    euglenaPhototaxis: 0.08,
    euglenaLoiter: 0,
    euglenaWake: 0.3,
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
  it("freezes one seeded hero/Euglena/Vorticella/Didinium update step", () => {
    const params = allAquariumParams();
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
      x: 211.25875918416583,
      y: 38.297124011169366,
      heading: 0.003025641291249437,
      startle: 0,
      tumbleProgress: 1,
      rollPhase: 0.7204900612203637,
      flagellumPhase: 0.16908209762686877,
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
});
