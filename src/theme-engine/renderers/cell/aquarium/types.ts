import type { ThemeState } from "../../../contract";

export interface AquariumFrame {
  readonly t: number;
  readonly dt: number;
  readonly width: number;
  readonly height: number;
  readonly mode: ThemeState["mode"];
  readonly activity: number;
  readonly audioLevel: number;
  readonly startle: number;
  readonly baseHue: number;
}

export interface AquariumParamsView {
  readonly enabled: boolean;
  readonly seed: number;
  readonly alpha: number;
  readonly activityBoost: number;
  readonly diatoms: {
    readonly count: number;
    readonly alpha: number;
    readonly driftSpeed: number;
  };
  readonly euglena: {
    readonly count: number;
    readonly speed: number;
    readonly speedActive: number;
    readonly scale: number;
  };
  readonly vorticella: {
    readonly count: number;
    readonly contractRate: number;
    readonly contractRateActive: number;
    readonly scale: number;
  };
}

export interface AquariumSeedPoint {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
  readonly size: number;
}

export interface AquariumLayerState {
  readonly seed: number;
  readonly diatoms: readonly AquariumSeedPoint[];
  readonly euglena: readonly AquariumSeedPoint[];
  readonly vorticella: readonly AquariumSeedPoint[];
}
