// src/theme-engine/renderers/__tests__/pill.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPillRenderer } from "../pill";

const PALETTE = {
  icon_color: "#FAA2CA",
  bar_color: "#ffe5ee",
  bar_glow: "#FAA2CA",
  shadow: "rgba(0,0,0,0.45)",
  transcribing_text: "#ffffff",
  cancel_hover_bg: "rgba(255,255,255,0.15)",
};

describe("createPillRenderer", () => {
  it("recording mode shows bars and cancel button", () => {
    const container = document.createElement("div");
    const onCancel = vi.fn();
    const r = createPillRenderer(container, { palette: PALETTE, onCancel });
    r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.5) });
    expect(container.querySelectorAll(".pill-bar").length).toBe(9);
    const cancel = container.querySelector("[data-action='cancel']") as HTMLElement;
    expect(cancel).toBeTruthy();
    cancel.click();
    expect(onCancel).toHaveBeenCalled();
    r.destroy();
  });

  it("transcribing mode shows label, no bars, no cancel", () => {
    const container = document.createElement("div");
    const r = createPillRenderer(container, { palette: PALETTE, onCancel: () => {} });
    r.update({ mode: "transcribing", audioLevel: 0, spectrumBins: [] });
    expect(container.textContent).toContain("Transcribing");
    expect(container.querySelectorAll(".pill-bar").length).toBe(0);
    expect(container.querySelector("[data-action='cancel']")).toBeNull();
    r.destroy();
  });

  it("idle mode shows only the icon", () => {
    const container = document.createElement("div");
    const r = createPillRenderer(container, { palette: PALETTE, onCancel: () => {} });
    r.update({ mode: "idle", audioLevel: 0, spectrumBins: [] });
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelectorAll(".pill-bar").length).toBe(0);
    r.destroy();
  });

  it("destroy clears the container", () => {
    const container = document.createElement("div");
    const r = createPillRenderer(container, { palette: PALETTE, onCancel: () => {} });
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

    it("decays bars to min height and min opacity after events stop", () => {
      const container = document.createElement("div");
      const r = createPillRenderer(container, { palette: PALETTE, onCancel: () => {} });
      r.update({ mode: "recording", audioLevel: 1, spectrumBins: new Array(32).fill(1) });

      // Push several high-energy updates
      for (let i = 0; i < 10; i++) {
        r.update({ mode: "recording", audioLevel: 1, spectrumBins: new Array(32).fill(1) });
      }

      const bars = container.querySelectorAll<HTMLElement>(".pill-bar");
      // Bars should be above min after high energy
      expect(parseFloat(bars[0].style.height)).toBeGreaterThan(4);

      // Push a few zero-frames (not enough to fully decay — residual > epsilon
      // so the settle loop is what brings bars to floor)
      for (let i = 0; i < 5; i++) {
        r.update({ mode: "recording", audioLevel: 0, spectrumBins: [] });
      }

      // Advance fake timers — accelerated settle reaches floor within 1.5 s
      // (worst case ~15 steps × 80 ms = 1200 ms).
      vi.advanceTimersByTime(1500);

      // After settle: all bars at MIN_PX (4px) and MIN_OPACITY (0.2)
      bars.forEach((b) => {
        expect(parseFloat(b.style.height)).toBe(4);
        expect(parseFloat(b.style.opacity)).toBe(0.2);
      });

      r.destroy();
    });

    it("settle is cancelled on mode change away from recording", () => {
      const container = document.createElement("div");
      const r = createPillRenderer(container, { palette: PALETTE, onCancel: () => {} });

      // Push high energy to trigger settle
      for (let i = 0; i < 10; i++) {
        r.update({ mode: "recording", audioLevel: 1, spectrumBins: new Array(32).fill(1) });
      }
      r.update({ mode: "recording", audioLevel: 0, spectrumBins: [] });

      const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

      // Mode change should cancel any pending settle
      r.update({ mode: "transcribing", audioLevel: 0, spectrumBins: [] });
      expect(cancelSpy).toHaveBeenCalled();

      cancelSpy.mockRestore();
      r.destroy();
    });

    it("destroy() cancels pending settle rAF", () => {
      const container = document.createElement("div");
      const r = createPillRenderer(container, { palette: PALETTE, onCancel: () => {} });

      for (let i = 0; i < 10; i++) {
        r.update({ mode: "recording", audioLevel: 1, spectrumBins: new Array(32).fill(1) });
      }
      r.update({ mode: "recording", audioLevel: 0, spectrumBins: [] });

      const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

      r.destroy();
      expect(cancelSpy).toHaveBeenCalled();
      expect(container.innerHTML).toBe("");

      cancelSpy.mockRestore();
    });
  });
});
