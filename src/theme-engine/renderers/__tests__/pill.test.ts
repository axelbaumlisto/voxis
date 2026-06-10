// src/theme-engine/renderers/__tests__/pill.test.ts
import { describe, it, expect, vi } from "vitest";
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
});
