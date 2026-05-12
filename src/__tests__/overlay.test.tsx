/**
 * Tests for the overlay webview entry component.
 *
 * Post-Handy-port architecture: OverlayApp is a thin shell composing
 * `useOverlayState` + `useTheme` + `<OverlayCanvas>`. The behavioural
 * contract is exercised at the hook/component layer; this suite only
 * verifies the shell wiring (root className, theme/family data-attrs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

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

// Stub the canvas — its own unit tests cover routing semantics.
vi.mock("../components/overlay/OverlayCanvas", () => ({
  default: ({ snapshot, theme }: { snapshot: { mode: string; themeId: string }; theme: { id: string; family: string } | null }) => (
    <div
      data-testid="overlay-canvas-stub"
      data-mode={snapshot.mode}
      data-theme={theme?.id ?? snapshot.themeId}
      data-family={theme?.family ?? "loading"}
    />
  ),
}));

import { OverlayApp } from "../overlay";

describe("OverlayApp", () => {
  beforeEach(() => {
    handlers.clear();
    listenMock.mockImplementation(async (event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return () => {};
    });
    // Default: getOverlayThemeData rejects → useTheme stays at null
    invokeMock.mockRejectedValue(new Error("test theme not loaded"));
  });

  afterEach(() => {
    listenMock.mockReset();
    invokeMock.mockReset();
  });

  it("mounts with idle mode and exposes data attributes", () => {
    render(<OverlayApp />);
    const root = screen.getByTestId("overlay-root");
    expect(root.className).toContain("overlay-idle");
    expect(root.dataset.theme).toBe("winamp_classic"); // default
    expect(root.dataset.family).toBe("loading"); // useTheme rejected
  });

  it("subscribes to all four overlay events", async () => {
    render(<OverlayApp />);
    await act(async () => {
      await Promise.resolve();
    });
    const subscribed = listenMock.mock.calls.map((c) => c[0]);
    expect(subscribed).toEqual(
      expect.arrayContaining([
        "overlay://state",
        "overlay://audio-level",
        "overlay://spectrum-bins",
        "overlay://theme",
      ]),
    );
  });

  it("updates root className when state event arrives", async () => {
    render(<OverlayApp />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      handlers.get("overlay://state")!({ payload: "recording" });
    });
    expect(screen.getByTestId("overlay-root").className).toContain("overlay-recording");
  });

  it("forwards mode to OverlayCanvas via snapshot prop", async () => {
    render(<OverlayApp />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      handlers.get("overlay://state")!({ payload: { state: "transcribing" } });
    });
    expect(screen.getByTestId("overlay-canvas-stub").dataset.mode).toBe("transcribing");
  });

  it("survives missing Tauri APIs (non-Tauri environment)", async () => {
    listenMock.mockRejectedValueOnce(new Error("not in Tauri"));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<OverlayApp />);
    await act(async () => {
      await Promise.resolve();
    });
    // Renders without crashing, stays at defaults.
    expect(screen.getByTestId("overlay-root")).toBeInTheDocument();
    consoleWarn.mockRestore();
  });
});
