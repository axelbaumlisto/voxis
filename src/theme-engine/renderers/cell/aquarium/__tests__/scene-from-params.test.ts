import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PARAMECIUM_CELL_PARAMS } from "../../../../builtin/_shared/paramecium";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { seedAquarium } from "../layer";
import { seedEuglena } from "../euglena";
import { REGISTRY, sceneFromParams } from "../registry";
import type { AquariumFrame, AquariumLayerState } from "../types";

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
    vorticellaScale: 5.5,
  };
}

function multiOrganismParams(): CellParams {
  return {
    ...CELL_DEFAULTS,
    enableAquarium: true,
    aquariumSeed: 23,
    diatomCount: 2,
    euglenaCount: 1,
    vorticellaCount: 1,
    diatomAlpha: 0.16,
    diatomDriftSpeed: 0.35,
    euglenaSpeed: 0.2,
    euglenaSpeedActive: 1.5,
    euglenaScale: 2.8,
    vorticellaContractRate: 1.2,
    vorticellaScale: 1.2,
    vorticellaAlongFrac: 0.16,
  };
}

const registryFrame: AquariumFrame = {
  t: 0,
  dt: 1 / 60,
  width: 240,
  height: 80,
  mode: "idle",
  activity: 0,
  audioLevel: 0,
  startle: 0,
  baseHue: 50,
};

describe("aquarium scene registry", () => {
  it("freezes current species salts and draw z-order", () => {
    expect(Object.fromEntries(Object.entries(REGISTRY).map(([species, entry]) => [species, entry.salt]))).toEqual({
      diatom: 0x0d1a70cd,
      euglena: 0x0e091eaa,
      vorticella: 0x070271ca,
      didinium: 0x0d1d1c0a,
    });
    expect(Object.fromEntries(Object.entries(REGISTRY).map(([species, entry]) => [species, entry.z]))).toEqual({
      diatom: 0,
      euglena: 1,
      vorticella: 2,
      didinium: 3,
    });
    expect(Object.fromEntries(Object.entries(REGISTRY).map(([species, entry]) => [species, entry.slot]))).toEqual({
      diatom: "diatoms",
      euglena: "euglena",
      vorticella: "vorticella",
      didinium: "didinium",
    });
  });

  it("keeps euglena seed streams isolated from registry composition", () => {
    const direct = seedEuglena(2, 17, registryFrame);
    const viaRegistry = REGISTRY.euglena.seed(2, 17, registryFrame, undefined);
    const withExtraSpecies = {
      ghost: {
        salt: 0x12345678,
        z: 99,
        seed: (count: number) => Array.from({ length: count }, (_, i) => ({ i })),
        update: (states: readonly { i: number }[]) => states,
        draw: () => undefined,
      },
      ...REGISTRY,
    };

    expect(REGISTRY.euglena.salt).toBe(0x0e091eaa);
    expect(viaRegistry).toEqual(direct);
    expect(withExtraSpecies.euglena.seed(2, 17, registryFrame, undefined)).toEqual(direct);
  });

  it("keeps production seed/draw dispatch data-driven for non-interacting organisms", () => {
    const validSlots = new Set(["diatoms", "euglena", "vorticella", "didinium"]);
    for (const entry of Object.values(REGISTRY)) {
      expect(validSlots.has(entry.slot)).toBe(true);
      expect(entry.seed).toEqual(expect.any(Function));
      expect(entry.update).toEqual(expect.any(Function));
      expect(entry.draw).toEqual(expect.any(Function));
    }

    const scene = sceneFromParams(multiOrganismParams());
    const expected: AquariumLayerState = { seed: scene.seed, diatoms: [], euglena: [], vorticella: [], didinium: [] };
    for (const instance of scene.instances) {
      const entry = REGISTRY[instance.species];
      expected[entry.slot] = entry.seed(instance.count, scene.seed, registryFrame, instance.cfg) as never;
    }

    expect(seedAquarium(registryFrame, multiOrganismParams())).toEqual(expected);

    const layerSource = readFileSync(resolve(process.cwd(), "src/theme-engine/renderers/cell/aquarium/layer.ts"), "utf8");
    const seedBody = layerSource.slice(
      layerSource.indexOf("export function seedAquarium"),
      layerSource.indexOf("export function updateAquarium"),
    );
    const drawBody = layerSource.slice(layerSource.indexOf("export function drawAquariumBackground"));
    expect(seedBody).not.toMatch(/if\s*\([^)]*species|switch\s*\([^)]*species|species\s*===/);
    expect(drawBody).not.toMatch(/if\s*\([^)]*species|switch\s*\([^)]*species|species\s*===/);
  });
});

describe("sceneFromParams", () => {
  it("maps duo_aquarium params to an independent motor-on Euglena scene", () => {
    expect(sceneFromParams(duoAquariumParams())).toEqual({
      seed: 2,
      instances: [
        {
          species: "euglena",
          count: 1,
          cfg: {
            count: 1,
            speed: 0.29,
            speedActive: 0.62,
            scale: 2.7,
            flagellumRateScale: 0.55,
            hueOffset: 42,
            photoIntent: 0.8,
            motorEnabled: true,
            steer: {
              gravitaxis: 0.02,
              phototaxis: 0,
              loiter: 0,
              wake: 0,
            },
            medium: undefined,
            seed: 2,
            aquariumAlpha: 0.68,
            activityBoost: 1,
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
            speed: 0.19,
            speedActive: 0.54,
            scale: 4.05,
            flagellumRateScale: 0.45,
            hueOffset: 42,
            photoIntent: 1.2,
            motorEnabled: true,
            steer: {
              gravitaxis: 0.02,
              phototaxis: 0,
              loiter: 0,
              wake: 0,
            },
            medium: undefined,
            seed: 17,
            aquariumAlpha: 1.0,
            activityBoost: 0.6,
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
            scale: 5.5,
            alongFrac: 0.5,
            seed: 3,
            aquariumAlpha: 0.92,
            activityBoost: 0.6,
          },
        },
      ],
    });
  });
});
