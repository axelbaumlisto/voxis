import { describe, expect, it } from "vitest";
import { PARAMECIUM_CELL_PARAMS } from "../../../../builtin/_shared/paramecium";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { REGISTRY, sceneFromParams } from "../registry";

function driftingContourParams(): CellParams {
  return {
    ...CELL_DEFAULTS,
    ...PARAMECIUM_CELL_PARAMS,
    enableAquarium: true,
    aquariumSeed: 17,
    aquariumAlpha: 0.68,
    aquariumActivityBoost: 1.0,
    diatomCount: 0,
    diatomAlpha: 0.16,
    diatomDriftSpeed: 0.35,
    euglenaCount: 1,
    euglenaSpeed: 0.20,
    euglenaSpeedActive: 1.5,
    euglenaScale: 2.8,
    euglenaGravitaxis: 0.2,
    euglenaPhototaxis: 0.6,
    euglenaRotDiffusion: 0.12,
    vorticellaCount: 0,
  };
}

function parameciumSoloParams(): CellParams {
  return {
    ...CELL_DEFAULTS,
    ...PARAMECIUM_CELL_PARAMS,
    enableAquarium: false,
  };
}

function euglenaDriftParams(): CellParams {
  return {
    ...CELL_DEFAULTS,
    enableHero: false,
    enableAquarium: true,
    aquariumSeed: 17,
    aquariumAlpha: 0.92,
    aquariumActivityBoost: 0.6,
    diatomCount: 0,
    euglenaCount: 1,
    euglenaSpeed: 0.16,
    euglenaSpeedActive: 0.34,
    euglenaScale: 7.5,
    vorticellaCount: 0,
  };
}

function vorticellaBloomParams(): CellParams {
  return {
    ...CELL_DEFAULTS,
    enableHero: false,
    enableAquarium: true,
    aquariumSeed: 3,
    aquariumAlpha: 0.92,
    aquariumActivityBoost: 0.6,
    diatomCount: 0,
    euglenaCount: 0,
    vorticellaCount: 1,
    vorticellaContractRate: 1.2,
    vorticellaContractRateActive: 1.5,
    vorticellaScale: 5.5,
  };
}

describe("aquarium scene registry", () => {
  it("freezes current species salts and draw z-order", () => {
    expect(REGISTRY).toEqual({
      diatom: { salt: 0x0d1a70cd, z: 0 },
      euglena: { salt: 0x0e091eaa, z: 1 },
      vorticella: { salt: 0x070271ca, z: 2 },
    });
  });
});

describe("sceneFromParams", () => {
  it("maps drifting_contour params to a duo scene", () => {
    expect(sceneFromParams(driftingContourParams())).toEqual({
      seed: 17,
      instances: [
        {
          species: "euglena",
          count: 1,
          cfg: {
            count: 1,
            speed: 0.2,
            speedActive: 1.5,
            scale: 2.8,
            steer: {
              gravitaxis: 0.2,
              phototaxis: 0.6,
            },
            medium: {
              rotDiffusion: 0.12,
            },
          },
        },
      ],
    });
  });

  it("maps paramecium_solo disabled aquarium params to an empty scene", () => {
    expect(sceneFromParams(parameciumSoloParams())).toEqual({
      seed: 1,
      instances: [],
    });
  });

  it("maps euglena_drift params to a euglena-solo scene", () => {
    expect(sceneFromParams(euglenaDriftParams())).toEqual({
      seed: 17,
      instances: [
        {
          species: "euglena",
          count: 1,
          cfg: {
            count: 1,
            speed: 0.16,
            speedActive: 0.34,
            scale: 7.5,
            steer: undefined,
            medium: undefined,
          },
        },
      ],
    });
  });

  it("maps vorticella_bloom params to a vorticella-solo scene", () => {
    expect(sceneFromParams(vorticellaBloomParams())).toEqual({
      seed: 3,
      instances: [
        {
          species: "vorticella",
          count: 1,
          cfg: {
            count: 1,
            contractRate: 1.2,
            contractRateActive: 1.5,
            scale: 5.5,
            alongFrac: 0.5,
          },
        },
      ],
    });
  });
});
