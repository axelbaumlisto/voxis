import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRingRenderer } from "../ring";

const SHAPE = { gap_degrees: 60, base_thickness: 3, taper: 0.5, roundness: 0.8, active_zones: 3 };
const MOTION = { idle_breathing: 0.1, speech_responsiveness: 0.8, drift: 0.2, settle_speed: 0.5 };

describe("createRingRenderer", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a canvas sized to options", () => {
    const container = document.createElement("div");
    const r = createRingRenderer(container, {
      shape: SHAPE, motion: MOTION, color: "#7a9fbd", width: 172, height: 36 });
    const canvas = container.querySelector("canvas")!;
    expect(canvas.width).toBe(172);
    expect(canvas.height).toBe(36);
    r.destroy();
  });

  it("starts RAF loop on create and cancels on destroy", () => {
    const container = document.createElement("div");
    const r = createRingRenderer(container, {
      shape: SHAPE, motion: MOTION, color: "#fff", width: 100, height: 50 });
    expect(requestAnimationFrame).toHaveBeenCalled();
    r.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });
});
