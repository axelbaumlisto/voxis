import type { CellParams } from "../types";
import type { EuglenaSteer, Medium } from "./euglena";
import { PARAMECIUM_BASE_HUE, PARAMECIUM_CELL_PARAMS } from "../../../builtin/_shared/paramecium";

export interface EuglenaSpecies {
  readonly scale?: number;
  readonly speed?: number;
  readonly speedActive?: number;
  readonly steer?: Partial<EuglenaSteer> | undefined;
  readonly medium?: Partial<Medium> | undefined;
  readonly palette?: { readonly hueOffset?: number };
}

export const EUGLENA_SPECIES: Record<string, EuglenaSpecies> = {
  wild: {
    scale: 2.8,
    speed: 0.2,
    speedActive: 1.5,
    steer: undefined,
    medium: undefined,
    palette: { hueOffset: 42 },
  },
};

export interface VorticellaSpecies {
  readonly scale?: number;
  readonly contractRate?: number;
  readonly contractRateActive?: number;
  readonly palette?: { readonly hueOffset?: number };
}

export const VORTICELLA_SPECIES: Record<string, VorticellaSpecies> = {
  default: {
    scale: 5.5,
    contractRate: 1.2,
    contractRateActive: 1.5,
    palette: { hueOffset: 200 },
  },
};

export interface DiatomSpecies {
  readonly alpha?: number;
  readonly driftSpeed?: number;
}

export const DIATOM_SPECIES: Record<string, DiatomSpecies> = {
  default: {
    alpha: 0.35,
    driftSpeed: 1.0,
  },
};

export interface ParameciumSpecies {
  readonly params?: Partial<CellParams>;
  readonly baseHue?: number;
}

export const PARAMECIUM_SPECIES: Record<string, ParameciumSpecies> = {
  aurelia: {
    params: PARAMECIUM_CELL_PARAMS,
    baseHue: PARAMECIUM_BASE_HUE,
  },
};

export function resolveEuglenaSpecies(id: string, overrides?: Partial<EuglenaSpecies>): EuglenaSpecies {
  const base = EUGLENA_SPECIES[id];
  return {
    ...base,
    ...overrides,
    steer: overrides?.steer ? { ...base.steer, ...overrides.steer } : base.steer,
    medium: overrides?.medium ? { ...base.medium, ...overrides.medium } : base.medium,
    palette: { ...base.palette, ...overrides?.palette },
  };
}

export function resolveVorticellaSpecies(
  id: string,
  overrides?: Partial<VorticellaSpecies>,
): VorticellaSpecies {
  const base = VORTICELLA_SPECIES[id];
  return {
    ...base,
    ...overrides,
    palette: { ...base.palette, ...overrides?.palette },
  };
}

export function resolveDiatomSpecies(id: string, overrides?: Partial<DiatomSpecies>): DiatomSpecies {
  return { ...DIATOM_SPECIES[id], ...overrides };
}

export function resolveParameciumSpecies(
  id: string,
  overrides?: Partial<ParameciumSpecies>,
): ParameciumSpecies {
  const base = PARAMECIUM_SPECIES[id];
  return {
    ...base,
    ...overrides,
    params: { ...base.params, ...overrides?.params },
  };
}
