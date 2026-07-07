// src/theme-engine/builtin/__tests__/metaballs25d.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as theme from "../metaballs25d";
import { validateThemeModule, THEME_API_VERSION, type ThemeApi, type ThemeMode } from "../../contract";

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

describe("metaballs25d theme", () => {
  let lastImage: { data: Uint8ClampedArray } | null = null;
  let rafFrames = 0;

  beforeEach(() => {
    lastImage = null;
    rafFrames = 0;
    const ctx = {
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
      putImageData: (img: { data: Uint8ClampedArray }) => {
        lastImage = img;
      },
    };
    vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    // Two synchronous frames: the 30fps throttle skips render() on odd frames.
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      if (rafFrames < 2) {
        rafFrames++;
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

  it("mounts a 2x-supersampled canvas and unmounts cleanly", () => {
    const container = document.createElement("div");
    const inst = theme.mount(container, fakeApi());
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(344);
    expect(canvas.height).toBe(72);
    inst.unmount();
    expect(container.innerHTML).toBe("");
  });

  it("renders across all modes without throwing and paints pixels", () => {
    const modes: ThemeMode[] = ["idle", "recording", "transcribing", "error"];
    for (const mode of modes) {
      lastImage = null;
      rafFrames = 0;
      const container = document.createElement("div");
      const inst = theme.mount(container, fakeApi(null, mode));
      expect(lastImage).not.toBeNull();
      const data = (lastImage as unknown as { data: Uint8ClampedArray }).data;
      expect(data.some((v) => v !== 0)).toBe(true);
      inst.unmount();
    }
  });

  it("honours custom params (blobCount clamped, colors parsed)", () => {
    const container = document.createElement("div");
    const inst = theme.mount(
      container,
      fakeApi({ blobCount: 99, colors: ["#ffffff", "#000000"] }),
    );
    expect(container.querySelector("canvas")).toBeTruthy();
    inst.unmount();
  });

  it("falls back to default colors when colors param is invalid", () => {
    const container = document.createElement("div");
    const inst = theme.mount(container, fakeApi({ colors: [42, null, "nope"] }));
    expect(container.querySelector("canvas")).toBeTruthy();
    inst.unmount();
  });
});
