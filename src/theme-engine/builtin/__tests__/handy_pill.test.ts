// src/theme-engine/builtin/__tests__/handy_pill.test.ts
import { describe, it, expect, vi } from "vitest";
import * as theme from "../handy_pill";
import { validateThemeModule, THEME_API_VERSION, type ThemeApi, type ThemeState } from "../../contract";

function fakeApi(opts?: { cancelFn?: () => void }): ThemeApi {
  let callback: ((s: ThemeState) => void) | null = null;
  const api: ThemeApi = {
    apiVersion: THEME_API_VERSION,
    params: null,
    size: { width: 172, height: 36 },
    onState(cb) {
      callback = cb;
      return () => { callback = null; };
    },
    actions: { cancel: opts?.cancelFn ?? (() => {}) },
  };
  (api as any)._push = (s: ThemeState) => callback?.(s);
  return api;
}

describe("handy_pill theme", () => {
  it("is a valid theme module", () => {
    expect(validateThemeModule(theme).ok).toBe(true);
  });

  it("mounts, renders 9 bars + cancel button in recording mode, shows transcribing label, unmounts cleanly", () => {
    const container = document.createElement("div");
    const cancelFn = vi.fn();
    const api = fakeApi({ cancelFn });

    const inst = theme.mount(container, api);

    // Push recording state
    (api as any)._push({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.5) });

    // 9 pill bars
    const bars = container.querySelectorAll(".pill-bar");
    expect(bars.length).toBe(9);

    // Cancel button with data-action='cancel'
    const cancelBtn = container.querySelector("[data-action='cancel']");
    expect(cancelBtn).not.toBeNull();
    expect(cancelBtn!.tagName).toBe("BUTTON");

    // Clicking cancel calls api.actions.cancel
    (cancelBtn as HTMLButtonElement).click();
    expect(cancelFn).toHaveBeenCalledOnce();

    // Push transcribing state → expect "Transcribing" text
    (api as any)._push({ mode: "transcribing", audioLevel: 0, spectrumBins: new Array(32).fill(0) });
    expect(container.textContent).toContain("Transcribing");

    // Unmount cleans container
    inst.unmount();
    expect(container.innerHTML).toBe("");
  });
});
