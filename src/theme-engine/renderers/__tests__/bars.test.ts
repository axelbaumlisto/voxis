// src/theme-engine/renderers/__tests__/bars.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createBarsRenderer } from "../bars";

const GRADIENT = { bottom: "#299400", middle: "#d6b521", top: "#ef3110" };

describe("createBarsRenderer", () => {
  it("renders barCount columns into the container", () => {
    const container = document.createElement("div");
    const r = createBarsRenderer(container, { gradient: GRADIENT, barCount: 16 });
    expect(container.querySelectorAll(".classic-bar-col").length).toBe(16);
    r.destroy();
  });

  it("update() changes bar heights", () => {
    const container = document.createElement("div");
    const r = createBarsRenderer(container, { gradient: GRADIENT, barCount: 4 });
    r.update({ mode: "recording", audioLevel: 1, spectrumBins: [1, 1, 1, 1] });
    const bar = container.querySelector(".classic-bar") as HTMLElement;
    expect(parseFloat(bar.style.height)).toBeGreaterThan(2);
    r.destroy();
  });

  it("destroy() empties the container", () => {
    const container = document.createElement("div");
    const r = createBarsRenderer(container, { gradient: GRADIENT, barCount: 4 });
    r.destroy();
    expect(container.innerHTML).toBe("");
  });

  describe("settle loop", () => {
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance", "requestAnimationFrame", "cancelAnimationFrame"],
      });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("decays bars to MIN_HEIGHT and peaks to display:none after events stop", () => {
      const container = document.createElement("div");
      const r = createBarsRenderer(container, {
        gradient: GRADIENT,
        barCount: 4,
        maxHeight: 32,
        peakDecay: 0.96,
        smoothingAlpha: 0.3,
      });

      // Push several high-energy updates to drive bars + peaks up
      for (let i = 0; i < 10; i++) {
        r.update({
          mode: "recording",
          audioLevel: 1,
          spectrumBins: [1, 1, 1, 1],
        });
      }
      // Then push a few zeros so smoothed bars drop but peak-hold persists
      for (let i = 0; i < 3; i++) {
        r.update({
          mode: "recording",
          audioLevel: 0,
          spectrumBins: [0, 0, 0, 0],
        });
      }

      // Verify peaks are visible (peak-hold holding above dropping bars)
      const bars = container.querySelectorAll<HTMLElement>(".classic-bar");
      const peaks = container.querySelectorAll<HTMLElement>(".classic-bar-peak");
      let anyPeakVisible = false;
      peaks.forEach((p) => {
        if (p.style.display === "block") anyPeakVisible = true;
      });
      expect(anyPeakVisible).toBe(true);

      // Push 12 zero-frames (simulating Rust silence burst)
      for (let i = 0; i < 12; i++) {
        r.update({
          mode: "recording",
          audioLevel: 0,
          spectrumBins: [0, 0, 0, 0],
        });
      }

      // Advance fake timers — accelerated settle reaches floor within 1.5 s
      // (worst case ~15 steps × 80 ms = 1200 ms).
      vi.advanceTimersByTime(1500);

      // After settle: all bars at MIN_HEIGHT (2px), all peaks display:none
      bars.forEach((b) => {
        expect(parseFloat(b.style.height)).toBe(2);
      });
      peaks.forEach((p) => {
        expect(p.style.display).toBe("none");
      });

      r.destroy();
    });

    it("settle is cancelled by a fresh real update (no runaway rAF)", () => {
      const container = document.createElement("div");
      const r = createBarsRenderer(container, {
        gradient: GRADIENT,
        barCount: 4,
        peakDecay: 0.96,
        smoothingAlpha: 0.3,
      });

      // Push high energy to drive bars up, then zeros to trigger settle
      for (let i = 0; i < 10; i++) {
        r.update({ mode: "recording", audioLevel: 1, spectrumBins: [1, 1, 1, 1] });
      }
      for (let i = 0; i < 3; i++) {
        r.update({ mode: "recording", audioLevel: 0, spectrumBins: [0, 0, 0, 0] });
      }

      // Advance one 80ms-gated decay step so settle loop is in progress
      vi.advanceTimersByTime(80);

      // Spy on cancelAnimationFrame to verify it's called when
      // a real update interrupts the pending settle rAF
      const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

      // A real update arrives — should cancel pending settle rAF
      r.update({ mode: "recording", audioLevel: 1, spectrumBins: [0.5, 0.5, 0.5, 0.5] });
      expect(cancelSpy).toHaveBeenCalled();

      cancelSpy.mockRestore();

      r.destroy();
    });

    it("destroy() cancels pending settle rAF", () => {
      const container = document.createElement("div");
      const r = createBarsRenderer(container, {
        gradient: GRADIENT,
        barCount: 4,
        peakDecay: 0.96,
        smoothingAlpha: 0.3,
      });

      // Push high energy to drive bars up, then zeros to trigger settle
      for (let i = 0; i < 10; i++) {
        r.update({ mode: "recording", audioLevel: 1, spectrumBins: [1, 1, 1, 1] });
      }
      r.update({ mode: "recording", audioLevel: 0, spectrumBins: [0, 0, 0, 0] });

      const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

      // Destroy while settle is pending
      r.destroy();
      expect(cancelSpy).toHaveBeenCalled();
      expect(container.innerHTML).toBe("");

      cancelSpy.mockRestore();
    });
  });
});
