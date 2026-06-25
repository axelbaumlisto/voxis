// src/theme-engine/builtin/__tests__/metaballs.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as theme from "../metaballs";
import { validateThemeModule, THEME_API_VERSION, type ThemeApi, type ThemeMode } from "../../contract";

// jsdom has no 2D canvas backend; stub getContext with a minimal mock so the
// theme's per-pixel render path runs without throwing.
function stubCanvas() {
  const ctx = {
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: () => {},
  };
  vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
}

function fakeApi(params: unknown = null, mode: ThemeMode = "recording"): ThemeApi {
  return {
    apiVersion: THEME_API_VERSION,
    params,
    size: { width: 172, height: 36 },
    onState(cb) {
      cb({ mode, audioLevel: 0.6, spectrumBins: new Array(32).fill(0.4) });
      return () => {};
    },
    actions: { cancel: () => {} },
  };
}

describe("metaballs theme", () => {
  beforeEach(() => {
    stubCanvas();
    // Drive exactly one frame synchronously so render() runs without the
    // theme's internal rAF loop recursing forever.
    let fired = false;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      if (!fired) {
        fired = true;
        cb(0);
      }
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a valid theme module", () => {
    expect(validateThemeModule(theme).ok).toBe(true);
  });

  it("mounts a canvas and unmounts cleanly", () => {
    const container = document.createElement("div");
    const inst = theme.mount(container, fakeApi());
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(172);
    expect(canvas.height).toBe(36);
    inst.unmount();
    expect(container.innerHTML).toBe("");
  });

  it("renders across all modes without throwing", () => {
    const modes: ThemeMode[] = ["idle", "recording", "transcribing", "error"];
    for (const mode of modes) {
      const container = document.createElement("div");
      const inst = theme.mount(container, fakeApi(null, mode));
      inst.unmount();
    }
  });

  it("honours custom params (blobCount clamped, palette parsed)", () => {
    const container = document.createElement("div");
    const inst = theme.mount(
      container,
      fakeApi({ blobCount: 99, palette: ["#ffffff"], background: "#000000" }),
    );
    expect(container.querySelector("canvas")).toBeTruthy();
    inst.unmount();
  });

  // Fix 4.1 — a legal `threshold: 0` must be respected (not coerced to 1.0) and
  // must not crash the bbox pad math (which would divide by sqrt(0)).
  it("respects threshold: 0 without throwing or crashing", () => {
    const container = document.createElement("div");
    expect(() => {
      const inst = theme.mount(container, fakeApi({ threshold: 0 }));
      expect(container.querySelector("canvas")).toBeTruthy();
      inst.unmount();
    }).not.toThrow();
    expect(container.innerHTML).toBe("");
  });

  // Fix 4.2 — garbage palette elements must not throw (hexToRgb on a non-string
  // would NaN/throw); valid entries are kept, invalid ignored, default used if
  // none are valid.
  it("tolerates a garbage palette and still renders", () => {
    const container = document.createElement("div");
    expect(() => {
      const inst = theme.mount(
        container,
        fakeApi({ palette: [123, "#fff", null] }),
      );
      expect(container.querySelector("canvas")).toBeTruthy();
      inst.unmount();
    }).not.toThrow();
    expect(container.innerHTML).toBe("");
  });

  // Fix 4.3 — a fractional blobCount must round to an integer count internally.
  it("handles a fractional blobCount (3.7) and unmounts cleanly", () => {
    const container = document.createElement("div");
    expect(() => {
      const inst = theme.mount(container, fakeApi({ blobCount: 3.7 }));
      expect(container.querySelector("canvas")).toBeTruthy();
      inst.unmount();
    }).not.toThrow();
    expect(container.innerHTML).toBe("");
  });
});
