import type { CellParams } from "../types";
import type { AquariumParamsView } from "./types";
import type { EuglenaSteer, Medium } from "./euglena";
import { finiteOr } from "./util";

function nonNegativeInt(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.floor(finiteOr(value, fallback)));
}

function nonNegative(value: number | undefined, fallback: number): number {
  return Math.max(0, finiteOr(value, fallback));
}

/** Build a partial steering override from theme params (undefined = use module defaults). */
function euglenaSteerOverride(params: CellParams): Partial<EuglenaSteer> | undefined {
  const gravitaxis = nonNegative(params.euglenaGravitaxis, 0);
  const phototaxis = nonNegative(params.euglenaPhototaxis, 0);
  const separation = nonNegative(params.euglenaSeparation, 0);
  if (gravitaxis === 0 && phototaxis === 0 && separation === 0) return undefined;
  return {
    gravitaxis,
    phototaxis,
    ...(separation === 0 ? {} : { separation }),
  };
}

/** Build a partial medium override from theme params (undefined = use module defaults). */
function mediumOverride(params: CellParams): Partial<Medium> | undefined {
  const rotDiffusion = nonNegative(params.euglenaRotDiffusion, 0);
  if (rotDiffusion === 0) return undefined;
  return { rotDiffusion };
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
      hueOffset: finiteOr(params.euglenaHueOffset, 42),
      steer: euglenaSteerOverride(params),
    },
    medium: mediumOverride(params),
    vorticella: {
      count: nonNegativeInt(params.vorticellaCount, 0),
      contractRate: nonNegative(params.vorticellaContractRate, 1.0),
      scale: nonNegative(params.vorticellaScale, 1.0),
      alongFrac: Math.min(1, Math.max(0, finiteOr(params.vorticellaAlongFrac, 0.5))),
    },
  };
}
