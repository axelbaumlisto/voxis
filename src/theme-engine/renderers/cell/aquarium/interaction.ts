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
  /** Optional body-axis heading (radians), for consumers that need orientation-aware reactions. */
  readonly heading?: number;
  /** Optional effective interaction radius (px). Point-only motiles remain valid when omitted. */
  readonly radius?: number;
  /** Optional speed proxy (body-lengths/sec or local renderer units), for strength heuristics. */
  readonly speed?: number;
  /** Optional semantic role; species/sourceId remains authoritative for dispatch. */
  readonly role?: "prey" | "predator" | "neutral";
  /** Optional interaction strength multiplier; consumers must fall back when omitted. */
  readonly strength?: number;
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
