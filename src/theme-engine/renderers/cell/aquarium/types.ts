import type { ThemeState } from "../../../contract";
import type { EuglenaSteer, Medium } from "./euglena";
import type { InteractionField } from "./interaction";

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
  readonly interaction?: InteractionField;
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
  readonly medium?: Partial<Medium>;
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
    readonly hueOffset: number;
    readonly steer?: Partial<EuglenaSteer>;
  };
  readonly vorticella: {
    readonly count: number;
    readonly contractRate: number;
    readonly scale: number;
    readonly alongFrac: number;
  };
  readonly didinium: {
    readonly count: number;
    readonly speed: number;
    readonly speedActive: number;
    readonly scale: number;
    readonly hueOffset: number;
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
  /** Discrete beat-switch tumble cycle index (deterministic run-and-tumble state). */
  readonly tumbleIndex?: number;
  /** Heading at the start of the current tumble. */
  readonly tumbleFrom?: number;
  /** Target heading for the current tumble. */
  readonly tumbleTo?: number;
  /** Progress [0,1] through the current ~1s beat-switch tumble. */
  readonly tumbleProgress?: number;
  /** Decaying escape state [0,1] for the startle-dart interaction. */
  readonly startle?: number;
  /** Stable per-cell deterministic noise key for future stochastic behaviours. */
  readonly noiseSeed?: number;
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
  /** Slow idle-sway phase of the stalk (alive at rest). */
  readonly swayPhase?: number;
  /** Per-cell idle-sway rate (Hz). */
  readonly swayRate?: number;
  /** Absolute-time contraction state machine: leg 0=extended,1=contracting,2=hold,3=re-extending. */
  readonly contractLeg?: number;
  /** Seconds elapsed in the current contraction leg. */
  readonly contractTimer?: number;
  /** Smooth attack/release envelope [0,1] of the recording "active feeding posture". */
  readonly voiceEnv?: number;
  /** Telotroch migration: 0=anchored,1=detaching,2=swimming,3=reattaching. */
  readonly migrateState?: number;
  /** Stalk attachment 1=fully anchored .. 0=free telotroch. */
  readonly attach?: number;
  /** Seconds elapsed since last anchored (drives the rare migration trigger). */
  readonly migrateTimer?: number;
  /** Seconds anchored before the next telotroch migration. */
  readonly migrateInterval?: number;
  /** Target floor X the detached telotroch swims to. */
  readonly migrateTargetX?: number;
  /** Migration event counter (advances seeded draws). */
  readonly migrateCount?: number;
}

export interface DidiniumState extends AquariumSeedPoint {
  readonly heading: number;
  readonly swimSpeed: number;
  /** Axial spin phase (cycles) — the body rotates as it swims. */
  readonly rollPhase: number;
  readonly rollRate: number;
  /** Pectinelle (ciliary girdle) metachronal beat phase (cycles). */
  readonly beatPhase: number;
  readonly beatRate: number;
  /** Terminal contractile-vacuole pulse phase (cycles). */
  readonly cvPhase?: number;
  readonly cvRate?: number;
  /** Birth-stable avoiding-reaction handedness (Jennings: always the same side). */
  readonly turnSide?: number;
  /** Discrete avoiding-reaction event index (deterministic). */
  readonly avoidIndex?: number;
  readonly avoidFrom?: number;
  readonly avoidTo?: number;
  /** Progress [0,1] through the current eased avoiding-reaction back-turn. */
  readonly avoidProgress?: number;
  /** Seconds remaining in predator contact/latch on a prey surface. */
  readonly contactTimer?: number;
  /** Seconds before another prey contact/latch can trigger. */
  readonly huntCooldown?: number;
  /** Stable per-cell deterministic noise key. */
  readonly noiseSeed?: number;
}

export interface AquariumLayerState {
  readonly seed: number;
  readonly diatoms: readonly DiatomState[];
  readonly euglena: readonly EuglenaState[];
  readonly vorticella: readonly VorticellaState[];
  readonly didinium: readonly DidiniumState[];
}
