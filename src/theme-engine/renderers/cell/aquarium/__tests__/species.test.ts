import { describe, expect, it } from "vitest";
import { PARAMECIUM_BASE_HUE, PARAMECIUM_CELL_PARAMS } from "../../../../builtin/_shared/paramecium";
import {
  DIATOM_SPECIES,
  EUGLENA_SPECIES,
  PARAMECIUM_SPECIES,
  VORTICELLA_SPECIES,
  resolveDiatomSpecies,
  resolveEuglenaSpecies,
  resolveParameciumSpecies,
  resolveVorticellaSpecies,
} from "../species";

const FROZEN_EUGLENA_WILD = {
  scale: 2.8,
  speed: 0.2,
  speedActive: 1.5,
  steer: undefined,
  medium: undefined,
  palette: { hueOffset: 42 },
};

const FROZEN_VORTICELLA_DEFAULT = {
  scale: 5.5,
  contractRate: 1.2,
  palette: { hueOffset: 200 },
};

const FROZEN_DIATOM_DEFAULT = {
  alpha: 0.35,
  driftSpeed: 1.0,
};

describe("aquarium species variants", () => {
  it("resolves default species to the frozen default-equivalence data", () => {
    const euglena = resolveEuglenaSpecies("wild");
    expect(euglena).toEqual(FROZEN_EUGLENA_WILD);
    expect(euglena.steer).toBeUndefined();
    expect(euglena.medium).toBeUndefined();

    expect(resolveVorticellaSpecies("default")).toEqual(FROZEN_VORTICELLA_DEFAULT);
    expect(resolveDiatomSpecies("default")).toEqual(FROZEN_DIATOM_DEFAULT);
    expect(resolveParameciumSpecies("aurelia")).toEqual({
      params: { ...PARAMECIUM_CELL_PARAMS },
      baseHue: PARAMECIUM_BASE_HUE,
    });
  });

  it("value-freezes the shipped species map contents", () => {
    expect(EUGLENA_SPECIES.wild).toEqual(FROZEN_EUGLENA_WILD);
    expect(VORTICELLA_SPECIES.default).toEqual(FROZEN_VORTICELLA_DEFAULT);
    expect(DIATOM_SPECIES.default).toEqual(FROZEN_DIATOM_DEFAULT);
    expect(PARAMECIUM_SPECIES.aurelia).toEqual({
      params: PARAMECIUM_CELL_PARAMS,
      baseHue: PARAMECIUM_BASE_HUE,
    });
  });

  it("shallow-merges euglena overrides without mutating the species map", () => {
    const before = { ...EUGLENA_SPECIES.wild, palette: { ...EUGLENA_SPECIES.wild.palette } };

    const resolved = resolveEuglenaSpecies("wild", { scale: 9, steer: { hero: -1 } });

    expect(resolved).toEqual({
      ...FROZEN_EUGLENA_WILD,
      scale: 9,
      steer: { hero: -1 },
    });
    expect(resolved.steer?.hero).toBe(-1);
    expect(EUGLENA_SPECIES.wild).toEqual(before);
    expect(EUGLENA_SPECIES.wild).toEqual(FROZEN_EUGLENA_WILD);
  });

  it("keeps variant shapes species-specific", () => {
    expect(EUGLENA_SPECIES.wild).not.toHaveProperty("vorticellaCount");
    expect(EUGLENA_SPECIES.wild).not.toHaveProperty("vorticellaScale");
    expect(EUGLENA_SPECIES.wild).not.toHaveProperty("vorticellaContractRate");

    expect(PARAMECIUM_SPECIES.aurelia).toEqual({
      params: PARAMECIUM_CELL_PARAMS,
      baseHue: PARAMECIUM_BASE_HUE,
    });
    expect(PARAMECIUM_SPECIES.aurelia.params).toBe(PARAMECIUM_CELL_PARAMS);
    expect(PARAMECIUM_SPECIES.aurelia).not.toHaveProperty("scale");
    expect(PARAMECIUM_SPECIES.aurelia).not.toHaveProperty("palette");
  });
});
