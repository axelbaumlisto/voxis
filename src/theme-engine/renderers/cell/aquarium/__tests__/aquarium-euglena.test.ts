import { describe, expect, it, vi } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import type { CellParams } from "../../types";
import { buildField, sourceId } from "../interaction";
import { drawAquariumBackground, seedAquarium, updateAquarium } from "../layer";
import { aquariumParamsView } from "../params";
import type { AquariumFrame, AquariumLayerState, EuglenaState } from "../types";
import { EUGLENA_STEER, MEDIUM, advanceEuglenaMotor, euglenaDisplayLength, euglenaPose, updateEuglena } from "../euglena";

type MotorCellParams = CellParams & { readonly euglenaMotorEnabled?: boolean };
type MotorEuglenaState = EuglenaState & {
  readonly motorPhase?: "run" | "photoCheck" | "commitTurn" | "recover";
  readonly motorAge?: number;
  readonly motorDuration?: number;
};

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

describe("aquarium layer Phase 3 euglena", () => {
  function testEuglena(overrides: Partial<EuglenaState> = {}): EuglenaState {
    return {
      x: 20,
      y: 10,
      phase: 0,
      size: 1,
      heading: 0,
      swimSpeed: 1,
      rollPhase: 0.25,
      metabolyPhase: 0.3,
      flagellumPhase: 0.4,
      rollRate: 0.2,
      metabolyRate: 0.05,
      flagellumRate: 1.2,
      spiralAmplitude: 0.4,
      ...overrides,
    };
  }

  function unitDelta(next: number, previous: number): number {
    return ((next - previous) % 1 + 1) % 1;
  }

  function wrapPi(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function euglenaPolyArea(metabolyPhase: number): number {
    const pose = euglenaPose(0.1, metabolyPhase, { length: 60, baseWidth: 13, heading: 0, metabolyEnvelope: 1 });
    const pts = pose.outline;
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a) / 2;
  }

  function euglenaPeakU(metabolyPhase: number): number {
    const pose = euglenaPose(0.1, metabolyPhase, { length: 60, baseWidth: 13, heading: 0, metabolyEnvelope: 1 });
    let bestU = 0;
    let bestW = -1;
    for (const s of pose.bodySamples) {
      if (s.halfWidth > bestW) { bestW = s.halfWidth; bestU = s.u; }
    }
    return bestU;
  }

  function euglenaVisualBounds(cell: EuglenaState, scale: number, height: number): { minX: number; maxX: number; minY: number; maxY: number } {
    const length = euglenaDisplayLength(cell.size, scale);
    const ampTip = Math.min(Math.max(length * 0.22, 2), 0.40 * height);
    const pose = euglenaPose(cell.rollPhase, cell.metabolyPhase, {
      centerX: cell.x,
      centerY: cell.y,
      length,
      baseWidth: length * 0.22,
      heading: cell.heading,
      flagellumLength: length * 0.95,
      flagellumPhase: cell.flagellumPhase,
      flagellumAmp: ampTip,
      maxFlagellumLateral: 0.40 * height,
      flagellumSegments: Math.min(Math.max(Math.round(length / 3), 10), 24),
      flagellumWaves: 1.5,
      metabolyEnvelope: 1,
    });
    const pts = [...pose.outline, ...pose.flagellumPoints];
    return {
      minX: Math.min(...pts.map((p) => p.x)),
      maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)),
      maxY: Math.max(...pts.map((p) => p.y)),
    };
  }

  function applyMotorOutput(cell: EuglenaState, output: ReturnType<typeof advanceEuglenaMotor>): EuglenaState {
    return {
      ...cell,
      heading: output.intentHeading,
      turnProgress: output.turnProgress,
      turnFrom: output.turnFrom,
      turnTo: output.turnTo,
      motorPhase: output.phase,
      motorAge: output.motorAge,
      motorDuration: output.motorDuration,
      motorIndex: output.motorIndex,
      intentHeading: output.intentHeading,
      photoAdapt: output.photoAdapt,
      lastStimulus: output.lastStimulus,
    };
  }

  function inspectEuglenaDraw(scale: number): { readonly calls: readonly string[]; readonly state: AquariumLayerState } {
    const calls: string[] = [];
    const ctx = {
      save: vi.fn(() => calls.push("save")),
      restore: vi.fn(() => calls.push("restore")),
      beginPath: vi.fn(() => calls.push("beginPath")),
      moveTo: vi.fn((x: number, y: number) => calls.push(`moveTo:${x.toFixed(2)},${y.toFixed(2)}`)),
      lineTo: vi.fn((x: number, y: number) => calls.push(`lineTo:${x.toFixed(2)},${y.toFixed(2)}`)),
      closePath: vi.fn(() => calls.push("closePath")),
      fill: vi.fn(() => calls.push("fill")),
      stroke: vi.fn(() => calls.push("stroke")),
      ellipse: vi.fn((_x: number, _y: number, rx: number, ry: number) => calls.push(`ellipse:${rx.toFixed(2)},${ry.toFixed(2)}`)),
      arc: vi.fn((_x: number, _y: number, r: number) => calls.push(`arc:${r.toFixed(2)}`)),
      set lineCap(value: CanvasLineCap) { calls.push(`lineCap:${value}`); },
      set lineJoin(value: CanvasLineJoin) { calls.push(`lineJoin:${value}`); },
      set fillStyle(value: string | CanvasGradient | CanvasPattern) { calls.push(`fillStyle:${String(value)}`); },
      set strokeStyle(value: string | CanvasGradient | CanvasPattern) { calls.push(`strokeStyle:${String(value)}`); },
      set lineWidth(value: number) { calls.push(`lineWidth:${value}`); },
    } as unknown as CanvasRenderingContext2D;
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumAlpha: 0.24,
      diatomCount: 0,
      euglenaCount: 1,
      euglenaScale: scale,
      vorticellaCount: 0,
    };
    const state: AquariumLayerState = {
      seed: 1,
      diatoms: [],
      euglena: [testEuglena({ x: 20, y: 10, size: 1, heading: 0 })],
      vorticella: [],
    };

    drawAquariumBackground(ctx, state, frame({ width: 172, height: 36, baseHue: 50 }), params);
    return { calls, state };
  }

  describe("euglena motor helper", () => {
    it("repeats the exact same output for the same input sequence", () => {
      const run = () => {
        let cell = testEuglena({ heading: 0.3, noiseSeed: 1234, motorPhase: "run", motorAge: 2.9, motorDuration: 3, lastStimulus: 0.1 });
        const outputs: ReturnType<typeof advanceEuglenaMotor>[] = [];
        for (const [dt, stimulus] of [[0.12, 0.9], [0.31, 0.9], [0.5, 0.55], [0.8, 0.3]] as const) {
          const output = advanceEuglenaMotor(cell, {
            dt,
            currentHeading: cell.heading,
            noiseSeed: 1234,
            rollPhase: cell.rollPhase,
            stimulus,
            stimulusBearing: 1.1,
          });
          outputs.push(output);
          cell = applyMotorOutput(cell, output);
        }
        return outputs;
      };

      expect(run()).toEqual(run());
    });

    it("dt=0 does not advance motor age or phase", () => {
      const cell = testEuglena({
        heading: 0.2,
        noiseSeed: 99,
        motorPhase: "photoCheck",
        motorAge: 0.2,
        motorDuration: 0.45,
        motorIndex: 4,
        intentHeading: 0.8,
        photoAdapt: 0.35,
        lastStimulus: 0.6,
      });

      const output = advanceEuglenaMotor(cell, {
        dt: 0,
        currentHeading: cell.heading,
        noiseSeed: 99,
        rollPhase: cell.rollPhase,
        stimulus: 0.95,
      });

      expect(output.phase).toBe("photoCheck");
      expect(output.motorAge).toBe(0.2);
      expect(output.motorDuration).toBe(0.45);
      expect(output.motorIndex).toBe(4);
      expect(output.intentHeading).toBe(0.8);
      expect(output.photoAdapt).toBe(0.35);
      expect(output.lastStimulus).toBe(0.6);
    });

    it("different deterministic seeds change phase duration or intent heading", () => {
      const cell = testEuglena({ heading: -0.1, motorPhase: "run", motorAge: 3, motorDuration: 3, lastStimulus: 0.4 });
      const context = { dt: 0.01, currentHeading: cell.heading, rollPhase: cell.rollPhase, stimulus: 0.4 };
      const a = advanceEuglenaMotor({ ...cell, noiseSeed: 111 }, { ...context, noiseSeed: 111 });
      const b = advanceEuglenaMotor({ ...cell, noiseSeed: 222 }, { ...context, noiseSeed: 222 });

      expect(a.phase).toBe("commitTurn");
      expect(b.phase).toBe("commitTurn");
      expect(a.motorDuration === b.motorDuration && a.intentHeading === b.intentHeading).toBe(false);
    });

    it("a stimulus jump can produce photoCheck, commitTurn, then recover", () => {
      let cell = testEuglena({
        heading: 0,
        noiseSeed: 0xabc,
        motorPhase: "run",
        motorAge: 2.99,
        motorDuration: 3,
        motorIndex: 0,
        lastStimulus: 0.05,
      });
      const baseContext = {
        currentHeading: cell.heading,
        noiseSeed: 0xabc,
        rollPhase: cell.rollPhase,
        stimulus: 0.85,
        stimulusBearing: Math.PI / 3,
      };

      const photoCheck = advanceEuglenaMotor(cell, { ...baseContext, dt: 0.02 });
      expect(photoCheck.phase).toBe("photoCheck");
      expect(photoCheck.photoAdapt).toBeGreaterThan(0);
      cell = applyMotorOutput(cell, photoCheck);

      const commitTurn = advanceEuglenaMotor(cell, {
        ...baseContext,
        currentHeading: cell.heading,
        dt: photoCheck.motorDuration - photoCheck.motorAge + 1e-6,
      });
      expect(commitTurn.phase).toBe("commitTurn");
      expect(commitTurn.turnTo).not.toBe(commitTurn.turnFrom);
      cell = applyMotorOutput(cell, commitTurn);

      const recover = advanceEuglenaMotor(cell, {
        ...baseContext,
        currentHeading: cell.heading,
        dt: commitTurn.motorDuration - commitTurn.motorAge + 1e-6,
      });
      expect(recover.phase).toBe("recover");
      expect(recover.turnProgress).toBe(1);
    });

    it("sustained strong stimulus raises photoAdapt and weakens later turn output", () => {
      const seed = 0x51ab1e;
      let cell = testEuglena({
        heading: 0,
        noiseSeed: seed,
        motorPhase: "run",
        motorAge: 0,
        motorDuration: 3,
        motorIndex: 0,
        photoAdapt: 0,
        lastStimulus: 0.1,
      });
      const step = (dt: number, stimulus: number) => {
        const output = advanceEuglenaMotor(cell, {
          dt,
          currentHeading: cell.heading,
          noiseSeed: seed,
          rollPhase: cell.rollPhase,
          stimulus,
          stimulusBearing: Math.PI / 2,
        });
        cell = applyMotorOutput(cell, output);
        return output;
      };

      let highAdapt = 0;
      for (let i = 0; i < Math.round(35 / 0.5); i++) highAdapt = step(0.5, 0.9).photoAdapt;
      expect(highAdapt, "20–40s sustained stimulus should build adaptation").toBeGreaterThan(0.45);

      for (let i = 0; i < Math.round(30 / 0.5); i++) step(0.5, 0.1);
      const partialRecovery = cell.photoAdapt ?? 0;
      expect(partialRecovery, "adaptation should start recovering when stimulus drops").toBeLessThan(highAdapt);
      expect(partialRecovery, "recovery should be slower than the stimulus-on adaptation window").toBeGreaterThan(0.15);

      for (let i = 0; i < Math.round(90 / 0.5); i++) step(0.5, 0.1);
      expect(cell.photoAdapt ?? 0, "longer low-stimulus period should restore sensitivity").toBeLessThan(partialRecovery * 0.55);

      const turnProbe = (photoAdapt: number) => advanceEuglenaMotor(testEuglena({
        heading: 0,
        noiseSeed: seed,
        motorPhase: "photoCheck",
        motorAge: 0.49,
        motorDuration: 0.5,
        motorIndex: 8,
        photoAdapt,
        lastStimulus: 0.9,
      }), {
        dt: 0.02,
        currentHeading: 0,
        noiseSeed: seed,
        rollPhase: 0.25,
        stimulus: 0.9,
      });
      const freshTurn = turnProbe(0);
      const adaptedTurn = turnProbe(highAdapt);
      const freshAmp = Math.abs(wrapPi(freshTurn.turnTo - freshTurn.turnFrom));
      const adaptedAmp = Math.abs(wrapPi(adaptedTurn.turnTo - adaptedTurn.turnFrom));

      expect(freshTurn.phase).toBe("commitTurn");
      expect(adaptedTurn.phase).toBe("commitTurn");
      expect(adaptedAmp, "adapted photo response should weaken committed turn output").toBeLessThan(freshAmp * 0.75);
    });

    it("phase output exposes Task6 speed/beat bands and recover ramps back to run", () => {
      const base = testEuglena({ heading: 0, noiseSeed: 0x71a5, lastStimulus: 0.4, intentHeading: 0, turnFrom: 0, turnTo: Math.PI / 2 });
      const output = (phase: MotorEuglenaState["motorPhase"], age: number, duration = 1) => advanceEuglenaMotor({
        ...base,
        motorPhase: phase,
        motorAge: age,
        motorDuration: duration,
        motorIndex: 2,
      }, {
        dt: 0,
        currentHeading: base.heading,
        noiseSeed: 0x71a5,
        rollPhase: base.rollPhase,
        stimulus: 0.4,
      });

      const run = output("run", 0.2);
      const photoCheck = output("photoCheck", 0.2);
      const commitTurn = output("commitTurn", 0.2);
      const recoverStart = output("recover", 0);
      const recoverEnd = output("recover", 1);

      expect(run.speedMul).toBe(1);
      expect(run.beatMul).toBe(1);
      expect(photoCheck.speedMul).toBeGreaterThanOrEqual(0.35);
      expect(photoCheck.speedMul).toBeLessThanOrEqual(0.65);
      expect(photoCheck.beatMul).toBeLessThan(1.25);
      expect(photoCheck.metabolyCue ?? 0).toBeLessThanOrEqual(0.1);
      expect(commitTurn.speedMul).toBeGreaterThanOrEqual(0.45);
      expect(commitTurn.speedMul).toBeLessThanOrEqual(0.75);
      expect(commitTurn.beatMul).toBeGreaterThanOrEqual(1.25);
      expect(commitTurn.beatMul).toBeLessThanOrEqual(1.8);
      expect(commitTurn.turnProgress).toBeGreaterThan(0);
      expect(recoverStart.speedMul).toBeLessThan(recoverEnd.speedMul);
      expect(recoverEnd.speedMul).toBe(1);
      expect(recoverStart.beatMul).toBeGreaterThan(recoverEnd.beatMul);
      expect(recoverEnd.beatMul).toBe(1);
    });

    it("stimulus jumps increase photoCheck/commitTurn transitions compared with steady low stimulus", () => {
      const run = (jump: boolean) => {
        const seed = 0xadc0de;
        let cell = testEuglena({
          heading: 0.1,
          noiseSeed: seed,
          motorPhase: "run",
          motorAge: 0,
          motorDuration: 3,
          motorIndex: 0,
          photoAdapt: 0,
          lastStimulus: 0.2,
        });
        let previousPhase = cell.motorPhase;
        let photoCheckEntries = 0;
        let sensoryTurnEntries = 0;
        for (let i = 1; i <= Math.round(8 / 0.25); i++) {
          const stimulus = jump && i >= 4 ? 0.95 : 0.2;
          const output = advanceEuglenaMotor(cell, {
            dt: 0.25,
            currentHeading: cell.heading,
            noiseSeed: seed,
            rollPhase: cell.rollPhase,
            stimulus,
            stimulusBearing: Math.PI / 2,
          });
          if (output.phase !== previousPhase && (output.phase === "photoCheck" || output.phase === "commitTurn")) {
            sensoryTurnEntries += 1;
            if (output.phase === "photoCheck") photoCheckEntries += 1;
          }
          previousPhase = output.phase;
          cell = applyMotorOutput(cell, output);
        }
        return { photoCheckEntries, sensoryTurnEntries };
      };

      const low = run(false);
      const jumped = run(true);

      expect(jumped.photoCheckEntries, "step-up stimulus should add sensory photoCheck hesitation").toBeGreaterThan(low.photoCheckEntries);
      expect(jumped.sensoryTurnEntries, "step-up stimulus should increase photoCheck/commitTurn occurrence").toBeGreaterThan(low.sensoryTurnEntries);
    });
  });

  it("updateAquarium moves euglena deterministically with dt-integrated phases", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      aquariumSeed: 41,
      diatomCount: 0,
      euglenaCount: 2,
      euglenaSpeed: 0.9,
      euglenaSpeedActive: 1.3,
      aquariumActivityBoost: 0.5,
    };
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params);
    const updated = updateAquarium(initial, frame({ dt: 0.5, width: 172, height: 36, activity: 0.8 }), params);
    const repeat = updateAquarium(initial, frame({ dt: 0.5, width: 172, height: 36, activity: 0.8 }), params);

    expect(updated).toEqual(repeat);
    expect(updated).not.toBe(initial);
    expect(updated.diatoms).toBe(initial.diatoms);
    expect(updated.vorticella).toBe(initial.vorticella);
    for (const cell of updated.euglena) {
      for (const value of [cell.x, cell.y, cell.heading, cell.rollPhase, cell.metabolyPhase, cell.flagellumPhase]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.x).toBeLessThan(172);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeLessThan(36);
      expect(cell.rollPhase).toBeGreaterThanOrEqual(0);
      expect(cell.rollPhase).toBeLessThan(1);
      expect(cell.metabolyPhase).toBeGreaterThanOrEqual(0);
      expect(cell.metabolyPhase).toBeLessThan(1);
      expect(cell.flagellumPhase).toBeGreaterThanOrEqual(0);
      expect(cell.flagellumPhase).toBeLessThan(1);
    }
  });

  it("updateEuglena smoothly moves away from the hero instead of teleporting", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0,
      euglenaSpeedActive: 0,
    });
    const hero = { x: 86, y: 18, radius: 17 };
    const initial = [testEuglena({ x: 92, y: 18, heading: 0 })];
    const once = updateEuglena(initial, frame({ width: 172, height: 36, dt: 0.016, hero }), view)[0];
    const twice = updateEuglena([once], frame({ width: 172, height: 36, dt: 0.016, hero }), view)[0];

    const d0 = Math.hypot(initial[0].x - hero.x, initial[0].y - hero.y);
    const d1 = Math.hypot(once.x - hero.x, once.y - hero.y);
    const d2 = Math.hypot(twice.x - hero.x, twice.y - hero.y);

    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    // soft exponential push: a small fraction of the penetration per frame
    // (smooth, not a teleport to the boundary)
    expect(d1 - d0).toBeLessThan(3);
    expect(once.y).toBeGreaterThanOrEqual(0);
    expect(once.y).toBeLessThanOrEqual(36);
  });

  it("photo intent is opt-in, deterministic, and changes the transit path", () => {
    const baseParams: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 2,
      euglenaPhototaxis: 0,
      euglenaLoiter: 0,
      euglenaWake: 0,
    };
    const initial = [testEuglena({
      x: 230,
      y: 90,
      heading: 0,
      burstPhase: 0.4,
      burstRate: 0,
      tumbleProgress: 1,
      startle: 0,
      noiseSeed: 123,
    })];
    const run = (photoIntent: number) => {
      const view = aquariumParamsView({ ...baseParams, euglenaPhotoIntent: photoIntent });
      let cells = initial;
      for (let i = 0; i < 60 * 4; i++) {
        cells = updateEuglena(cells, frame({
          t: i / 60,
          dt: 1 / 60,
          width: 340,
          height: 170,
          mode: "idle",
          activity: 0,
          audioLevel: 0,
        }), view) as EuglenaState[];
      }
      return cells[0];
    };

    const withoutIntent = run(0);
    const withIntent = run(1.25);
    const repeat = run(1.25);

    expect(withIntent).toEqual(repeat);
    expect(withIntent.x).toBeLessThan(withoutIntent.x - 40);
    expect(withIntent.y).toBeGreaterThanOrEqual(0);
    expect(withIntent.y).toBeLessThanOrEqual(170);
  });

  it("scales Euglena flagellum visual beat without changing body transit", () => {
    const baseParams: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 2,
    };
    const initial = [testEuglena({
      x: 120,
      y: 80,
      heading: 0,
      flagellumPhase: 0.25,
      flagellumRate: 3,
      burstPhase: 0.4,
      burstRate: 0,
      tumbleProgress: 1,
      startle: 0,
    })];
    const run = (euglenaFlagellumRateScale: number) => updateEuglena(
      initial,
      frame({ t: 0, dt: 0.1, width: 340, height: 170, activity: 0, audioLevel: 0 }),
      aquariumParamsView({ ...baseParams, euglenaFlagellumRateScale }),
    )[0];

    const normal = run(1);
    const slow = run(0.4);

    expect(slow.x).toBeCloseTo(normal.x, 10);
    expect(slow.y).toBeCloseTo(normal.y, 10);
    expect(unitDelta(slow.flagellumPhase, initial[0].flagellumPhase)).toBeLessThan(unitDelta(normal.flagellumPhase, initial[0].flagellumPhase));
  });

  it("motor phase drives visible displacement without breaking the flagellum rate cap", () => {
    const baseParams: MotorCellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 2,
      aquariumActivityBoost: 1,
      euglenaMotorEnabled: true,
      euglenaFlagellumRateScale: 1,
    };
    const start = testEuglena({
      x: 120,
      y: 80,
      heading: 0,
      swimSpeed: 1,
      rollRate: 0,
      metabolyRate: 0,
      flagellumPhase: 0.25,
      flagellumRate: 30,
      burstPhase: 0.4,
      burstRate: 0,
      tumbleProgress: 1,
      startle: 0,
      noiseSeed: 0x6eed,
      lastStimulus: 0.4,
    });
    const runPhase = (phase: MotorEuglenaState["motorPhase"], scale = 1) => updateEuglena([{
      ...start,
      motorPhase: phase,
      motorAge: 0.1,
      motorDuration: 0.5,
      motorIndex: 2,
      intentHeading: 0,
      turnFrom: 0,
      turnTo: Math.PI / 2,
    }], frame({ t: 0, dt: 0.1, width: 340, height: 170, activity: 0, audioLevel: 0 }), aquariumParamsView({
      ...baseParams,
      euglenaFlagellumRateScale: scale,
    }))[0] as MotorEuglenaState;
    const displacement = (cell: EuglenaState) => Math.hypot(cell.x - start.x, cell.y - start.y);

    const run = runPhase("run");
    const photoCheck = runPhase("photoCheck");
    const commitTurn = runPhase("commitTurn");
    const capped = runPhase("commitTurn", 10);

    expect(displacement(run), "run speedMul should read as full cruise").toBeGreaterThan(displacement(commitTurn));
    expect(displacement(commitTurn), "commitTurn should still translate more than a photoCheck hesitation").toBeGreaterThan(displacement(photoCheck));
    expect(displacement(photoCheck) / displacement(run), "photoCheck speedMul should stay in the 0.35–0.65 visible hesitation band").toBeGreaterThanOrEqual(0.35);
    expect(displacement(photoCheck) / displacement(run), "photoCheck speedMul should stay in the 0.35–0.65 visible hesitation band").toBeLessThanOrEqual(0.65);
    expect(displacement(commitTurn) / displacement(run), "commitTurn speedMul should stay in the 0.45–0.75 reorientation band").toBeGreaterThanOrEqual(0.45);
    expect(displacement(commitTurn) / displacement(run), "commitTurn speedMul should stay in the 0.45–0.75 reorientation band").toBeLessThanOrEqual(0.75);
    expect(unitDelta(capped.flagellumPhase, start.flagellumPhase), "beatMul must still respect the global visual cap").toBeLessThanOrEqual(0.8 + 1e-12);
  });

  it("motor beatMul affects flagellum phase through the global visual scale", () => {
    const baseParams: MotorCellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0,
      euglenaSpeedActive: 0,
      aquariumActivityBoost: 1,
      euglenaMotorEnabled: true,
      euglenaFlagellumRateScale: 0.5,
    };
    const start = testEuglena({
      x: 120,
      y: 80,
      heading: 0,
      swimSpeed: 0,
      flagellumPhase: 0.25,
      flagellumRate: 8,
      rollRate: 0,
      metabolyRate: 0,
      burstPhase: 0.4,
      burstRate: 0,
      tumbleProgress: 1,
      startle: 0,
      noiseSeed: 0x6eed,
      lastStimulus: 0.4,
    });
    const step = (phase: MotorEuglenaState["motorPhase"]) => updateEuglena([{
      ...start,
      motorPhase: phase,
      motorAge: 0.1,
      motorDuration: 0.5,
      motorIndex: 2,
      intentHeading: 0,
      turnFrom: 0,
      turnTo: Math.PI / 2,
    }], frame({ t: 0, dt: 0.1, width: 340, height: 170, activity: 0, audioLevel: 0 }), aquariumParamsView(baseParams))[0] as MotorEuglenaState;

    const run = step("run");
    const photoCheck = step("photoCheck");
    const commitTurn = step("commitTurn");

    expect(unitDelta(photoCheck.flagellumPhase, start.flagellumPhase), "photoCheck scan should not make the flagellum frantic").toBeGreaterThan(unitDelta(run.flagellumPhase, start.flagellumPhase));
    expect(unitDelta(commitTurn.flagellumPhase, start.flagellumPhase), "commitTurn beat switch should be visibly faster than run").toBeGreaterThan(unitDelta(photoCheck.flagellumPhase, start.flagellumPhase));
    expect(unitDelta(commitTurn.flagellumPhase, start.flagellumPhase), "global euglenaFlagellumRateScale should still cap motor beatMul").toBeCloseTo(8 * 0.5 * 1.32 * 0.1, 10);
  });

  it("updateEuglena applies mode multipliers only through dt-integrated phase deltas", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      aquariumActivityBoost: 1,
    });
    const initial = [testEuglena({ rollPhase: 0.2, metabolyPhase: 0.3, flagellumPhase: 0.4 })];
    const idle = updateEuglena(initial, frame({ mode: "idle", dt: 0.5, activity: 0 }), view)[0];
    const recording = updateEuglena(initial, frame({ mode: "recording", dt: 0.5, activity: 0 }), view)[0];
    const transcribing = updateEuglena(initial, frame({ mode: "transcribing", dt: 0.5, activity: 0 }), view)[0];
    const error = updateEuglena(initial, frame({ mode: "error", dt: 0.5, activity: 0 }), view)[0];

    expect(unitDelta(recording.rollPhase, initial[0].rollPhase)).toBeGreaterThan(unitDelta(idle.rollPhase, initial[0].rollPhase));
    expect(unitDelta(transcribing.rollPhase, initial[0].rollPhase)).toBeLessThan(unitDelta(idle.rollPhase, initial[0].rollPhase));
    expect(unitDelta(error.rollPhase, initial[0].rollPhase)).toBeLessThan(unitDelta(idle.rollPhase, initial[0].rollPhase));
    expect(unitDelta(recording.metabolyPhase, initial[0].metabolyPhase)).toBeGreaterThan(unitDelta(idle.metabolyPhase, initial[0].metabolyPhase));
    expect(unitDelta(transcribing.flagellumPhase, initial[0].flagellumPhase)).toBeLessThan(unitDelta(idle.flagellumPhase, initial[0].flagellumPhase));
    expect(recording.size).toBe(initial[0].size);
    expect(recording.swimSpeed).toBe(initial[0].swimSpeed);
  });

  it("euglenaPose metaboly conserves area (no inflation) and travels along the body", () => {
    const areas = [0, 0.2, 0.4, 0.6, 0.8].map(euglenaPolyArea);
    const mean = areas.reduce((sum, value) => sum + value, 0) / areas.length;
    for (const area of areas) {
      // width-only traveling bulge with (1-u^2) damping stays within ~3% of mean
      expect(area / mean).toBeGreaterThan(0.95);
      expect(area / mean).toBeLessThan(1.05);
    }
    // the bulge is a TRAVELING wave: its peak-width location shifts with phase
    const peaks = [0, 0.33, 0.66].map(euglenaPeakU);
    expect(new Set(peaks).size).toBeGreaterThan(1);
  });

  it("higher medium viscosity slows reorientation (less turn per time)", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const run = () => {
      let cell = testEuglena({ x: 230, y: 150, heading: 0, swimSpeed: 1 }); // approaching the right wall, outside the clamp
      for (let i = 0; i < 6; i++) {
        cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0 }), view)[0];
      }
      return Math.abs(cell.heading); // how far it turned away from heading 0
    };
    const saved = MEDIUM.viscosity;
    try {
      MEDIUM.viscosity = 1.0;
      const thin = run();
      MEDIUM.viscosity = 4.0;
      const thick = run();
      expect(thick).toBeLessThan(thin); // thicker medium → turned less in the same time
    } finally {
      MEDIUM.viscosity = saved;
    }
  });

  it("negative gravitaxis drifts heading toward screen-up in tall open water", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const saved = EUGLENA_STEER.gravitaxis;
    try {
      EUGLENA_STEER.gravitaxis = 0.6;
      let cell = testEuglena({ x: 150, y: 150, heading: 0, swimSpeed: 0 });
      for (let i = 0; i < 20; i++) {
        cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0 }), view)[0];
      }
      expect(cell.heading).toBeLessThan(0);
      expect(Math.sin(cell.heading)).toBeLessThan(-0.1);
    } finally {
      EUGLENA_STEER.gravitaxis = saved;
    }
  });

  it("short-tank fade disables gravitaxis when height is at most three body lengths", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const saved = EUGLENA_STEER.gravitaxis;
    try {
      EUGLENA_STEER.gravitaxis = 2.0;
      let cell = testEuglena({ x: 150, y: 35, heading: 0, swimSpeed: 0 });
      for (let i = 0; i < 20; i++) {
        cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 70, activity: 0 }), view)[0];
      }
      expect(cell.heading).toBeCloseTo(0, 10);
    } finally {
      EUGLENA_STEER.gravitaxis = saved;
    }
  });

  it("phototaxis at moderate app-light steers toward the fixed +x light without a hero", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const saved = EUGLENA_STEER.phototaxis;
    try {
      EUGLENA_STEER.phototaxis = 2.0;
      let cell = testEuglena({ x: 100, y: 150, heading: Math.PI / 2, swimSpeed: 0 });
      for (let i = 0; i < 20; i++) {
        cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0.4, audioLevel: 0 }), view)[0];
      }
      expect(cell.heading).toBeLessThan(Math.PI / 2);
      expect(Math.cos(cell.heading)).toBeGreaterThan(0.1);
    } finally {
      EUGLENA_STEER.phototaxis = saved;
    }
  });

  it("phototaxis flips to photophobic steering away from the +x light at high app-light", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const saved = EUGLENA_STEER.phototaxis;
    try {
      EUGLENA_STEER.phototaxis = 2.0;
      let cell = testEuglena({ x: 100, y: 150, heading: Math.PI / 2, swimSpeed: 0 });
      for (let i = 0; i < 20; i++) {
        cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0.95, audioLevel: 0.2 }), view)[0];
      }
      expect(cell.heading).toBeGreaterThan(Math.PI / 2);
      expect(Math.cos(cell.heading)).toBeLessThan(-0.1);
    } finally {
      EUGLENA_STEER.phototaxis = saved;
    }
  });

  it("priority steering banks the euglena away from an approaching wall", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    // swimming straight at the right wall, close to it → heading must rotate away
    const initial = [testEuglena({ x: 290, y: 150, heading: 0, swimSpeed: 1 })];
    let cell = initial[0];
    for (let i = 0; i < 30; i++) {
      cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0 }), view)[0];
    }
    // it banked away from the wall (no longer heading straight right) and never crossed it
    expect(Math.cos(cell.heading)).toBeLessThan(0.85);
    expect(cell.x).toBeLessThanOrEqual(300);
  });

  it("de-pins a wall-clamped euglena so its rendered body and flagellum leave the edge", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0.18,
      euglenaSpeedActive: 0.34,
      euglenaScale: 2.2,
      aquariumActivityBoost: 0.65,
    });
    const width = 340;
    const height = 170;
    let cell = testEuglena({ x: 16, y: 85, heading: Math.PI, swimSpeed: 0.8563175361836329 });
    for (let i = 0; i < 4; i++) {
      cell = updateEuglena([cell], frame({ dt: 0.05, width, height, activity: 0.2 }), view)[0];
    }
    const bounds = euglenaVisualBounds(cell, view.euglena.scale, height);
    expect(bounds.minX).toBeGreaterThanOrEqual(6);
    expect(Math.cos(cell.heading)).toBeGreaterThan(0);
  });

  it("a negative hero weight makes the euglena PURSUE the hero instead of avoiding", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const hero = { x: 150, y: 150, radius: 18 };
    // start well outside the startle zone, below the hero, heading up toward it
    const start = testEuglena({ x: 150, y: 220, heading: -Math.PI / 2, swimSpeed: 1 });
    const savedHero = EUGLENA_STEER.hero;
    const savedLoiter = EUGLENA_STEER.loiter;
    try {
      EUGLENA_STEER.hero = -1.2;     // pure pursue
      EUGLENA_STEER.loiter = 0;   // disable the approach-then-retreat spring
      let chase = start;
      for (let i = 0; i < 8; i++) {
        chase = updateEuglena([chase], frame({ dt: 0.05, width: 300, height: 300, hero }), view)[0];
      }
      // pursuing keeps it pointed at the hero (heading stays roughly upward)
      expect(Math.sin(chase.heading)).toBeLessThan(-0.5);
    } finally {
      EUGLENA_STEER.hero = savedHero;
      EUGLENA_STEER.loiter = savedLoiter;
    }
  });

  it("close contact triggers a decaying startle-dart away from the hero", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaScale: 3,
      aquariumActivityBoost: 1,
    });
    const hero = { x: 150, y: 150, radius: 18 };
    // placed right on the exclusion rim (q ~ 1) -> inside the startle trigger
    const start = testEuglena({ x: 150, y: 192, heading: -Math.PI / 2, swimSpeed: 1, startle: 0 });
    const d0 = Math.hypot(start.x - hero.x, start.y - hero.y);
    const once = updateEuglena([start], frame({ dt: 0.05, width: 300, height: 300, hero }), view)[0];
    expect(once.startle).toBeGreaterThan(0); // startle engaged on contact
    // over a few frames the dart turns it around and it flees (moves away)
    let cell = once;
    for (let i = 0; i < 10; i++) {
      cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, hero }), view)[0];
    }
    expect(Math.hypot(cell.x - hero.x, cell.y - hero.y)).toBeGreaterThan(d0);
    // and it decays toward zero when contact ends (far away, no trigger)
    const far = updateEuglena([{ ...once, x: 20, y: 20, startle: 1 }], frame({ dt: 0.5, width: 300, height: 300 }), view)[0];
    expect(far.startle).toBeLessThan(1);
  });

  it("RED Task0: motor-on forced commitTurn drives visible turnProgress from 0 to 1", () => {
    const params: MotorCellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0,
      euglenaSpeedActive: 0,
      aquariumActivityBoost: 1,
      euglenaMotorEnabled: true,
    };
    const view = aquariumParamsView(params);
    const start: MotorEuglenaState = testEuglena({
      x: 150,
      y: 150,
      heading: 0,
      swimSpeed: 0,
      burstRate: 0,
      turnProgress: 0,
      turnFrom: 0,
      turnTo: Math.PI / 2,
      motorPhase: "commitTurn",
      motorAge: 0,
      motorDuration: 0.5,
    });

    const mid = updateEuglena([start], frame({ dt: 0.25, width: 300, height: 300, activity: 0 }), view)[0] as MotorEuglenaState;
    const end = updateEuglena([mid], frame({ dt: 0.25, width: 300, height: 300, activity: 0 }), view)[0] as MotorEuglenaState;

    expect(mid.motorPhase, "forced motor commitTurn should remain in the motor state machine during the cue").toBe("commitTurn");
    expect(mid.turnProgress, "forced commitTurn should advance the visible turn cue after half duration").toBeGreaterThan(0);
    expect(mid.turnProgress, "forced commitTurn should not complete before its duration").toBeLessThan(1);
    expect(mid.turnFrom, "forced commitTurn should expose the visible source heading").toBeCloseTo(start.turnFrom ?? 0, 6);
    expect(mid.turnTo, "forced commitTurn should expose the visible target heading").toBeCloseTo(start.turnTo ?? 0, 6);
    expect(Math.abs(wrapPi(mid.heading - start.heading)), "forced commitTurn should visibly rotate heading during the cue").toBeGreaterThan(0.1);
    expect(end.turnProgress, "forced commitTurn should complete visible turnProgress at the end of duration").toBe(1);
    expect(end.turnFrom, "completed commitTurn should preserve visible source heading for draw").toBeCloseTo(start.turnTo ?? 0, 6);
    expect(end.turnTo, "completed commitTurn should preserve visible target heading for draw").toBeCloseTo(start.turnTo ?? 0, 6);
    expect(end.heading, "forced commitTurn should finish at turnTo heading").toBeCloseTo(start.turnTo ?? 0, 6);
  });

  it("discrete tumble reorients deterministically by 30-150 degrees over about 1s", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0,
      euglenaSpeedActive: 0,
      aquariumActivityBoost: 1,
    });
    const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const start = testEuglena({
      x: 150, y: 150, heading: 0, swimSpeed: 0,
      burstPhase: 0.99, burstRate: 1, tumbleIndex: 0, tumbleProgress: 1,
      noiseSeed: 0x12345678,
    });
    const once = updateEuglena([start], frame({ dt: 0.5, width: 300, height: 300, activity: 0 }), view)[0];
    const repeat = updateEuglena([start], frame({ dt: 0.5, width: 300, height: 300, activity: 0 }), view)[0];

    expect(once).toEqual(repeat);
    expect(once.tumbleIndex).toBe(1);
    expect(once.tumbleProgress).toBeGreaterThan(0);
    const targetTurn = Math.abs(wrapPi((once.tumbleTo ?? 0) - (once.tumbleFrom ?? 0)));
    expect(targetTurn).toBeGreaterThanOrEqual(Math.PI / 6);
    expect(targetTurn).toBeLessThanOrEqual((5 * Math.PI) / 6);

    let cell = once;
    for (let i = 0; i < 12; i++) {
      cell = updateEuglena([cell], frame({ dt: 0.05, width: 300, height: 300, activity: 0 }), view)[0];
    }
    const actualTurn = Math.abs(wrapPi(cell.heading - start.heading));
    expect(actualTurn).toBeGreaterThanOrEqual(Math.PI / 6);
    expect(actualTurn).toBeLessThanOrEqual((5 * Math.PI) / 6);
  });

  it("heavy-tailed tumble interval modulation is deterministic per noise seed", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0,
      euglenaSpeedActive: 0,
      aquariumActivityBoost: 1,
    });
    const base = testEuglena({ x: 150, y: 150, swimSpeed: 0, burstPhase: 0.1, burstRate: 0.1, tumbleIndex: 3 });
    const a1 = updateEuglena([{ ...base, noiseSeed: 111 }], frame({ dt: 1, width: 300, height: 300, activity: 0 }), view)[0];
    const a2 = updateEuglena([{ ...base, noiseSeed: 111 }], frame({ dt: 1, width: 300, height: 300, activity: 0 }), view)[0];
    const b = updateEuglena([{ ...base, noiseSeed: 222 }], frame({ dt: 1, width: 300, height: 300, activity: 0 }), view)[0];

    expect(a1.burstPhase).toBe(a2.burstPhase);
    expect(b.burstPhase).not.toBe(a1.burstPhase);
  });

  it("rotDiffusion cosmetic jitter is bounded, deterministic, and default-off", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0,
      euglenaSpeedActive: 0,
      aquariumActivityBoost: 1,
    });
    const start = testEuglena({
      x: 150, y: 150, heading: 0.4, swimSpeed: 0,
      rollRate: 0, metabolyRate: 0, flagellumRate: 0, burstRate: 0,
      noiseSeed: 0xabcdef,
    });
    const saved = MEDIUM.rotDiffusion;
    try {
      MEDIUM.rotDiffusion = 0;
      const off = updateEuglena([start], frame({ t: 10, dt: 0.04, width: 300, height: 300, activity: 0 }), view)[0];
      expect(off.heading).toBe(start.heading);

      MEDIUM.rotDiffusion = 0.5;
      const a = updateEuglena([start], frame({ t: 10, dt: 0.04, width: 300, height: 300, activity: 0 }), view)[0];
      const b = updateEuglena([start], frame({ t: 10, dt: 0.04, width: 300, height: 300, activity: 0 }), view)[0];
      expect(a.heading).toBe(b.heading);
      expect(Math.abs(a.heading - start.heading)).toBeLessThanOrEqual(0.5 * Math.sqrt(0.04) + 1e-12);
    } finally {
      MEDIUM.rotDiffusion = saved;
    }
  });

  it("updateEuglena stays dt-partition-exact with all new knobs at default", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      aquariumActivityBoost: 1,
    });
    expect(EUGLENA_STEER.gravitaxis).toBe(0);
    expect(EUGLENA_STEER.phototaxis).toBe(0);
    expect(EUGLENA_STEER.separation).toBe(0);
    // open water, no wall/hero/startle pressure; new foundation knobs are default no-op
    const initial = [testEuglena({ x: 150, y: 150, heading: 0, swimSpeed: 1, rollPhase: 0.1, metabolyPhase: 0.2, flagellumPhase: 0.3 })];
    const oneStep = updateEuglena(initial, frame({ dt: 0.24, width: 300, height: 300, activity: 0 }), view);
    const halfStep = updateEuglena(initial, frame({ dt: 0.12, width: 300, height: 300, activity: 0 }), view);
    const twoSteps = updateEuglena(halfStep, frame({ dt: 0.12, width: 300, height: 300, activity: 0 }), view);

    expect(twoSteps[0].x).toBeCloseTo(oneStep[0].x, 10);
    expect(twoSteps[0].y).toBeCloseTo(oneStep[0].y, 10);
    expect(twoSteps[0].heading).toBeCloseTo(oneStep[0].heading, 10);
    expect(twoSteps[0].rollPhase).toBeCloseTo(oneStep[0].rollPhase, 10);
    expect(twoSteps[0].metabolyPhase).toBeCloseTo(oneStep[0].metabolyPhase, 10);
    expect(twoSteps[0].flagellumPhase).toBeCloseTo(oneStep[0].flagellumPhase, 10);
  });

  it("updateEuglena treats an empty EFFECTIVE field as the legacy pure-forward path", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      aquariumActivityBoost: 1,
    });
    const initial = [testEuglena({ x: 150, y: 150, heading: 0, swimSpeed: 1, rollPhase: 0.1, metabolyPhase: 0.2, flagellumPhase: 0.3 })];
    const interaction = buildField([{ kind: "motile", x: 150, y: 150, sourceId: sourceId("euglena", 0) }]);
    const fieldFrame = (dt: number) => frame({ dt, width: 300, height: 300, activity: 0, interaction });
    const legacyFrame = (dt: number) => frame({ dt, width: 300, height: 300, activity: 0 });

    const fieldStep = updateEuglena(initial, fieldFrame(0.24), view);
    const legacyStep = updateEuglena(initial, legacyFrame(0.24), view);
    expect(fieldStep[0].x).toBeCloseTo(legacyStep[0].x, 10);
    expect(fieldStep[0].y).toBeCloseTo(legacyStep[0].y, 10);
    expect(fieldStep[0].heading).toBeCloseTo(legacyStep[0].heading, 10);
    expect(fieldStep[0].rollPhase).toBeCloseTo(legacyStep[0].rollPhase, 10);
    expect(fieldStep[0].metabolyPhase).toBeCloseTo(legacyStep[0].metabolyPhase, 10);
    expect(fieldStep[0].flagellumPhase).toBeCloseTo(legacyStep[0].flagellumPhase, 10);

    const halfStep = updateEuglena(initial, fieldFrame(0.12), view);
    const twoSteps = updateEuglena(halfStep, fieldFrame(0.12), view);
    expect(twoSteps[0].x).toBeCloseTo(fieldStep[0].x, 10);
    expect(twoSteps[0].y).toBeCloseTo(fieldStep[0].y, 10);
    expect(twoSteps[0].heading).toBeCloseTo(fieldStep[0].heading, 10);
  });

  it("separation=0 is byte-identical for two euglena and stays dt-partition exact", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 2,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      euglenaSeparation: 0,
      aquariumActivityBoost: 1,
    });
    expect(view.euglena.steer).toBeUndefined();
    expect(EUGLENA_STEER.separation).toBe(0);

    const initial = [
      testEuglena({ x: 145, y: 150, heading: 0, swimSpeed: 1, rollPhase: 0.1, metabolyPhase: 0.2, flagellumPhase: 0.3, burstRate: 0 }),
      testEuglena({ x: 155, y: 150, heading: 0, swimSpeed: 1, rollPhase: 0.4, metabolyPhase: 0.5, flagellumPhase: 0.6, burstRate: 0 }),
    ];
    const motileField = (cells: readonly EuglenaState[]) => buildField(cells.map((cell, idx) => ({
      kind: "motile" as const,
      x: cell.x,
      y: cell.y,
      sourceId: sourceId("euglena", idx),
    })));
    const fieldFrame = (dt: number, cells = initial) => frame({ dt, width: 300, height: 300, activity: 0, interaction: motileField(cells) });
    const legacyFrame = (dt: number) => frame({ dt, width: 300, height: 300, activity: 0 });

    const zeroed = updateEuglena(initial, fieldFrame(0.24), view);
    const legacy = updateEuglena(initial, legacyFrame(0.24), view);
    expect(zeroed).toEqual(legacy);

    const half = updateEuglena(initial, fieldFrame(0.12), view);
    const two = updateEuglena(half, fieldFrame(0.12, half), view);
    expect(two[0].x).toBeCloseTo(zeroed[0].x, 10);
    expect(two[0].y).toBeCloseTo(zeroed[0].y, 10);
    expect(two[0].heading).toBeCloseTo(zeroed[0].heading, 10);
    expect(two[1].x).toBeCloseTo(zeroed[1].x, 10);
    expect(two[1].y).toBeCloseTo(zeroed[1].y, 10);
    expect(two[1].heading).toBeCloseTo(zeroed[1].heading, 10);
  });

  it("enabled separation moves close same-species euglena apart without reacting to hero motiles", () => {
    const start = [
      testEuglena({ x: 148, y: 150, heading: 0, swimSpeed: 1, burstRate: 0 }),
      testEuglena({ x: 152, y: 150, heading: Math.PI, swimSpeed: 1, burstRate: 0 }),
    ];
    const dist = (cells: readonly EuglenaState[]) => Math.hypot(cells[1].x - cells[0].x, cells[1].y - cells[0].y);
    const interaction = buildField([
      ...start.map((cell, idx) => ({ kind: "motile" as const, x: cell.x, y: cell.y, sourceId: sourceId("euglena", idx) })),
      { kind: "motile", x: 150, y: 150, sourceId: sourceId("hero", 0) },
      { kind: "motile", x: 150, y: 151, sourceId: sourceId("vorticella", 0) },
    ]);
    const baseParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 2,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      aquariumActivityBoost: 1,
    };
    const off = updateEuglena(start, frame({ dt: 0.2, width: 300, height: 300, activity: 0, interaction }), aquariumParamsView(baseParams));
    const on = updateEuglena(start, frame({ dt: 0.2, width: 300, height: 300, activity: 0, interaction }), aquariumParamsView({
      ...baseParams,
      euglenaSeparation: 4,
    }));
    const heroOnlyInteraction = buildField([
      { kind: "motile", x: 150, y: 150, sourceId: sourceId("hero", 0) },
      { kind: "motile", x: 150, y: 151, sourceId: sourceId("vorticella", 0) },
    ]);
    const heroOnly = updateEuglena([start[0]], frame({ dt: 0.2, width: 300, height: 300, activity: 0, interaction: heroOnlyInteraction }), aquariumParamsView({ ...baseParams, euglenaCount: 1, euglenaSeparation: 4 }));
    const noField = updateEuglena([start[0]], frame({ dt: 0.2, width: 300, height: 300, activity: 0 }), aquariumParamsView({ ...baseParams, euglenaCount: 1, euglenaSeparation: 4 }));

    expect(dist(on)).toBeGreaterThan(dist(off));
    expect(dist(on) - dist(off)).toBeLessThan(20);
    expect(heroOnly[0]).toEqual(noField[0]);
  });

  it("steers away from a nearby Didinium motile hazard without predation semantics", () => {
    const start = [testEuglena({ x: 150, y: 150, heading: 0, swimSpeed: 0, burstRate: 0 })];
    const baseParams = { ...CELL_DEFAULTS, enableAquarium: true, euglenaCount: 1, euglenaSpeed: 1, euglenaSpeedActive: 1, aquariumActivityBoost: 1 };
    const interaction = buildField([
      { kind: "motile", x: 150, y: 163, radius: 12, role: "predator", sourceId: sourceId("didinium", 0) },
    ]);
    const next = updateEuglena(start, frame({ dt: 0.5, width: 300, height: 300, activity: 0, interaction }), aquariumParamsView(baseParams));
    expect(next[0].heading).toBeLessThan(-0.05);
  });

  it("ignores a far Didinium motile hazard", () => {
    const start = [testEuglena({ x: 150, y: 150, heading: 0, swimSpeed: 0, burstRate: 0 })];
    const baseParams = { ...CELL_DEFAULTS, enableAquarium: true, euglenaCount: 1, euglenaSpeed: 1, euglenaSpeedActive: 1, aquariumActivityBoost: 1 };
    const far = buildField([
      { kind: "motile", x: 280, y: 280, radius: 12, role: "predator", sourceId: sourceId("didinium", 0) },
    ]);
    const withFar = updateEuglena(start, frame({ dt: 0.5, width: 300, height: 300, activity: 0, interaction: far }), aquariumParamsView(baseParams));
    const noField = updateEuglena(start, frame({ dt: 0.5, width: 300, height: 300, activity: 0 }), aquariumParamsView(baseParams));
    expect(withFar[0].heading).toBeCloseTo(noField[0].heading, 10);
    expect(withFar[0].x).toBeCloseTo(noField[0].x, 10);
    expect(withFar[0].y).toBeCloseTo(noField[0].y, 10);
  });

  it("updateEuglena is dt-partition invariant across phase wrap", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      aquariumActivityBoost: 1,
    });
    // far from every wall so no steering engages — isolates the phase-wrap math
    const initial = [testEuglena({ x: 150, y: 150, rollPhase: 0.98, metabolyPhase: 0.99, flagellumPhase: 0.97 })];
    const oneStep = updateEuglena(initial, frame({ dt: 0.4, width: 300, height: 300, activity: 0 }), view);
    const halfStep = updateEuglena(initial, frame({ dt: 0.2, width: 300, height: 300, activity: 0 }), view);
    const twoSteps = updateEuglena(halfStep, frame({ dt: 0.2, width: 300, height: 300, activity: 0 }), view);

    expect(twoSteps[0].x).toBeCloseTo(oneStep[0].x, 10);
    expect(twoSteps[0].y).toBeCloseTo(oneStep[0].y, 10);
    expect(twoSteps[0].rollPhase).toBeCloseTo(oneStep[0].rollPhase, 10);
    expect(twoSteps[0].metabolyPhase).toBeCloseTo(oneStep[0].metabolyPhase, 10);
    expect(twoSteps[0].flagellumPhase).toBeCloseTo(oneStep[0].flagellumPhase, 10);
  });

  it("updateEuglena edge wrapping is dt-partition invariant near overlay bounds", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1,
      aquariumActivityBoost: 1,
    });
    // mid-field, far from every wall (beyond the avoidance lookahead): no wall
    // steering engages, so the path is pure forward + closed-form phase
    // accumulators (partition-exact).
    const initial = [testEuglena({ x: 150, y: 150, heading: Math.PI / 4, rollPhase: 0.9 })];
    const oneStep = updateEuglena(initial, frame({ dt: 0.16, width: 300, height: 300, activity: 0 }), view);
    const halfStep = updateEuglena(initial, frame({ dt: 0.08, width: 300, height: 300, activity: 0 }), view);
    const twoSteps = updateEuglena(halfStep, frame({ dt: 0.08, width: 300, height: 300, activity: 0 }), view);

    expect(twoSteps[0].x).toBeCloseTo(oneStep[0].x, 10);
    expect(twoSteps[0].y).toBeCloseTo(oneStep[0].y, 10);
    expect(oneStep[0].x).toBeGreaterThanOrEqual(0);
    expect(oneStep[0].x).toBeLessThan(300);
    expect(oneStep[0].y).toBeGreaterThanOrEqual(0);
    expect(oneStep[0].y).toBeLessThan(300);
  });

  it("abrupt activity onset after long idle uses current dt instead of elapsed frame time", () => {
    const view = aquariumParamsView({
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 0.8,
      euglenaSpeedActive: 1.6,
      aquariumActivityBoost: 1,
    });
    const initial = [testEuglena({ rollPhase: 0.2 })];
    const onset = updateEuglena(initial, frame({ t: 10_000, dt: 1 / 60, activity: 1, mode: "recording" }), view)[0];
    const shortClock = updateEuglena(initial, frame({ t: 1, dt: 1 / 60, activity: 1, mode: "recording" }), view)[0];
    const longDt = updateEuglena(initial, frame({ t: 10_000, dt: 0.5, activity: 1, mode: "recording" }), view)[0];

    expect(onset.rollPhase).toBeCloseTo(shortClock.rollPhase, 12);
    expect(unitDelta(onset.rollPhase, initial[0].rollPhase)).toBeLessThan(unitDelta(longDt.rollPhase, initial[0].rollPhase));
  });

  it("keeps euglena finite and clamped in-bounds over long runtime", () => {
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      euglenaCount: 1,
      euglenaSpeed: 1,
      euglenaSpeedActive: 1.2,
    };
    const initial = seedAquarium(frame({ width: 172, height: 36 }), params);
    const updated = updateAquarium(initial, frame({ dt: 100_000, width: 172, height: 36, activity: 1 }), params);
    const cell = updated.euglena[0];

    for (const value of [cell.x, cell.y, cell.heading, cell.rollPhase, cell.metabolyPhase, cell.flagellumPhase]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(cell.x).toBeGreaterThanOrEqual(0);
    expect(cell.x).toBeLessThanOrEqual(172); // clamped (no wrap teleport)
    expect(cell.y).toBeGreaterThanOrEqual(0);
    expect(cell.y).toBeLessThanOrEqual(36);
    expect(cell.rollPhase).toBeGreaterThanOrEqual(0);
    expect(cell.rollPhase).toBeLessThan(1);
    expect(cell.metabolyPhase).toBeGreaterThanOrEqual(0);
    expect(cell.metabolyPhase).toBeLessThan(1);
    expect(cell.flagellumPhase).toBeGreaterThanOrEqual(0);
    expect(cell.flagellumPhase).toBeLessThan(1);
  });

  it("euglenaPose keeps eyespot and flagellum at the anterior end for rotated cells", () => {
    const pose = euglenaPose(0.3, 0.6, {
      centerX: 20,
      centerY: 10,
      length: 8,
      baseWidth: 2,
      heading: Math.PI / 2,
      flagellumLength: 3,
      flagellumPhase: 0.1,
    });

    expect(pose.eyespot.y).toBeGreaterThan(pose.center.y);
    expect(pose.flagellumEnd.y).toBeGreaterThan(pose.anterior.y);
    // flagellum emerges from the anterior pole (on axis), eyespot is lateral
    expect(Math.hypot(pose.flagellumPoints[0].x - pose.anterior.x, pose.flagellumPoints[0].y - pose.anterior.y)).toBeLessThan(1e-9);
    expect(Math.abs(pose.anterior.x - pose.center.x)).toBeLessThan(1e-6);
  });

  it("drawAquariumBackground draws a muted euglena-only identity smoke at 172×36", () => {
    const { calls } = inspectEuglenaDraw(1);

    expect(calls.filter((call) => call === "save")).toHaveLength(1);
    expect(calls.filter((call) => call === "restore")).toHaveLength(1);
    expect(calls.filter((call) => call === "fill").length).toBeGreaterThanOrEqual(4);
    expect(calls.filter((call) => call === "stroke").length).toBeGreaterThanOrEqual(3);
    expect(calls.some((call) => call.startsWith("ellipse:"))).toBe(true);
    expect(calls.some((call) => call.startsWith("arc:0.") || call.startsWith("arc:1."))).toBe(true);
    expect(calls.some((call) => call.startsWith("moveTo:"))).toBe(true);
    expect(calls.some((call) => call.startsWith("lineTo:"))).toBe(true);
    expect(calls.some((call) => call.includes("hsla(92"))).toBe(true);
    expect(calls.some((call) => call.includes("hsla(8,"))).toBe(true);
    expect(calls.some((call) => call.includes("hsla(186"))).toBe(true);

    const reservoirIndex = calls.findIndex((call) => call.includes("hsla(186"));
    const eyespotIndex = calls.findIndex((call) => call.includes("hsla(8,"));
    expect(reservoirIndex).toBeGreaterThan(-1);
    expect(eyespotIndex).toBeGreaterThan(reservoirIndex);
  });

  it("drawAquariumBackground adds euglena reservoir glint only above the 7px body threshold", () => {
    const small = inspectEuglenaDraw(0.74).calls; // L < 7
    const large = inspectEuglenaDraw(0.8).calls;  // L >= 7

    expect(small.some((call) => call.includes("hsla(186"))).toBe(false);
    expect(large.some((call) => call.includes("hsla(186"))).toBe(true);
    expect(large.some((call) => call.startsWith("arc:0.") || call.startsWith("arc:1."))).toBe(true);
  });

  it("drawAquariumBackground scales euglena detail monotonically with body length", () => {
    const small = inspectEuglenaDraw(0.6).calls;  // L < 7: minimal
    const medium = inspectEuglenaDraw(0.8).calls; // L >= 7: chloroplasts + reservoir
    const large = inspectEuglenaDraw(1.03).calls;

    const ell = (c: readonly string[]) => c.filter((x) => x.startsWith("ellipse:")).length;
    const arcs = (c: readonly string[]) => c.filter((x) => x.startsWith("arc:")).length;

    expect(ell(small)).toBe(0);
    expect(ell(medium)).toBeGreaterThan(0);
    expect(ell(large)).toBeGreaterThanOrEqual(ell(medium));
    expect(small.some((x) => x.includes("hsla(186"))).toBe(false);
    expect(medium.some((x) => x.includes("hsla(186"))).toBe(true);
    expect(arcs(large)).toBeGreaterThanOrEqual(arcs(small));
  });
});
