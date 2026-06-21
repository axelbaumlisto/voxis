import type { CellParams } from "../types";
import type { AquariumParamsView } from "./types";

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function nonNegativeInt(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.floor(finiteOr(value, fallback)));
}

function nonNegative(value: number | undefined, fallback: number): number {
  return Math.max(0, finiteOr(value, fallback));
}

export function aquariumParamsView(params: CellParams): AquariumParamsView {
  return {
    enabled: params.enableAquarium === true,
    seed: Math.trunc(finiteOr(params.aquariumSeed, 1)),
    alpha: nonNegative(params.aquariumAlpha, 0.35),
    activityBoost: nonNegative(params.aquariumActivityBoost, 0.4),
    diatoms: {
      count: nonNegativeInt(params.diatomCount, 0),
      alpha: nonNegative(params.diatomAlpha, 0.35),
      driftSpeed: nonNegative(params.diatomDriftSpeed, 1.0),
    },
    euglena: {
      count: nonNegativeInt(params.euglenaCount, 0),
      speed: nonNegative(params.euglenaSpeed, 1.0),
      speedActive: nonNegative(params.euglenaSpeedActive, 2.0),
      scale: nonNegative(params.euglenaScale, 1.0),
    },
    vorticella: {
      count: nonNegativeInt(params.vorticellaCount, 0),
      contractRate: nonNegative(params.vorticellaContractRate, 1.0),
      contractRateActive: nonNegative(params.vorticellaContractRateActive, 2.0),
      scale: nonNegative(params.vorticellaScale, 1.0),
    },
  };
}
