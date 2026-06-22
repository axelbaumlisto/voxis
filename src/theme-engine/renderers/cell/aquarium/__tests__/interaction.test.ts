import { describe, expect, it } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import { euglenaContribute, EUGLENA_RELEVANT_FIELDS } from "../euglena";
import { buildField, KIND_ID, sourceId } from "../interaction";
import type { FieldContribution } from "../interaction";
import { buildEuglenaInteractionField, buildVorticellaInteractionField, heroContribute, seedAquarium, updateAquarium } from "../layer";
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

describe("aquarium interaction field vocabulary", () => {
  it("freezes sourceId namespace packing", () => {
    expect(KIND_ID).toEqual({ diatom: 0, euglena: 1, vorticella: 2, hero: 3 });
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
    expect(euglenaContribute(initial.euglena[0], 0)).toEqual([{
      kind: "motile",
      x: initial.euglena[0].x,
      y: initial.euglena[0].y,
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
      { kind: "motile", x: hero.x, y: hero.y, sourceId: sourceId("hero", 0) },
    ]);
    expect([...EUGLENA_RELEVANT_FIELDS]).toEqual(["obstacle", "wake"]);
    expect([...VORTICELLA_RELEVANT_FIELDS]).toEqual(["motile"]);
  });

  it("generic staged builders match hand-built filtered references", () => {
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
      vorticellaContractRateActive: 1.5,
      vorticellaScale: 1.2,
      vorticellaAlongFrac: 0.16,
    };
    const hero = { x: 118, y: 42, radius: 11, heading: 0.35, halfLen: 18, halfWid: 7 };
    const seedFrame = frame({ t: 4, dt: 1 / 60, mode: "recording", activity: 0.6, audioLevel: 0.4, hero });
    const initial = seedAquarium(seedFrame, params);

    const euglenaReferenceContribs: FieldContribution[] = [
      ...initial.vorticella.flatMap((v, i) => vorticellaContribute(v, 1.2, seedFrame.height, i)),
      ...heroContribute(seedFrame.hero),
    ].filter((contrib) => EUGLENA_RELEVANT_FIELDS.has(contrib.kind));
    const euglenaField = buildEuglenaInteractionField(initial.vorticella, seedFrame.hero, 1.2, seedFrame.height);

    expect(euglenaField).toEqual(buildField(euglenaReferenceContribs));
    expect(euglenaReferenceContribs.map((contrib) => contrib.kind)).toEqual(["obstacle", "obstacle", "obstacle", "wake"]);
    expect(euglenaField.motiles).toEqual([]);

    const next = updateAquarium(initial, { ...seedFrame, t: 4.25, dt: 0.05 }, params);
    const vorticellaReferenceContribs: FieldContribution[] = [
      ...heroContribute(seedFrame.hero),
      ...next.euglena.flatMap((e, i) => euglenaContribute(e, i)),
    ].filter((contrib) => VORTICELLA_RELEVANT_FIELDS.has(contrib.kind));
    const vorticellaField = buildVorticellaInteractionField(seedFrame.hero, next.euglena);

    expect(vorticellaField).toEqual(buildField(vorticellaReferenceContribs));
    expect(vorticellaReferenceContribs.map((contrib) => contrib.sourceId)).toEqual([
      sourceId("hero", 0),
      sourceId("euglena", 0),
      sourceId("euglena", 1),
    ]);
    expect(vorticellaField.obstacles).toEqual([]);
    expect(vorticellaField.wakes).toEqual([]);
  });
});
