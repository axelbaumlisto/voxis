import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RADIOLARIAN_DEFAULTS, radiolarianEnergy, shellRadius,
  spikeEndpoints, poreLattice,
  createRadiolarianRenderer,
} from "../radiolarian";

const P = RADIOLARIAN_DEFAULTS;

describe("radiolarianEnergy", () => {
  it("idle returns a small positive breathing value", () => {
    const e = radiolarianEnergy("idle", 0, 1.0, P);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(0.5);
  });
  it("recording rises with audio level (monotonic-ish)", () => {
    const lo = radiolarianEnergy("recording", 0.1, 1.0, P);
    const hi = radiolarianEnergy("recording", 0.9, 1.0, P);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThanOrEqual(1);
  });
});

describe("shellRadius", () => {
  it("is deterministic", () => {
    expect(shellRadius(1.0, 2.0, 0.3, P)).toBe(shellRadius(1.0, 2.0, 0.3, P));
  });
  it("is N-fold symmetric: r(angle) ≈ r(angle + 2π/symmetry)", () => {
    const t = 3.0, energy = 0.3;
    const step = (Math.PI * 2) / P.symmetry;
    for (let k = 0; k < P.symmetry; k++) {
      const a = 0.4 + k * step;
      expect(shellRadius(a, t, energy, P)).toBeCloseTo(
        shellRadius(0.4, t, energy, P), 5,
      );
    }
  });
  it("stays within a sane band around 1.0 (rigid shell, small bumps)", () => {
    for (let i = 0; i < 60; i++) {
      const r = shellRadius(i * 0.21, 2.0, 0.4, P);
      expect(r).toBeGreaterThan(0.7);
      expect(r).toBeLessThan(1.4);
    }
  });
});

describe("spikeEndpoints", () => {
  it("emits exactly `symmetry` spikes", () => {
    const s = spikeEndpoints(100, 100, 20, 1.0, 0.5, RADIOLARIAN_DEFAULTS);
    expect(s.length).toBe(RADIOLARIAN_DEFAULTS.symmetry);
  });
  it("spike outer point is farther than shell at higher audio", () => {
    const lo = spikeEndpoints(100, 100, 20, 1.0, 0.0, RADIOLARIAN_DEFAULTS)[0];
    const hi = spikeEndpoints(100, 100, 20, 1.0, 1.0, RADIOLARIAN_DEFAULTS)[0];
    const dist = (p: { x1: number; y1: number; x2: number; y2: number }) =>
      Math.hypot(p.x2 - 100, p.y2 - 100);
    expect(dist(hi)).toBeGreaterThan(dist(lo));
  });
  it("inner endpoints sit on/near the shell, outer beyond it", () => {
    const sp = spikeEndpoints(100, 100, 20, 1.0, 0.5, RADIOLARIAN_DEFAULTS)[0];
    const inner = Math.hypot(sp.x1 - 100, sp.y1 - 100);
    const outer = Math.hypot(sp.x2 - 100, sp.y2 - 100);
    expect(outer).toBeGreaterThan(inner);
  });
});

describe("poreLattice", () => {
  it("returns dots on `poreRings` concentric rings, all inside the shell", () => {
    const baseR = 20;
    const dots = poreLattice(100, 100, baseR, 2.0, RADIOLARIAN_DEFAULTS);
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) {
      const rr = Math.hypot(d.x - 100, d.y - 100);
      expect(rr).toBeLessThanOrEqual(baseR * 1.01); // inside shell
    }
  });
  it("is deterministic", () => {
    const a = poreLattice(100, 100, 20, 2.0, RADIOLARIAN_DEFAULTS);
    const b = poreLattice(100, 100, 20, 2.0, RADIOLARIAN_DEFAULTS);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// createRadiolarianRenderer (smoke test matching cell.test.ts patterns)
// ---------------------------------------------------------------------------

describe("createRadiolarianRenderer", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(42));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a canvas sized to options", () => {
    const container = document.createElement("div");
    const r = createRadiolarianRenderer(container, { width: 172, height: 36 });
    const canvas = container.querySelector("canvas")!;
    expect(canvas).not.toBeNull();
    expect(canvas.width).toBe(172);
    expect(canvas.height).toBe(36);
    r.destroy();
  });

  it("starts RAF loop on create and cancels on destroy", () => {
    const container = document.createElement("div");
    const r = createRadiolarianRenderer(container, { width: 100, height: 50 });
    expect(requestAnimationFrame).toHaveBeenCalled();
    r.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("update() does not throw (smoke)", () => {
    const container = document.createElement("div");
    const r = createRadiolarianRenderer(container, { width: 100, height: 50 });
    expect(() =>
      r.update({
        mode: "recording",
        audioLevel: 0.8,
        spectrumBins: new Array(32).fill(0.5),
      }),
    ).not.toThrow();
    r.destroy();
  });

  it("destroy clears container", () => {
    const container = document.createElement("div");
    const r = createRadiolarianRenderer(container, { width: 100, height: 50 });
    expect(container.children.length).toBeGreaterThan(0);
    r.destroy();
    expect(container.children.length).toBe(0);
    expect(container.innerHTML).toBe("");
  });
});
