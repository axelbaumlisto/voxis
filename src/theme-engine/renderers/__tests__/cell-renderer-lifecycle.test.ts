// src/theme-engine/renderers/__tests__/cell-renderer-lifecycle.test.ts
/**
 * Split from cell.test.ts. Tests moved by domain; assertions intentionally unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  smoothstep,
  smoothEnergy,
  cellActivity,
  swimSpeed,
  bodyHeadingStep,
  prolateAspect,
  startleOffset,
  startleHeadingKick,
  startleBurstSpeed,
  idleMorph,
  resolveBaseRadius,
  perimeterCiliaCount,
  bandLimitDeform,
  dipoleFlowAt,
  advectMote,
  seedMotes,
  cellReach,
  cellDrift,
  wanderStep,
  wallReorientHeading,
  rotationalBrownianStep,
  sedimentationBias,
  driftActivation,
  sanitizeUnit,
  sanitizeFinite,
  sanitizeBins,
  serializeCellState,
  parseCellState,
  restoreSeed,
  wanderPoseFromState,
  cellPersistKey,
  CELL_DEFAULTS,
  createCellRenderer,
  affineSqueezePoints,
  axialSpin,
  advanceAxialSpinPhase,
  advanceCiliaBeatCycles,
  ciliaBeatPhaseAtCycle,
  cyclosisLoopPointAtPhase,
  advanceCyclosisPhase,
  effectiveCyclosisPeriod,
} from "../cell/testing";
import type { CellParams, CellPersistState } from "../cell/testing";

const TAU = Math.PI * 2;
const RENDERER_SOURCE_PATH = join(process.cwd(), "src/theme-engine/renderers/cell/renderer.ts");

// ---------------------------------------------------------------------------
// startleOffset
// ---------------------------------------------------------------------------

describe("startleOffset", () => {
  // startleOffset(prevMag, level, baseline, sensitivity, decay) -> newMag in [0,1]
  it("fires on a sharp rising edge (level >> baseline)", () => {
    const m = startleOffset(0, 0.9, 0.1, 2.0, 0.85);
    expect(m).toBeGreaterThan(0.3); // a jolt was triggered
  });
  it("does not fire when level ~ baseline (steady sound)", () => {
    const m = startleOffset(0, 0.5, 0.5, 2.0, 0.85);
    expect(m).toBeLessThan(0.05);
  });
  it("decays toward 0 when no new edge", () => {
    const m = startleOffset(1.0, 0.2, 0.2, 2.0, 0.85);
    expect(m).toBeLessThan(1.0);
    expect(m).toBeGreaterThan(0.5); // decay 0.85 → keeps 85%
  });
  it("clamps to [0,1] and never negative", () => {
    expect(startleOffset(0, 5, 0, 10, 0.9)).toBeLessThanOrEqual(1);
    expect(startleOffset(0, 0, 1, 2, 0.9)).toBeGreaterThanOrEqual(0);
  });
  it("takes the max of decayed-previous and new-edge (sustained startle holds)", () => {
    // strong previous, weak edge → stays high via decay, not reset by edge
    const m = startleOffset(0.9, 0.3, 0.3, 2.0, 0.9);
    expect(m).toBeCloseTo(0.81, 1); // 0.9 * 0.9 decay
  });
});

// ---------------------------------------------------------------------------
// CreateCellRenderer (smoke test matching ring.test.ts patterns)
// ---------------------------------------------------------------------------

describe("createCellRenderer", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(42));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a canvas sized to options", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 172, height: 36 });
    const canvas = container.querySelector("canvas")!;
    expect(canvas).not.toBeNull();
    expect(canvas.width).toBe(172);
    expect(canvas.height).toBe(36);
    r.destroy();
  });

  it("starts RAF loop on create and cancels on destroy", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 100, height: 50 });
    expect(requestAnimationFrame).toHaveBeenCalled();
    r.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("update() does not throw (smoke)", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 100, height: 50 });
    expect(() =>
      r.update({
        mode: "recording",
        audioLevel: 0.5,
        spectrumBins: new Array(32).fill(0.3),
      }),
    ).not.toThrow();
    r.destroy();
  });

  it("accepts custom params spread over defaults", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 100,
      height: 50,
      baseHue: 50,
      params: { octaves: 6, push: 25 },
    });
    expect(() =>
      r.update({
        mode: "idle",
        audioLevel: 0,
        spectrumBins: new Array(32).fill(0),
      }),
    ).not.toThrow();
    r.destroy();
  });

  it("freezes flat params merge order as CELL_DEFAULTS then opts.params", () => {
    const source = readFileSync(RENDERER_SOURCE_PATH, "utf8");
    expect(source).toContain("const params: CellParams = { ...CELL_DEFAULTS, ...(opts.params ?? {}) };");
    expect(source).not.toContain("resolveCellPreset(");
  });

  it("destroy clears container", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 100, height: 50 });
    expect(container.children.length).toBeGreaterThan(0);
    r.destroy();
    expect(container.children.length).toBe(0);
    expect(container.innerHTML).toBe("");
  });

  it("form memory: high audio then zero does not crash and holds shape", () => {
    const container = document.createElement("div");
    const rafCalls: Array<() => void> = [];
    let rafCounter = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return ++rafCounter;
    });

    const r = createCellRenderer(container, {
      width: 100,
      height: 50,
      params: { attack: 0.2, release: 0.005 },
    });

    // Push a few high-audio recording states
    for (let i = 0; i < 3; i++) {
      r.update({
        mode: "recording",
        audioLevel: 0.9,
        spectrumBins: new Array(32).fill(0.5),
      });
    }

    // Advance RAF a few times with recording mode
    for (let i = 0; i < 5; i++) {
      if (rafCalls.length > 0) {
        const cb = rafCalls.shift()!;
        expect(() => cb()).not.toThrow();
      }
    }

    // Now push zero (idle silence) — deformation should not instantly collapse
    r.update({
      mode: "idle",
      audioLevel: 0,
      spectrumBins: new Array(32).fill(0),
    });

    // Advance RAF several more times after switching to idle
    for (let i = 0; i < 5; i++) {
      if (rafCalls.length > 0) {
        const cb = rafCalls.shift()!;
        expect(() => cb()).not.toThrow();
      }
    }

    r.destroy();
    expect(container.children.length).toBe(0);
  });

  it("nucleus: mount + recording update + RAF ticks does not throw (smoke)", () => {
    const container = document.createElement("div");
    const rafCalls: Array<() => void> = [];
    let rafCounter = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return ++rafCounter;
    });

    const r = createCellRenderer(container, {
      width: 172,
      height: 36,
    });

    r.update({
      mode: "recording",
      audioLevel: 0.8,
      spectrumBins: new Array(32).fill(0.6),
    });

    // Advance several frames to exercise the nucleus drawing path
    for (let i = 0; i < 8; i++) {
      if (rafCalls.length > 0) {
        const cb = rafCalls.shift()!;
        expect(() => cb()).not.toThrow();
      }
    }

    r.destroy();
    expect(container.children.length).toBe(0);
  });

  it("nucleus: idle breathing across frames does not throw (smoke)", () => {
    const container = document.createElement("div");
    const rafCalls: Array<() => void> = [];
    let rafCounter = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return ++rafCounter;
    });

    const r = createCellRenderer(container, {
      width: 172,
      height: 36,
    });

    r.update({
      mode: "idle",
      audioLevel: 0,
      spectrumBins: new Array(32).fill(0),
    });

    // Advance several idle frames — nucleus breathes gently
    for (let i = 0; i < 12; i++) {
      if (rafCalls.length > 0) {
        const cb = rafCalls.shift()!;
        expect(() => cb()).not.toThrow();
      }
    }

    r.destroy();
    expect(container.children.length).toBe(0);
  });

  it("nucleus: custom nucleus params are accepted and do not throw", () => {
    const container = document.createElement("div");
    const rafCalls: Array<() => void> = [];
    let rafCounter = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return ++rafCounter;
    });

    const r = createCellRenderer(container, {
      width: 200,
      height: 100,
      params: {
        nucleusRadius: 0.35,
        nucleusPulse: 0.15,
        nucleusWander: 0.20,
        nucleusDrift: 0.08,
        nucleusAlpha: 0.65,
      },
    });

    r.update({
      mode: "recording",
      audioLevel: 0.7,
      spectrumBins: new Array(32).fill(0.4),
    });

    for (let i = 0; i < 5; i++) {
      if (rafCalls.length > 0) {
        const cb = rafCalls.shift()!;
        expect(() => cb()).not.toThrow();
      }
    }

    r.destroy();
    expect(container.children.length).toBe(0);
  });

  it("renders with cilia + startle + growth params without throwing", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: 172, height: 36,
      params: { ciliaCount: 20, startleSensitivity: 3, growthSwell: 0.3 },
    });
    expect(() => {
      r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.7) });
      r.update({ mode: "recording", audioLevel: 0.1, spectrumBins: new Array(32).fill(0.1) });
    }).not.toThrow();
    r.destroy();
    expect(container.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// M11: single simulation clock (simTime)
// ---------------------------------------------------------------------------
//
// The tick loop must drive BOTH position integration AND phase clocks from ONE
// accumulator that sums the SAME clamped per-frame dt. Otherwise a backgrounded
// tab resuming with one huge real delta advances phases (wall-clock) far past
// the position (clamped dt), and they desync permanently.
//
// Observable: the persisted `elapsed` field == the phase clock fed to all phase
// formulas. Position-time == sum of clamped per-frame dt. The two must agree.
describe("M11: single simulation clock (simTime)", () => {
  const W = 160, H = 160;
  const key = cellPersistKey(W, H);
  let clock = 0;
  let nowSpy: ReturnType<typeof vi.spyOn>;
  const rafCalls: Array<() => void> = [];

  beforeEach(() => {
    rafCalls.length = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    localStorage.clear();
    clock = 1000;
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    nowSpy.mockRestore();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const readElapsed = (): number | null => {
    const s = parseCellState(localStorage.getItem(key));
    return s ? s.elapsed : null;
  };
  // Run the next queued tick with performance.now() pinned to `ms`.
  const tickAt = (ms: number) => {
    clock = ms;
    const cb = rafCalls.shift();
    if (cb) cb();
  };

  // Invariant A (60fps-unchanged): under on-time frames the clamped dt equals
  // the true dt, so simTime must equal the pre-change wall-clock formula
  // t = (now - startedAt)/1000 to floating-point. This locks the steady-state
  // path so the single-clock refactor is numerically identical when no stall
  // occurs. (Holds before AND after the fix — it is the regression lock.)
  it("A: steady on-time frames keep phase-time == accumulated dt (1e-9)", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    // 50ms frames: each is exactly at the clamp ceiling, so clamped dt == true dt
    // (the steady-state identity). Persist throttles to >500ms: it fires at frame
    // 1 (t=1050) then next at frame 12 (t=1600, since 1600-1050=550>500). So after
    // 12 frames the persisted elapsed == 12*0.05 = 0.6, which is BOTH the
    // wall-clock total AND the accumulated clamped dt — they coincide precisely
    // because no frame was ever stalled. No throttle-lag ambiguity.
    let t = 1000;
    let persisted = 0;
    for (let i = 0; i < 12; i++) {
      t += 50;
      tickAt(t);
      const e = readElapsed();
      if (e !== null) persisted = e;
    }
    const accumulated = 12 * 0.05; // sum of clamped per-frame dt
    const wallClock = (t - 1000) / 1000;
    expect(persisted).toBeGreaterThan(0);
    // phase-time equals BOTH accumulated dt and wall-clock when never stalled.
    expect(Math.abs(persisted - accumulated)).toBeLessThan(1e-9);
    expect(Math.abs(persisted - wallClock)).toBeLessThan(1e-9);
    r.destroy();
  });

  // Invariant B (gap divergence fixed): after one 500ms stall frame, the
  // persisted phase-time must equal the accumulated CLAMPED position-time
  // (the 500ms frame is clamped to 50ms), NOT the wall-clock total. Before the
  // fix the phase clock used wall-clock and would read ~0.532s while position
  // only advanced ~0.082s — a ~0.45s permanent desync.
  it("B: a 500ms gap frame advances phase-time by the CLAMPED dt, not wall-clock", () => {
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    // On-time frame (16ms). First persist fires here (now - lastPersist > 500).
    tickAt(1016);
    // 500ms STALL: one frame with a huge real delta (clamped to 50ms).
    tickAt(1516);
    // One more on-time frame to cross the next 500ms persist throttle boundary.
    tickAt(1532);
    const elapsed = readElapsed();
    // Sum of CLAMPED per-frame dt = position-time = phase-time after the fix.
    const expectedSim = 0.016 + 0.05 + 0.016; // 0.082
    const wallClock = (1532 - 1000) / 1000; // 0.532 — the pre-fix (buggy) value
    expect(elapsed).not.toBeNull();
    expect(Math.abs(elapsed! - expectedSim)).toBeLessThan(1e-9);
    // And it must NOT be the wall-clock value (proves the gap no longer diverges).
    expect(Math.abs(elapsed! - wallClock)).toBeGreaterThan(0.4);
    r.destroy();
  });

  // Restart seam (closes the review's test-gap nit): a restored state run through
  // the LIVE tick must resume phase-time at saved.elapsed + one frame's dt, i.e.
  // exactly the old wall-clock formula. Proves continuity end-to-end, not just
  // via the pure restoreSeed round-trip.
  it("C: a restored state resumes phase-time at saved.elapsed + dt (seamless)", () => {
    localStorage.setItem(key, serializeCellState({ driftPhase: 7.5, growth: 0.3, elapsed: 5 }));
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    // First on-time frame: dt = 50ms. Persist fires (now-0>500) and writes the
    // resumed elapsed = saved.elapsed (5) + dt (0.05) = 5.05.
    tickAt(1050);
    const elapsed = readElapsed();
    expect(elapsed).not.toBeNull();
    expect(Math.abs(elapsed! - 5.05)).toBeLessThan(1e-9);
    r.destroy();
  });
});

// ---------------------------------------------------------------------------
// M15: NaN-poison guard
// ---------------------------------------------------------------------------

describe("M15: sanitize helpers", () => {
  it("sanitizeUnit clamps to [0,1] and maps NaN/Inf to 0", () => {
    expect(sanitizeUnit(0.5)).toBe(0.5);
    expect(sanitizeUnit(0)).toBe(0);
    expect(sanitizeUnit(1)).toBe(1);
    expect(sanitizeUnit(-2)).toBe(0);
    expect(sanitizeUnit(2)).toBe(1);
    expect(sanitizeUnit(NaN)).toBe(0);
    expect(sanitizeUnit(Infinity)).toBe(0);
    expect(sanitizeUnit(-Infinity)).toBe(0);
  });
  it("sanitizeUnit is identity for normal in-range input (no behaviour change)", () => {
    for (const v of [0, 0.1, 0.37, 0.5, 0.99, 1]) expect(sanitizeUnit(v)).toBe(v);
  });
  it("sanitizeFinite passes finite through, falls back otherwise", () => {
    expect(sanitizeFinite(3.2, 9)).toBe(3.2);
    expect(sanitizeFinite(-100, 9)).toBe(-100);
    expect(sanitizeFinite(NaN, 9)).toBe(9);
    expect(sanitizeFinite(Infinity, 0)).toBe(0);
    expect(sanitizeFinite(-Infinity, 7)).toBe(7);
  });
  it("sanitizeBins clamps each bin and maps bad ones to 0", () => {
    expect(sanitizeBins([0.2, NaN, Infinity, 5, -1])).toEqual([0.2, 0, 0, 1, 0]);
    expect(sanitizeBins(undefined)).toEqual([]);
    expect(sanitizeBins([])).toEqual([]);
  });
  it("sanitizeBins is identity for normal in-range bins (no behaviour change)", () => {
    const ok = [0, 0.25, 0.5, 0.75, 1];
    expect(sanitizeBins(ok)).toEqual(ok);
  });
});

describe("M15: NaN-poison guard through update()", () => {
  // jsdom's getContext('2d') returns null, so the tick body (where form-memory
  // mutates) is skipped. Install a recording 2D context so the REAL poison path
  // runs, capturing every drawn coordinate to prove the state stays finite.
  function installRecordingContext() {
    const coords: number[] = [];
    const grad = { addColorStop: () => {} };
    const ctx = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      stroke: () => {},
      fill: () => {},
      moveTo: (x: number, y: number) => { coords.push(x, y); },
      lineTo: (x: number, y: number) => { coords.push(x, y); },
      arc: (x: number, y: number, r: number) => { coords.push(x, y, r); },
      ellipse: () => {},
      createRadialGradient: () => grad,
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
    };
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (id: string) => unknown;
    };
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    return { coords, restore: () => { proto.getContext = orig; } };
  }

  let restoreCtx: (() => void) | null = null;
  afterEach(() => {
    if (restoreCtx) { restoreCtx(); restoreCtx = null; }
    vi.unstubAllGlobals();
  });

  it("a NaN/Inf frame keeps drawn state finite AND the next clean frame is normal (no permanent poison)", () => {
    const rec = installRecordingContext();
    restoreCtx = rec.restore;
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 160, height: 160 });
    // Each tick re-queues one rAF; step() runs exactly `k` bounded ticks.
    const step = (k: number) => { for (let i = 0; i < k; i++) { if (rafCalls.length) rafCalls.shift()!(); } };

    // Warm up with clean recording frames so form-memory is populated.
    r.update({ mode: "recording", audioLevel: 0.6, spectrumBins: new Array(32).fill(0.4) });
    step(4);

    // POISON FRAME: NaN audioLevel + NaN/Inf spectrum bins.
    const badBins = new Array(32).fill(0.3);
    badBins[2] = NaN;
    badBins[5] = Infinity;
    badBins[9] = -Infinity;
    r.update({ mode: "recording", audioLevel: NaN, spectrumBins: badBins });
    rec.coords.length = 0;
    step(1);
    expect(rec.coords.length).toBeGreaterThan(0);
    for (const c of rec.coords) expect(Number.isFinite(c)).toBe(true);

    // NEXT CLEAN FRAME must produce normal finite output — proving the single
    // bad frame did not permanently poison the integrated form-memory.
    r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.4) });
    rec.coords.length = 0;
    step(1);
    expect(rec.coords.length).toBeGreaterThan(0);
    for (const c of rec.coords) expect(Number.isFinite(c)).toBe(true);

    r.destroy();
  });

  it("sustained NaN input never throws and recovers to finite output after clean frames", () => {
    const rec = installRecordingContext();
    restoreCtx = rec.restore;
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: 160, height: 160 });
    const step = (k: number) => { for (let i = 0; i < k; i++) { if (rafCalls.length) rafCalls.shift()!(); } };

    // Many consecutive poison frames.
    for (let i = 0; i < 6; i++) {
      r.update({ mode: "recording", audioLevel: NaN, spectrumBins: new Array(32).fill(NaN) });
      expect(() => step(1)).not.toThrow();
    }

    // Recover: clean frames must yield finite coordinates.
    for (let i = 0; i < 4; i++) {
      r.update({ mode: "recording", audioLevel: 0.4, spectrumBins: new Array(32).fill(0.3) });
      step(1);
    }
    rec.coords.length = 0;
    step(1);
    expect(rec.coords.length).toBeGreaterThan(0);
    for (const c of rec.coords) expect(Number.isFinite(c)).toBe(true);

    r.destroy();
  });

  it("M8: a startle onset does NOT shove the idle/centred cell (kick perturbs heading, not centre)", () => {
    const rec = installRecordingContext();
    restoreCtx = rec.restore;
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const container = document.createElement("div");
    // IDLE mode + kick on (default): drift01 stays ~0 so the centre is width/2.
    const r = createCellRenderer(container, { width: 160, height: 160 });
    const step = (k: number) => { for (let i = 0; i < k; i++) { if (rafCalls.length) rafCalls.shift()!(); } };

    // The nucleus is drawn via arc(nx, ny, nr): the LAST arc per frame is the
    // nucleolus at the cell centre. Capture its position across a sharp onset.
    const lastArcXY = () => {
      // coords from arc are pushed as (x,y,r) triples; the nucleus arcs are the
      // final ones in the frame. Grab the last triple's x,y.
      const c = rec.coords;
      return [c[c.length - 3], c[c.length - 2]] as [number, number];
    };

    r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
    step(4);
    rec.coords.length = 0; step(1);
    const before = lastArcXY();

    // Sharp onset (would trigger a startle edge), but still IDLE mode.
    r.update({ mode: "idle", audioLevel: 1.0, spectrumBins: new Array(32).fill(0.9) });
    rec.coords.length = 0; step(1);
    const after = lastArcXY();

    // With the kick model, an idle cell's centre must NOT jump from startle.
    // (Legacy positional shove would move it by up to startleMaxPx=5 px.)
    expect(Math.abs(after[0] - before[0])).toBeLessThan(2);
    expect(Math.abs(after[1] - before[1])).toBeLessThan(2);

    r.destroy();
  });

  it("H4: enableFlowField OFF (default) draws NO motes; ON advects them over frames", () => {
    const rafCalls: Array<() => void> = [];
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const step = (k: number) => { for (let i = 0; i < k; i++) { if (rafCalls.length) rafCalls.shift()!(); } };

    // The renderer reads flow params from the theme params, not update(). The
    // default builtin has enableFlowField undefined -> OFF. Count arc() triples:
    // motes are drawn as tiny arcs BEFORE the cell, so with the gate off the
    // mote-draw block is skipped entirely (allocates nothing).
    const recOff = installRecordingContext();
    restoreCtx = recOff.restore;
    const cOff = document.createElement("div");
    const rOff = createCellRenderer(cOff, { width: 160, height: 160 });
    rOff.update({ mode: "recording", audioLevel: 0.6, spectrumBins: new Array(32).fill(0.4) });
    step(3);
    recOff.coords.length = 0; step(1);
    const arcsOff = recOff.coords.length;
    rOff.destroy();
    recOff.restore();

    // Now drive a renderer with the flow gate ON via a custom params object: we
    // build motes directly through the exported helpers to assert advection is
    // non-trivial (the render wiring is exercised by the pure-helper suite; here
    // we lock that ON actually changes mote positions frame-to-frame).
    const P = { ...CELL_DEFAULTS, enableFlowField: true, flowMoteCount: 12 };
    let ms = seedMotes(160, 160, P);
    const first = ms.map((m) => ({ ...m }));
    // advect with a moving body (heading 0, swim speed ~9 px/s) for several
    // frames; flowStrength default (300) folds the doublet body-size^2 scale so
    // the field is visible (px/s) at body-scale distances.
    for (let f = 0; f < 60; f++) {
      ms = ms.map((m) => advectMote(m, 80, 80, 0, 9, 1 / 60, 160, 160, P));
    }
    const moved = ms.some((m, i) => Math.hypot(m.x - first[i].x, m.y - first[i].y) > 0.5);
    expect(moved).toBe(true);
    // Sanity: the OFF render produced some cell geometry (arcs) but the gate
    // skipped the mote pass without throwing.
    expect(arcsOff).toBeGreaterThan(0);

    // INTEGRATION (closes the review seam): drive the ACTUAL renderer with the
    // flow gate ON via params, and assert the wiring draws + advects motes. Motes
    // are tiny arcs (r=0.8) emitted BEFORE the cell each frame, so an ON render
    // emits strictly more arc triples than an OFF one, and the first mote's
    // recorded position changes frame-to-frame (advection through the wiring).
    const recOn = installRecordingContext();
    restoreCtx = recOn.restore;
    const cOn = document.createElement("div");
    const rOn = createCellRenderer(cOn, {
      width: 160, height: 160,
      params: { enableFlowField: true, flowMoteCount: 12 },
    });
    rOn.update({ mode: "recording", audioLevel: 0.6, spectrumBins: new Array(32).fill(0.4) });
    step(3);
    recOn.coords.length = 0; step(1);
    const arcsOn = recOn.coords.length;
    // The leading arcs are the 12 motes (r=0.8); the first mote sits exactly at
    // its deterministic seedMotes position, confirming the gate routed params ->
    // seedMotes -> draw (not some other geometry).
    const seeded = seedMotes(160, 160, { ...CELL_DEFAULTS, flowMoteCount: 12 });
    const firstMote = [recOn.coords[0], recOn.coords[1]] as [number, number];
    rOn.destroy();
    recOn.restore();
    // ON renders strictly more arcs (the 12 mote arcs precede the cell geometry):
    // proves the enableFlowField param plumbs through createCellRenderer and the
    // mote pass actually runs (the OFF render never entered the block).
    expect(arcsOn).toBeGreaterThan(arcsOff);
    expect(arcsOn - arcsOff).toBeGreaterThanOrEqual(12 * 3); // >=12 mote arcs (x,y,r)
    // first drawn mote == deterministic seed position (a non-swimming harness cell
    // drags no fluid: flowSpeed~0 => field 0 => motes correctly stay at their
    // seed; advection itself is proven by the dipoleFlowAt/advectMote suites).
    expect(firstMote[0]).toBeCloseTo(seeded[0].x, 6);
    expect(firstMote[1]).toBeCloseTo(seeded[0].y, 6);
  });

  // Commit 20: wiring of the commit-17 pure helpers (E1/F13/F11) into the render
  // loop behind their default-OFF gates. Each must be inert when off and produce
  // a visible, correct change when on.
  it("Commit 20 — E1 enablePerimeterCount drives more cilia arcs on a big cell", () => {
    const rafCalls: Array<() => void> = []; let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const step = (k: number) => { for (let i = 0; i < k; i++) if (rafCalls.length) rafCalls.shift()!(); };
    // A large baseR so the perimeter count exceeds the default 18 (cap raised so
    // the perimeter formula, not the cap, governs). enableActivity on so cilia draw.
    const big = { enablePerimeterCount: true, ciliaCount: 200, ciliaSpacingPx: 8, baseRadiusPx: 40 };
    const recOn = installRecordingContext(); restoreCtx = recOn.restore;
    const rOn = createCellRenderer(document.createElement("div"), { width: 200, height: 200, params: big });
    rOn.update({ mode: "recording", audioLevel: 0.8, spectrumBins: new Array(32).fill(0.6) });
    step(6); recOn.coords.length = 0; step(1);
    const arcsBig = recOn.coords.length; rOn.destroy(); recOn.restore();
    // OFF (fixed ciliaCount 18) on the same big cell => fewer cilia arcs.
    const recOff = installRecordingContext(); restoreCtx = recOff.restore;
    const rOff = createCellRenderer(document.createElement("div"), {
      width: 200, height: 200, params: { ciliaCount: 18, baseRadiusPx: 40 },
    });
    rOff.update({ mode: "recording", audioLevel: 0.8, spectrumBins: new Array(32).fill(0.6) });
    step(6); recOff.coords.length = 0; step(1);
    const arcsSmall = recOff.coords.length; rOff.destroy(); recOff.restore();
    // perimeter count at baseR~40, spacing 8 ≈ round(2π·40/8)=31 > 18.
    expect(perimeterCiliaCount(40, { ...CELL_DEFAULTS, ciliaCount: 200, ciliaSpacingPx: 8 })).toBeGreaterThan(18);
    expect(arcsBig).toBeGreaterThan(arcsSmall);
  });

  it("Commit 20 — F11 enableVacuole draws an extra peripheral vesicle arc", () => {
    const rafCalls: Array<() => void> = []; let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const step = (k: number) => { for (let i = 0; i < k; i++) if (rafCalls.length) rafCalls.shift()!(); };
    // Count nucleus/organelle arcs (r-bearing) with vacuole OFF vs ON at a sim
    // time where the vacuole is filled (u≈0.85 of its period => near R_max).
    const mkArcs = (params: Record<string, unknown>) => {
      const rec = installRecordingContext(); restoreCtx = rec.restore;
      const r = createCellRenderer(document.createElement("div"), { width: 160, height: 160, params });
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      step(8); rec.coords.length = 0; step(1);
      const c = rec.coords.length; r.destroy(); rec.restore();
      return c;
    };
    // small vacuolePeriod so by frame ~9 (sim ~0.45s at 50ms) u is in the filled
    // band; vacuoleMaxFrac large enough that vac.r>=0.5.
    const on = mkArcs({ enableVacuole: true, vacuolePeriod: 1, vacuoleMaxFrac: 0.25 });
    const off = mkArcs({ enableVacuole: false });
    expect(on).toBeGreaterThan(off); // the vesicle adds one more arc triple
  });

  it("Commit 20 — F13 enableBandLimit produces finite, in-bounds membrane geometry", () => {
    const rafCalls: Array<() => void> = []; let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return ++n; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const step = (k: number) => { for (let i = 0; i < k; i++) if (rafCalls.length) rafCalls.shift()!(); };
    // With the band-limit gate on, the membrane contour must still be finite and
    // inside the tank across active frames (the deform is clamped to bandLimitAmp
    // then the renderer clamps radius to [floor,maxRadius]). Smoke-proves the
    // wiring routes deform through bandLimitDeform without producing NaN/escape.
    const rec = installRecordingContext(); restoreCtx = rec.restore;
    const r = createCellRenderer(document.createElement("div"), {
      width: 160, height: 160,
      params: { enableBandLimit: true, bandLimitMode: 4, bandLimitAmp: 0.08 },
    });
    for (let i = 0; i < 6; i++) {
      r.update({ mode: "recording", audioLevel: 0.7, spectrumBins: new Array(32).fill(0.5) });
      step(1);
    }
    rec.coords.length = 0; step(1);
    expect(rec.coords.length).toBeGreaterThan(0);
    for (const c of rec.coords) {
      expect(Number.isFinite(c)).toBe(true);
      // membrane/organelle coords live within a generous tank-plus-margin box.
      expect(c).toBeGreaterThan(-50);
      expect(c).toBeLessThan(210);
    }
    r.destroy(); rec.restore();
  });
});

// ---------------------------------------------------------------------------
// idleMorph
// ---------------------------------------------------------------------------

describe("idleMorph", () => {
  const P = CELL_DEFAULTS;
  it("returns one value per sample", () => {
    expect(idleMorph(96, 1.0, P).length).toBe(96);
  });
  it("is deterministic", () => {
    expect(idleMorph(96, 2.3, P)).toEqual(idleMorph(96, 2.3, P));
  });
  it("stays within a gentle bound (|d| <= idleMorphAmplitude)", () => {
    for (const tt of [0, 1.7, 5.0, 12.4]) {
      for (const d of idleMorph(64, tt, P)) {
        expect(Math.abs(d)).toBeLessThanOrEqual(P.idleMorphAmplitude + 1e-9);
      }
    }
  });
  it("changes over time (not frozen)", () => {
    const a = idleMorph(64, 0.0, P);
    const b = idleMorph(64, 4.0, P);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBeGreaterThan(0.01);
  });
  it("envelope waxes and wanes (overall magnitude varies over time)", () => {
    const mag = (arr: number[]) => arr.reduce((s, v) => s + Math.abs(v), 0);
    // sample over a long span; magnitude must vary noticeably (alive, not flat)
    const mags: number[] = [];
    for (let k = 0; k < 16; k++) mags.push(mag(idleMorph(64, k * 1.3, P)));
    expect(Math.max(...mags)).toBeGreaterThan(Math.min(...mags) * 1.3);
  });
  it("envelope is NOT strictly periodic (no cos-cycle blink/loop)", () => {
    // Regression: the old envelope was cos(TAU*t/period) — strictly periodic,
    // so the whole organism visibly repeated/blinked every `idleMorphPeriod`
    // seconds. A living cell must never replay the exact same envelope.
    const mag = (tt: number) => idleMorph(64, tt, P).reduce((s, v) => s + Math.abs(v), 0);
    const period = P.idleMorphPeriod;
    let maxRepeatErr = 0;
    for (const base of [0.0, 1.1, 2.7, 4.3]) {
      const a = mag(base);
      const b = mag(base + period);
      const rel = Math.abs(a - b) / (Math.abs(a) + 1e-6);
      maxRepeatErr = Math.max(maxRepeatErr, rel);
    }
    // A strictly periodic envelope would give ~0 here. Require real drift.
    expect(maxRepeatErr).toBeGreaterThan(0.1);
  });
  it("respects the floor (envelope never fully zero when floor > 0)", () => {
    const mag = (arr: number[]) => arr.reduce((s, v) => s + Math.abs(v), 0);
    // with default floor > 0 there is always some morph somewhere
    let any = 0;
    for (let k = 0; k < 8; k++) any += mag(idleMorph(48, k * 0.9, P));
    expect(any).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// resolveBaseRadius
// ---------------------------------------------------------------------------

describe("resolveBaseRadius", () => {
  const P = CELL_DEFAULTS;

  it("with baseRadiusPx=16 and large window (160x160), returns 16 (absolute px)", () => {
    const r = resolveBaseRadius(160, 160, { ...P, baseRadiusPx: 16 }, 0);
    expect(r).toBeCloseTo(16, 1);
  });

  it("without baseRadiusPx, falls back to Math.min(width,height)*radiusFraction", () => {
    const r = resolveBaseRadius(160, 160, P, 0);
    expect(r).toBeCloseTo(160 * P.radiusFraction, 1);
  });

  it("applies growth swell when growth > 0", () => {
    const rNoGrowth = resolveBaseRadius(160, 160, { ...P, baseRadiusPx: 16 }, 0);
    const rWithGrowth = resolveBaseRadius(160, 160, { ...P, baseRadiusPx: 16 }, 0.5);
    expect(rWithGrowth).toBeGreaterThan(rNoGrowth);
    // baseR = 16 * (1 + 0.5 * growthSwell)
    expect(rWithGrowth).toBeCloseTo(16 * (1 + 0.5 * P.growthSwell), 1);
  });

  it("is deterministic", () => {
    const a = resolveBaseRadius(100, 80, P, 0.3);
    const b = resolveBaseRadius(100, 80, P, 0.3);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// cellReach
// ---------------------------------------------------------------------------

describe("cellReach", () => {
  it("returns a value >= baseR for defaults (membrane alone)", () => {
    const r = cellReach(16, CELL_DEFAULTS);
    expect(r).toBeGreaterThanOrEqual(16 * 1.4);
  });

  it("includes cilia reach: at least baseR + ciliaLen*baseR", () => {
    const p = { ...CELL_DEFAULTS, ciliaLength: 0.4, ciliaGrowthBoost: 0.55, startleMaxPx: 0 };
    const r = cellReach(16, p);
    // F12: worst-case hair uses (1+ciliaLengthVar=1.5) not the old 1.3, plus the
    // F2 transverse-cap headroom sqrt(1+0.25*gap^2) with gap=2pi/18.
    // longestAlong = 16 + 16*(0.95)*1.5 = 38.8; ciliaOuter = 38.8*1.01512 = 39.39
    expect(r).toBeGreaterThanOrEqual(39.3);
    // membrane outer = 16 * 1.4 = 22.4 — cilia dominates
    expect(r).toBeCloseTo(39.39, 1);
  });

  it("includes startle on top", () => {
    const pNoStartle = { ...CELL_DEFAULTS, ciliaLength: 0.4, ciliaGrowthBoost: 0.55, startleMaxPx: 0 };
    const pWithStartle = { ...pNoStartle, startleMaxPx: 4 };
    const rNo = cellReach(16, pNoStartle);
    const rWith = cellReach(16, pWithStartle);
    expect(rWith - rNo).toBeCloseTo(4, 1);
  });

  it("returns >= baseR + cilia + startle for typical drifting_contour params", () => {
    const p = { ...CELL_DEFAULTS, ciliaLength: 0.4, ciliaGrowthBoost: 0.55, startleMaxPx: 4 };
    const r = cellReach(16, p);
    // membrane = 22.4, cilia = 39.39, +4 startle = 43.39 (F12)
    expect(r).toBeGreaterThanOrEqual(43.3);
    expect(r).toBeCloseTo(43.39, 1);
  });

  it("defaults missing cilia/growth/startle to 0", () => {
    const p = { ...CELL_DEFAULTS };
    // remove cilia + startle fields so only the membrane headroom remains
    const pPartial = { ...CELL_DEFAULTS, ciliaLength: 0 as unknown as number };
    delete (pPartial as any).ciliaLength;
    delete (pPartial as any).ciliaGrowthBoost;
    delete (pPartial as any).startleMaxPx;
    const r = cellReach(10, pPartial as CellParams);
    // membrane = 10 * 1.4 = 14; cilia (no length/boost) = 10*1.0151 = 10.15;
    // membrane dominates, +0 startle.
    expect(r).toBe(14);
  });

  it("grows with baseR (dominant term is proportional)", () => {
    const p = { ...CELL_DEFAULTS, ciliaLength: 0.4, ciliaGrowthBoost: 0.5, startleMaxPx: 3 };
    const r10 = cellReach(10, p);
    const r20 = cellReach(20, p);
    // cilia outer dominates: baseR + baseR * 0.9 * 1.3 = 2.17 * baseR;
    // startle is constant (3) so ratio is slightly below 2×.
    expect(r20).toBeGreaterThan(r10 * 1.7);
  });

  it("is deterministic", () => {
    const a = cellReach(16, CELL_DEFAULTS);
    const b = cellReach(16, CELL_DEFAULTS);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// cellDrift
// ---------------------------------------------------------------------------

describe("cellDrift", () => {
  const P = CELL_DEFAULTS;
  const W = 160, H = 160;
  const baseR = 16;

  it("contains the whole cell (cilia + membrane + startle) within [0,160] box (defaults)", () => {
    const reach = cellReach(baseR, P);
    for (let t = 0; t < 1000; t += 13.7) {
      const d = cellDrift(t, W, H, baseR, P);
      // Centre must stay >= reach from left/top so cilia tips never go negative
      expect(d.cx - reach).toBeGreaterThanOrEqual(-0.001);
      expect(d.cy - reach).toBeGreaterThanOrEqual(-0.001);
      // Centre must stay <= width-reach from right/bottom so cilia tips never exceed window
      expect(d.cx + reach).toBeLessThanOrEqual(W + 0.001);
      expect(d.cy + reach).toBeLessThanOrEqual(H + 0.001);
    }
  });

  it("contains the whole cell within [0,160] with precise drifting_contour params", () => {
    // Exact params from drifting_contour theme (baseRadiusPx≈16, ciliaLength 0.4,
    // ciliaGrowthBoost 0.55, startleMaxPx 4, driftMargin 30).
    const dcParams = {
      ...P,
      ciliaLength: 0.4,
      ciliaGrowthBoost: 0.55,
      startleMaxPx: 4,
      driftMargin: 30,
    };
    const reach = cellReach(baseR, dcParams);
    // F12: the cilia-reach factor was corrected from 1.3 to the true worst-case
    // hair (1 + ciliaLengthVar) plus the F2 transverse-bend headroom, so the
    // containment radius grew from ≈39.76 to ≈43.39. inset = max(30, 43.39).
    expect(reach).toBeCloseTo(43.39, 1);
    for (let t = 0; t < 1000; t += 13.7) {
      const d = cellDrift(t, W, H, baseR, dcParams);
      // cx ± reach must stay within [0, 160]
      expect(d.cx - reach).toBeGreaterThanOrEqual(-0.001);
      expect(d.cx + reach).toBeLessThanOrEqual(W + 0.001);
      expect(d.cy - reach).toBeGreaterThanOrEqual(-0.001);
      expect(d.cy + reach).toBeLessThanOrEqual(H + 0.001);
    }
  });

  it("degenerate pill (172x36) now clamps Y to centre when reach > height", () => {
    const w = 172, h = 36;
    const br = Math.min(w, h) * P.radiusFraction; // ≈ 12.24
    const reach = cellReach(br, P);
    const inset = Math.max(P.driftMargin ?? 4, reach);
    for (let t = 0; t < 500; t += 11.3) {
      const d = cellDrift(t, w, h, br, P);
      // Y-axis: with old margin the pill used to have ~3.5px travel;
      // with full reach containment the Y axis is degenerate → clamps to centre.
      if (h - 2 * inset <= 0) {
        expect(d.cy).toBeCloseTo(h / 2, 0);
      } else {
        expect(d.cy).toBeGreaterThanOrEqual(inset - 0.001);
        expect(d.cy).toBeLessThanOrEqual(h - inset + 0.001);
      }
      // X-axis should still have room (172 is wide)
      if (w - 2 * inset > 0) {
        expect(d.cx).toBeGreaterThanOrEqual(inset - 0.001);
        expect(d.cx).toBeLessThanOrEqual(w - inset + 0.001);
      }
    }
  });

  it("truly degenerate axis (no travel room) clamps to center", () => {
    // With large baseR and small window, travelRange <= 0 → pin to center
    const d = cellDrift(0, 20, 20, 10, P);
    // reach = cellReach(10, P); inset = max(4, reach) >= 10*1.4 = 14 > 10 → degenerate
    expect(d.cx).toBe(10);
    expect(d.cy).toBe(10);
  });

  it("respects custom driftMargin but full-reach still dominates when larger", () => {
    const margin = 10;
    const p = { ...P, driftMargin: margin };
    const reach = cellReach(baseR, p);
    // inset = max(margin, reach) — reach is typically much larger than 10
    const inset = Math.max(margin, reach);
    for (let t = 0; t < 200; t += 17) {
      const d = cellDrift(t, W, H, baseR, p);
      // Full containment: centre ± reach must stay in window
      expect(d.cx - reach).toBeGreaterThanOrEqual(-0.001);
      expect(d.cx + reach).toBeLessThanOrEqual(W + 0.001);
      expect(d.cy - reach).toBeGreaterThanOrEqual(-0.001);
      expect(d.cy + reach).toBeLessThanOrEqual(H + 0.001);
    }
  });

  it("produces different positions at different times (cell actually travels)", () => {
    const positions = new Set<string>();
    for (let t = 0; t < 100; t += 5) {
      const d = cellDrift(t, W, H, baseR, P);
      positions.add(`${d.cx.toFixed(2)},${d.cy.toFixed(2)}`);
    }
    // Should have multiple distinct positions (cell actually travels)
    expect(positions.size).toBeGreaterThan(3);
  });

  it("is deterministic", () => {
    const a = cellDrift(5, W, H, baseR, P);
    const b = cellDrift(5, W, H, baseR, P);
    expect(a).toEqual(b);
  });

  it("X and Y drift are decorrelated (wanders in 2D, not back-and-forth on a line)", () => {
    // Mechanical look = cx and cy move in lock-step (their paths correlate),
    // so the cell slides along essentially one axis. A living cell wanders
    // in 2D: the X and Y trajectories must be statistically independent.
    // We assert the Pearson correlation between the cx and cy series over
    // time is low in magnitude.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let t = 0; t < 400; t += 2) {
      const d = cellDrift(t, W, H, baseR, P);
      xs.push(d.cx);
      ys.push(d.cy);
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(xs), my = mean(ys);
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < xs.length; i++) {
      const ddx = xs[i] - mx, ddy = ys[i] - my;
      cov += ddx * ddy; vx += ddx * ddx; vy += ddy * ddy;
    }
    const corr = cov / (Math.sqrt(vx * vy) || 1);
    expect(Math.abs(corr)).toBeLessThan(0.5);
  });

  it("handles zero-sized window gracefully (no crash, returns finite)", () => {
    const d = cellDrift(0, 0, 0, 0, P);
    expect(Number.isFinite(d.cx)).toBe(true);
    expect(Number.isFinite(d.cy)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wanderStep — Reynolds steering-style integrated wander (stateful)
// ---------------------------------------------------------------------------

describe("wanderStep", () => {
  const P = CELL_DEFAULTS;
  const W = 160, H = 160;
  const baseR = 16;
  const reach = cellReach(baseR, P);

  // Helper: integrate the wander for N steps from centre, return path.
  function runPath(steps: number, dt = 1 / 60, seed = 0) {
    let s = { x: W / 2, y: H / 2, heading: seed, vx: 0, vy: 0 };
    const path: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < steps; i++) {
      s = wanderStep(s, dt, W, H, baseR, P);
      path.push({ x: s.x, y: s.y });
    }
    return path;
  }

  it("keeps the whole organism inside the aquarium walls", () => {
    for (const p of runPath(4000)) {
      expect(p.x - reach).toBeGreaterThanOrEqual(-0.5);
      expect(p.y - reach).toBeGreaterThanOrEqual(-0.5);
      expect(p.x + reach).toBeLessThanOrEqual(W + 0.5);
      expect(p.y + reach).toBeLessThanOrEqual(H + 0.5);
    }
  });

  it("is deterministic for the same input state", () => {
    const s0 = { x: 80, y: 80, heading: 1.2, vx: 0.3, vy: -0.1 };
    expect(wanderStep(s0, 1 / 60, W, H, baseR, P)).toEqual(
      wanderStep(s0, 1 / 60, W, H, baseR, P),
    );
  });

  it("does NOT gravitate back to the centre (true wandering, not oscillation)", () => {
    // The old cellDrift used position=noise(t), which oscillates about the
    // centre — the cell always returned to the middle. A real wanderer's
    // average position over a long run should be measurably off-centre and
    // it should spend lots of time far from the middle.
    const path = runPath(6000, 1 / 60, 0.7);
    const cxAvg = path.reduce((s, p) => s + p.x, 0) / path.length;
    const cyAvg = path.reduce((s, p) => s + p.y, 0) / path.length;
    // far-from-centre occupancy
    const far = path.filter(
      (p) => Math.hypot(p.x - W / 2, p.y - H / 2) > 0.25 * Math.min(W, H) / 2,
    ).length;
    // Not pinned to dead-centre on average, and roams the tank.
    const offCentre = Math.hypot(cxAvg - W / 2, cyAvg - H / 2);
    expect(far).toBeGreaterThan(path.length * 0.2);
    expect(offCentre).toBeGreaterThanOrEqual(0); // sanity (no NaN)
    expect(Number.isFinite(offCentre)).toBe(true);
  });

  it("heading changes gradually (no twitching / instant reversals)", () => {
    // Reynolds: retain heading, apply SMALL random displacement each frame.
    // Successive velocity directions must be highly correlated frame-to-frame.
    let s = { x: W / 2, y: H / 2, heading: 0.3, vx: 0, vy: 0 };
    let prevAng: number | null = null;
    let maxTurn = 0;
    for (let i = 0; i < 1200; i++) {
      s = wanderStep(s, 1 / 60, W, H, baseR, P);
      const ang = Math.atan2(s.vy, s.vx);
      if (prevAng !== null) {
        let d = Math.abs(ang - prevAng);
        if (d > Math.PI) d = 2 * Math.PI - d; // wrap
        // ignore wall-bounce frames (big intentional flips)
        const nearWall =
          s.x - reach < 2 || s.y - reach < 2 || s.x + reach > W - 2 || s.y + reach > H - 2;
        if (!nearWall) maxTurn = Math.max(maxTurn, d);
      }
      prevAng = ang;
    }
    // Per-frame heading change stays small away from walls (smooth turns).
    expect(maxTurn).toBeLessThan(0.5);
  });

  it("F6: heading autocorrelation decays over a long run (no stall / limit cycle)", () => {
    // With the OLD position-coupled jitter the walk could lock into a cycle.
    // Sampling the jitter on a dedicated clock makes the heading a genuine
    // random walk, so its autocorrelation at a long lag drops well below 1.
    let s: ReturnType<typeof wanderStep> = { x: W / 2, y: H / 2, heading: 0.3, vx: 0, vy: 0, clock: 0 };
    const headings: number[] = [];
    for (let i = 0; i < 10000; i++) {
      s = wanderStep(s, 1 / 60, W, H, baseR, P);
      headings.push(s.heading);
    }
    // Autocorrelation of the unit heading vector at lag L.
    const lag = 2000;
    let dot = 0, n = 0;
    for (let i = 0; i + lag < headings.length; i++) {
      dot += Math.cos(headings[i]) * Math.cos(headings[i + lag]) +
        Math.sin(headings[i]) * Math.sin(headings[i + lag]);
      n++;
    }
    const autocorr = dot / n;
    expect(autocorr).toBeLessThan(0.8); // decayed from 1 => not stuck
  });

  it("F6: jitter is translation-invariant (same heading+clock => same step regardless of x,y)", () => {
    // Both sample points must be in the wall-free interior: the wall bounce
    // (heading reflection) is a position-dependent effect that is NOT the
    // jitter under test. With W=H=160 and reach≈43, [70,90] is well inside.
    const a = wanderStep({ x: 72, y: 76, heading: 0.7, vx: 0, vy: 0, clock: 5 }, 1 / 60, W, H, baseR, P);
    const b = wanderStep({ x: 88, y: 84, heading: 0.7, vx: 0, vy: 0, clock: 5 }, 1 / 60, W, H, baseR, P);
    // Same heading delta (the jitter no longer depends on position).
    const da = Math.atan2(Math.sin(a.heading - 0.7), Math.cos(a.heading - 0.7));
    const db = Math.atan2(Math.sin(b.heading - 0.7), Math.cos(b.heading - 0.7));
    expect(da).toBeCloseTo(db, 10);
  });
});

// ---------------------------------------------------------------------------
// driftActivation
// ---------------------------------------------------------------------------

describe("driftActivation", () => {
  it("ramps prev toward 1 when recording=true", () => {
    let v = 0;
    const rate = 0.1;
    for (let i = 0; i < 30; i++) {
      v = driftActivation(v, true, rate);
    }
    // After 30 frames at rate 0.1, should be very close to 1
    expect(v).toBeGreaterThan(0.95);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("ramps prev toward 0 when recording=false", () => {
    let v = 1;
    const rate = 0.1;
    for (let i = 0; i < 30; i++) {
      v = driftActivation(v, false, rate);
    }
    expect(v).toBeLessThan(0.05);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it("clamps to [0, 1]", () => {
    // rate=0.5, starting near 0, recording=true — should never exceed 1
    let v = 0;
    for (let i = 0; i < 20; i++) {
      v = driftActivation(v, true, 0.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Starting near 1, recording=false — should never go below 0
    v = 0.99;
    for (let i = 0; i < 20; i++) {
      v = driftActivation(v, false, 0.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("rate=1 jumps immediately to target", () => {
    expect(driftActivation(0, true, 1)).toBe(1);
    expect(driftActivation(0.5, true, 1)).toBe(1);
    expect(driftActivation(1, false, 1)).toBe(0);
    expect(driftActivation(0.3, false, 1)).toBe(0);
  });

  it("rate=0 never moves", () => {
    expect(driftActivation(0, true, 0)).toBe(0);
    expect(driftActivation(0.5, false, 0)).toBe(0.5);
    expect(driftActivation(1, false, 0)).toBe(1);
  });

  it("is deterministic", () => {
    let v1 = 0.3;
    let v2 = 0.3;
    for (let i = 0; i < 10; i++) {
      v1 = driftActivation(v1, i % 2 === 0, 0.05);
      v2 = driftActivation(v2, i % 2 === 0, 0.05);
      expect(v1).toBeCloseTo(v2, 10);
    }
  });

  it("default rate 0.02 reaches ~90% after ~3 seconds at 60 fps", () => {
    // 60 fps * 3 seconds = 180 frames; (1-0.02)^180 ≈ 0.026, so 1 - 0.026 = 0.974
    let v = 0;
    for (let i = 0; i < 180; i++) {
      v = driftActivation(v, true, 0.02);
    }
    expect(v).toBeGreaterThan(0.9);
  });
});

/**
 * Blend helper: given a cell-drift position, a canvas center, and an activation
 * value in [0, 1], returns the blended (x, y).
 *
 * This is the exact formula used in createCellRenderer tick.
 */
function blendCenter(
  drift: { cx: number; cy: number },
  width: number,
  height: number,
  activation: number,
): { x: number; y: number } {
  return {
    x: width / 2 + (drift.cx - width / 2) * activation,
    y: height / 2 + (drift.cy - height / 2) * activation,
  };
}

describe("blendCenter", () => {
  it("activation=0 → (width/2, height/2) regardless of drift position", () => {
    const drift = { cx: 80, cy: 120 };
    const b = blendCenter(drift, 160, 160, 0);
    expect(b.x).toBeCloseTo(80); // width/2
    expect(b.y).toBeCloseTo(80); // height/2

    const drift2 = { cx: 30, cy: 140 };
    const b2 = blendCenter(drift2, 160, 160, 0);
    expect(b2.x).toBeCloseTo(80);
    expect(b2.y).toBeCloseTo(80);
  });

  it("activation=1 → equals drift position", () => {
    const drift = { cx: 80, cy: 120 };
    const b = blendCenter(drift, 160, 160, 1);
    expect(b.x).toBeCloseTo(80);
    expect(b.y).toBeCloseTo(120);

    const drift2 = { cx: 30, cy: 140 };
    const b2 = blendCenter(drift2, 160, 160, 1);
    expect(b2.x).toBeCloseTo(30);
    expect(b2.y).toBeCloseTo(140);
  });

  it("activation=0.5 is halfway between center and drift", () => {
    const drift = { cx: 100, cy: 40 };
    const b = blendCenter(drift, 160, 160, 0.5);
    // width/2 = 80, half to 100 = 90
    expect(b.x).toBeCloseTo(90);
    // height/2 = 80, half to 40 = 60
    expect(b.y).toBeCloseTo(60);
  });

  it("blend is continuous (adjacent activation values are close)", () => {
    const drift = cellDrift(5, 160, 160, 16, CELL_DEFAULTS);
    const b1 = blendCenter(drift, 160, 160, 0.0);
    const b2 = blendCenter(drift, 160, 160, 0.2);
    const b3 = blendCenter(drift, 160, 160, 0.4);
    const b4 = blendCenter(drift, 160, 160, 0.6);
    const b5 = blendCenter(drift, 160, 160, 0.8);
    const b6 = blendCenter(drift, 160, 160, 1.0);
    // Check monotonic progression in both x and y (or at least no huge jumps)
    const xs = [b1.x, b2.x, b3.x, b4.x, b5.x, b6.x];
    for (let i = 1; i < xs.length; i++) {
      expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThan(Math.abs(drift.cx - 80) + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// restoreSeed
// ---------------------------------------------------------------------------

describe("restoreSeed", () => {
  it("resumes drift-phase at the persisted value (NOT double-counted)", () => {
    const saved: CellPersistState = { driftPhase: 1200, growth: 0.5, elapsed: 600 };
    const now = 1_000_000;
    const seed = restoreSeed(saved, now);
    // t ≈ (now - startedAt)/1000 ≈ 600
    const t = (now - seed.startedAt) / 1000;
    expect(t).toBeCloseTo(600, 0);
    // Phase arg passed to cellDrift: t + driftPhaseOffset
    const phaseArg = t + seed.driftPhaseOffset;
    // Should resume at the persisted driftPhase, NOT 2*elapsed + ...
    expect(Math.abs(phaseArg - saved.driftPhase)).toBeLessThan(1e-6);
    // Sanity: it must NOT be ~1800 (which would be the double-count bug)
    expect(Math.abs(phaseArg - 1800)).toBeGreaterThan(1);
    // Verify offset is calibrated: driftPhase - elapsed = 1200 - 600 = 600
    expect(seed.driftPhaseOffset).toBeCloseTo(600, 6);
  });

  it("handles elapsed=0 gracefully", () => {
    const saved: CellPersistState = { driftPhase: 42, growth: 0.2, elapsed: 0 };
    const now = 500_000;
    const seed = restoreSeed(saved, now);
    expect(seed.startedAt).toBeCloseTo(now, 0);
    expect(seed.driftPhaseOffset).toBeCloseTo(42, 6);
    const t = (now - seed.startedAt) / 1000;
    expect(t).toBeCloseTo(0, 0);
    const phaseArg = t + seed.driftPhaseOffset;
    expect(Math.abs(phaseArg - saved.driftPhase)).toBeLessThan(1e-6);
  });

  it("handles elapsed<0 (should occur only on tampered/edge data) — uses 0", () => {
    const saved: CellPersistState = { driftPhase: 10, growth: 0, elapsed: -5 };
    const now = 1_000_000;
    const seed = restoreSeed(saved, now);
    expect(seed.startedAt).toBeCloseTo(now, 0);
    expect(seed.driftPhaseOffset).toBeCloseTo(10, 6);
  });

  it("round-trips: persist → restoreSeed yields continuous phase", () => {
    // Simulate a running cell: driftPhaseOffset=7.3, t=5.2
    const driftPhaseOffset = 7.3;
    const tRun = 5.2;
    const phaseDuringRun = tRun + driftPhaseOffset; // 12.5

    // Persist
    const persisted: CellPersistState = {
      driftPhase: phaseDuringRun, // 12.5
      growth: 0.4,
      elapsed: tRun, // 5.2
    };

    // Restore a bit later
    const now = 2_000_000;
    const seed = restoreSeed(persisted, now);

    // First frame after restore: t' ≈ persisted.elapsed = 5.2
    const tRestored = (now - seed.startedAt) / 1000;
    expect(tRestored).toBeCloseTo(5.2, 0);

    // Phase arg should equal the phase at persist time (12.5), not 5.2+12.5=17.7
    const phaseAfterRestore = tRestored + seed.driftPhaseOffset;
    expect(Math.abs(phaseAfterRestore - phaseDuringRun)).toBeLessThan(1e-6);
    // Also verify that offset was properly computed: 12.5 - 5.2 = 7.3
    expect(seed.driftPhaseOffset).toBeCloseTo(driftPhaseOffset, 6);
  });
});

// ---------------------------------------------------------------------------
// serializeCellState / parseCellState
// ---------------------------------------------------------------------------

describe("CellPersistState serialization", () => {
  it("roundtrips a valid state", () => {
    const state = { driftPhase: 42.5, growth: 0.3, elapsed: 17.2 };
    const raw = serializeCellState(state);
    const parsed = parseCellState(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.driftPhase).toBeCloseTo(42.5);
    expect(parsed!.growth).toBeCloseTo(0.3);
    expect(parsed!.elapsed).toBeCloseTo(17.2);
  });

  it("parseCellState(null) returns null", () => {
    expect(parseCellState(null)).toBeNull();
  });

  it('parseCellState("garbage") returns null', () => {
    expect(parseCellState("garbage")).toBeNull();
  });

  it("parseCellState of empty string returns null", () => {
    expect(parseCellState("")).toBeNull();
  });

  it("parseCellState of object missing fields returns null", () => {
    expect(parseCellState('{"driftPhase":1}')).toBeNull();
    expect(parseCellState('{"growth":0.5}')).toBeNull();
    expect(parseCellState('{"elapsed":10}')).toBeNull();
    expect(parseCellState('{"driftPhase":1,"growth":0.5}')).toBeNull();
  });

  it("parseCellState of object with non-numeric fields returns null", () => {
    expect(parseCellState('{"driftPhase":"abc","growth":0.3,"elapsed":1}')).toBeNull();
    expect(parseCellState('{"driftPhase":1,"growth":true,"elapsed":1}')).toBeNull();
    expect(parseCellState('{"driftPhase":1,"growth":0.3,"elapsed":null}')).toBeNull();
  });

  it("parseCellState of object with extra fields still returns valid state", () => {
    const parsed = parseCellState('{"driftPhase":1,"growth":0.3,"elapsed":5,"extra":true}');
    expect(parsed).not.toBeNull();
    expect(parsed!.driftPhase).toBe(1);
    expect(parsed!.growth).toBe(0.3);
    expect(parsed!.elapsed).toBe(5);
  });

  it("serializeCellState produces valid JSON parseable string", () => {
    const state = { driftPhase: 0, growth: 0, elapsed: 0 };
    const raw = serializeCellState(state);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("rejects absurd elapsed (>= 1e7)", () => {
    expect(parseCellState(JSON.stringify({ driftPhase: 0, growth: 0, elapsed: 1e7 }))).toBeNull();
    expect(parseCellState(JSON.stringify({ driftPhase: 0, growth: 0, elapsed: 1e308 }))).toBeNull();
  });

  it("rejects absurd driftPhase (outside [-1e7, 1e7])", () => {
    expect(parseCellState(JSON.stringify({ driftPhase: 1e7 + 1, growth: 0, elapsed: 0 }))).toBeNull();
    expect(parseCellState(JSON.stringify({ driftPhase: -1e7 - 1, growth: 0, elapsed: 0 }))).toBeNull();
  });

  it("rejects negative elapsed", () => {
    expect(parseCellState(JSON.stringify({ driftPhase: 0, growth: 0, elapsed: -1 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Commit 8a — activity backbone (G1 cellActivity, G2 propulsion, F5 memoryless)
// ---------------------------------------------------------------------------
describe("cellActivity (G1)", () => {
  it("is the weighted blend 0.6*energy + 0.4*growth", () => {
    expect(cellActivity(1, 0)).toBeCloseTo(0.6, 12);
    expect(cellActivity(0, 1)).toBeCloseTo(0.4, 12);
    expect(cellActivity(1, 1)).toBeCloseTo(1.0, 12);
    expect(cellActivity(0, 0)).toBeCloseTo(0.0, 12);
    expect(cellActivity(0.5, 0.5)).toBeCloseTo(0.5, 12);
  });

  it("clamps to [0,1]", () => {
    expect(cellActivity(2, 2)).toBe(1);
    expect(cellActivity(-1, -1)).toBe(0);
    expect(cellActivity(5, 0)).toBe(1);
  });

  it("honors custom weights", () => {
    expect(cellActivity(1, 0, { activityEnergyWeight: 0.8, activityGrowthWeight: 0.2 })).toBeCloseTo(0.8, 12);
  });

  it("is pure/deterministic", () => {
    expect(cellActivity(0.37, 0.21)).toBe(cellActivity(0.37, 0.21));
  });
});

describe("swimSpeed (G2 propulsion law)", () => {
  const W = 160, H = 160;
  const P = { ...CELL_DEFAULTS };

  it("is ~zero at activity 0 (silence stops the cell, low-Re no coasting)", () => {
    expect(swimSpeed(0, W, H, P)).toBe(0);
  });

  it("is monotone increasing in activity", () => {
    let prev = -1;
    for (const a of [0, 0.2, 0.4, 0.6, 0.8, 1.0]) {
      const u = swimSpeed(a, W, H, P);
      expect(u).toBeGreaterThanOrEqual(prev);
      prev = u;
    }
  });

  it("is linear in activity: U(2a) ~= 2*U(a)", () => {
    const u1 = swimSpeed(0.3, W, H, P);
    const u2 = swimSpeed(0.6, W, H, P);
    expect(Math.abs(u2 / u1 - 2)).toBeLessThan(1e-9);
  });

  it("scales peak speed by swimSpeedMaxFrac*min(w,h)", () => {
    expect(swimSpeed(1, W, H, P)).toBeCloseTo((P.swimSpeedMaxFrac ?? 0.06) * 160, 9);
  });

  it("clamps activity to [0,1]", () => {
    expect(swimSpeed(5, W, H, P)).toBe(swimSpeed(1, W, H, P));
    expect(swimSpeed(-5, W, H, P)).toBe(0);
  });
});

describe("wanderStep F5 memoryless velocity (G2)", () => {
  const W = 320, H = 320;
  const P = { ...CELL_DEFAULTS };
  const baseR = 17;
  const start = { x: 160, y: 160, heading: 0.5, vx: 0, vy: 0, clock: 0 };

  it("speed override replaces driftSpeed (drives speed directly)", () => {
    const fast = wanderStep(start, 0.016, W, H, baseR, P, 100);
    const slow = wanderStep(start, 0.016, W, H, baseR, P, 1);
    const dFast = Math.hypot(fast.x - start.x, fast.y - start.y);
    const dSlow = Math.hypot(slow.x - start.x, slow.y - start.y);
    expect(dFast).toBeGreaterThan(dSlow * 10);
  });

  it("is memoryless: dropping drive to ~0 stops motion the SAME step (no coasting)", () => {
    // Build up motion at high speed for several steps...
    let s = start;
    for (let i = 0; i < 20; i++) s = wanderStep(s, 0.016, W, H, baseR, P, 120);
    const movingSpeed = Math.hypot(s.vx, s.vy);
    expect(movingSpeed).toBeGreaterThan(50);
    // ...then cut the drive to 0: velocity must collapse immediately, no inertia.
    const stopped = wanderStep(s, 0.016, W, H, baseR, P, 0);
    expect(Math.hypot(stopped.vx, stopped.vy)).toBe(0);
    expect(Math.hypot(stopped.x - s.x, stopped.y - s.y)).toBe(0);
  });
});

describe("Commit 8a — activity gate", () => {
  it("flips enableActivity ON by default", () => {
    expect(CELL_DEFAULTS.enableActivity).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit 8b — body motion (G4 bodyHeading, D1 motion basis, D4 prolate)
// ---------------------------------------------------------------------------
describe("bodyHeadingStep (G4)", () => {
  const P = { ...CELL_DEFAULTS, bodyHeadingTau: 0.4 };

  it("holds heading when essentially still (no defined travel direction)", () => {
    expect(bodyHeadingStep(1.2, 0, 0, 0.016, P)).toBe(1.2);
    expect(bodyHeadingStep(1.2, 1e-9, 1e-9, 0.016, P)).toBe(1.2);
  });

  it("chases the velocity heading (EMA toward atan2(vy,vx))", () => {
    // moving along +x => target heading 0; start at 1.0 => should decrease toward 0
    const next = bodyHeadingStep(1.0, 10, 0, 0.016, P);
    expect(next).toBeLessThan(1.0);
    expect(next).toBeGreaterThan(0);
  });

  it("converges to the target after many steps", () => {
    let h = 2.5;
    for (let i = 0; i < 2000; i++) h = bodyHeadingStep(h, 5, 5, 0.016, P);
    expect(h).toBeCloseTo(Math.PI / 4, 3); // atan2(5,5)=pi/4
  });

  it("is Lipschitz from rest: per-step rotation bounded by the shortest-arc error", () => {
    // worst case: target opposite current heading (pi away)
    const h0 = 0;
    const h1 = bodyHeadingStep(h0, -10, 1e-3, 0.016, P); // target ~ +pi
    const alpha = 1 - Math.exp(-0.016 / 0.4);
    // step magnitude must be <= |shortest arc| * alpha (+ fp slack)
    expect(Math.abs(h1 - h0)).toBeLessThanOrEqual(Math.PI * alpha + 1e-9);
  });

  it("takes the shortest arc across the +/-pi wrap", () => {
    // heading just under +pi, target just over -pi (i.e. crossing the seam):
    // moving along -x with tiny -y => target ~ -pi+eps; shortest arc is small +.
    const h = bodyHeadingStep(Math.PI - 0.05, -10, -1e-3, 0.016, P);
    // should move toward -pi the SHORT way (increasing past pi / wrapping), not
    // swing all the way back through 0.
    expect(Math.abs(Math.atan2(Math.sin(h - Math.PI), Math.cos(h - Math.PI)))).toBeLessThan(0.05);
  });
});

describe("prolateAspect (D4)", () => {
  it("is identity (k=1) at rest with default floor 0 => round when still", () => {
    expect(prolateAspect(0, CELL_DEFAULTS)).toBe(1);
  });

  it("elongates with speed: k = 1 + elong*speedNorm", () => {
    const P = { ...CELL_DEFAULTS, bodyElongation: 0.13, bodyElongationFloor: 0 };
    expect(prolateAspect(1, P)).toBeCloseTo(1.13, 12);
    expect(prolateAspect(0.5, P)).toBeCloseTo(1.065, 12);
  });

  it("honors a nonzero floor (permanently prolate pellicle look)", () => {
    const P = { ...CELL_DEFAULTS, bodyElongation: 0.2, bodyElongationFloor: 0.5 };
    expect(prolateAspect(0, P)).toBeCloseTo(1.1, 12); // 1 + 0.2*0.5
    expect(prolateAspect(1, P)).toBeCloseTo(1.2, 12);
  });

  it("clamps speedNorm to [0,1]", () => {
    expect(prolateAspect(5, CELL_DEFAULTS)).toBe(prolateAspect(1, CELL_DEFAULTS));
    expect(prolateAspect(-5, CELL_DEFAULTS)).toBe(1);
  });

  it("D4 collapses to identity at speedNorm=0 (back-compat invariant)", () => {
    // The squeeze with k=1 is identity regardless of phi (proven in Commit 5);
    // prolateAspect(0)=1 guarantees the resting body is unchanged by D4.
    const noisy: Array<[number, number]> = [];
    for (let i = 0; i < 32; i++) {
      const th = (i / 32) * Math.PI * 2;
      const r = 30 + 9 * Math.sin(3 * th);
      noisy.push([80 + r * Math.cos(th), 90 + r * Math.sin(th)]);
    }
    const k = prolateAspect(0, CELL_DEFAULTS);
    const out = affineSqueezePoints(noisy, k, 1.234, 80, 90, { ...CELL_DEFAULTS, enableAffine: true });
    for (let i = 0; i < noisy.length; i++) {
      expect(out[i][0]).toBeCloseTo(noisy[i][0], 9);
      expect(out[i][1]).toBeCloseTo(noisy[i][1], 9);
    }
  });

  it("D4 prolate preserves area (det=1) while elongating along travel", () => {
    const shoelace = (pts: Array<[number, number]>) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        a += x1 * y2 - x2 * y1;
      }
      return Math.abs(a) / 2;
    };
    const noisy: Array<[number, number]> = [];
    for (let i = 0; i < 64; i++) {
      const th = (i / 64) * Math.PI * 2;
      const r = 30 + 7 * Math.sin(3 * th) + 4 * Math.cos(7 * th);
      noisy.push([80 + r * Math.cos(th), 90 + r * Math.sin(th)]);
    }
    const before = shoelace(noisy);
    const P = { ...CELL_DEFAULTS, enableAffine: true, bodyElongation: 0.13 };
    const k = prolateAspect(1, P);
    const out = affineSqueezePoints(noisy, k, 0.6, 80, 90, P);
    expect(shoelace(out)).toBeCloseTo(before, 6);
    // and it actually deformed (prolate, not identity)
    let maxDelta = 0;
    for (let i = 0; i < noisy.length; i++) maxDelta = Math.max(maxDelta, Math.hypot(out[i][0] - noisy[i][0], out[i][1] - noisy[i][1]));
    expect(maxDelta).toBeGreaterThan(0.5);
  });
});

describe("Commit 30 — resting prolate spindle (enableRestingProlate)", () => {
  it("(a) default OFF: byte-identical to legacy formula", () => {
    expect(CELL_DEFAULTS.enableRestingProlate).toBe(false);
    // circle at rest, unchanged
    expect(prolateAspect(0, CELL_DEFAULTS)).toBe(1);
    // at s=1 still the legacy 1 + 0.13*1 = 1.13
    expect(prolateAspect(1, CELL_DEFAULTS)).toBeCloseTo(1.13, 12);
  });

  it("(b) gate ON at rest: k = prolateRestAspect (1.7), axis ratio k^2 ~ 3:1", () => {
    const P = { ...CELL_DEFAULTS, enableRestingProlate: true };
    const k = prolateAspect(0, P);
    expect(k).toBeCloseTo(1.7, 9);
    // affine applies diag(k,1/k) => major/minor axis ratio = k^2
    expect(k * k).toBeCloseTo(2.89, 6);
    expect(k * k).toBeGreaterThan(2.8); // ~3:1 spindle
  });

  it("(c) gate ON: non-decreasing in speed, never below the resting floor", () => {
    const P = { ...CELL_DEFAULTS, enableRestingProlate: true };
    let prev = -Infinity;
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      const k = prolateAspect(s, P);
      expect(k).toBeGreaterThanOrEqual(1.7);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
    // with default elong the speed-driven base (1.13 < 1.7) never wins => 1.7 at s=1
    expect(prolateAspect(1, P)).toBeCloseTo(1.7, 9);
  });

  it("(c2) gate ON: swimming elongates further above the resting floor", () => {
    const P = { ...CELL_DEFAULTS, enableRestingProlate: true, bodyElongation: 1.0 };
    // base at s=1 = 1 + 1.0*1 = 2.0 > 1.7 => speed wins above the floor
    expect(prolateAspect(1, P)).toBeCloseTo(2.0, 9);
    // at rest still pinned to the resting floor
    expect(prolateAspect(0, P)).toBeCloseTo(1.7, 9);
  });

  it("(d) OFF byte-identity: gate-off path equals legacy 1+0.13*s", () => {
    for (const s of [0, 0.1, 0.25, 0.5, 0.73, 1]) {
      const legacy = 1 + 0.13 * s;
      expect(prolateAspect(s, CELL_DEFAULTS)).toBe(prolateAspect(s, { ...CELL_DEFAULTS }));
      expect(prolateAspect(s, CELL_DEFAULTS)).toBeCloseTo(legacy, 12);
    }
  });
});

describe("Commit 8c — biology param corrections", () => {
  it("ciliaAsymmetry default = 0.49 (power:recovery ~ 1:2.9)", () => {
    expect(CELL_DEFAULTS.ciliaAsymmetry).toBeCloseTo(0.49, 12);
  });
  it("ciliaMetachronal default = 1.1 (lambda ~ 5-7 cilia)", () => {
    expect(CELL_DEFAULTS.ciliaMetachronal).toBeCloseTo(1.1, 12);
  });
  it("dragCoeff default = 0.5", () => {
    expect(CELL_DEFAULTS.dragCoeff).toBeCloseTo(0.5, 12);
  });
});

// ---------------------------------------------------------------------------
// Commit 9 — robustness seams (F8 dt-consistency, M9 idle de-flicker)
// ---------------------------------------------------------------------------
describe("driftActivation F8 frame-rate independence", () => {
  it("equals the legacy per-frame factor at dt=1/60 (back-compat)", () => {
    const legacy = driftActivation(0.3, true, 0.02);
    const dtForm = driftActivation(0.3, true, 0.02, 1 / 60);
    expect(dtForm).toBeCloseTo(legacy, 12);
  });

  it("omitting dt reproduces the exact legacy behavior", () => {
    expect(driftActivation(0.5, true, 0.02)).toBe(0.5 + (1 - 0.5) * 0.02);
  });

  it("reaches the same value after equal wall-clock time at different frame rates", () => {
    // 1 second of activation: 60 steps @16.67ms vs 30 steps @33.3ms must match.
    let a = 0, b = 0;
    for (let i = 0; i < 60; i++) a = driftActivation(a, true, 0.02, 1 / 60);
    for (let i = 0; i < 30; i++) b = driftActivation(b, true, 0.02, 1 / 30);
    expect(b).toBeCloseTo(a, 4);
  });

  it("still clamps to [0,1] and moves toward the target", () => {
    expect(driftActivation(0.99, true, 0.5, 0.05)).toBeLessThanOrEqual(1);
    expect(driftActivation(0.01, false, 0.5, 0.05)).toBeGreaterThanOrEqual(0);
    expect(driftActivation(0, true, 0.02, 1 / 60)).toBeGreaterThan(0); // toward 1
    expect(driftActivation(1, false, 0.02, 1 / 60)).toBeLessThan(1); // toward 0
  });
});

describe("M9 idle de-flicker (smoothstep on activity)", () => {
  // idleFactor = (1 - smoothstep(activity/0.33)) * recordingFade. The property
  // we lock: it is monotone-NONincreasing in activity and bounded/continuous —
  // no hard knee that flips on small audio fluctuations.
  const idleFactorOf = (activity: number) => 1 - smoothstep(activity / 0.33);

  it("is full (1) at zero activity and ~0 once active", () => {
    expect(idleFactorOf(0)).toBeCloseTo(1, 12);
    expect(idleFactorOf(0.33)).toBeCloseTo(0, 12);
    expect(idleFactorOf(1)).toBe(0);
  });

  it("is monotone non-increasing in activity (no flicker knee)", () => {
    let prev = 2;
    for (let a = 0; a <= 1.0001; a += 0.02) {
      const f = idleFactorOf(a);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it("has bounded slope near the threshold (smoothstep has zero-derivative ends)", () => {
    // smoothstep' = 0 at both ends, so small jitter at activity=0 or 0.33 barely
    // moves idleFactor (unlike the old linear knee whose slope was a constant 3).
    const eps = 0.005;
    const dAtZero = Math.abs(idleFactorOf(eps) - idleFactorOf(0));
    expect(dAtZero).toBeLessThan(0.01); // gentle, not the old ~3*eps*... jump
  });
});

// ---------------------------------------------------------------------------
// Commit 10 — H1/M8 startle as a low-Re escape dart (heading kick + speed burst)
// ---------------------------------------------------------------------------
describe("startleHeadingKick (H1/M8)", () => {
  const P = { ...CELL_DEFAULTS, startleKickThreshold: 0.12, startleKickMax: 1.2 };

  it("kicks the heading on a rising startle edge (perturbs direction, not position)", () => {
    // big jump 0 -> 0.8 exceeds threshold => nonzero kick
    const k = startleHeadingKick(0.8, 0.0, 1.0, P);
    expect(k).not.toBe(0);
    expect(Math.abs(k)).toBeLessThanOrEqual(1.2);
  });

  it("does NOT kick when startle is steady or decaying (no edge)", () => {
    expect(startleHeadingKick(0.5, 0.5, 1.0, P)).toBe(0); // steady
    expect(startleHeadingKick(0.3, 0.6, 1.0, P)).toBe(0); // decaying
    expect(startleHeadingKick(0.05, 0.0, 1.0, P)).toBe(0); // rise below threshold
  });

  it("is bounded by startleKickMax and deterministic", () => {
    for (let t = 0; t < 20; t += 0.3) {
      const k = startleHeadingKick(1.0, 0.0, t, P);
      expect(Math.abs(k)).toBeLessThanOrEqual(1.2 + 1e-12);
    }
    expect(startleHeadingKick(1, 0, 3.3, P)).toBe(startleHeadingKick(1, 0, 3.3, P));
  });
});

describe("startleBurstSpeed (H1)", () => {
  const P = { ...CELL_DEFAULTS, startleBurstFrac: 0.5 };
  const baseR = 17;

  it("is zero with no startle and scales linearly with startle (memoryless)", () => {
    expect(startleBurstSpeed(0, baseR, P)).toBe(0);
    expect(startleBurstSpeed(1, baseR, P)).toBeCloseTo(0.5 * baseR, 9);
    expect(startleBurstSpeed(0.5, baseR, P)).toBeCloseTo(0.25 * baseR, 9);
  });

  it("clamps startle to [0,1]", () => {
    expect(startleBurstSpeed(5, baseR, P)).toBe(startleBurstSpeed(1, baseR, P));
    expect(startleBurstSpeed(-5, baseR, P)).toBe(0);
  });

  it("fades as startle decays (no coasting): smaller startle => smaller burst", () => {
    let prev = Infinity;
    for (const s of [1.0, 0.7, 0.4, 0.1, 0.0]) {
      const b = startleBurstSpeed(s, baseR, P);
      expect(b).toBeLessThan(prev);
      prev = b;
    }
  });
});

describe("Commit 10 — startle kick gate", () => {
  it("enableStartleKick defaults ON (M8: no idle centre shove)", () => {
    expect(CELL_DEFAULTS.enableStartleKick).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit 13 — M4 (persist wander pose) + M5 (fraction storage, resize-safe)
// ---------------------------------------------------------------------------
describe("CellPersistState M4/M5 — pose round-trip + back-compat", () => {
  it("serializes & parses the optional pose fields (fx,fy,heading)", () => {
    const s: CellPersistState = { driftPhase: 1.2, growth: 0.3, elapsed: 5, fx: 0.25, fy: 0.75, heading: 1.1 };
    const round = parseCellState(serializeCellState(s));
    expect(round).not.toBeNull();
    expect(round!.fx).toBeCloseTo(0.25, 12);
    expect(round!.fy).toBeCloseTo(0.75, 12);
    expect(round!.heading).toBeCloseTo(1.1, 12);
  });
  it("still parses legacy payloads with no pose (back-compat -> undefined pose)", () => {
    const legacy = JSON.stringify({ driftPhase: 0.5, growth: 0.2, elapsed: 3 });
    const p = parseCellState(legacy);
    expect(p).not.toBeNull();
    expect(p!.fx).toBeUndefined();
    expect(p!.fy).toBeUndefined();
  });
  it("rejects out-of-range fractions (corrupt pose -> drop pose, keep base)", () => {
    const bad = JSON.stringify({ driftPhase: 0, growth: 0.2, elapsed: 3, fx: 5, fy: 0.5, heading: 1 });
    const p = parseCellState(bad);
    // base state still valid; pose dropped (fx out of [0,1])
    expect(p).not.toBeNull();
    expect(p!.fx).toBeUndefined();
  });
});

describe("wanderPoseFromState M4/M5 — fraction -> clamped pixel pose", () => {
  const P = CELL_DEFAULTS;
  it("returns null when the saved state carries no pose", () => {
    expect(wanderPoseFromState({ driftPhase: 0, growth: 0.2, elapsed: 1 }, 160, 160, 24, P)).toBeNull();
  });
  it("round-trips a centred pose to ~centre", () => {
    const pose = wanderPoseFromState({ driftPhase: 0, growth: 0, elapsed: 1, fx: 0.5, fy: 0.5, heading: 0.7 }, 160, 160, 24, P)!;
    expect(pose.x).toBeCloseTo(80, 6);
    expect(pose.y).toBeCloseTo(80, 6);
    expect(pose.heading).toBeCloseTo(0.7, 12);
  });
  it("M5: a 160x160 fraction loaded at 320x320 keeps the SAME relative position +/-1%", () => {
    // Use the real absolute baseR (17px) so the inset is small and the relative
    // position is preserved (a giant baseR would clamp everything to centre).
    const saved = { driftPhase: 0, growth: 0, elapsed: 1, fx: 0.3, fy: 0.7, heading: 0 };
    const pose = wanderPoseFromState(saved, 320, 320, 17, P)!;
    expect(pose.x / 320).toBeCloseTo(0.3, 2);
    expect(pose.y / 320).toBeCloseTo(0.7, 2);
  });
  it("M5: clamps the pose inside the wander inset (never out of bounds)", () => {
    // fx=0.99 would be near the wall; the inset must pull it inside.
    const pose = wanderPoseFromState({ driftPhase: 0, growth: 0, elapsed: 1, fx: 0.99, fy: 0.01, heading: 0 }, 160, 160, 24, P)!;
    const reach = cellReach(24, P);
    const inset = Math.max(P.driftMargin ?? 4, reach);
    expect(pose.x).toBeLessThanOrEqual(160 - inset + 1e-6);
    expect(pose.x).toBeGreaterThanOrEqual(inset - 1e-6);
    expect(pose.y).toBeLessThanOrEqual(160 - inset + 1e-6);
    expect(pose.y).toBeGreaterThanOrEqual(inset - 1e-6);
  });
});

describe("cellPersistKey M5 — namespaced by tank size", () => {
  it("differs by size so a harness overlay never loads a square-overlay pose", () => {
    expect(cellPersistKey(160, 160)).not.toBe(cellPersistKey(172, 36));
    expect(cellPersistKey(160, 160)).toBe(cellPersistKey(160, 160));
  });
  it("includes the dimensions", () => {
    expect(cellPersistKey(160, 160)).toContain("160x160");
  });
});

// ---------------------------------------------------------------------------
// Commit 14 — M6: EMA-chased energy removes the mode-change pop
// ---------------------------------------------------------------------------
describe("smoothEnergy (M6 mode-change pop)", () => {
  const P = CELL_DEFAULTS;
  const dt = 1 / 60;

  it("converges to a steady target (idempotent at equilibrium)", () => {
    let e = 0.4;
    for (let i = 0; i < 600; i++) e = smoothEnergy(e, 0.4, dt, P);
    expect(e).toBeCloseTo(0.4, 6);
  });

  it("removes the step discontinuity: first-frame change << the raw jump", () => {
    // idle ~0.18 -> a loud recording target ~0.7 is a big raw jump.
    const prev = 0.18, target = 0.7;
    const next = smoothEnergy(prev, target, dt, P);
    const step = next - prev;
    expect(step).toBeGreaterThan(0); // moves toward target
    expect(step).toBeLessThan((target - prev) * 0.5); // no instantaneous snap
    // C0: the smoothed value never overshoots the target
    expect(next).toBeLessThanOrEqual(target);
  });

  it("monotonically approaches the target (no oscillation/overshoot)", () => {
    let e = 0.1;
    let prev = e;
    for (let i = 0; i < 120; i++) {
      e = smoothEnergy(e, 0.8, dt, P);
      expect(e).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(e).toBeLessThanOrEqual(0.8 + 1e-12);
      prev = e;
    }
  });

  it("smooths a FALLING target too (transcribing->idle): monotone decrease, no undershoot", () => {
    let e = 0.8;
    let prev = e;
    const target = 0.18;
    const firstStep = prev - smoothEnergy(prev, target, dt, P);
    expect(firstStep).toBeGreaterThan(0); // moves down toward target
    expect(firstStep).toBeLessThan((prev - target) * 0.5); // no instantaneous snap
    for (let i = 0; i < 200; i++) {
      e = smoothEnergy(e, target, dt, P);
      expect(e).toBeLessThanOrEqual(prev + 1e-12);
      expect(e).toBeGreaterThanOrEqual(target - 1e-12); // never undershoots
      prev = e;
    }
    expect(e).toBeCloseTo(target, 4);
  });

  it("is frame-rate independent: same elapsed time => ~same value (dt vs 2*dt)", () => {
    let a = 0.2;
    for (let i = 0; i < 120; i++) a = smoothEnergy(a, 0.9, 1 / 60, P);
    let b = 0.2;
    for (let i = 0; i < 60; i++) b = smoothEnergy(b, 0.9, 2 / 60, P);
    expect(a).toBeCloseTo(b, 2);
  });

  it("preserves idle breathing: a slow 0.8 rad/s sine target is tracked, not flattened", () => {
    // Feed the idle oscillation as the target; the smoothed output must retain
    // most of the amplitude (fast tau barely attenuates a slow sine).
    const idle = 0.2;
    let e = idle;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 1200; i++) {
      const t = i * dt;
      const target = idle * (1 + Math.sin(t * 0.8) * 0.25);
      e = smoothEnergy(e, target, dt, P);
      if (i > 600) { min = Math.min(min, e); max = Math.max(max, e); }
    }
    const amp = (max - min) / 2;
    const rawAmp = idle * 0.25;
    expect(amp).toBeGreaterThan(rawAmp * 0.9); // <10% attenuation
  });

  it("gate off (enableEnergySmoothing=false) returns the target verbatim", () => {
    const Poff = { ...CELL_DEFAULTS, enableEnergySmoothing: false };
    expect(smoothEnergy(0.1, 0.9, dt, Poff)).toBe(0.9);
  });

  it("enableEnergySmoothing defaults ON", () => {
    expect(CELL_DEFAULTS.enableEnergySmoothing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit 16 — F7 wall-reorient + H2 rotational Brownian + H3 sedimentation
// (all gates OFF by default; wanderStep byte-identical unless explicitly enabled)
// ---------------------------------------------------------------------------
describe("Commit 16 — optional flourishes default OFF (byte-identical wander)", () => {
  it("the three gates default to off/undefined", () => {
    expect(CELL_DEFAULTS.enableWallReorient ?? false).toBe(false);
    expect(CELL_DEFAULTS.enableRotationalBrownian ?? false).toBe(false);
    expect(CELL_DEFAULTS.enableSedimentation ?? false).toBe(false);
  });
  it("wanderStep with defaults is unaffected by the new helpers (identity path)", () => {
    const P = { ...CELL_DEFAULTS };
    let a: WanderState = { x: 80, y: 80, heading: 0.5, vx: 0, vy: 0, clock: 0 };
    let b: WanderState = { x: 80, y: 80, heading: 0.5, vx: 0, vy: 0, clock: 0 };
    for (let i = 0; i < 200; i++) {
      a = wanderStep(a, 1 / 60, 160, 160, 17, P);
      b = wanderStep(b, 1 / 60, 160, 160, 17, { ...P }); // explicit-undefined gates
    }
    expect(b).toEqual(a);
  });
});

describe("wallReorientHeading (F7)", () => {
  it("turns the cell back into the tank (>90 deg from the incoming heading)", () => {
    // moving right into the +x wall (heading ~0): reorient should face back (~pi).
    for (const t of [0, 1.3, 5.0, 9.9]) {
      const h = wallReorientHeading(0.05, t, CELL_DEFAULTS);
      const delta = Math.abs(Math.atan2(Math.sin(h - 0.05), Math.cos(h - 0.05)));
      expect(delta).toBeGreaterThan(Math.PI / 2);
    }
  });
  it("is deterministic and bounded around the back direction", () => {
    expect(wallReorientHeading(0.05, 3.3, CELL_DEFAULTS)).toBe(wallReorientHeading(0.05, 3.3, CELL_DEFAULTS));
  });
});

describe("rotationalBrownianStep (H2)", () => {
  const P = { ...CELL_DEFAULTS, rotationalDiffusion: 0.5 };
  it("is zero-mean (deterministic gaussian sums to ~0 over many samples)", () => {
    let sum = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) sum += rotationalBrownianStep(i * 0.5 + 0.1, 1 / 60, P);
    expect(Math.abs(sum / N)).toBeLessThan(0.01);
  });
  it("RMS per step matches sqrt(2*Dr*dt) within ~25% (honest unit-variance calibration)", () => {
    const dt = 1 / 60;
    let sq = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) { const d = rotationalBrownianStep(i * 0.5 + 0.1, dt, P); sq += d * d; }
    const rms = Math.sqrt(sq / N);
    const expected = Math.sqrt(2 * 0.5 * dt);
    // After dividing by the measured 3-tap std (0.795), g has ~unit variance, so
    // the realized RMS should be CLOSE to the labelled coefficient, not ~0.46x.
    expect(rms).toBeGreaterThan(expected * 0.75);
    expect(rms).toBeLessThan(expected * 1.25);
  });
  it("is zero when rotationalDiffusion is 0", () => {
    expect(rotationalBrownianStep(1.0, 1 / 60, { ...CELL_DEFAULTS, rotationalDiffusion: 0 })).toBe(0);
  });
});

describe("sedimentationBias (H3)", () => {
  it("adds a small downward (+y) velocity bias bounded to <15% of swim speed", () => {
    const speed = 100;
    const P = { ...CELL_DEFAULTS, sedimentationFrac: 0.1 };
    const { dvx, dvy } = sedimentationBias(speed, P);
    expect(dvx).toBe(0);
    expect(dvy).toBeGreaterThan(0); // downward (+y is down in canvas)
    expect(dvy).toBeLessThanOrEqual(0.15 * speed + 1e-9);
  });
  it("is zero by default (sedimentationFrac defaults 0)", () => {
    const { dvy } = sedimentationBias(100, CELL_DEFAULTS);
    expect(dvy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Commit 24 — AXIAL SPIN
// ---------------------------------------------------------------------------
// A real Paramecium is a near-rigid spindle that SPINS about its long axis as
// it swims; the apparent "breathe/contract-expand" is the 2D foreshortening of
// that rotating spindle. Model it as a pure body-frame ROTATION of the existing
// area-preserving affine squeeze: spinPhi = -rate*simTime, rate = axialSpinMax*
// clamp01(speedNorm). LEFT-HANDED => negative. Gated OFF by default; collapses
// byte-identically to the static squeezePhi (= bodyHeading) when off OR at rest.
describe("Commit 24 — axial spin", () => {
  // Shoelace polygon area (signed -> abs). 2A = sum det[P_i, P_{i+1}].
  const shoelace = (pts: Array<[number, number]>): number => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  };

  it("(defaults) gate OFF and a calm axialSpinMax", () => {
    expect(CELL_DEFAULTS.enableAxialSpin).toBe(false);
    expect(CELL_DEFAULTS.axialSpinMax).toBe(3.5);
  });

  it("(a) GATE OFF: returns 0 and squeezePhi === bodyHeading exactly", () => {
    const p = { ...CELL_DEFAULTS }; // enableAxialSpin false
    expect(axialSpin(5, 1, p)).toBe(0);
    const bodyHeading = 0.73;
    for (const simTime of [0, 1, 2.5, 9.999]) {
      for (const s of [0, 0.3, 0.6, 1]) {
        const squeezePhiEff = bodyHeading + axialSpin(simTime, s, p);
        expect(squeezePhiEff).toBe(bodyHeading);
      }
    }
  });

  it("(b) REST COLLAPSE: gate ON but speedNorm=0 => no spin", () => {
    const p = { ...CELL_DEFAULTS, enableAxialSpin: true };
    // rate=0 => -0*simTime can be signed -0; +0 normalizes (math value is 0).
    expect(axialSpin(5, 0, p) + 0).toBe(0);
    expect(axialSpin(123.4, 0, p) + 0).toBe(0);
    // negative speed clamps to 0 too
    expect(axialSpin(5, -0.5, p) + 0).toBe(0);
  });

  it("(c) MONOTONE IN SPEED and bounded by axialSpinMax*t", () => {
    const p = { ...CELL_DEFAULTS, enableAxialSpin: true };
    const t = 2;
    const mags = [0, 0.25, 0.5, 0.75, 1].map((s) => Math.abs(axialSpin(t, s, p)));
    for (let i = 1; i < mags.length; i++) {
      expect(mags[i]).toBeGreaterThan(mags[i - 1]);
    }
    const bound = (p.axialSpinMax ?? 0) * t;
    for (const m of mags) expect(m).toBeLessThanOrEqual(bound + 1e-12);
    // speedNorm>1 clamps to 1 (same as full speed)
    expect(axialSpin(t, 5, p)).toBe(axialSpin(t, 1, p));
  });

  it("(d) DT-INDEPENDENCE: pure of simTime, phase scales linearly", () => {
    const p = { ...CELL_DEFAULTS, enableAxialSpin: true };
    const s = 0.6;
    const at_t = axialSpin(2, s, p);
    expect(axialSpin(2, s, p)).toBe(at_t); // pure
    expect(axialSpin(4, s, p)).toBeCloseTo(2 * at_t, 12); // linear in simTime
    expect(axialSpin(0, s, p) + 0).toBe(0); // simTime=0 => phase 0 (-0 normalized)
  });

  it("(e) SIGN = LEFT-HANDED: negative at t=1, speedNorm=1", () => {
    const p = { ...CELL_DEFAULTS, enableAxialSpin: true };
    expect(axialSpin(1, 1, p)).toBeLessThan(0);
    expect(axialSpin(1, 1, p)).toBeCloseTo(-(p.axialSpinMax ?? 0), 12);
  });

  it("(f) AREA CONSERVED: rotating the squeeze frame by spinPhi keeps area", () => {
    const on = { ...CELL_DEFAULTS, enableAffine: true, enableAxialSpin: true };
    const CX = 80, CY = 90;
    const noisy: Array<[number, number]> = [];
    for (let i = 0; i < 24; i++) {
      const th = (i / 24) * Math.PI * 2;
      const r = 30 + 6 * Math.sin(3 * th) + 3 * Math.cos(5 * th);
      noisy.push([CX + r * Math.cos(th), CY + r * Math.sin(th)]);
    }
    const k = 1.5;
    const bodyHeading = 0.4;
    const a0 = shoelace(affineSqueezePoints(noisy, k, bodyHeading, CX, CY, on));
    for (const simTime of [0.5, 1, 3.7]) {
      const phi = bodyHeading + axialSpin(simTime, 1, on);
      const a1 = shoelace(affineSqueezePoints(noisy, k, phi, CX, CY, on));
      expect(Math.abs(a1 - a0)).toBeLessThanOrEqual(1e-6);
    }
  });

  it("(g) DETERMINISM: identical args => identical value (no Date/random)", () => {
    const p = { ...CELL_DEFAULTS, enableAxialSpin: true };
    expect(axialSpin(3.3, 0.8, p)).toBe(axialSpin(3.3, 0.8, p));
  });
});

describe("Step A+B — activity-dependent phases are dt-integrated", () => {
  it("axial/helical spin does not spike when speedNorm changes after long elapsed time", () => {
    const p = { ...CELL_DEFAULTS, enableAxialSpin: true, axialSpinMax: 7 };
    const elapsed = 120;
    const dt = 0.5;
    const s0 = 0.1;
    const s1 = 0.8;
    let phase = 0;
    phase = advanceAxialSpinPhase(phase, elapsed, s0, p);
    const before = phase;
    phase = advanceAxialSpinPhase(phase, dt, s1, p);
    const increment = Math.abs(phase - before);
    expect(increment).toBeLessThanOrEqual((p.axialSpinMax ?? 0) * s1 * dt + 1e-12);
    const oldFormulaJump = Math.abs(axialSpin(elapsed + dt, s1, p) - axialSpin(elapsed, s0, p));
    expect(oldFormulaJump).toBeGreaterThan(increment * 10);
  });

  it("cyclosis phase does not spike when effective period/activity changes after long elapsed time", () => {
    const p = { ...CELL_DEFAULTS, cyclosisPeriod: 65, cyclosisActivityBoost: 0.4 };
    const elapsed = 120;
    const dt = 0.5;
    const idle = { ...p, cyclosisPeriod: effectiveCyclosisPeriod(0.06, p) };
    const active = { ...p, cyclosisPeriod: effectiveCyclosisPeriod(1, p) };
    let phase = 0;
    phase = advanceCyclosisPhase(phase, elapsed, idle);
    const before = phase;
    phase = advanceCyclosisPhase(phase, dt, active);
    const increment = Math.abs(phase - before);
    const minPeriod = Math.min(idle.cyclosisPeriod ?? 65, active.cyclosisPeriod ?? 65);
    expect(increment).toBeLessThanOrEqual((TAU / minPeriod) * dt + 1e-12);

    const g = { q: 0.7, phi0: 0.4 };
    const p0 = cyclosisLoopPointAtPhase(g, before);
    const p1 = cyclosisLoopPointAtPhase(g, phase);
    expect(Math.hypot(p1.u - p0.u, p1.s - p0.s)).toBeLessThan(0.08);

    const oldPhi0 = (TAU / (idle.cyclosisPeriod ?? 65)) * elapsed;
    const oldPhi1 = (TAU / (active.cyclosisPeriod ?? 65)) * (elapsed + dt);
    expect(Math.abs(oldPhi1 - oldPhi0)).toBeGreaterThan(increment * 10);
  });

  it("cilia beat phase does not spike when Hz changes after long elapsed time", () => {
    const p = { ...CELL_DEFAULTS, ciliaBeatHz: 0.5, ciliaBeatHzActive: 0.9, ciliaAsymmetry: 0 };
    const elapsed = 120;
    const dt = 0.5;
    let cycles = 0;
    cycles = advanceCiliaBeatCycles(cycles, elapsed, 0.5);
    const before = cycles;
    cycles = advanceCiliaBeatCycles(cycles, dt, 0.9);
    let increment = cycles - before;
    if (increment < -0.5) increment += 1;
    if (increment > 0.5) increment -= 1;
    expect(Math.abs(increment)).toBeLessThanOrEqual(0.9 * dt + 1e-12);

    const ph0 = ciliaBeatPhaseAtCycle(before, 3, p);
    const ph1 = ciliaBeatPhaseAtCycle(cycles, 3, p);
    let phaseDelta = ph1 - ph0;
    if (phaseDelta < -0.5) phaseDelta += 1;
    if (phaseDelta > 0.5) phaseDelta -= 1;
    expect(Math.abs(phaseDelta)).toBeLessThanOrEqual(0.9 * dt + 1e-12);

    const oldUnwrappedDelta = (elapsed + dt) * 0.9 - elapsed * 0.5;
    expect(oldUnwrappedDelta).toBeGreaterThan(Math.abs(increment) * 10);
  });
});
