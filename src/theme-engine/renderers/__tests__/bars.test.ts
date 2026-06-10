// src/theme-engine/renderers/__tests__/bars.test.ts
import { describe, it, expect } from "vitest";
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
});
