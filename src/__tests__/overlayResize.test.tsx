// Overlay shell: the corner resize affordance and the square frame.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invokeMock = vi.fn(async (cmd: string): Promise<unknown> =>
  cmd === "get_overlay_window_position" ? [100, 100] : null,
);

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

import { OverlayApp, ARM_MS } from "../overlay";

const calls = (cmd: string) => invokeMock.mock.calls.filter(([c]) => c === cmd);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

describe("overlay shell — drag grip", () => {
  beforeEach(() => invokeMock.mockClear());

  it("hold → drag moves the window by the pointer delta and persists the spot", async () => {
    render(<OverlayApp />);
    const grip = screen.getByTestId("overlay-drag-grip");
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, screenX: 500, screenY: 500 });
    await sleep(ARM_MS + 50); // hold matures
    expect(grip.className).toContain("dragging");
    fireEvent.pointerMove(grip, { pointerId: 1, screenX: 530, screenY: 480 });
    await waitFor(() => expect(calls("move_overlay_window").length).toBeGreaterThan(0));
    expect(calls("move_overlay_window").at(-1)![1]).toEqual({ x: 130, y: 80 });
    fireEvent.pointerUp(grip, { pointerId: 1 });
    await waitFor(() => expect(calls("set_overlay_custom_position")).toHaveLength(1));
    expect(calls("set_overlay_custom_position")[0][1]).toEqual({ x: 130, y: 80 });
    expect(grip.className).not.toContain("dragging");
    // A move never shows the resize outline.
    expect(screen.getByTestId("overlay-resize-frame").className).not.toContain("visible");
  });

  it("a short tap passes through: no move, nothing persisted", async () => {
    render(<OverlayApp />);
    const grip = screen.getByTestId("overlay-drag-grip");
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, screenX: 500, screenY: 500 });
    fireEvent.pointerUp(grip, { pointerId: 1 });
    await sleep(ARM_MS + 50);
    expect(calls("move_overlay_window")).toHaveLength(0);
    expect(calls("set_overlay_custom_position")).toHaveLength(0);
  });

  it("double-click resets to the preset position", async () => {
    render(<OverlayApp />);
    fireEvent.doubleClick(screen.getByTestId("overlay-drag-grip"));
    await waitFor(() => expect(calls("clear_overlay_custom_position")).toHaveLength(1));
  });
});
