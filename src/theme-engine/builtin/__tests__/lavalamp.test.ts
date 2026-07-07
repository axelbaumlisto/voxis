// src/theme-engine/builtin/__tests../lavalamp.test.ts
//
// Unit test for the lavalamp (WebGL raymarched) theme. This runs in jsdom,
// which has NO WebGL backend — canvas.getContext("webgl") returns null. So the
// only code path reachable here is the GRACEFUL FALLBACK ("bail"): the theme
// must warn, remove its canvas, and return a valid no-op instance instead of
// throwing and crashing the host.
//
// What is deliberately NOT asserted here (and why):
//   - Param handling (shine/zoom/colors/speed/...) and the api.onState render
//     loop are read/subscribed in index.ts only AFTER a non-null gl context.
//     In jsdom getContext("webgl") returns null, so mount() bails BEFORE those
//     lines ever execute. Asserting on them in jsdom would test nothing real.
//     Their behaviour (voice pulse, params, shading) is covered by the real
//     WebGL e2e test: e../lavalamp-pulse.spec.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as theme from "../lavalamp";
import { validateThemeModule, THEME_API_VERSION, type ThemeApi, type ThemeMode } from "../../contract";

// Mirror metaballs.test.ts's fakeApi helper. mode defaults to "recording".
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

describe("lavalamp theme (jsdom — no WebGL)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Deterministic: silence + capture console.warn (the bail path warns once).
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a valid theme module (exports mount)", () => {
    expect(validateThemeModule(theme).ok).toBe(true);
  });

  it("bails gracefully when WebGL is unavailable (jsdom getContext → null)", () => {
    const container = document.createElement("div");
    let inst!: { unmount: () => void };
    // Must NOT throw even though there is no WebGL context.
    expect(() => {
      inst = theme.mount(container, fakeApi());
    }).not.toThrow();
    // Returns a valid instance with a callable unmount().
    expect(inst).toBeTruthy();
    expect(typeof inst.unmount).toBe("function");
    // Warned exactly about its own fallback (helps debugging, distinguishes it).
    expect(warnSpy).toHaveBeenCalled();
    const warnedMsg = warnSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(warnedMsg).toContain("lavalamp");
    // Bail removes the canvas → no orphan element left in the container.
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("returned no-op unmount() is safe to call (no throw)", () => {
    const container = document.createElement("div");
    const inst = theme.mount(container, fakeApi());
    expect(() => inst.unmount()).not.toThrow();
    // Idempotent — calling again on the no-op instance is still safe.
    expect(() => inst.unmount()).not.toThrow();
    expect(container.innerHTML).toBe("");
  });

  it("mounting with each mode does not throw and leaves the container empty", () => {
    const modes: ThemeMode[] = ["idle", "recording", "transcribing", "error"];
    for (const mode of modes) {
      const container = document.createElement("div");
      expect(() => {
        const inst = theme.mount(container, fakeApi(null, mode));
        inst.unmount();
      }).not.toThrow();
      // Bail removed the canvas, so the container is empty regardless of mode.
      expect(container.innerHTML).toBe("");
    }
  });
});
