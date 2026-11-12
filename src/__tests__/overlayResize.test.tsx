// Overlay shell: the corner resize affordance and the square frame.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invokeMock = vi.fn(async (_cmd: string) => null);

// The overlay webview fills its window, so the grip reads the starting edge
// from `innerWidth/innerHeight`. jsdom's default viewport is 1024x768 — pin it
// to the size the real overlay window has for this test (160).
Object.defineProperty(window, "innerWidth", { configurable: true, value: 160 });
Object.defineProperty(window, "innerHeight", { configurable: true, value: 160 });

vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../hooks/useOverlayState", () => ({
  useOverlayState: () => ({ mode: "idle", audioLevel: 0, spectrumBins: [], themeId: "default" }),
}));
vi.mock("../theme-engine/fetchModule", () => ({ fetchThemeModule: vi.fn(async () => null) }));
vi.mock("../bindings", () => ({ commands: { getThemeManifest: vi.fn(async () => null), cancelOperation: vi.fn() } }));

import { OverlayApp } from "../overlay";

describe("overlay shell — corner resize", () => {
  beforeEach(() => invokeMock.mockClear());

  it("renders both grips and a hidden square frame", () => {
    render(<OverlayApp />);
    expect(screen.getByTestId("overlay-drag-grip")).toBeTruthy();
    expect(screen.getByTestId("overlay-resize-grip")).toBeTruthy();
    const frame = screen.getByTestId("overlay-resize-frame");
    expect(frame.className).not.toContain("visible");
  });

  it("a resize drag shows the frame, asks the host to resize, and persists the edge on release", async () => {
    render(<OverlayApp />);
    const grip = screen.getByTestId("overlay-resize-grip");
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, screenX: 300, screenY: 300 });
    await waitFor(() =>
      expect(screen.getByTestId("overlay-resize-frame").className).toContain("visible"),
    );
    // +40 logical px on the dominant axis from a 160 px window.
    fireEvent.pointerMove(grip, { pointerId: 1, screenX: 340, screenY: 305 });
    await waitFor(() =>
      expect(invokeMock.mock.calls.some(([c]) => c === "resize_overlay_window")).toBe(true),
    );
    const resizeCall = invokeMock.mock.calls.find(([c]) => c === "resize_overlay_window")!;
    expect(resizeCall[1]).toEqual({ width: 200, height: 200 });
    fireEvent.pointerUp(grip, { pointerId: 1 });
    await waitFor(() =>
      expect(invokeMock.mock.calls.some(([c]) => c === "set_overlay_custom_size")).toBe(true),
    );
    expect(screen.getByTestId("overlay-resize-frame").className).not.toContain("visible");
  });

  it("double-click on the resize grip drops the custom size", async () => {
    render(<OverlayApp />);
    fireEvent.doubleClick(screen.getByTestId("overlay-resize-grip"));
    await waitFor(() =>
      expect(invokeMock.mock.calls.some(([c]) => c === "clear_overlay_custom_size")).toBe(true),
    );
  });
});
