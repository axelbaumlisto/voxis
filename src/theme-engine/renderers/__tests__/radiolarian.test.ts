import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RADIOLARIAN_DEFAULTS, radiolarianEnergy, shellRadius,
  spikeEndpoints, poreLattice,
  createRadiolarianRenderer,
} from "../radiolarian";
import { growthLevel } from "../shared";

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
    expect(shellRadius(1.0, 2.0, 0.3, 0, P)).toBe(shellRadius(1.0, 2.0, 0.3, 0, P));
  });
  it("is N-fold symmetric: r(angle) ≈ r(angle + 2π/symmetry)", () => {
    const t = 3.0, energy = 0.3;
    const step = (Math.PI * 2) / P.symmetry;
    for (let k = 0; k < P.symmetry; k++) {
      const a = 0.4 + k * step;
      expect(shellRadius(a, t, energy, 0, P)).toBeCloseTo(
        shellRadius(0.4, t, energy, 0, P), 5,
      );
    }
  });
  it("stays within a sane band around 1.0 (rigid shell, small bumps)", () => {
    for (let i = 0; i < 60; i++) {
      const r = shellRadius(i * 0.21, 2.0, 0.4, 0, P);
      expect(r).toBeGreaterThan(0.7);
      expect(r).toBeLessThan(1.4);
    }
  });
  it("growth=1 swells the radius beyond the base", () => {
    const base = shellRadius(1.0, 2.0, 0.3, 0, P);
    const swollen = shellRadius(1.0, 2.0, 0.3, 1, P);
    expect(swollen).toBeGreaterThan(base);
  });
  it("growth swell is proportional to growthShellSwell param", () => {
    // At growth=1, the swell factor should be (1 + 1*growthShellSwell)
    const r0 = shellRadius(1.0, 2.0, 0, 0, P);
    const r1 = shellRadius(1.0, 2.0, 0, 1, P);
    // r0 = 1.0 (no energy, no FBM noise) and r1 = 1+gswell
    // FBM gives small bump, so r0 ≈ 1.0, ratio ≈ 1+gswell
    expect(r1 / r0).toBeCloseTo(1 + P.growthShellSwell, 1);
  });
});

// ---------------------------------------------------------------------------
// growthLevel
// ---------------------------------------------------------------------------

describe("growthLevel", () => {
  it("is deterministic", () => {
    expect(growthLevel(0.5, 0.3, "recording", 0.06, 0.012))
      .toBe(growthLevel(0.5, 0.3, "recording", 0.06, 0.012));
  });

  it("attack is faster than release (given attack > release)", () => {
    // Starting at the same prev, stepping toward a target that is further away
    // should move more if the rate is higher
    const stepAttack = growthLevel(0.3, 0.9, "recording", 0.06, 0.012);
    const stepRelease = growthLevel(0.3, 0.9, "recording", 0.012, 0.06);
    // With attack=0.06 it should move more toward target than with rate=0.012
    expect(stepAttack).toBeGreaterThan(stepRelease);
  });

  it("sustained audio converges upward", () => {
    let g = 0;
    // Simulate many frames of sustained speech (audioLevel=0.8, recording mode)
    for (let i = 0; i < 200; i++) {
      g = growthLevel(g, 0.8, "recording", 0.06, 0.01);
    }
    // After many frames, should be close to audioLevel
    expect(g).toBeGreaterThan(0.7);
    expect(g).toBeLessThanOrEqual(1);
  });

  it("silence decays slowly", () => {
    let g = 0.9; // start at high growth
    // Many frames of idle (audioLevel=0, idle mode)
    for (let i = 0; i < 100; i++) {
      g = growthLevel(g, 0, "idle", 0.06, 0.01);
    }
    // After 100 frames at release=0.01, should still be above 0.3
    // (1 - 0.01)^100 ≈ 0.366, so 0.9 * 0.366 ≈ 0.33
    expect(g).toBeGreaterThan(0.2);
    expect(g).toBeLessThan(0.5);
  });

  it("clamped to [0, 1]", () => {
    const below = growthLevel(-0.5, 0, "idle", 0.06, 0.01);
    expect(below).toBeGreaterThanOrEqual(0);
    const above = growthLevel(1.5, 1.0, "recording", 0.06, 0.01);
    expect(above).toBeLessThanOrEqual(1);
  });

  it("idle/transcribing mode target is 0 (decays)", () => {
    let g = 0.8;
    g = growthLevel(g, 0.5, "idle", 0.06, 0.05);
    expect(g).toBeLessThan(0.8); // should move down (target=0)
    g = growthLevel(g, 0.5, "transcribing", 0.06, 0.05);
    expect(g).toBeLessThan(0.8); // should continue down
  });

  it("recording mode target is audioLevel", () => {
    // Start from 0, audioLevel=0.5 → should move up
    const g = growthLevel(0.0, 0.5, "recording", 0.06, 0.01);
    expect(g).toBeGreaterThan(0);
  });

  it("never goes below 0 even with negative prev", () => {
    const g = growthLevel(-0.1, 0, "idle", 0.1, 0.1);
    expect(g).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// spikeEndpoints (updated for jitter, growth, clamping)
// ---------------------------------------------------------------------------

describe("spikeEndpoints", () => {
  const W = 200, H = 200, CX = 100, CY = 100, BR = 30;

  it("emits exactly `symmetry` spikes", () => {
    const s = spikeEndpoints(CX, CY, BR, W, H, 1.0, 0.5, 0, RADIOLARIAN_DEFAULTS);
    expect(s.length).toBe(RADIOLARIAN_DEFAULTS.symmetry);
  });

  it("spike outer point is farther than shell at higher audio", () => {
    const lo = spikeEndpoints(CX, CY, BR, W, H, 1.0, 0.0, 0, RADIOLARIAN_DEFAULTS)[0];
    const hi = spikeEndpoints(CX, CY, BR, W, H, 1.0, 1.0, 0, RADIOLARIAN_DEFAULTS)[0];
    const dist = (p: { x1: number; y1: number; x2: number; y2: number }) =>
      Math.hypot(p.x2 - CX, p.y2 - CY);
    expect(dist(hi)).toBeGreaterThan(dist(lo));
  });

  it("inner endpoints sit on/near the shell, outer beyond it", () => {
    const sp = spikeEndpoints(CX, CY, BR, W, H, 1.0, 0.5, 0, RADIOLARIAN_DEFAULTS)[0];
    const inner = Math.hypot(sp.x1 - CX, sp.y1 - CY);
    const outer = Math.hypot(sp.x2 - CX, sp.y2 - CY);
    expect(outer).toBeGreaterThan(inner);
  });

  it("spikes extend further with growth", () => {
    const spNoGrowth = spikeEndpoints(CX, CY, BR, W, H, 1.0, 0.2, 0, RADIOLARIAN_DEFAULTS)[0];
    const spGrowth = spikeEndpoints(CX, CY, BR, W, H, 1.0, 0.2, 1.0, RADIOLARIAN_DEFAULTS)[0];
    const dist = (p: { x1: number; y1: number; x2: number; y2: number }) =>
      Math.hypot(p.x2 - CX, p.y2 - CY);
    expect(dist(spGrowth)).toBeGreaterThan(dist(spNoGrowth));
  });

  describe("jitter", () => {
    it("jitter is deterministic (same t → same output)", () => {
      const a = spikeEndpoints(CX, CY, BR, W, H, 2.5, 0.5, 0.3, {
        ...RADIOLARIAN_DEFAULTS,
        angleJitter: 0.1,
        lengthJitter: 0.2,
        jitterSpeed: 0.4,
      });
      const b = spikeEndpoints(CX, CY, BR, W, H, 2.5, 0.5, 0.3, {
        ...RADIOLARIAN_DEFAULTS,
        angleJitter: 0.1,
        lengthJitter: 0.2,
        jitterSpeed: 0.4,
      });
      expect(a).toEqual(b);
    });

    it("with jitter params zero, spikes are evenly spaced (back-compat)", () => {
      const params = {
        ...RADIOLARIAN_DEFAULTS,
        angleJitter: 0,
        lengthJitter: 0,
      };
      const s = spikeEndpoints(CX, CY, BR, W, H, 0, 0, 0, params);
      const angles: number[] = [];
      for (const sp of s) {
        angles.push(Math.atan2(sp.y2 - CY, sp.x2 - CX));
      }
      // Sort angles and check equal spacing
      angles.sort((a, b) => a - b);
      for (let k = 0; k < angles.length; k++) {
        const next = angles[(k + 1) % angles.length];
        let diff = next - angles[k];
        if (diff < 0) diff += Math.PI * 2;
        const expected = (Math.PI * 2) / params.symmetry;
        // Allow tiny floating-point error
        expect(Math.abs(diff - expected)).toBeLessThan(3e-15);
      }
    });

    it("with jitter enabled, angles differ per spike (organic)", () => {
      const params = {
        ...RADIOLARIAN_DEFAULTS,
        angleJitter: 0.1,
        lengthJitter: 0.2,
        jitterSpeed: 0.4,
      };
      const s = spikeEndpoints(CX, CY, BR, W, H, 1.0, 0.5, 0, params);
      const angles = s.map(sp => Math.atan2(sp.y2 - CY, sp.x2 - CX));
      const distances = s.map(sp => Math.hypot(sp.x2 - CX, sp.y2 - CY));
      // Check that not all distances are identical (length jitter)
      const uniqueDist = new Set(distances.map(d => d.toFixed(6)));
      expect(uniqueDist.size).toBeGreaterThan(1);
      // Check that not all angle diffs are identical (angle jitter)
      const sorted = [...angles].sort((a, b) => a - b);
      const diffs: number[] = [];
      for (let k = 0; k < sorted.length; k++) {
        const next = sorted[(k + 1) % sorted.length];
        diffs.push((next - sorted[k] + Math.PI * 3) % (Math.PI * 2));
      }
      const uniqueDiffs = new Set(diffs.map(d => d.toFixed(6)));
      expect(uniqueDiffs.size).toBeGreaterThan(1);
    });
  });

  describe("clipping", () => {
    it("all spike tips stay within canvas bounds at extreme audio+growth", () => {
      const w = 172, h = 36;
      const cx = w / 2, cy = h / 2;
      const baseR = Math.min(w, h) * RADIOLARIAN_DEFAULTS.radiusFraction;
      const xBound = w * 0.46;
      const yBound = h * 0.46;

      // Test across multiple time values with max audio and max growth
      for (let t = 0; t < 10; t += 0.7) {
        const spikes = spikeEndpoints(cx, cy, baseR, w, h, t, 1.0, 1.0, RADIOLARIAN_DEFAULTS);
        for (const sp of spikes) {
          expect(Math.abs(sp.x2 - cx)).toBeLessThanOrEqual(xBound + 0.001);
          expect(Math.abs(sp.y2 - cy)).toBeLessThanOrEqual(yBound + 0.001);
        }
      }
    });

    it("horizontal spikes are not truncated by vertical limit (wide canvas)", () => {
      const w = 200, h = 40;
      const cx = w / 2, cy = h / 2;
      const baseR = Math.min(w, h) * RADIOLARIAN_DEFAULTS.radiusFraction;
      // With a 200-wide canvas, horizontal spikes should extend much further
      // than vertical ones — the clamp is angle-dependent.
      const spikes = spikeEndpoints(cx, cy, baseR, w, h, 0, 1.0, 1.0, RADIOLARIAN_DEFAULTS);
      // Count spikes that go beyond the vertical limit but stay within horizontal limit
      const yBound = h * 0.46;
      const xBound = w * 0.46;
      let horizontalLike = 0;
      for (const sp of spikes) {
        const dx = Math.abs(sp.x2 - cx);
        const dy = Math.abs(sp.y2 - cy);
        // A spike near horizontal (angle near 0 or π) should have |dx| > |dy|
        // and can exceed the vertical bound in dx-direction
        if (dx > dy && dx < xBound + 0.001 && dy < yBound + 0.001) {
          horizontalLike++;
        }
        // All should be within bounds regardless
        expect(dx).toBeLessThanOrEqual(xBound + 0.001);
        expect(dy).toBeLessThanOrEqual(yBound + 0.001);
      }
      expect(horizontalLike).toBeGreaterThan(0);
    });
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