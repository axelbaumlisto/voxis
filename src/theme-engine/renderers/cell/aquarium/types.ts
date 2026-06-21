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

export interface DiatomState extends AquariumSeedPoint {
  readonly shape: "navicula" | "ovalCentric";
  readonly heading: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly rotationRate: number;
}

export interface EuglenaState extends AquariumSeedPoint {
  readonly heading: number;
  readonly swimSpeed: number;
  readonly rollPhase: number;
  readonly metabolyPhase: number;
  readonly flagellumPhase: number;
  readonly rollRate: number;
  readonly metabolyRate: number;
  readonly flagellumRate: number;
  readonly spiralAmplitude: number;
}

export interface AquariumLayerState {
  readonly seed: number;
  readonly diatoms: readonly DiatomState[];
  readonly euglena: readonly EuglenaState[];
  readonly vorticella: readonly AquariumSeedPoint[];
}
