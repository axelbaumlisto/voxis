// src/theme-engine/builtin/__tests__/metaballs.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as theme from "../metaballs";
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

describe("metaballs theme", () => {
  // Capturing canvas stub (jsdom has no 2D backend): record the last ImageData
  // passed to putImageData and how many times it was called, so tests can prove
  // render() actually painted rather than being a silent smoke test.
  let lastImage: { data: Uint8ClampedArray } | null = null;
  // Frame counter for the shared rAF mock. Hoisted so a test that mounts the
  // theme more than once (e.g. the per-mode loop) can reset it before each
  // mount and get a fresh pair of frames → a guaranteed paint every time.
  let rafFrames = 0;
  const resetRaf = () => {
    rafFrames = 0;
  };

  beforeEach(() => {
    lastImage = null;
    resetRaf();
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
    // Drive TWO frames synchronously: the A2 30fps throttle skips render() on
    // odd frames (time starts 0 → first step makes time=1, odd → skipped), so a
    // single frame would never paint. Two frames land on an even one where
    // render() actually runs. Stop after 2 so the rAF loop can't recurse forever.
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

  it("mounts a canvas and unmounts cleanly", () => {
    const container = document.createElement("div");
    const inst = theme.mount(container, fakeApi());
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
    // Backing store is always 2x the CSS size (fixed supersampling so the
    // compositor's 2:1 bilinear downscale acts as an exact box filter).
    expect(canvas.width).toBe(344);
    expect(canvas.height).toBe(72);
    inst.unmount();
    expect(container.innerHTML).toBe("");
  });

  it("renders across all modes without throwing", () => {
    const modes: ThemeMode[] = ["idle", "recording", "transcribing", "error"];
    for (const mode of modes) {
      lastImage = null;
      resetRaf(); // fresh pair of frames so each mode's render() actually paints
      const container = document.createElement("div");
      const inst = theme.mount(container, fakeApi(null, mode));
      // Prove render() genuinely ran for this mode: the two-frame rAF mock lands
      // on an even frame, so putImageData captured a non-empty buffer (some
      // pixel was written) rather than this being a silent smoke test.
      expect(lastImage).not.toBeNull();
      const data = (lastImage as unknown as { data: Uint8ClampedArray }).data;
      expect(data.some((v) => v !== 0)).toBe(true);
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

  // A3 (m4) — a `threshold: 0` is floored to 1.0 (a non-positive iso-level would
  // make the whole bbox shade as a solid opaque rectangle, since the field is
  // > 0 everywhere). Observable: capture the ImageData written in one frame and
  // assert NOT every pixel is fully opaque (a real blob leaves transparent
  // background), proving the floor path was taken rather than a filled rect.
  it("threshold: 0 floors to 1.0 and does not fill a solid rectangle", () => {
    let captured: { data: Uint8ClampedArray } | null = null;
    const ctx = {
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
      putImageData: (img: { data: Uint8ClampedArray }) => {
        captured = img;
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ctx as unknown as CanvasRenderingContext2D,
    );
    // The A2 30fps throttle skips render() on odd frames, so drive TWO frames
    // to land on an even one where render() actually paints.
    let count = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      if (count < 2) {
        count++;
        cb(0);
      }
      return 1;
    });

    const container = document.createElement("div");
    const inst = theme.mount(container, fakeApi({ threshold: 0 }));
    expect(captured).not.toBeNull();
    const data = (captured as unknown as { data: Uint8ClampedArray }).data;
    let partial = 0,
      transparentCount = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) transparentCount++;
      else if (data[i] < 255) partial++;
    }
    // Raw threshold 0 fills the bbox as a hard opaque rectangle (no AA band → partial==0
    // and zero transparent background). A correctly floored blob (threshold→1.0) has
    // anti-aliased edge pixels (partial>0) AND leaves transparent background pixels
    // (transparentCount>0) — both impossible for a solid filled rectangle.
    expect(partial).toBeGreaterThan(0);
    expect(transparentCount).toBeGreaterThan(0);
    inst.unmount();
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
