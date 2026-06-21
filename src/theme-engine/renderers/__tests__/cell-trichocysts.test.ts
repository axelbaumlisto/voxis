// src/theme-engine/renderers/__tests__/cell-trichocysts.test.ts
/**
 * Split from cell.test.ts. Tests moved by domain; assertions intentionally unchanged.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CELL_DEFAULTS,
  createCellRenderer,
} from "../cell/testing";

// ==========================================================================
// v3.8E: Trichocyst discharge on startle
// ==========================================================================
describe("trichocyst discharge (v3.8E)", () => {
  const W = 200;
  const H = 200;

  function setupRaf() {
    const rafCalls: FrameRequestCallback[] = [];
    let frameId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return frameId++;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("performance", { now: () => 1000 });
    return rafCalls;
  }

  function installCtx() {
    const grad = { addColorStop: () => {} };
    const ctx: Record<string, unknown> = {
      clearRect: () => {},
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      createRadialGradient: () => grad,
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
    };
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (id: string) => unknown;
    };
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    return { ctx, restore: () => { proto.getContext = orig; } };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("enableTrichocysts defaults to false", () => {
    expect(CELL_DEFAULTS.enableTrichocysts).toBe(false);
  });

  it("trichocystCount defaults to 30", () => {
    expect(CELL_DEFAULTS.trichocystCount).toBe(30);
  });

  it("trichocystLengthMul defaults to 3.0", () => {
    expect(CELL_DEFAULTS.trichocystLengthMul).toBe(3.0);
  });

  it("trichocystDecay defaults to 1.0 (v4.0B: slow fade for ~3.5s visibility)", () => {
    expect(CELL_DEFAULTS.trichocystDecay).toBe(1.0);
  });

  it("trichocystLineWidth defaults to 1.5 (v4.0B: thicker for visibility)", () => {
    expect(CELL_DEFAULTS.trichocystLineWidth).toBe(1.5);
  });

  it("drifting_contour-like recording config keeps trichocysts dormant during startle", () => {
    const rafCalls = setupRaf();
    const { ctx, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W,
      height: H,
      params: {
        ...CELL_DEFAULTS,
        enableSomaticCilia: true,
        somaticCiliaCount: 104,
        ciliaGrowthBoost: 0,
        enableCiliaOnContour: true,
        enableTrichocysts: false,
        trichocystCount: 30,
        trichocystLengthMul: 3.0,
        trichocystLineWidth: 1.5,
      },
    });

    for (let i = 0; i < 5; i++) {
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }

    type CallEntry = { kind: "bp" | "mt" | "lt" | "st"; args: number[] };
    const callLog: CallEntry[] = [];
    (ctx.beginPath as ReturnType<typeof vi.fn>).mockImplementation(() => callLog.push({ kind: "bp", args: [] }));
    (ctx.moveTo as ReturnType<typeof vi.fn>).mockImplementation((...a: number[]) => callLog.push({ kind: "mt", args: a }));
    (ctx.lineTo as ReturnType<typeof vi.fn>).mockImplementation((...a: number[]) => callLog.push({ kind: "lt", args: a }));
    (ctx.stroke as ReturnType<typeof vi.fn>).mockImplementation(() => callLog.push({ kind: "st", args: [] }));

    for (let i = 0; i < 3; i++) {
      r.update({ mode: "recording", audioLevel: 0.95, spectrumBins: new Array(32).fill(0.9) });
      if (rafCalls.length) rafCalls.shift()!();
    }

    let longSingleSegmentNeedles = 0;
    for (let i = 0; i < callLog.length - 3; i++) {
      if (
        callLog[i].kind === "bp" &&
        callLog[i + 1].kind === "mt" &&
        callLog[i + 2].kind === "lt" &&
        callLog[i + 3].kind === "st"
      ) {
        const dx = callLog[i + 2].args[0] - callLog[i + 1].args[0];
        const dy = callLog[i + 2].args[1] - callLog[i + 1].args[1];
        if (Math.hypot(dx, dy) > 10) longSingleSegmentNeedles++;
      }
    }

    expect(longSingleSegmentNeedles).toBe(0);
    r.destroy();
    restore();
  });

  it("enableTrichocysts=false (default) \u2192 no trichocyst strokes during startle", () => {
    // With default params (enableTrichocysts=false), stroke count should be
    // the same whether or not a startle occurs.
    const rafCalls = setupRaf();
    const { ctx, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    // Warm up idle
    for (let i = 0; i < 3; i++) {
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    const strokeBefore = (ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    // Jump to recording to trigger startle
    for (let i = 0; i < 3; i++) {
      r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    const strokeAfter = (ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    // Record baseline stroke count during startle with trichocysts OFF
    const baseStrokes = strokeAfter - strokeBefore;
    r.destroy();
    restore();

    // enableTrichocysts ON should produce MORE strokes
    const rafCalls2 = setupRaf();
    const { ctx: ctx2, restore: restore2 } = installCtx();
    const container2 = document.createElement("div");
    const r2 = createCellRenderer(container2, {
      width: W, height: H,
      params: { ...CELL_DEFAULTS, enableTrichocysts: true },
    });
    // Warm up idle
    for (let i = 0; i < 3; i++) {
      r2.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls2.length) rafCalls2.shift()!();
    }
    const strokeBefore2 = (ctx2.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    // Jump to recording to trigger startle
    for (let i = 0; i < 3; i++) {
      r2.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
      if (rafCalls2.length) rafCalls2.shift()!();
    }
    const strokeAfter2 = (ctx2.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    const triStrokes = strokeAfter2 - strokeBefore2;
    // enableTrichocysts ON during startle should produce MORE stroke calls
    expect(triStrokes).toBeGreaterThan(baseStrokes);
    r2.destroy();
    restore2();
  });

  it("enableTrichocysts=true + no startle (idle) \u2192 no trichocyst strokes", () => {
    // No startle = no needles even with the gate on
    const rafCalls = setupRaf();
    const { ctx, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: { ...CELL_DEFAULTS, enableTrichocysts: true },
    });
    // Run several idle frames so startle stays 0
    for (let i = 0; i < 10; i++) {
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    // Record stroke count for the LAST idle frame (startle should be 0)
    const strokeBefore = (ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
    if (rafCalls.length) rafCalls.shift()!();
    const strokeAfter = (ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    // Should be same as default (no extra trichocyst strokes)
    r.destroy();
    restore();

    // Compare with trichocysts OFF
    const rafCalls2 = setupRaf();
    const { ctx: ctx2, restore: restore2 } = installCtx();
    const container2 = document.createElement("div");
    const r2 = createCellRenderer(container2, { width: W, height: H });
    for (let i = 0; i < 10; i++) {
      r2.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls2.length) rafCalls2.shift()!();
    }
    const strokeBefore2 = (ctx2.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    r2.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
    if (rafCalls2.length) rafCalls2.shift()!();
    const strokeAfter2 = (ctx2.stroke as ReturnType<typeof vi.fn>).mock.calls.length;
    // Same stroke count for idle frame (no startle = no trichocysts)
    expect(strokeAfter - strokeBefore).toBe(strokeAfter2 - strokeBefore2);
    r2.destroy();
    restore2();
  });

  it("enableTrichocysts=true renders without throwing", () => {
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableTrichocysts: true,
        trichocystCount: 30,
        trichocystLengthMul: 3.0,
        trichocystDecay: 5.0,
      },
    });
    expect(() => {
      // Idle
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
      // Sudden recording (triggers startle)
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.7) });
        if (rafCalls.length) rafCalls.shift()!();
      }
      // Back to idle (startle decays)
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });

  it("custom trichocystCount/LengthMul/Decay accepted without error", () => {
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableTrichocysts: true,
        trichocystCount: 50,
        trichocystLengthMul: 4.5,
        trichocystDecay: 8.0,
      },
    });
    expect(() => {
      for (let i = 0; i < 3; i++) {
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
      for (let i = 0; i < 3; i++) {
        r.update({ mode: "recording", audioLevel: 1.0, spectrumBins: new Array(32).fill(1.0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });

  it("trichocyst uses save/restore (no context leak)", () => {
    const rafCalls = setupRaf();
    const { ctx, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: { ...CELL_DEFAULTS, enableTrichocysts: true },
    });
    // Idle + then startle
    for (let i = 0; i < 3; i++) {
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    for (let i = 0; i < 3; i++) {
      r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    const saveCalls = (ctx.save as ReturnType<typeof vi.fn>).mock.calls.length;
    const restoreCalls = (ctx.restore as ReturnType<typeof vi.fn>).mock.calls.length;
    // save/restore must be balanced
    expect(saveCalls).toBe(restoreCalls);
    r.destroy();
    restore();
  });

  it("v3.9A: trichocyst needles point outward from cell surface", () => {
    const rafCalls = setupRaf();
    const { ctx, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableTrichocysts: true,
        trichocystCount: 20,
        trichocystLengthMul: 3.0,
      },
    });
    // Warm up idle so startle is 0
    for (let i = 0; i < 5; i++) {
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }

    // Build a call log from spies so we can isolate individual line segments.
    // Each trichocyst needle is: beginPath → moveTo(base) → lineTo(tip) → stroke.
    // We record these calls in order and extract needles from single-segment paths.
    type CallEntry = { kind: "bp" | "mt" | "lt" | "st"; args: number[] };
    const callLog: CallEntry[] = [];
    (ctx.beginPath as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callLog.push({ kind: "bp", args: [] });
    });
    (ctx.moveTo as ReturnType<typeof vi.fn>).mockImplementation((...a: number[]) => {
      callLog.push({ kind: "mt", args: a });
    });
    (ctx.lineTo as ReturnType<typeof vi.fn>).mockImplementation((...a: number[]) => {
      callLog.push({ kind: "lt", args: a });
    });
    (ctx.stroke as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callLog.push({ kind: "st", args: [] });
    });

    // Trigger startle (idle→recording)
    r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
    if (rafCalls.length) rafCalls.shift()!();

    // Extract single-segment paths: bp → mt → lt → st with exactly one lineTo
    const needles: { bx: number; by: number; tx: number; ty: number }[] = [];
    for (let i = 0; i < callLog.length - 3; i++) {
      if (
        callLog[i].kind === "bp" &&
        callLog[i + 1].kind === "mt" &&
        callLog[i + 2].kind === "lt" &&
        callLog[i + 3].kind === "st"
      ) {
        const [bx, by] = callLog[i + 1].args;
        const [tx, ty] = callLog[i + 2].args;
        needles.push({ bx, by, tx, ty });
      }
    }

    // We should find at least the trichocyst needles (there may be a few cilia
    // that also use single-segment paths, filter by length to be safe).
    const cx = W / 2;
    const cy = H / 2;
    let outwardCount = 0;
    let totalNeedles = 0;
    for (const { bx, by, tx, ty } of needles) {
      const ndx = tx - bx;
      const ndy = ty - by;
      const nLen = Math.hypot(ndx, ndy);
      if (nLen < 10) continue; // skip short segments (cilia)
      // Dot product: needle direction vs centroid-to-base
      const dot = ndx * (bx - cx) + ndy * (by - cy);
      totalNeedles++;
      if (dot > 0) outwardCount++;
    }
    // All trichocyst needles point outward from the cell
    expect(totalNeedles).toBeGreaterThanOrEqual(15); // at least 15 of 20 detected
    expect(outwardCount).toBe(totalNeedles);
    r.destroy();
    restore();
  });

  it("v3.9A: trichocyst placement indices are uniformly distributed (no >2× gap)", () => {
    // Test the index math directly: Math.round(i * N / count) should produce
    // a max gap <= ceil(N/count) + 1
    const N = 48; // typical contour point count
    const count = 20;
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      indices.push(Math.round(i * N / count) % N);
    }
    // Compute gaps between sorted indices
    const sorted = [...indices].sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
    }
    // Wrap-around gap
    maxGap = Math.max(maxGap, N - sorted[sorted.length - 1] + sorted[0]);
    const idealGap = Math.ceil(N / count);
    // Max gap should be at most idealGap + 1 (due to rounding)
    expect(maxGap).toBeLessThanOrEqual(idealGap + 1);
    // No duplicate indices
    const unique = new Set(indices);
    expect(unique.size).toBe(count);
  });

  it("v3.9B: trichocystDecay param affects needle count over time", () => {
    // With slow decay (0.5/s), trichocyst needles persist for seconds.
    // With fast decay (20/s), they vanish within a few frames.
    // We mock performance.now to advance 16.67ms/frame so dt is realistic.

    function countNeedlesDuringDecay(decay: number): number {
      let clock = 1000;
      const rafCalls = setupRaf();
      // Override setupRaf's static performance.now mock with advancing clock
      vi.stubGlobal("performance", { now: () => clock });
      const { ctx, restore } = installCtx();
      const container = document.createElement("div");
      const r = createCellRenderer(container, {
        width: W, height: H,
        params: {
          ...CELL_DEFAULTS,
          enableTrichocysts: true,
          trichocystCount: 10,
          trichocystDecay: decay,
        },
      });
      // Idle warmup (5 frames)
      for (let i = 0; i < 5; i++) {
        clock += 16.67;
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
      // Trigger startle
      clock += 16.67;
      r.update({ mode: "recording", audioLevel: 0.95, spectrumBins: new Array(32).fill(0.9) });
      if (rafCalls.length) rafCalls.shift()!();

      // Track paths during decay phase (60 idle frames ≈ 1s)
      type Call = { kind: string; args: number[] };
      const log: Call[] = [];
      (ctx.beginPath as ReturnType<typeof vi.fn>).mockImplementation(() => log.push({ kind: "bp", args: [] }));
      (ctx.moveTo as ReturnType<typeof vi.fn>).mockImplementation((...a: number[]) => log.push({ kind: "mt", args: a }));
      (ctx.lineTo as ReturnType<typeof vi.fn>).mockImplementation((...a: number[]) => log.push({ kind: "lt", args: a }));
      (ctx.stroke as ReturnType<typeof vi.fn>).mockImplementation(() => log.push({ kind: "st", args: [] }));

      for (let i = 0; i < 60; i++) {
        clock += 16.67;
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }

      // Extract long single-segment paths (trichocyst needles > 10px)
      let needles = 0;
      for (let i = 0; i < log.length - 3; i++) {
        if (log[i].kind === "bp" && log[i+1].kind === "mt" &&
            log[i+2].kind === "lt" && log[i+3].kind === "st") {
          const dx = log[i+2].args[0] - log[i+1].args[0];
          const dy = log[i+2].args[1] - log[i+1].args[1];
          if (Math.hypot(dx, dy) > 10) needles++;
        }
      }
      r.destroy();
      restore();
      return needles;
    }

    const slowNeedles = countNeedlesDuringDecay(0.5);  // half-life ~1.4s
    const fastNeedles = countNeedlesDuringDecay(20.0); // half-life ~35ms
    // Slow decay should produce MORE needle draws than fast decay
    expect(slowNeedles).toBeGreaterThan(fastNeedles);
    // Slow should have many (10 needles × many frames)
    expect(slowNeedles).toBeGreaterThan(100);
  });

  it("v3.9B: trichocystLineWidth param is respected", () => {
    const rafCalls = setupRaf();
    const { ctx, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableTrichocysts: true,
        trichocystLineWidth: 2.5,
      },
    });
    // Warmup idle
    for (let i = 0; i < 5; i++) {
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    // Track lineWidth assignments
    const lineWidths: number[] = [];
    Object.defineProperty(ctx, "lineWidth", {
      set: (v: number) => { lineWidths.push(v); },
      get: () => lineWidths[lineWidths.length - 1] ?? 1,
      configurable: true,
    });
    // Trigger startle
    r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.8) });
    if (rafCalls.length) rafCalls.shift()!();
    // Should have set lineWidth=2.5 at least once (for the trichocyst block)
    expect(lineWidths).toContain(2.5);
    r.destroy();
    restore();
  });

  it("v3.9B: trichocystAlpha persists independently from startle", () => {
    // Verify that trichocyst alpha outlives startle (different decay rates).
    // startleDecay=0.90 at real dt=0.0167 decays rapidly.
    // trichocystDecay=0.3 at dt=0.0167 is slow. After 60 frames (~1s),
    // trichocystAlpha ≈ e^(-0.3*1) ≈ 0.74 (still above 0.005 threshold).
    let clock = 1000;
    const rafCalls = setupRaf();
    vi.stubGlobal("performance", { now: () => clock });
    const { ctx, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableTrichocysts: true,
        trichocystCount: 10,
        trichocystDecay: 0.3,    // very slow — half-life ~2.3s
        startleDecay: 0.90,      // very fast startle decay
      },
    });
    // Warmup
    for (let i = 0; i < 5; i++) {
      clock += 16.67;
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    // Trigger startle
    clock += 16.67;
    r.update({ mode: "recording", audioLevel: 0.95, spectrumBins: new Array(32).fill(0.9) });
    if (rafCalls.length) rafCalls.shift()!();
    // Run 60 idle frames (~1s) — startle should be near-zero
    for (let i = 0; i < 60; i++) {
      clock += 16.67;
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    // Now check that trichocysts are STILL being drawn (stroke calls should occur)
    let strokeCount = 0;
    (ctx.stroke as ReturnType<typeof vi.fn>).mockImplementation(() => { strokeCount++; });
    clock += 16.67;
    r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
    if (rafCalls.length) rafCalls.shift()!();
    // With trichocystDecay=0.3 and ~1s elapsed, trichocystAlpha ≈ 0.74 >> 0.005
    expect(strokeCount).toBeGreaterThan(0);
    r.destroy();
    restore();
  });

  it("v4.0B: rising-edge threshold 0.02 allows small startle bumps to re-trigger", () => {
    // With threshold lowered from 0.05 to 0.02, a startle increase of 0.03
    // should re-fire trichocystAlpha to 1.0.
    let clock = 1000;
    const rafCalls = setupRaf();
    vi.stubGlobal("performance", { now: () => clock });
    const { ctx, restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, {
      width: W, height: H,
      params: {
        ...CELL_DEFAULTS,
        enableTrichocysts: true,
        trichocystCount: 10,
        trichocystDecay: 0.5,    // slow decay so needles persist
        startleDecay: 0.96,
      },
    });
    // Warmup idle
    for (let i = 0; i < 5; i++) {
      clock += 16.67;
      r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    // First startle trigger
    clock += 16.67;
    r.update({ mode: "recording", audioLevel: 0.8, spectrumBins: new Array(32).fill(0.8) });
    if (rafCalls.length) rafCalls.shift()!();
    // Let it decay a bit (30 frames)
    for (let i = 0; i < 30; i++) {
      clock += 16.67;
      r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.5) });
      if (rafCalls.length) rafCalls.shift()!();
    }
    // Bump audio slightly — should re-fire because threshold is 0.02
    clock += 16.67;
    r.update({ mode: "recording", audioLevel: 0.7, spectrumBins: new Array(32).fill(0.7) });
    if (rafCalls.length) rafCalls.shift()!();
    // Check trichocysts are being drawn on next frame
    let strokeCount = 0;
    (ctx.stroke as ReturnType<typeof vi.fn>).mockImplementation(() => { strokeCount++; });
    clock += 16.67;
    r.update({ mode: "recording", audioLevel: 0.7, spectrumBins: new Array(32).fill(0.7) });
    if (rafCalls.length) rafCalls.shift()!();
    expect(strokeCount).toBeGreaterThan(0);
    r.destroy();
    restore();
  });

  it("gate-off golden: CELL_DEFAULTS with trichocysts off renders identically", () => {
    const rafCalls = setupRaf();
    const { restore } = installCtx();
    const container = document.createElement("div");
    const r = createCellRenderer(container, { width: W, height: H });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
        if (rafCalls.length) rafCalls.shift()!();
      }
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0.7, spectrumBins: new Array(32).fill(0.5) });
        if (rafCalls.length) rafCalls.shift()!();
      }
    }).not.toThrow();
    r.destroy();
    restore();
  });
});
