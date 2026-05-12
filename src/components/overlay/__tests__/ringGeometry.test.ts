/**
 * Pure-function tests for the organic ring geometry, ported 1:1 from
 * `src-tauri/src/overlay_bin/platform/macos/ring.rs::tests`.
 *
 * Two implementations of the same math must produce identical contracts:
 * - Rust ring.rs drives the subprocess (egui) overlay.
 * - This TypeScript port drives the webview (canvas) overlay.
 *
 * Keeping the test set parallel ensures visual parity between the two
 * rendering paths.
 */
import { describe, it, expect } from "vitest";
import type { OrganicRingMotion, OrganicRingShape } from "../../../bindings";
import {
  applyRingGap,
  buildRingPoints,
  organicBaseRadius,
  ringStrokeWidth,
  type OrganicRingTheme,
} from "../ringGeometry";

// ---------- Shared fixtures ---------------------------------------------------

const SPECTRUM_BIN_COUNT = 32;

function defaultShape(overrides: Partial<OrganicRingShape> = {}): OrganicRingShape {
  return {
    gap_degrees: 42,
    base_thickness: 7.2,
    taper: 0.7,
    roundness: 0.9,
    active_zones: 3,
    ...overrides,
  };
}

function defaultMotion(overrides: Partial<OrganicRingMotion> = {}): OrganicRingMotion {
  return {
    idle_breathing: 0.1,
    speech_responsiveness: 0.92,
    drift: 0.38,
    settle_speed: 0.6,
    ...overrides,
  };
}

function defaultTheme(
  shape: Partial<OrganicRingShape> = {},
  motion: Partial<OrganicRingMotion> = {},
): OrganicRingTheme {
  return {
    shape: defaultShape(shape),
    motion: defaultMotion(motion),
  };
}

function zeroBins(): number[] {
  return new Array<number>(SPECTRUM_BIN_COUNT).fill(0);
}

// ---------- organicBaseRadius -------------------------------------------------

describe("organicBaseRadius", () => {
  it("produces visible radius for 200x100 (target overlay window)", () => {
    const r = organicBaseRadius(200, 100);
    expect(r).toBeGreaterThanOrEqual(12);
    // Ring must fit inside the smaller axis.
    expect(r).toBeLessThanOrEqual(50);
  });

  it("uses min(w,h) * 0.34 formula", () => {
    expect(organicBaseRadius(400, 100)).toBeCloseTo(100 * 0.34);
    expect(organicBaseRadius(60, 250)).toBeCloseTo(60 * 0.34);
  });
});

// ---------- applyRingGap ------------------------------------------------------

describe("applyRingGap", () => {
  it("treats 42deg gap as +/- 21deg around angle 0", () => {
    expect(applyRingGap(0, 42)).toBe(true); // dead center
    expect(applyRingGap((20 * Math.PI) / 180, 42)).toBe(true); // 20deg inside
    expect(applyRingGap((22 * Math.PI) / 180, 42)).toBe(false); // 22deg outside
  });

  it("with 0deg gap rejects all non-zero angles", () => {
    expect(applyRingGap(0.001, 0)).toBe(false);
    expect(applyRingGap(-0.001, 0)).toBe(false);
  });
});

// ---------- ringStrokeWidth ---------------------------------------------------

describe("ringStrokeWidth", () => {
  it("never returns < 1 (clamp keeps stroke visible at all angles)", () => {
    const shape = defaultShape();
    for (let i = 0; i < 360; i++) {
      const angle = (i * Math.PI) / 180 - Math.PI / 2;
      const w = ringStrokeWidth(angle, shape);
      expect(w).toBeGreaterThanOrEqual(1);
    }
  });

  it("scales with base_thickness (6x base ⇒ peak > 2x)", () => {
    const thin = defaultShape({ base_thickness: 2.0 });
    const thick = defaultShape({ base_thickness: 12.0 });
    const peakAngle = Math.PI / 2; // angle where taper_wave ≈ 1
    const wThin = ringStrokeWidth(peakAngle, thin);
    const wThick = ringStrokeWidth(peakAngle, thick);
    expect(wThick).toBeGreaterThan(wThin * 2);
  });
});

// ---------- buildRingPoints ---------------------------------------------------

describe("buildRingPoints", () => {
  it("emits 95-120 points for 42deg gap (sample_count=120, gap≈14 samples)", () => {
    const theme = defaultTheme();
    const points = buildRingPoints(400, 100, zeroBins(), 0, 0, theme, "recording");
    expect(points.length).toBeGreaterThanOrEqual(95);
    expect(points.length).toBeLessThanOrEqual(120);
  });

  it("keeps every point inside [0, w] x [0, h]", () => {
    const theme = defaultTheme();
    const points = buildRingPoints(400, 100, zeroBins(), 0, 0, theme, "recording");
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(400);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });

  it("returns same point count regardless of mode (geometry is mode-stable)", () => {
    const theme = defaultTheme();
    const modes = ["idle", "recording", "transcribing", "error"] as const;
    const counts = modes.map((m) => buildRingPoints(400, 100, zeroBins(), 0, 0, theme, m).length);
    // Mode changes pulse_multiplier/state_energy, not the gap; counts must match.
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBe(counts[0]);
    }
  });

  it("produces distinct geometry signatures for distinct shape parameters", () => {
    const themeA = defaultTheme({ gap_degrees: 28, base_thickness: 9, taper: 0.9, active_zones: 5 });
    const themeB = defaultTheme({ gap_degrees: 60, base_thickness: 5, taper: 0.4, active_zones: 2 });
    const themeC = defaultTheme({ gap_degrees: 42, base_thickness: 7.2, taper: 0.7, active_zones: 3 });

    const sig = (theme: OrganicRingTheme) => {
      const points = buildRingPoints(400, 100, zeroBins(), 0, 0, theme, "recording");
      const sum = points.reduce((acc, [x, y]) => acc + x + y, 0);
      return `${points.length}|${Math.round(sum * 100)}`;
    };

    const sigA = sig(themeA);
    const sigB = sig(themeB);
    const sigC = sig(themeC);

    expect(sigA).not.toBe(sigB);
    expect(sigA).not.toBe(sigC);
    expect(sigB).not.toBe(sigC);
  });
});
