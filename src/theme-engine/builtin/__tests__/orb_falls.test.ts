// src/theme-engine/builtin/__tests__/orb_falls.test.ts
//
// jsdom has no WebGL backend, so mount() takes its graceful-fallback path here —
// exactly like metaballs3d.test.ts. What IS asserted: a valid module, no throw
// without WebGL, one warn that names the theme, no orphan canvas, idempotent
// unmount, and every mode safe. The shader's reaction to the voice level is
// covered by the real-WebGL UI spec (tests/ui/*themes* in the host repo), which
// mounts every builtin theme in Chromium.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as theme from "../orb_falls";
import { validateThemeModule, THEME_API_VERSION, type ThemeApi, type ThemeMode } from "../../contract";

function fakeApi(params: unknown = null, mode: ThemeMode = "recording"): ThemeApi {
  return {
    apiVersion: THEME_API_VERSION,
    params,
    size: { width: 160, height: 160 },
    onState(cb) {
      cb({ mode, audioLevel: 0.6, spectrumBins: new Array(32).fill(0.4) });
      return () => {};
    },
    actions: { cancel: () => {} },
  };
}

describe("orb_falls theme (jsdom — no WebGL)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a valid theme module (exports mount)", () => {
    expect(validateThemeModule(theme).ok).toBe(true);
  });

  it("bails gracefully when WebGL is unavailable, naming itself, leaving no canvas", () => {
    const container = document.createElement("div");
    let inst!: { unmount: () => void };
    expect(() => {
      inst = theme.mount(container, fakeApi());
    }).not.toThrow();
    expect(typeof inst.unmount).toBe("function");
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(warned).toContain("orb_falls");
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("no-op unmount() is safe to call twice", () => {
    const container = document.createElement("div");
    const inst = theme.mount(container, fakeApi());
    expect(() => inst.unmount()).not.toThrow();
    expect(() => inst.unmount()).not.toThrow();
    expect(container.innerHTML).toBe("");
  });

  it("mounts under every mode without throwing and cleans up", () => {
    const modes: ThemeMode[] = ["idle", "recording", "transcribing", "error"];
    for (const mode of modes) {
      const container = document.createElement("div");
      expect(() => {
        const inst = theme.mount(container, fakeApi(null, mode));
        inst.unmount();
      }).not.toThrow();
      expect(container.innerHTML).toBe("");
    }
  });

  it("ignores a manifest param block full of junk (numbers only, defaults kept)", () => {
    const container = document.createElement("div");
    expect(() => {
      const inst = theme.mount(container, fakeApi({ speed: "fast", glow: null, radius: 1.2 }));
      inst.unmount();
    }).not.toThrow();
  });
});
