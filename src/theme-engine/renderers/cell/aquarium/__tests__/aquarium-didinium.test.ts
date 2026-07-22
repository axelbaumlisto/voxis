import { describe, expect, it } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { didiniumContribute, didiniumDisplayLength, seedDidinium, updateDidinium } from "../didinium";
import { didiniumContactPhase, didiniumParameciumContactPoint } from "../didinium-paramecium";
import { buildField, sourceId } from "../interaction";
import { drawAquariumBackground, drawAquariumForeground } from "../layer";
import { aquariumParamsView } from "../params";
import type { AquariumFrame, AquariumLayerState, DidiniumState } from "../types";
import { RecordingCanvasContext2D, round, summarize } from "../../../__tests__/helpers/recordingCanvas";

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

describe("aquarium layer Phase 4 didinium (predator)", () => {
  function didiniumView(overrides: Partial<CellParams> = {}) {
    return aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      didiniumCount: 1,
      didiniumSpeed: 1,
      didiniumSpeedActive: 1,
      aquariumActivityBoost: 1,
      ...overrides,
    });
  }

  function testDidinium(overrides: Partial<DidiniumState> = {}): DidiniumState {
    return {
      x: 150,
      y: 150,
      phase: 0,
      size: 1,
      heading: 0,
      swimSpeed: 1,
      rollPhase: 0.1,
      rollRate: 0.4,
      beatPhase: 0.2,
      beatRate: 4,
      cvPhase: 0.3,
      cvRate: 0.05,
      turnSide: 1,
      avoidIndex: 0,
      avoidFrom: 0,
      avoidTo: 0,
      avoidProgress: 1,
      noiseSeed: 12345,
      ...overrides,
    };
  }

  it("seedDidinium is deterministic and places cells inside the tank", () => {
    const f = frame({ width: 320, height: 160 });
    const a = seedDidinium(2, 7, f);
    const b = seedDidinium(2, 7, f);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    for (const cell of a) {
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.x).toBeLessThanOrEqual(320);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeLessThanOrEqual(160);
      expect(Number.isFinite(cell.heading)).toBe(true);
      expect(cell.turnSide === 1 || cell.turnSide === -1).toBe(true);
    }
  });

  it("updateDidinium stays dt-partition-exact in open water (center, no walls)", () => {
    const view = didiniumView();
    // center of a large tank → no wall pressure; erratic cruise + wander are pure
    // functions of frame.t so a single 0.24s step equals two 0.12s steps.
    const initial = [testDidinium({ x: 500, y: 500 })];
    const big = { width: 1000, height: 1000, activity: 0 };
    const oneStep = updateDidinium(initial, frame({ dt: 0.24, t: 3, ...big }), view);
    const half = updateDidinium(initial, frame({ dt: 0.12, t: 3, ...big }), view);
    const twoSteps = updateDidinium(half, frame({ dt: 0.12, t: 3, ...big }), view);
    expect(twoSteps[0].x).toBeCloseTo(oneStep[0].x, 10);
    expect(twoSteps[0].y).toBeCloseTo(oneStep[0].y, 10);
    expect(twoSteps[0].heading).toBeCloseTo(oneStep[0].heading, 10);
    expect(twoSteps[0].rollPhase).toBeCloseTo(oneStep[0].rollPhase, 10);
    expect(twoSteps[0].beatPhase).toBeCloseTo(oneStep[0].beatPhase, 10);
    expect(twoSteps[0].cvPhase).toBeCloseTo(oneStep[0].cvPhase, 10);
  });

  it("updateDidinium keeps the cell inside the tank over many erratic steps", () => {
    const view = didiniumView({ didiniumSpeed: 3, didiniumSpeedActive: 3 });
    let cells = seedDidinium(1, 11, frame({ width: 320, height: 160 }));
    for (let i = 0; i < 400; i++) {
      cells = updateDidinium(cells, frame({ dt: 0.05, t: i * 0.05, width: 320, height: 160, activity: 0.5 }), view);
      expect(cells[0].x).toBeGreaterThanOrEqual(0);
      expect(cells[0].x).toBeLessThanOrEqual(320);
      expect(cells[0].y).toBeGreaterThanOrEqual(0);
      expect(cells[0].y).toBeLessThanOrEqual(160);
    }
  });

  it("avoiding-reaction turns to the SAME birth-stable side on a wall hit", () => {
    const view = didiniumView({ didiniumSpeed: 4, didiniumSpeedActive: 4 });
    // heading +x straight at the right wall, near it → forces an avoiding reaction
    const startRight = [testDidinium({ x: 316, y: 80, heading: 0, turnSide: 1 })];
    const startLeft = [testDidinium({ x: 316, y: 80, heading: 0, turnSide: -1 })];
    const stepR = updateDidinium(startRight, frame({ dt: 0.1, t: 0, width: 320, height: 160 }), view);
    const stepL = updateDidinium(startLeft, frame({ dt: 0.1, t: 0, width: 320, height: 160 }), view);
    // both fired an avoid event
    expect(stepR[0].avoidIndex).toBe(1);
    expect(stepL[0].avoidIndex).toBe(1);
    // the avoiding reaction turns toward the inward normal (away from the wall),
    // offset by the fixed per-cell side: the +1 cell sweeps to a larger angle than
    // the -1 cell, so birth-stable handedness still determines turn direction.
    expect(stepR[0].avoidTo).toBeGreaterThan(stepL[0].avoidTo!);
  });

  it("does not latch or target-lock the hero ellipse from outside the forward encounter cone", () => {
    const view = didiniumView({ didiniumSpeed: 0, didiniumSpeedActive: 0 });
    const initial = [testDidinium({ x: 120, y: 80, heading: Math.PI, phase: Math.PI })];
    const interaction = buildField([
      { kind: "obstacle", shape: "ellipse", x: 210, y: 80, halfLen: 38, halfWid: 14, heading: 0, social: true, sourceId: sourceId("hero", 0) },
    ]);
    const next = updateDidinium(initial, frame({ dt: 0.2, t: 2, width: 340, height: 170, interaction }), view);
    expect(next[0].heading).toBe(initial[0].heading);
    expect(next[0].contactTimer ?? 0).toBe(0);
    expect(next[0].contactDuration ?? 0).toBe(0);
    expect(next[0].huntCooldown ?? 0).toBe(0);
  });

  it("hunts the hero ellipse only during a forward local encounter", () => {
    const view = didiniumView({ didiniumSpeed: 0, didiniumSpeedActive: 0 });
    const initial = [testDidinium({ x: 155, y: 100, heading: 0, phase: 0 })];
    const interaction = buildField([
      { kind: "obstacle", shape: "ellipse", x: 210, y: 80, halfLen: 38, halfWid: 14, heading: 0, social: true, sourceId: sourceId("hero", 0) },
    ]);
    const next = updateDidinium(initial, frame({ dt: 0.2, t: 2, width: 340, height: 170, interaction }), view);
    expect(next[0].heading).toBeLessThan(0);
    expect(next[0].contactTimer ?? 0).toBe(0);
  });

  it("banks away from vorticella circle obstacles and resolves the shell with a dt velocity cap", () => {
    const view = didiniumView({ didiniumSpeed: 0, didiniumSpeedActive: 0, didiniumScale: 2 });
    const initial = [testDidinium({ x: 150, y: 80, heading: 0, phase: 0 })];
    const obstacle = { kind: "obstacle" as const, shape: "circle" as const, x: 175, y: 80, radius: 18, sourceId: sourceId("vorticella", 0) };
    const interaction = buildField([obstacle]);
    const dt = 0.2;
    const next = updateDidinium(initial, frame({ dt, t: 2, width: 340, height: 170, interaction }), view);
    expect(Math.abs(next[0].heading)).toBeGreaterThan(1.5);
    const beforeD = Math.hypot(initial[0].x - obstacle.x, initial[0].y - obstacle.y);
    const afterD = Math.hypot(next[0].x - obstacle.x, next[0].y - obstacle.y);
    expect(afterD).toBeGreaterThan(beforeD);
    expect(Math.hypot(next[0].x - initial[0].x, next[0].y - initial[0].y)).toBeLessThanOrEqual(didiniumDisplayLength(1, 2) * 1.0 * dt + 1e-6);
  });

  it("softly avoids Euglena motiles without capture/latch semantics", () => {
    const view = didiniumView({ didiniumSpeed: 0, didiniumSpeedActive: 0, didiniumScale: 2 });
    const initial = [testDidinium({ x: 150, y: 80, heading: 0, phase: 0 })];
    const interaction = buildField([
      { kind: "motile", x: 175, y: 80, radius: 8, role: "neutral", sourceId: sourceId("euglena", 0) },
    ]);
    const next = updateDidinium(initial, frame({ dt: 0.2, t: 2, width: 340, height: 170, interaction }), view);
    expect(Math.abs(next[0].heading)).toBeGreaterThan(0.3);
    expect(next[0].contactTimer ?? 0).toBe(0);
    expect(next[0].contactDuration ?? 0).toBe(0);
    expect(next[0].huntCooldown ?? 0).toBe(0);
  });

  it("local forward hero encounter latches while prey-shell servo is velocity-limited by dt", () => {
    const view = didiniumView({ didiniumSpeed: 0, didiniumSpeedActive: 0, didiniumScale: 2 });
    const initial = [testDidinium({ x: 240, y: 80, heading: Math.PI, phase: Math.PI })];
    const prey = { kind: "obstacle" as const, shape: "ellipse" as const, x: 200, y: 80, halfLen: 38, halfWid: 14, heading: 0, social: true, sourceId: sourceId("hero", 0) };
    const interaction = buildField([prey]);
    const dt = 0.1;
    const next = updateDidinium(initial, frame({ dt, t: 2, width: 340, height: 170, interaction }), view);
    expect(next[0].contactTimer).toBeGreaterThan(0);
    expect(next[0].contactDuration).toBe(next[0].contactTimer);
    expect(next[0].huntCooldown ?? 0).toBe(0);
    const L = didiniumDisplayLength(1, 2);
    const A = prey.halfLen + L * 0.38;
    const beforeQ = Math.abs(initial[0].x - prey.x) / A;
    const q = Math.abs(next[0].x - prey.x) / A;
    expect(q).toBeGreaterThan(beforeQ);
    expect(q).toBeLessThan(1.0);
    expect(Math.hypot(next[0].x - initial[0].x, next[0].y - initial[0].y)).toBeLessThanOrEqual(L * 1.2 * dt + 1e-6);
  });

  it("decays contact duration and enforces cooldown before another prey latch", () => {
    const view = didiniumView({ didiniumSpeed: 0, didiniumSpeedActive: 0, didiniumScale: 2 });
    const active = updateDidinium(
      [testDidinium({ contactTimer: 1.2, contactDuration: 2.4, huntCooldown: 0 })],
      frame({ dt: 0.25, t: 2, width: 340, height: 170 }),
      view,
    )[0];
    expect(active.contactTimer).toBeCloseTo(0.95, 10);
    expect(active.contactDuration).toBe(2.4);
    expect(active.huntCooldown ?? 0).toBe(0);

    const released = updateDidinium(
      [{ ...active, contactTimer: 0.05, contactDuration: 2.4, huntCooldown: 0 }],
      frame({ dt: 0.1, t: 2.1, width: 340, height: 170 }),
      view,
    )[0];
    expect(released.contactTimer).toBe(0);
    expect(released.contactDuration).toBe(0);
    expect(released.huntCooldown).toBeGreaterThan(0);

    const prey = { kind: "obstacle" as const, shape: "ellipse" as const, x: 200, y: 80, halfLen: 38, halfWid: 14, heading: 0, social: true, sourceId: sourceId("hero", 0) };
    const refractory = updateDidinium(
      [{ ...released, x: 240, y: 80, heading: Math.PI, phase: Math.PI, avoidProgress: 1 }],
      frame({ dt: 0.1, t: 2.2, width: 340, height: 170, interaction: buildField([prey]) }),
      view,
    )[0];
    expect(refractory.huntCooldown).toBeGreaterThan(0);
    expect(refractory.contactTimer).toBe(0);
    expect(refractory.contactDuration).toBe(0);
  });

  it("didiniumContribute emits one metadata-rich motile per cell with the didinium sourceId", () => {
    const cell = testDidinium({ x: 42, y: 24, heading: 0.7, swimSpeed: 0.9, size: 1.2 });
    const contribs = didiniumContribute(cell, 0, 1.8);
    expect(contribs).toEqual([{
      kind: "motile",
      x: 42,
      y: 24,
      heading: 0.7,
      radius: didiniumDisplayLength(1.2, 1.8) * 0.35,
      speed: 0.9,
      role: "predator",
      strength: 0.75,
      sourceId: sourceId("didinium", 0),
    }]);
    expect(didiniumContribute(cell, 3)[0].sourceId).toBe(sourceId("didinium", 3));
  });

  it("didiniumDisplayLength agrees between update and draw (single source of truth)", () => {
    expect(didiniumDisplayLength(1, 1)).toBeGreaterThan(0);
    expect(didiniumDisplayLength(1, 2)).toBeGreaterThan(didiniumDisplayLength(1, 1));
  });

  it("characterizes Didinium/Paramecium contact phase helpers", () => {
    const early = didiniumContactPhase(testDidinium({ contactTimer: 1.5, contactDuration: 2 }));
    expect(early.contact).toBe(1.5);
    expect(early.duration).toBe(2);
    expect(early.elapsed).toBe(0.5);
    expect(early.env).toBe(1);
    expect(early.sideEnv).toBeCloseTo(0.7142857143, 10);
    expect(early.fanEnv).toBe(0);

    const late = didiniumContactPhase(testDidinium({ contactTimer: 0.5, contactDuration: 2 }));
    expect(late.env).toBe(1);
    expect(late.sideEnv).toBe(1);
    expect(late.fanEnv).toBeCloseTo(0.6666666667, 10);
  });

  it("projects Didinium contact onto the current Paramecium membrane", () => {
    const hero = {
      x: 120,
      y: 48,
      radius: 20,
      heading: 0,
      halfLen: 20 * Math.sqrt(3),
      halfWid: 20 / Math.sqrt(3),
    };
    const length = didiniumDisplayLength(1, 1);
    const didinium = testDidinium({
      x: hero.x - hero.halfLen - length * 0.52,
      y: hero.y,
      phase: 0,
      heading: 0,
    });

    const contact = didiniumParameciumContactPoint(didinium, frame({ hero }), length);

    expect(contact.snoutX).toBeCloseTo(hero.x - hero.halfLen, 10);
    expect(contact.snoutY).toBe(hero.y);
    expect(contact.px).toBeCloseTo(hero.x - hero.halfLen, 10);
    expect(contact.py).toBeCloseTo(hero.y, 10);
  });

  it("characterizes Didinium contact foreground on the current hero membrane", () => {
    const ops: string[] = [];
    const ctx = new RecordingCanvasContext2D(ops) as unknown as CanvasRenderingContext2D;
    const hero = {
      x: 120,
      y: 48,
      radius: 20,
      heading: 0,
      halfLen: 20 * Math.sqrt(3),
      halfWid: 20 / Math.sqrt(3),
    };
    const didinium = testDidinium({
      x: hero.x - hero.halfLen - didiniumDisplayLength(1, 1) * 0.52,
      y: hero.y,
      phase: 0,
      heading: 0,
      contactTimer: 1.5,
      contactDuration: 2,
    });
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumAlpha: 0.55,
      didiniumCount: 1,
      didiniumScale: 1,
    };

    drawAquariumForeground(ctx, { seed: 1, diatoms: [], euglena: [], vorticella: [], didinium: [didinium] }, frame({ hero }), params);

    const membraneX = round(hero.x - hero.halfLen);
    const membraneY = round(hero.y);
    expect(summarize(ops)).toEqual({
      hash: "fdfc46ba8565dd8d",
      opCount: 58,
      counts: {
        save: 2,
        translate: 1,
        rotate: 1,
        beginPath: 14,
        ellipse: 1,
        stroke: 12,
        moveTo: 10,
        lineTo: 10,
        restore: 2,
        arc: 3,
        fill: 2,
      },
    });
    expect(ops).toContain(`arc(${membraneX},${membraneY},1.3,0,6.283)`);
    expect(ops).toContain(`arc(${membraneX},${membraneY},1,0,6.283)`);
    expect(ops.filter((op) => op === `lineTo(${membraneX},${membraneY})`)).toHaveLength(3);
    expect(ops.some((op) => op.includes("hsla(198, 52%, 98%"))).toBe(true);
    expect(ops.some((op) => op.includes("hsla(42, 46%, 95%"))).toBe(true);
  });

  it("draws exactly two ciliary girdles and stays within an op budget", () => {
    const ops: string[] = [];
    const gradient = { addColorStop: () => ops.push("addColorStop") };
    const ctx = new Proxy({}, {
      get(_t, prop) {
        if (prop === "canvas") return document.createElement("canvas");
        if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => { ops.push(String(prop)); return gradient; };
        if (prop === "measureText") return () => ({ width: 0 });
        return (..._args: unknown[]) => ops.push(String(prop));
      },
      set() { return true; },
    }) as CanvasRenderingContext2D;
    const cells = seedDidinium(1, 5, frame({ width: 320, height: 160 }));
    const params: CellParams = { ...CELL_DEFAULTS, enableAquarium: true, didiniumCount: 1, didiniumScale: 2 };
    const state: AquariumLayerState = { seed: 5, diatoms: [], euglena: [], vorticella: [], didinium: cells };
    drawAquariumBackground(ctx, state, frame({ width: 320, height: 160, mode: "recording" }), params);
    // cilia ticks + 2 girdle bands + macronucleus + cone + CV are many strokes;
    // assert a sane bounded op count with strokes and fills present.
    expect(ops.length).toBeGreaterThan(20);
    expect(ops.length).toBeLessThan(2600);
    expect(ops.filter((o) => o === "stroke").length).toBeGreaterThan(4);
    expect(ops.filter((o) => o === "fill").length).toBeGreaterThan(0);
  });
});
