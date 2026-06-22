import { describe, expect, it } from "vitest";
import { buildField, KIND_ID, sourceId } from "../interaction";
import type { FieldContribution } from "../interaction";

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
});
