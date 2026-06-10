// src/theme-engine/builtin/__tests__/dark.test.ts
import { describe, it, expect } from "vitest";
import * as theme from "../dark";
import { validateThemeModule, THEME_API_VERSION, type ThemeApi } from "../../contract";

function fakeApi(): ThemeApi {
  return {
    apiVersion: THEME_API_VERSION,
    params: null,
    size: { width: 172, height: 36 },
    onState(cb) {
      cb({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.5) });
      return () => {};
    },
    actions: { cancel: () => {} },
  };
}

describe("dark theme", () => {
  it("is a valid theme module", () => {
    expect(validateThemeModule(theme).ok).toBe(true);
  });

  it("mounts, renders bars with purple gradient, unmounts cleanly", () => {
    const container = document.createElement("div");
    const inst = theme.mount(container, fakeApi());
    expect(container.querySelectorAll(".classic-bar-col").length).toBeGreaterThan(0);
    const bar = container.querySelector(".classic-bar") as HTMLElement;
    // jsdom normalises hex to rgb()
    expect(bar.style.background).toContain("rgb(124, 77, 255)");
    inst.unmount();
    expect(container.innerHTML).toBe("");
  });
});