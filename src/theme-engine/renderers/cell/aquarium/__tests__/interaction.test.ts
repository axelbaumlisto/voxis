import { describe, expect, it } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import { euglenaContribute, euglenaDisplayLength, EUGLENA_RELEVANT_FIELDS } from "../euglena";
import { didiniumContribute, didiniumDisplayLength, DIDINIUM_RELEVANT_FIELDS } from "../didinium";
import { heroConsumeObstacles } from "../hero";
import { buildField, KIND_ID, sourceId } from "../interaction";
import type { FieldContribution, ObstacleCircle } from "../interaction";
import { buildAquariumInteractionField, heroContribute, seedAquarium, updateAquarium } from "../layer";
import type { AquariumFrame } from "../types";
import { vorticellaContribute, vorticellaObstacle, VORTICELLA_RELEVANT_FIELDS } from "../vorticella";
import type { CellParams } from "../../types";

function frame(overrides: Partial<AquariumFrame> = {}): AquariumFrame {
  return {
    t: 0,
    dt: 1 / 60,
    width: 240,
    height: 80,
    mode: "idle",
    activity: 0,
    audioLevel: 0,
    startle: 0,
    baseHue: 50,
    ...overrides,
  };
}

function legacyHeroVorticellaClampDelta(
  circles: readonly Pick<ObstacleCircle, "x" | "y" | "radius">[],
  cx: number,
  cy: number,
  heroReach: number,
): { dx: number; dy: number } {
  let curX = cx;
  let curY = cy;
  for (const o of circles) {
    const dx = curX - o.x;
    const dy = curY - o.y;
    const d = Math.hypot(dx, dy);
    const minD = o.radius + heroReach;
    if (d < minD && d > 1e-6) {
      const push = minD - d;
      const pxh = (dx / d) * push;
      const pyh = (dy / d) * push;
      curX += pxh;
      curY += pyh;
    }
  }
  return { dx: curX - cx, dy: curY - cy };
}

describe("aquarium interaction field vocabulary", () => {
  it("freezes sourceId namespace packing", () => {
    expect(KIND_ID).toEqual({ diatom: 0, euglena: 1, vorticella: 2, hero: 3, didinium: 4 });
    expect(sourceId("diatom", 0)).toBe(0);
    expect(sourceId("euglena", 0)).toBe(1 << 20);
    expect(sourceId("euglena", 1)).toBe((1 << 20) | 1);
    expect(sourceId("vorticella", 0)).toBe(2 << 20);
    expect(sourceId("hero", 0)).toBe(3 << 20);
  });

  it("buckets mixed contributions while preserving input order within each bucket", () => {
    const heroObstacle = {
      kind: "obstacle",
      shape: "ellipse",
      x: 10,
      y: 20,
      halfLen: 9,
      halfWid: 3,
      heading: 0.5,
      social: true,
      sourceId: sourceId("hero", 0),
    } as const;
    const euglenaMotile = {
      kind: "motile",
      x: 30,
      y: 40,
      sourceId: sourceId("euglena", 0),
    } as const;
    const heroWake = {
      kind: "wake",
      x: 11,
      y: 21,
      heading: 0.5,
      sourceId: sourceId("hero", 0),
    } as const;
    const vorticellaObstacle = {
      kind: "obstacle",
      shape: "circle",
      x: 50,
      y: 60,
      radius: 7,
      sourceId: sourceId("vorticella", 0),
    } as const;
    const secondMotile = {
      kind: "motile",
      x: 31,
      y: 41,
      sourceId: sourceId("euglena", 1),
    } as const;
    const contribs: readonly FieldContribution[] = [
      heroObstacle,
      euglenaMotile,
      heroWake,
      vorticellaObstacle,
      secondMotile,
    ];

    expect(buildField(contribs)).toEqual({
      obstacles: [heroObstacle, vorticellaObstacle],
      motiles: [euglenaMotile, secondMotile],
      wakes: [heroWake],
    });
  });

  it("returns empty buckets for empty input", () => {
    expect(buildField([])).toEqual({ obstacles: [], motiles: [], wakes: [] });
  });

  it("exposes producer contributions and consumer relevant field sets", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 67,
      aquariumAlpha: 0.55,
      aquariumActivityBoost: 0.8,
      diatomCount: 0,
      euglenaCount: 1,
      euglenaScale: 1.4,
      vorticellaCount: 1,
      vorticellaScale: 1.2,
      vorticellaAlongFrac: 0.16,
    };
    const hero = { x: 118, y: 42, radius: 11, heading: 0.35, halfLen: 18, halfWid: 7 };
    const seedFrame = frame({ hero });
    const initial = seedAquarium(seedFrame, params);
    const obstacle = vorticellaObstacle(initial.vorticella[0], 1.2, seedFrame.height);

    expect(vorticellaContribute(initial.vorticella[0], 1.2, seedFrame.height, 0)).toEqual([{
      kind: "obstacle",
      shape: "circle",
      x: obstacle.x,
      y: obstacle.y,
      radius: obstacle.radius,
      sourceId: sourceId("vorticella", 0),
    }]);
    expect(euglenaContribute(initial.euglena[0], 0, 1.4)).toEqual([{
      kind: "motile",
      x: initial.euglena[0].x,
      y: initial.euglena[0].y,
      heading: initial.euglena[0].heading,
      radius: euglenaDisplayLength(initial.euglena[0].size, 1.4) * 0.18,
      speed: initial.euglena[0].swimSpeed,
      role: "neutral",
      strength: 0.35,
      sourceId: sourceId("euglena", 0),
    }]);
    expect(heroContribute(hero)).toEqual([
      {
        kind: "obstacle",
        shape: "ellipse",
        x: hero.x,
        y: hero.y,
        halfLen: hero.halfLen,
        halfWid: hero.halfWid,
        heading: hero.heading,
        social: true,
        sourceId: sourceId("hero", 0),
      },
      { kind: "wake", x: hero.x, y: hero.y, heading: hero.heading, sourceId: sourceId("hero", 0) },
      {
        kind: "motile",
        x: hero.x,
        y: hero.y,
        heading: hero.heading,
        radius: Math.max(hero.halfWid, hero.halfLen * 0.35),
        speed: 0,
        role: "prey",
        strength: 1,
        sourceId: sourceId("hero", 0),
      },
    ]);
    const didinium = {
      x: 66,
      y: 44,
      phase: 0.4,
      size: 1.2,
      heading: 0.7,
      swimSpeed: 0.9,
      rollPhase: 0,
      rollRate: 0.7,
      beatPhase: 0,
      beatRate: 4,
    };
    expect(didiniumContribute(didinium, 0, 1.8)).toEqual([{
      kind: "motile",
      x: 66,
      y: 44,
      heading: 0.7,
      radius: didiniumDisplayLength(1.2, 1.8) * 0.35,
      speed: 0.9,
      role: "predator",
      strength: 0.75,
      sourceId: sourceId("didinium", 0),
    }]);
    expect([...EUGLENA_RELEVANT_FIELDS]).toEqual(["obstacle", "wake", "motile"]);
    expect([...VORTICELLA_RELEVANT_FIELDS]).toEqual(["motile"]);
    expect([...DIDINIUM_RELEVANT_FIELDS]).toEqual(["obstacle", "motile"]);
  });

  it("hero hard-clamp consume matches legacy vorticella obstacle loop to 1e-10", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 67,
      aquariumAlpha: 0.55,
      diatomCount: 0,
      euglenaCount: 0,
      vorticellaCount: 2,
      vorticellaScale: 1.2,
      vorticellaAlongFrac: 0.16,
    };
    const seedFrame = frame({ width: 240, height: 80 });
    const seeded = seedAquarium(seedFrame, params).vorticella;
    const circles = buildField(
      seeded.flatMap((v, i) => vorticellaContribute(v, 1.2, seedFrame.height, i)),
    ).obstacles.filter((obstacle): obstacle is ObstacleCircle => obstacle.shape === "circle");
    const heroReach = 14 * Math.sqrt(Math.max(1, 2.6)) * 1.2;
    const first = circles[0];
    const second = circles[1];
    const d1 = first.radius + heroReach;
    const d2 = second.radius + heroReach;
    const cases = [
      { name: "single near vorticella", active: [first], cx: first.x + d1 * 0.35, cy: first.y + d1 * 0.2 },
      { name: "two vorticella cumulative ordering", active: circles, cx: (first.x + second.x) / 2, cy: (first.y + second.y) / 2 },
      { name: "far clear", active: circles, cx: 230, cy: 8, zero: true },
      { name: "exact boundary", active: [second], cx: second.x + d2, cy: second.y, zero: true },
    ] as const;

    for (const c of cases) {
      const expected = legacyHeroVorticellaClampDelta(c.active, c.cx, c.cy, heroReach);
      const actual = heroConsumeObstacles(c.active, c.cx, c.cy, heroReach);
      expect(actual.dx, `${c.name} dx`).toBeCloseTo(expected.dx, 10);
      expect(actual.dy, `${c.name} dy`).toBeCloseTo(expected.dy, 10);
      if (c.zero) {
        expect(actual).toEqual({ dx: 0, dy: 0 });
      }
    }
  });

  it("single snapshot builder publishes all pre-update participant fields", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 67,
      aquariumAlpha: 0.55,
      aquariumActivityBoost: 0.8,
      diatomCount: 3,
      diatomAlpha: 0.35,
      diatomDriftSpeed: 0.42,
      euglenaCount: 2,
      euglenaSpeed: 0.2,
      euglenaSpeedActive: 1.5,
      euglenaScale: 1.4,
      euglenaGravitaxis: 0.2,
      euglenaPhototaxis: 0.6,
      euglenaRotDiffusion: 0.12,
      vorticellaCount: 2,
      vorticellaContractRate: 1.2,
      vorticellaScale: 1.2,
      vorticellaAlongFrac: 0.16,
    };
    const hero = { x: 118, y: 42, radius: 11, heading: 0.35, halfLen: 18, halfWid: 7 };
    const seedFrame = frame({ t: 4, dt: 1 / 60, mode: "recording", activity: 0.6, audioLevel: 0.4, hero });
    const initial = seedAquarium(seedFrame, params);
    const next = updateAquarium(initial, { ...seedFrame, t: 4.25, dt: 0.05 }, params);

    const referenceContribs: FieldContribution[] = [
      ...initial.vorticella.flatMap((v, i) => vorticellaContribute(v, 1.2, seedFrame.height, i)),
      ...initial.euglena.flatMap((e, i) => euglenaContribute(e, i, 1.4)),
      ...heroContribute(seedFrame.hero),
    ];
    const field = buildAquariumInteractionField(initial.euglena, initial.vorticella, seedFrame.hero, 1.2, seedFrame.height, undefined, 1.4);

    expect(field).toEqual(buildField(referenceContribs));
    expect(field.obstacles.map((contrib) => contrib.sourceId)).toEqual([
      sourceId("vorticella", 0),
      sourceId("vorticella", 1),
      sourceId("hero", 0),
    ]);
    expect(field.wakes.map((contrib) => contrib.sourceId)).toEqual([sourceId("hero", 0)]);
    expect(field.motiles.map((contrib) => contrib.sourceId)).toEqual([
      sourceId("euglena", 0),
      sourceId("euglena", 1),
      sourceId("hero", 0),
    ]);
    expect(field.motiles[0].x).toBe(initial.euglena[0].x);
    expect(field.motiles[0].y).toBe(initial.euglena[0].y);
    expect(field.motiles[0].x).not.toBe(next.euglena[0].x);
    expect(field.obstacles.filter((contrib) => EUGLENA_RELEVANT_FIELDS.has(contrib.kind))).toHaveLength(3);
    expect(field.motiles.filter((contrib) => VORTICELLA_RELEVANT_FIELDS.has(contrib.kind))).toHaveLength(3);
  });
});
