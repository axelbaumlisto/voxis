import { describe, expect, it, vi } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { buildField, sourceId } from "../interaction";
import { drawAquariumBackground, seedAquarium, updateAquarium } from "../layer";
import { aquariumParamsView } from "../params";
import type { AquariumFrame } from "../types";
import { updateVorticella, vorticellaContractPhase, vorticellaGeometry, vorticellaObstacle } from "../vorticella";

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

describe("aquarium layer Phase 4 vorticella", () => {
  it("vorticellaContractPhase is bounded: ballistic contraction, slow extension, long extended dwell", () => {
    const samples = [0, 0.02, 0.05, 0.1, 0.3, 0.45, 0.7, 0.95].map(vorticellaContractPhase);
    for (const phase of samples) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThanOrEqual(1);
    }
    // ballistic collapse: nearly fully contracted within the first ~5% of the cycle
    expect(vorticellaContractPhase(0.04)).toBeGreaterThan(0.85);
    // slow re-extension: monotonically decreasing through the relax window
    expect(vorticellaContractPhase(0.10)).toBeGreaterThan(vorticellaContractPhase(0.35));
    // long extended/feeding dwell at the end of the cycle (s = 0)
    expect(vorticellaContractPhase(0.7)).toBe(0);
    expect(vorticellaContractPhase(0.95)).toBe(0);
    // contraction is far faster than re-extension (per-phase rate)
    const contractRate = vorticellaContractPhase(0.02) - vorticellaContractPhase(0.0);
    const extendRate = Math.abs(vorticellaContractPhase(0.30) - vorticellaContractPhase(0.25));
    expect(contractRate).toBeGreaterThan(extendRate);
  });

  it("vorticellaGeometry is monotonic from extended to contracted", () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map((contractPhase) =>
      vorticellaGeometry(contractPhase, { anchorX: 4, anchorY: 18, restLength: 10, directionAngle: 0 }),
    );

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].stalkLength).toBeLessThanOrEqual(samples[i - 1].stalkLength);
      expect(samples[i].coilTurns).toBeGreaterThanOrEqual(samples[i - 1].coilTurns);
      expect(samples[i].bellCenter.x).toBeLessThanOrEqual(samples[i - 1].bellCenter.x);
      expect(samples[i].bellCenter.y).toBeCloseTo(samples[0].bellCenter.y, 6);
    }
  });

  it("updateVorticella is deterministic, anchored, finite, and bounded", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 51,
      vorticellaCount: 2,
      vorticellaContractRate: 1.0,
    };
    const view = aquariumParamsView(params);
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params).vorticella;
    const updated = updateVorticella(initial, frame({ dt: 0.5, activity: 0.7, startle: 0.3 }), view);
    const repeat = updateVorticella(initial, frame({ dt: 0.5, activity: 0.7, startle: 0.3 }), view);

    expect(updated).toEqual(repeat);
    for (let i = 0; i < updated.length; i++) {
      expect(updated[i].anchorX).toBe(initial[i].anchorX);
      expect(updated[i].anchorY).toBe(initial[i].anchorY);
      expect(updated[i].x).toBe(initial[i].anchorX);
      expect(updated[i].y).toBe(initial[i].anchorY);
      for (const value of [updated[i].contractCyclePhase, updated[i].contractPhase, updated[i].oralWreathPhase]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("updateAquarium updates vorticella without moving diatoms/euglena when only vorticella is counted", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 53,
      diatomCount: 0,
      euglenaCount: 0,
      vorticellaCount: 1,
    };
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params);
    const updated = updateAquarium(initial, frame({ dt: 0.25, width: 172, height: 36 }), params);

    expect(updated).not.toBe(initial);
    expect(updated.diatoms).toBe(initial.diatoms);
    expect(updated.euglena).toBe(initial.euglena);
    expect(updated.vorticella).not.toBe(initial.vorticella);
    expect(updated.vorticella[0].anchorX).toBe(initial.vorticella[0].anchorX);
    expect(updated.vorticella[0].anchorY).toBe(initial.vorticella[0].anchorY);
  });

  it("updateVorticella runs an absolute-time ballistic contraction (fast collapse, slow re-extend)", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 51,
      vorticellaCount: 1,
      vorticellaContractRate: 1.0,
    };
    const view = aquariumParamsView(params);
    const seeded = seedAquarium(frame({ width: 240, height: 80 }), params).vorticella;
    // a motile cell parked on the bell = the real mechanical stimulus that fires the startle
    const obs = vorticellaObstacle(seeded[0], view.vorticella.scale, 80);
    let cell = seeded.map((c) => ({ ...c, contractTimer: 1.1 })); // past the 1s refractory
    const dt = 0.05;
    let peak = 0;
    let collapseSteps = Infinity; // steps from first s>0.5 to s>0.95
    let crossed = -1;
    const stimF = frame({ dt, width: 240, height: 80, interaction: buildField([{ kind: "motile", x: obs.x, y: obs.y, sourceId: sourceId("euglena", 0) }]) });
    for (let i = 0; i < 200; i++) {
      cell = updateVorticella(cell, stimF, view);
      const s = cell[0].contractPhase;
      peak = Math.max(peak, s);
      if (crossed < 0 && s > 0.5) crossed = i;
      if (crossed >= 0 && s > 0.95 && collapseSteps === Infinity) collapseSteps = i - crossed;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    // a contraction fired and fully collapsed
    expect(peak).toBeGreaterThan(0.95);
    // BALLISTIC: from half to full collapse in <= ~0.15s (<=3 steps) — a snap, not a ramp
    expect(collapseSteps).toBeLessThanOrEqual(3);
    // deterministic
    const again = updateVorticella(seeded.map((c) => ({ ...c, contractTimer: 1.1 })), stimF, view);
    expect(again[0].contractPhase).toBe(updateVorticella(seeded.map((c) => ({ ...c, contractTimer: 1.1 })), stimF, view)[0].contractPhase);
  });

  it("telotroch migration: a vorticella detaches, relocates to a new floor X, and re-anchors", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 51,
      vorticellaCount: 1,
      vorticellaContractRate: 1.0,
    };
    const view = aquariumParamsView(params);
    let cell = seedAquarium(frame({ width: 240, height: 80 }), params).vorticella;
    const startX = cell[0].anchorX;
    let sawDetached = false;
    let maxDx = 0;
    // migration is now RARE (mean ~900s), so run a long horizon (~50min) to catch one event
    for (let i = 0; i < 6000; i++) {
      cell = updateVorticella(cell, frame({ dt: 0.5, width: 240, height: 80, activity: 0.1 }), view);
      if ((cell[0].attach ?? 1) < 0.5) sawDetached = true;
      maxDx = Math.max(maxDx, Math.abs((cell[0].anchorX ?? startX) - startX));
      expect(cell[0].anchorX).toBeGreaterThanOrEqual(0);
      expect(cell[0].anchorX).toBeLessThanOrEqual(240);
      expect(cell[0].x).toBe(cell[0].anchorX); // x tracks the (possibly migrating) anchor
    }
    expect(sawDetached).toBe(true);          // it became a free telotroch at least once
    expect(maxDx).toBeGreaterThan(20);       // it relocated to a meaningfully different spot
    // deterministic: a fresh identical run lands at the same place
    let again = seedAquarium(frame({ width: 240, height: 80 }), params).vorticella;
    for (let i = 0; i < 6000; i++) again = updateVorticella(again, frame({ dt: 0.5, width: 240, height: 80, activity: 0.1 }), view);
    expect(again[0].anchorX).toBe(cell[0].anchorX);
  });

  it("mechanosensitive reflex: a motile cell near the bell triggers contraction sooner", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 51,
      vorticellaCount: 1,
      vorticellaContractRate: 1.0,
    };
    const view = aquariumParamsView(params);
    const seeded = seedAquarium(frame({ width: 240, height: 80 }), params).vorticella;
    const obs = vorticellaObstacle(seeded[0], view.vorticella.scale, 80);
    const stepsTo90 = (withMotile: boolean): number => {
      let cell = seeded;
      const f = withMotile
        ? frame({
          dt: 0.05,
          width: 240,
          height: 80,
          activity: 0.2,
          interaction: buildField([{ kind: "motile", x: obs.x, y: obs.y, sourceId: sourceId("euglena", 0) }]),
        })
        : frame({ dt: 0.05, width: 240, height: 80, activity: 0.2 });
      for (let i = 0; i < 200; i++) {
        cell = updateVorticella(cell, f, view);
        if (cell[0].contractPhase > 0.9) return i;
      }
      return Infinity;
    };
    const withM = stepsTo90(true);
    const without = stepsTo90(false);
    expect(withM).toBeLessThan(without);    // the near cell triggers a contraction sooner
    expect(withM).toBeLessThanOrEqual(40);  // ~within refractory(1s)+collapse
    // deterministic
    expect(stepsTo90(true)).toBe(withM);
  });

  it("mechanosensitive trigger is radius/strength-aware: hero/Didinium trigger farther than Euglena", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 51,
      vorticellaCount: 1,
      vorticellaContractRate: 1.0,
    };
    const view = aquariumParamsView(params);
    const seeded = seedAquarium(frame({ width: 240, height: 80 }), params).vorticella;
    const initial = seeded.map((cell) => ({ ...cell, contractLeg: 0, contractTimer: 1.1 }));
    const obs = vorticellaObstacle(initial[0], view.vorticella.scale, 80);
    const base = { dt: 0.05, width: 240, height: 80, activity: 0.2 };
    const atDistance = (d: number, motile: Parameters<typeof buildField>[0][number]) => updateVorticella(
      initial,
      frame({ ...base, interaction: buildField([{ ...motile, x: obs.x + d, y: obs.y }]) }),
      view,
    )[0].contractLeg;

    const probeD = obs.radius * 1.25 + 4;
    expect(atDistance(probeD, { kind: "motile", x: 0, y: 0, sourceId: sourceId("hero", 0), radius: 30, strength: 1, role: "prey" })).toBe(1);
    expect(atDistance(probeD, { kind: "motile", x: 0, y: 0, sourceId: sourceId("didinium", 0), radius: 20, strength: 0.75, role: "predator" })).toBe(1);
    expect(atDistance(probeD, { kind: "motile", x: 0, y: 0, sourceId: sourceId("euglena", 0), radius: 12, strength: 0.35, role: "neutral" })).toBe(0);
    expect(atDistance(obs.radius * 1.02, { kind: "motile", x: 0, y: 0, sourceId: sourceId("euglena", 0), radius: 12, strength: 0.35, role: "neutral" })).toBe(1);
  });

  it("mechanosensitive field path triggers from motiles and empty field matches no motiles", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 51,
      vorticellaCount: 1,
      vorticellaContractRate: 1.0,
    };
    const view = aquariumParamsView(params);
    const seeded = seedAquarium(frame({ width: 240, height: 80 }), params).vorticella;
    const initial = seeded.map((cell) => ({ ...cell, contractLeg: 0, contractTimer: 1.1 }));
    const obs = vorticellaObstacle(initial[0], view.vorticella.scale, 80);
    const base = { dt: 0.05, width: 240, height: 80, activity: 0.2 };
    const motileField = updateVorticella(
      initial,
      frame({ ...base, interaction: buildField([{ kind: "motile", x: obs.x, y: obs.y, sourceId: sourceId("euglena", 0) }]) }),
      view,
    );
    const noMotiles = updateVorticella(initial, frame(base), view);
    const emptyField = updateVorticella(initial, frame({ ...base, interaction: buildField([]) }), view);

    for (const key of ["contractPhase", "contractLeg", "contractTimer"] as const) {
      expect(emptyField[0][key]).toBeCloseTo(noMotiles[0][key], 10);
    }
    expect(motileField[0].contractLeg).toBe(1);
    expect(motileField[0].contractTimer).toBe(0);
    expect(emptyField).toEqual(noMotiles);
  });

  it("voice envelope: recording eases voiceEnv up (no contraction); idle keeps it at 0", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 51,
      vorticellaCount: 1,
      vorticellaContractRate: 1.0,
    };
    const view = aquariumParamsView(params);
    const seeded = seedAquarium(frame({ width: 240, height: 80 }), params).vorticella;
    // recording -> voiceEnv eases UP toward the active feeding posture, WITHOUT any
    // contraction (the body never balls up just from the voice).
    let cell = seeded;
    let peak = 0;
    const recF = frame({ dt: 0.05, width: 240, height: 80, mode: "recording", activity: 0.9, audioLevel: 0.9 });
    for (let i = 0; i < 60; i++) { cell = updateVorticella(cell, recF, view); peak = Math.max(peak, cell[0].contractPhase); }
    expect(cell[0].voiceEnv ?? 0).toBeGreaterThan(0.7); // eased up to the active posture
    expect(peak).toBeLessThan(0.05);                    // and it did NOT contract from the voice
    // idle -> voiceEnv stays at rest (0); no active posture
    let idleCell = seeded;
    const idleF = frame({ dt: 0.05, width: 240, height: 80, mode: "idle", activity: 0.9, audioLevel: 0.9 });
    for (let i = 0; i < 60; i++) idleCell = updateVorticella(idleCell, idleF, view);
    expect(idleCell[0].voiceEnv ?? 0).toBe(0);
    // releases back toward 0 when recording stops
    let rel = cell;
    for (let i = 0; i < 120; i++) rel = updateVorticella(rel, idleF, view);
    expect(rel[0].voiceEnv ?? 1).toBeLessThan(0.05);
    // deterministic
    let again = seeded;
    for (let i = 0; i < 60; i++) again = updateVorticella(again, recF, view);
    expect(again[0].voiceEnv).toBe(cell[0].voiceEnv);
  });

  it("mechanosensitive field self-excludes this vorticella source id", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 51,
      vorticellaCount: 1,
      vorticellaContractRate: 1.0,
    };
    const view = aquariumParamsView(params);
    const seeded = seedAquarium(frame({ width: 240, height: 80 }), params).vorticella;
    const initial = seeded.map((cell) => ({ ...cell, contractLeg: 0, contractTimer: 1.1 }));
    const obs = vorticellaObstacle(initial[0], view.vorticella.scale, 80);
    const base = { dt: 0.05, width: 240, height: 80, activity: 0.2 };
    const noMotiles = updateVorticella(initial, frame(base), view);
    const selfOnly = updateVorticella(
      initial,
      frame({ ...base, interaction: buildField([{ kind: "motile", x: obs.x, y: obs.y, sourceId: sourceId("vorticella", 0) }]) }),
      view,
    );

    expect(selfOnly).toEqual(noMotiles);
  });

  it("updateVorticella is dt-partition invariant away from event boundaries", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 57,
      vorticellaCount: 1,
      vorticellaContractRate: 0.8,
    };
    const view = aquariumParamsView(params);
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params).vorticella;
    const oneStep = updateVorticella(initial, frame({ dt: 0.12, activity: 0.2 }), view);
    const halfStep = updateVorticella(initial, frame({ dt: 0.06, activity: 0.2 }), view);
    const twoSteps = updateVorticella(halfStep, frame({ dt: 0.06, activity: 0.2 }), view);

    expect(twoSteps[0].contractCyclePhase).toBeCloseTo(oneStep[0].contractCyclePhase, 10);
    expect(twoSteps[0].contractPhase).toBeCloseTo(oneStep[0].contractPhase, 10);
    expect(twoSteps[0].oralWreathPhase).toBeCloseTo(oneStep[0].oralWreathPhase, 10);
    expect(twoSteps[0].anchorX).toBe(oneStep[0].anchorX);
    expect(twoSteps[0].anchorY).toBe(oneStep[0].anchorY);
  });

  it("drawAquariumBackground draws a low-alpha edge vorticella smoke at 172×36", () => {
    const calls: string[] = [];
    const ctx = {
      save: vi.fn(() => calls.push("save")),
      restore: vi.fn(() => calls.push("restore")),
      beginPath: vi.fn(() => calls.push("beginPath")),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(() => calls.push("fill")),
      stroke: vi.fn(() => calls.push("stroke")),
      ellipse: vi.fn(() => calls.push("ellipse")),
      arc: vi.fn(() => calls.push("arc")),
      createLinearGradient: vi.fn(() => ({ addColorStop: (_o: number, color: string) => calls.push(String(color)) })),
      createRadialGradient: vi.fn(() => ({ addColorStop: (_o: number, color: string) => calls.push(String(color)) })),
      clip: vi.fn(),
      set lineCap(_value: CanvasLineCap) {},
      set lineJoin(_value: CanvasLineJoin) {},
      set fillStyle(value: string | CanvasGradient | CanvasPattern) { calls.push(String(value)); },
      set strokeStyle(value: string | CanvasGradient | CanvasPattern) { calls.push(String(value)); },
      set lineWidth(_value: number) {},
    } as unknown as CanvasRenderingContext2D;
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 59,
      aquariumAlpha: 0.24,
      diatomCount: 0,
      euglenaCount: 0,
      vorticellaCount: 1,
    };
    const state = seedAquarium(frame({ width: 172, height: 36 }), params);

    drawAquariumBackground(ctx, state, frame({ width: 172, height: 36 }), params);

    // 4 save/restore: outer drawVorticella pass + feeding-current cue + clipped granule/relief pass + clipped interior-organelle pass
    expect(ctx.save).toHaveBeenCalledTimes(4);
    expect(ctx.restore).toHaveBeenCalledTimes(4);
    expect(ctx.clip).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    // (vorticella's lip/disc are now amorphous polylines, not ctx.ellipse)
    expect(ctx.arc).toHaveBeenCalled();
    // DARKFIELD palette: a luminous cool blue-white body/granules/structures (hue ~196-205,
    // low saturation) — committed away from the old warm/teal cartoon look.
    expect(calls.some((call) => /hsla\(19[6-9], 1[0-8]%/.test(call) || /hsla\(20[0-5], 1[0-9]%/.test(call))).toBe(true);
    // at least one BRIGHT cool element (high lightness) = the self-luminous darkfield glow
    expect(calls.some((call) => /hsla\(19[6-9], \d+%, 9[0-9]%/.test(call))).toBe(true);
  });
});
