// src/theme-engine/builtin/__tests__/living_reed.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as theme from "../living_reed";
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

describe("living_reed theme", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is a valid theme module", () => {
    expect(validateThemeModule(theme).ok).toBe(true);
  });

  it("mounts, renders a canvas, unmounts cleanly", () => {
    const container = document.createElement("div");
    const inst = theme.mount(container, fakeApi());
    const canvas = container.querySelector("canvas")!;
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(172);
    expect(canvas.height).toBe(36);
    inst.unmount();
    expect(container.innerHTML).toBe("");
  });
});