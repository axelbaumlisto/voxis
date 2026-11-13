/**
 * Integration tests for the overlay webview entry shell.
 *
 * OverlayApp now delegates to ThemeHost — all visual logic lives in theme
 * modules. This suite verifies the wiring: useOverlayState → ThemeHost with
 * fetchModule/fallbackModule/cancel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act, fireEvent } from "@testing-library/react";

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
const manualStartMock = vi.fn().mockResolvedValue({ status: "ok", data: null });
const manualStopMock = vi.fn().mockResolvedValue({ status: "ok", data: null });

vi.mock("../bindings", () => ({
  commands: {
    readThemeScript: (...args: unknown[]) => readThemeScriptMock(...args),
    getThemeManifest: (...args: unknown[]) => getThemeManifestMock(...args),
    cancelOperation: (...args: unknown[]) => cancelOperationMock(...args),
    debugLogOverlay: (...args: unknown[]) => debugLogOverlayMock(...args),
    getCurrentOverlayTheme: (...args: unknown[]) => getCurrentOverlayThemeMock(...args),
    manualStartRecording: (...args: unknown[]) => manualStartMock(...args),
    manualStopRecording: (...args: unknown[]) => manualStopMock(...args),
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────

import { OverlayApp, ARM_MS } from "../overlay";
import { IDLE_HIDE_MS, LEAVE_CONFIRM_MS } from "../overlay/useHandleVisibility";

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
    manualStartMock.mockClear();
    manualStartMock.mockResolvedValue({ status: "ok", data: null });
    manualStopMock.mockClear();
    manualStopMock.mockResolvedValue({ status: "ok", data: null });
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

  describe("OverlayApp hold-to-dictate", () => {
    it("pointerdown on the overlay starts recording", async () => {
      const { container } = render(<OverlayApp />);
      const host = container.querySelector("[data-press-target]") as HTMLElement;
      expect(host).toBeTruthy();
      await act(async () => {
        host.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
      expect(manualStartMock).toHaveBeenCalledTimes(1);
    });
    it("pointerup stops recording", async () => {
      const { container } = render(<OverlayApp />);
      const host = container.querySelector("[data-press-target]") as HTMLElement;
      await act(async () => {
        host.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        host.dispatchEvent(new Event("pointerup", { bubbles: true }));
      });
      expect(manualStartMock).toHaveBeenCalledTimes(1);
      expect(manualStopMock).toHaveBeenCalledTimes(1);
    });
    it("contextmenu is prevented (no long-press menu on touch / right-click)", async () => {
      const { container } = render(<OverlayApp />);
      const host = container.querySelector("[data-press-target]") as HTMLElement;
      const ev = new Event("contextmenu", { bubbles: true, cancelable: true });
      host.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    });
  });

  describe("window-size tracking", () => {
    let origInnerWidth: number;
    let origInnerHeight: number;

    beforeEach(() => {
      origInnerWidth = window.innerWidth;
      origInnerHeight = window.innerHeight;
    });

    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        value: origInnerWidth,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: origInnerHeight,
        writable: true,
        configurable: true,
      });
    });

    it("passes window.innerWidth/innerHeight as ThemeHost width/height", async () => {
      Object.defineProperty(window, "innerWidth", {
        value: 160,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: 160,
        writable: true,
        configurable: true,
      });
      const { container } = render(<OverlayApp />);
      await waitFor(() => {
        const host = container.querySelector(
          "[data-testid='theme-host']",
        ) as HTMLElement | null;
        expect(host).toBeTruthy();
        expect(host!.style.width).toBe("160px");
        expect(host!.style.height).toBe("160px");
      });
    });

    it("falls back to ThemeHost defaults when innerWidth is 0", async () => {
      Object.defineProperty(window, "innerWidth", {
        value: 0,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: 0,
        writable: true,
        configurable: true,
      });
      const { container } = render(<OverlayApp />);
      await waitFor(() => {
        const host = container.querySelector(
          "[data-testid='theme-host']",
        ) as HTMLElement | null;
        expect(host).toBeTruthy();
        // ThemeHost defaults: width=172, height=36
        expect(host!.style.width).toBe("172px");
        expect(host!.style.height).toBe("36px");
      });
    });
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

// ── Hover-handle visibility & no-blink-while-dragging ────────────────────
describe("OverlayApp hover-handle visibility", () => {
  beforeEach(() => {
    handlers.clear();
    document.body.classList.remove("pointer-inside");
    listenMock.mockImplementation(
      async (event: string, handler: EventHandler) => {
        handlers.set(event, handler);
        return () => {};
      },
    );
    invokeMock.mockReset();
    // get_overlay_window_position must resolve to a tuple; everything else ok.
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "get_overlay_window_position"
        ? [100, 100]
        : { status: "ok", data: null },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    listenMock.mockReset();
    invokeMock.mockReset();
    document.body.classList.remove("pointer-inside");
  });

  const emitInside = async (payload: boolean) => {
    await act(async () => {
      await handlers.get("overlay://pointer-inside")?.({ payload });
    });
  };

  const mounted = async () => {
    render(<OverlayApp />);
    // let the pointer-inside listener subscribe
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(handlers.has("overlay://pointer-inside")).toBe(true),
    );
  };

  it("reveals the handles on a pointer-inside=true ping", async () => {
    await mounted();
    expect(document.body.classList.contains("pointer-inside")).toBe(false);
    await emitInside(true);
    expect(document.body.classList.contains("pointer-inside")).toBe(true);
  });

  it("auto-hides the handles after the idle timeout with no further pings", async () => {
    await mounted();
    // Enable fake timers BEFORE the ping so the idle hide is a fake timer we
    // can advance deterministically.
    vi.useFakeTimers();
    await emitInside(true);
    expect(document.body.classList.contains("pointer-inside")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(IDLE_HIDE_MS + 50);
    });
    expect(document.body.classList.contains("pointer-inside")).toBe(false);
  });

  it("a leave hides only after the confirm window", async () => {
    await mounted();
    vi.useFakeTimers();
    await emitInside(true);
    await emitInside(false);
    expect(document.body.classList.contains("pointer-inside")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(LEAVE_CONFIRM_MS + 20);
    });
    expect(document.body.classList.contains("pointer-inside")).toBe(false);
  });

  it("a spurious leave→enter pair does not blink", async () => {
    await mounted();
    vi.useFakeTimers();
    await emitInside(true);
    await emitInside(false);
    await act(async () => {
      vi.advanceTimersByTime(LEAVE_CONFIRM_MS / 3);
    });
    await emitInside(true);
    await act(async () => {
      vi.advanceTimersByTime(LEAVE_CONFIRM_MS * 2);
    });
    expect(document.body.classList.contains("pointer-inside")).toBe(true);
  });

  it("keeps the handles pinned for the whole drag — no blink even past the idle timeout", async () => {
    await mounted();
    const grip = document.querySelector(
      "[data-testid='overlay-drag-grip']",
    ) as HTMLElement;
    expect(grip).toBeTruthy();

    // Start the drag: onInteracting(true) fires immediately on pointerdown.
    await act(async () => {
      fireEvent.pointerDown(grip, { button: 0, pointerId: 1, screenX: 0, screenY: 0 });
      await Promise.resolve();
    });
    expect(document.body.classList.contains("pointer-inside")).toBe(true);
    // The square outline frame must NOT show during a MOVE — repainting a 1px
    // edge frame on every per-frame reposition flickers; the orb shows position.
    const frame = document.querySelector(
      "[data-testid='overlay-resize-frame']",
    ) as HTMLElement;
    expect(frame.className).not.toContain("visible");

    // Hold well past the idle timeout — the DOM pointer-capture swallows the
    // GTK motion pings, but the handles must stay pinned (this is the blink fix).
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(ARM_MS + IDLE_HIDE_MS * 3);
    });
    expect(document.body.classList.contains("pointer-inside")).toBe(true);

    // Release → idle countdown resumes → handles fade after the idle timeout.
    await act(async () => {
      fireEvent.pointerUp(grip, { pointerId: 1 });
    });
    expect(document.body.classList.contains("pointer-inside")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(IDLE_HIDE_MS + 50);
    });
    expect(document.body.classList.contains("pointer-inside")).toBe(false);
  });

  it("shows the square outline frame during a RESIZE (where the window edge matters)", async () => {
    await mounted();
    const grip = document.querySelector(
      "[data-testid='overlay-resize-grip']",
    ) as HTMLElement;
    const frame = document.querySelector(
      "[data-testid='overlay-resize-frame']",
    ) as HTMLElement;
    expect(frame.className).not.toContain("visible");

    await act(async () => {
      fireEvent.pointerDown(grip, { button: 0, pointerId: 2, screenX: 0, screenY: 0 });
      await Promise.resolve();
    });
    expect(frame.className).toContain("visible");
    // handles are pinned during resize too
    expect(document.body.classList.contains("pointer-inside")).toBe(true);

    await act(async () => {
      fireEvent.pointerUp(grip, { pointerId: 2 });
    });
    expect(frame.className).not.toContain("visible");
  });
});
