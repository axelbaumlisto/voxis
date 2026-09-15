// crates/tauri-plugin-voxis/guest-js/__tests__/theme-bridge.test.ts
import { describe, expect, it, vi } from "vitest";
import { createThemeBridge, pluginStateToThemeMode } from "../src/theme-bridge";
import { THEME_API_VERSION } from "../src/types/theme-api";

describe("createThemeBridge", () => {
  it("api.onState fires immediately with the current (idle) state", () => {
    const bridge = createThemeBridge({ width: 64, height: 64 }, undefined, { cancel: vi.fn() });
    const cb = vi.fn();
    bridge.api.onState(cb);
    expect(cb).toHaveBeenCalledWith({ mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
  });

  it("setFromLevel pushes mode/audioLevel/spectrumBins to subscribers", () => {
    const bridge = createThemeBridge({ width: 64, height: 64 }, undefined, { cancel: vi.fn() });
    const cb = vi.fn();
    bridge.api.onState(cb);
    cb.mockClear();

    bridge.setFromLevel("recording", 0.5, false);

    expect(cb).toHaveBeenCalledTimes(1);
    const state = cb.mock.calls[0]?.[0];
    expect(state.mode).toBe("recording");
    expect(state.audioLevel).toBe(0.5);
    expect(state.spectrumBins).toHaveLength(32);
    expect(state.spectrumBins.every((b: number) => b === 0.5)).toBe(true);
  });

  it("muted forces audioLevel to 0 regardless of rms", () => {
    const bridge = createThemeBridge({ width: 64, height: 64 }, undefined, { cancel: vi.fn() });
    const cb = vi.fn();
    bridge.api.onState(cb);
    cb.mockClear();

    bridge.setFromLevel("recording", 0.9, true);

    const state = cb.mock.calls[0]?.[0];
    expect(state.audioLevel).toBe(0);
  });

  it("onState's unsubscribe function stops further pushes", () => {
    const bridge = createThemeBridge({ width: 64, height: 64 }, undefined, { cancel: vi.fn() });
    const cb = vi.fn();
    const unsubscribe = bridge.api.onState(cb);
    cb.mockClear();
    unsubscribe();

    bridge.setFromLevel("recording", 0.2, false);
    expect(cb).not.toHaveBeenCalled();
  });

  it("actions.cancel forwards to the injected cancel callback", () => {
    const cancel = vi.fn();
    const bridge = createThemeBridge({ width: 64, height: 64 }, undefined, { cancel });
    bridge.api.actions.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("api.apiVersion matches THEME_API_VERSION (contract v1)", () => {
    const bridge = createThemeBridge({ width: 64, height: 64 }, undefined, { cancel: vi.fn() });
    expect(bridge.api.apiVersion).toBe(THEME_API_VERSION);
  });
});

describe("pluginStateToThemeMode", () => {
  it("is an identity mapping (PluginState and ThemeMode share the same string values)", () => {
    for (const s of ["idle", "recording", "transcribing", "error"] as const) {
      expect(pluginStateToThemeMode(s)).toBe(s);
    }
  });
});
