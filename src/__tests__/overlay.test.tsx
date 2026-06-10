/**
 * Integration tests for the overlay webview entry shell.
 *
 * OverlayApp now delegates to ThemeHost — all visual logic lives in theme
 * modules. This suite verifies the wiring: useOverlayState → ThemeHost with
 * fetchModule/fallbackModule/cancel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

// ── Mock Tauri event bus (used by useOverlayState) ──────────────────────
type EventHandler = (event: { payload: unknown }) => void;

const listenMock = vi.fn();
const invokeMock = vi.fn();
const handlers = new Map<string, EventHandler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// ── Mock bindings.commands ──────────────────────────────────────────────
// readThemeScript returns a trivial valid theme module source via the
// generated Result<T,E> wrapper ({ status, data } | { status, error }).
const readThemeScriptMock = vi.fn().mockResolvedValue({
  status: "ok",
  data: "export function mount(c){c.dataset.theme='loaded';return{unmount(){}}}",
});
const getThemeManifestMock = vi.fn().mockResolvedValue(null);
const cancelOperationMock = vi.fn().mockResolvedValue({ status: "ok", data: null });
const debugLogOverlayMock = vi.fn().mockResolvedValue(undefined);
const getCurrentOverlayThemeMock = vi.fn().mockResolvedValue("default");

vi.mock("../bindings", () => ({
  commands: {
    readThemeScript: (...args: unknown[]) => readThemeScriptMock(...args),
    getThemeManifest: (...args: unknown[]) => getThemeManifestMock(...args),
    cancelOperation: (...args: unknown[]) => cancelOperationMock(...args),
    debugLogOverlay: (...args: unknown[]) => debugLogOverlayMock(...args),
    getCurrentOverlayTheme: (...args: unknown[]) => getCurrentOverlayThemeMock(...args),
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────

import { OverlayApp } from "../overlay";

describe("OverlayApp (ThemeHost integration)", () => {
  beforeEach(() => {
    handlers.clear();
    listenMock.mockImplementation(
      async (event: string, handler: EventHandler) => {
        handlers.set(event, handler);
        return () => {};
      },
    );
    invokeMock.mockResolvedValue({ status: "ok", data: null });
    readThemeScriptMock.mockResolvedValue({
      status: "ok",
      data: "export function mount(c){c.dataset.theme='loaded';return{unmount(){}}}",
    });
    cancelOperationMock.mockResolvedValue({ status: "ok", data: null });
    debugLogOverlayMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    listenMock.mockReset();
    invokeMock.mockReset();
  });

  it("renders the theme-host container", async () => {
    const { container } = render(<OverlayApp />);
    await waitFor(() =>
      expect(
        container.querySelector("[data-testid='theme-host']"),
      ).toBeTruthy(),
    );
  });

  it("mounts the fetched theme module (sets data-theme='loaded')", async () => {
    render(<OverlayApp />);
    await waitFor(() =>
      expect(
        document.querySelector("[data-theme='loaded']"),
      ).toBeTruthy(),
    );
  });

  it("subscribes to all four overlay events (useOverlayState)", async () => {
    render(<OverlayApp />);
    await act(async () => {
      await Promise.resolve();
    });
    const subscribed = listenMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(subscribed).toEqual(
      expect.arrayContaining([
        "overlay://state",
        "overlay://audio-level",
        "overlay://spectrum-bins",
        "overlay://theme",
      ]),
    );
  });

  it("passes forced ?theme= query param to ThemeHost", async () => {
    const prevSearch = window.location.search;
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?theme=winamp_classic" },
      writable: true,
      configurable: true,
    });
    try {
      render(<OverlayApp />);
      await waitFor(() =>
        expect(
          document.querySelector("[data-testid='theme-host']"),
        ).toBeTruthy(),
      );
      // fetchModule should have been called with the forced theme id
      expect(readThemeScriptMock).toHaveBeenCalledWith("winamp_classic");
    } finally {
      Object.defineProperty(window, "location", {
        value: { ...window.location, search: prevSearch },
        writable: true,
        configurable: true,
      });
    }
  });

  it("delivers manifest params to theme via api.params", async () => {
    // Mock getThemeManifest to include a params object.
    getThemeManifestMock.mockResolvedValue({
      manifest_version: 2,
      id: "test_theme",
      name: "Test Theme",
      api_version: 1,
      entry: "theme.js",
      // specta skips params, but we access it at runtime via cast
      params: { speed: 2 },
    });
    // The test theme module serializes api.params into the dataset.
    readThemeScriptMock.mockResolvedValue({
      status: "ok",
      data: [
        "export function mount(c,api){",
        "  c.dataset.theme='loaded';",
        "  c.dataset.params=JSON.stringify(api.params);",
        "  return{unmount(){}}",
        "}",
      ].join("\n"),
    });
    render(<OverlayApp />);
    // Wait for the initial mount (null params), then the params
    // fetch resolves and ThemeHost remounts with {speed:2}.
    await waitFor(
      () => {
        const el = document.querySelector(
          "[data-theme='loaded']",
        ) as HTMLElement | null;
        const raw = el?.dataset.params;
        expect(raw).toBeDefined();
        expect(raw).not.toBe("null");
        const parsed = JSON.parse(raw!);
        expect(parsed).toEqual({ speed: 2 });
      },
      { timeout: 3000 },
    );
  });

  it("falls back to builtin default module when fetchModule rejects", async () => {
    readThemeScriptMock.mockResolvedValue({
      status: "error",
      error: "theme not found",
    });
    const { container } = render(<OverlayApp />);
    // Should still render theme-host (fallback mounted)
    await waitFor(() =>
      expect(
        container.querySelector("[data-testid='theme-host']"),
      ).toBeTruthy(),
    );
    // The fallback (default bars theme) renders .classic-bar-col elements
    await waitFor(
      () =>
        expect(
          container.querySelectorAll(".classic-bar-col").length,
        ).toBeGreaterThan(0),
      { timeout: 3000 },
    );
  });
});
