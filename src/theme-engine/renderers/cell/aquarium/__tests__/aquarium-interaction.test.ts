import { describe, expect, it } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import { aquariumParamsView } from "../params";
import { buildAquariumInteractionField, seedAquarium, updateAquarium } from "../layer";
import { diatomGeometry } from "../diatoms";
import { euglenaPose, updateEuglena } from "../euglena";
import { updateVorticella, vorticellaGeometry } from "../vorticella";
import type { AquariumFrame } from "../types";
import type { CellParams } from "../../types";

function frame(overrides: Partial<AquariumFrame> = {}): AquariumFrame {
  return {
    t: 1.25,
    dt: 1 / 60,
    width: 172,
    height: 36,
    mode: "idle",
    activity: 0.2,
    audioLevel: 0.1,
    startle: 0,
    baseHue: 50,
    ...overrides,
  };
}

describe("aquarium biology geometry contracts", () => {
  it("vorticellaGeometry clamps contraction and moves the bell toward the anchor", () => {
    const extended = vorticellaGeometry(-1, { anchorX: 10, anchorY: 4, restLength: 12, directionAngle: 0 });
    const contracted = vorticellaGeometry(2, { anchorX: 10, anchorY: 4, restLength: 12, directionAngle: 0 });

    expect(extended.contractPhase).toBe(0);
    expect(contracted.contractPhase).toBe(1);
    expect(contracted.stalkLength).toBeLessThan(extended.stalkLength);
    expect(contracted.coilTurns).toBeGreaterThan(extended.coilTurns);
    expect(contracted.bellCenter.x).toBeLessThan(extended.bellCenter.x);
    expect(contracted.bellCenter.y).toBeCloseTo(extended.bellCenter.y, 6);
    expect(contracted.stalkPath.length).toBeGreaterThanOrEqual(2);
    for (const point of contracted.stalkPath) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it("euglenaPose keeps a tapered spindle with anterior eyespot near the flagellum end", () => {
    const pose = euglenaPose(0.1, 0.25, { length: 9, baseWidth: 2.4, heading: 0, flagellumLength: 4 });
    const centerSample = pose.bodySamples.find((sample) => sample.u === 0);
    const anteriorTip = pose.bodySamples.find((sample) => sample.u === 1);
    const posteriorTip = pose.bodySamples.find((sample) => sample.u === -1);

    expect(centerSample?.halfWidth).toBeGreaterThan(0.8);
    expect(anteriorTip?.halfWidth).toBeCloseTo(0, 6);
    expect(posteriorTip?.halfWidth).toBeCloseTo(0, 6);
    // eyespot is lateral, beside the anterior reservoir (not on the tip)
    expect(pose.eyespot.x).toBeGreaterThan(pose.center.x);
    // flagellum emerges from the anterior pole, not the eyespot
    expect(pose.flagellumPoints[0]).toEqual(pose.anterior);
    expect(pose.flagellumEnd.x).toBeGreaterThan(pose.anterior.x);
    expect(pose.flagellumEnd.x - pose.anterior.x).toBeLessThan(4 * 1.2);
  });

  it("keeps every interior organelle AND the eyespot inside the body outline across all roll/metaboly phases", () => {
    function inside(poly: readonly { x: number; y: number }[], px: number, py: number): boolean {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    }
    // small slack for the polyline chord vs the smooth boundary it approximates
    const SLACK = 0.6;
    function insideSlack(poly: readonly { x: number; y: number }[], cx: number, cy: number, p: { x: number; y: number }): boolean {
      if (inside(poly, p.x, p.y)) return true;
      const dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy) || 1;
      return inside(poly, p.x + (dx / d) * SLACK, p.y + (dy / d) * SLACK);
    }
    for (const roll of [0, 0.12, 0.25, 0.37, 0.5, 0.62, 0.75, 0.88]) {
      for (const meta of [0, 0.33, 0.66]) {
        const pose = euglenaPose(roll, meta, {
          centerX: 90, centerY: 18, length: 70, baseWidth: 70 * 0.22, heading: 0,
          metabolyEnvelope: 1, organelleSeed: 12345,
          chloroplastCount: 16, striaeCount: 6, paramylonCount: 2,
          includeNucleus: true, includeReservoir: true, includeCV: true, cvPhase: roll,
        });
        const poly = pose.outline;
        const cx = pose.center.x, cy = pose.center.y;
        const ux = pose.ux, uy = pose.uy, nx = -uy, ny = ux;
        const ellipses = [...pose.chloroplasts, ...pose.paramylon, ...(pose.nucleus ? [pose.nucleus] : [])];
        for (const e of ellipses) {
          for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const px = e.x + ux * e.rx * a + nx * e.ry * b;
            const py = e.y + uy * e.rx * a + ny * e.ry * b;
            expect(insideSlack(poly, cx, cy, { x: px, y: py })).toBe(true);
          }
        }
        for (const c of [pose.reservoir, pose.contractileVacuole]) {
          if (!c) continue;
          for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            expect(insideSlack(poly, cx, cy, { x: c.x + nx * c.r * b + ux * c.r * a, y: c.y + ny * c.r * b + uy * c.r * a })).toBe(true);
          }
        }
        expect(insideSlack(poly, cx, cy, pose.eyespot)).toBe(true);
      }
    }
  });

  it("euglenaPose roll changes apparent width and stripe phase without moving the anterior anchor", () => {
    const a = euglenaPose(0, 0.2, { centerX: 2, centerY: 3, length: 8, baseWidth: 2, heading: 0 });
    const b = euglenaPose(0.25, 0.2, { centerX: 2, centerY: 3, length: 8, baseWidth: 2, heading: 0 });

    expect(b.apparentWidth).toBeLessThan(a.apparentWidth);
    expect(b.stripePhase).not.toBe(a.stripePhase);
    expect(b.eyespot.x).toBeCloseTo(a.eyespot.x, 6);
    // the flagellum ANCHOR (anterior pole) does not move with roll; the tip may
    // shift slightly with phase due to the non-planar lasso curl.
    expect(b.flagellumPoints[0].x).toBeCloseTo(a.flagellumPoints[0].x, 6);
  });

  it("diatomGeometry keeps navicula bilateral symmetry with finite scale-aware striae", () => {
    const small = diatomGeometry("navicula", { length: 4, width: 1.4 });
    const large = diatomGeometry("navicula", { length: 8, width: 2.8 });

    expect(small.striae.length).toBeGreaterThan(0);
    expect(large.striae.length).toBeGreaterThan(small.striae.length);
    for (const stria of large.striae) {
      expect(Number.isFinite(stria.from.x)).toBe(true);
      expect(Number.isFinite(stria.from.y)).toBe(true);
      expect(Number.isFinite(stria.to.x)).toBe(true);
      expect(Number.isFinite(stria.to.y)).toBe(true);
      const mirrored = large.striae.find((candidate) =>
        Math.abs(candidate.from.x + stria.from.x) < 1e-6 && Math.abs(candidate.to.x + stria.to.x) < 1e-6,
      );
      expect(mirrored).toBeTruthy();
    }
  });

  it("diatomGeometry keeps oval centric symmetry with finite scale-aware radial striae", () => {
    const tiny = diatomGeometry("ovalCentric", { length: 3, width: 2 });
    const larger = diatomGeometry("ovalCentric", { length: 8, width: 5 });

    expect(tiny.striae.length).toBeGreaterThanOrEqual(4);
    expect(larger.striae.length).toBeGreaterThan(tiny.striae.length);
    for (const point of larger.outline) {
      const opposite = larger.outline.find((candidate) =>
        Math.abs(candidate.x + point.x) < 1e-6 && Math.abs(candidate.y + point.y) < 1e-6,
      );
      expect(opposite).toBeTruthy();
    }
    for (const stria of larger.striae) {
      expect(Number.isFinite(stria.from.x)).toBe(true);
      expect(Number.isFinite(stria.from.y)).toBe(true);
      expect(Number.isFinite(stria.to.x)).toBe(true);
      expect(Number.isFinite(stria.to.y)).toBe(true);
    }
  });
});

describe("aquarium layer Phase 4.5 combined perf/golden", () => {
  it("2-phase euglena/vorticella updates are order-independent to 1e-10", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 67,
      aquariumAlpha: 0.55,
      aquariumActivityBoost: 0.8,
      diatomCount: 0,
      euglenaCount: 1,
      euglenaSpeed: 0.7,
      euglenaSpeedActive: 1.1,
      euglenaScale: 1.4,
      vorticellaCount: 1,
      vorticellaContractRate: 0.8,
      vorticellaScale: 1.2,
      vorticellaAlongFrac: 0.16,
    };
    const view = aquariumParamsView(params);
    const hero = { x: 120, y: 40, radius: 14, heading: 0.2, halfLen: 18, halfWid: 11 };
    const f0 = frame({ t: 2, dt: 1 / 60, width: 240, height: 80, activity: 0.5, audioLevel: 0.25, hero });
    const initial = seedAquarium(f0, params);
    const interaction = buildAquariumInteractionField(initial.euglena, initial.vorticella, f0.hero, view.vorticella.scale, f0.height);
    const snapshotFrame = { ...f0, interaction };

    const production = updateAquarium(initial, f0, params);
    const reverse = {
      ...initial,
      vorticella: updateVorticella(initial.vorticella, snapshotFrame, view),
      euglena: updateEuglena(initial.euglena, snapshotFrame, view),
    };

    for (const species of ["euglena", "vorticella"] as const) {
      expect(production[species]).toHaveLength(reverse[species].length);
      for (let i = 0; i < production[species].length; i++) {
        for (const key of Object.keys(production[species][i]) as Array<keyof typeof production[typeof species][number]>) {
          const actual = production[species][i][key];
          const expected = reverse[species][i][key];
          if (typeof actual === "number" && typeof expected === "number") {
            expect(actual, `${species}[${i}].${String(key)}`).toBeCloseTo(expected, 10);
          } else {
            expect(actual, `${species}[${i}].${String(key)}`).toEqual(expected);
          }
        }
      }
    }
  });

  it("retains seeded identities and anchors across combined multi-frame updates", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 67,
      diatomCount: 4,
      euglenaCount: 1,
      vorticellaCount: 1,
      diatomDriftSpeed: 0.9,
      euglenaSpeed: 0.7,
      euglenaSpeedActive: 1.1,
      vorticellaContractRate: 0.8,
    };
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params);
    let state = initial;

    for (let i = 0; i < 5; i++) {
      state = updateAquarium(
        state,
        frame({ t: 1 + i / 60, dt: 1 / 60, width: 172, height: 36, activity: i % 2 === 0 ? 0.2 : 0.6 }),
        params,
      );
    }

    expect(initial.diatoms).toHaveLength(4);
    expect(initial.euglena).toHaveLength(1);
    expect(initial.vorticella).toHaveLength(1);
    expect(state.diatoms).toHaveLength(initial.diatoms.length);
    expect(state.euglena).toHaveLength(initial.euglena.length);
    expect(state.vorticella).toHaveLength(initial.vorticella.length);
    for (let i = 0; i < initial.diatoms.length; i++) {
      expect(state.diatoms[i]).toMatchObject({
        phase: initial.diatoms[i].phase,
        size: initial.diatoms[i].size,
        shape: initial.diatoms[i].shape,
        driftX: initial.diatoms[i].driftX,
        driftY: initial.diatoms[i].driftY,
        rotationRate: initial.diatoms[i].rotationRate,
      });
    }
    expect(state.euglena[0]).toMatchObject({
      size: initial.euglena[0].size,
      swimSpeed: initial.euglena[0].swimSpeed,
      rollRate: initial.euglena[0].rollRate,
      metabolyRate: initial.euglena[0].metabolyRate,
      flagellumRate: initial.euglena[0].flagellumRate,
      spiralAmplitude: initial.euglena[0].spiralAmplitude,
    });
    expect(state.vorticella[0]).toMatchObject({
      x: initial.vorticella[0].anchorX,
      y: initial.vorticella[0].anchorY,
      anchorX: initial.vorticella[0].anchorX,
      anchorY: initial.vorticella[0].anchorY,
      directionAngle: initial.vorticella[0].directionAngle,
      restLength: initial.vorticella[0].restLength,
      contractRate: initial.vorticella[0].contractRate,
      oralRate: initial.vorticella[0].oralRate,
    });

    const repeat = seedAquarium(frame({ width: 172, height: 36 }), params);
    expect(repeat).toEqual(initial);
  });
});
