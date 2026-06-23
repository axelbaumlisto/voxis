import type { AquariumFrame } from "./types";

export const KIND_ID = { diatom: 0, euglena: 1, vorticella: 2, hero: 3, didinium: 4 } as const;

export type FieldKind = "obstacle" | "wake" | "motile";

export type ObstacleCircle = {
  readonly kind: "obstacle";
  readonly shape: "circle";
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly sourceId: number;
};

export type ObstacleEllipse = {
  readonly kind: "obstacle";
  readonly shape: "ellipse";
  readonly x: number;
  readonly y: number;
  readonly halfLen: number;
  readonly halfWid: number;
  readonly heading: number;
  readonly social?: boolean;
  readonly sourceId: number;
};

export type Motile = {
  readonly kind: "motile";
  readonly x: number;
  readonly y: number;
  readonly sourceId: number;
};

export type Wake = {
  readonly kind: "wake";
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly sourceId: number;
};

export type Obstacle = ObstacleCircle | ObstacleEllipse;

export type FieldContribution = Obstacle | Motile | Wake;

export interface InteractionField {
  readonly obstacles: readonly Obstacle[];
  readonly motiles: readonly Motile[];
  readonly wakes: readonly Wake[];
}

export function buildField(contribs: readonly FieldContribution[]): InteractionField {
  const obstacles: Obstacle[] = [];
  const motiles: Motile[] = [];
  const wakes: Wake[] = [];

  for (const contrib of contribs) {
    if (contrib.kind === "obstacle") {
      obstacles.push(contrib);
    } else if (contrib.kind === "motile") {
      motiles.push(contrib);
    } else {
      wakes.push(contrib);
    }
  }

  return { obstacles, motiles, wakes };
}

export function sourceId(kind: keyof typeof KIND_ID, instanceIndex: number): number {
  return (KIND_ID[kind] << 20) | instanceIndex;
}

export interface FieldParticipant<S, Cfg> {
  contribute?(state: S, frame: AquariumFrame, cfg: Cfg): FieldContribution[];
  consume?(state: S, field: InteractionField, frame: AquariumFrame, cfg: Cfg): S;
}

export interface OrganismModule<S, Cfg> extends FieldParticipant<S, Cfg> {
  readonly salt: number;
  readonly z: number;
  seed(count: number, seed: number, frame: AquariumFrame, cfg: Cfg): readonly S[];
  update(states: readonly S[], frame: AquariumFrame, cfg: Cfg): readonly S[];
  draw(ctx: CanvasRenderingContext2D, states: readonly S[], frame: AquariumFrame, cfg: Cfg): void;
}
