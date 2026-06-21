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
  readonly hero?: {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    /** Long-axis heading of the elongated hero body (radians). */
    readonly heading?: number;
    /** Hero body semi-major / semi-minor (px) for elliptical exclusion. */
    readonly halfLen?: number;
    readonly halfWid?: number;
  };
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
  readonly cvPhase?: number;
  readonly cvRate?: number;
  readonly burstPhase?: number;
  readonly burstRate?: number;
  readonly turnProgress?: number;
  readonly turnFrom?: number;
  readonly turnTo?: number;
}

export interface VorticellaState extends AquariumSeedPoint {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly directionAngle: number;
  readonly restLength: number;
  readonly contractPhase: number;
  readonly contractCyclePhase: number;
  readonly oralWreathPhase: number;
  readonly contractRate: number;
  readonly oralRate: number;
}

export interface AquariumLayerState {
  readonly seed: number;
  readonly diatoms: readonly DiatomState[];
  readonly euglena: readonly EuglenaState[];
  readonly vorticella: readonly VorticellaState[];
}
