/**
 * Unit tests for the overlay webview entry component.
 *
 * Verifies that OverlayApp mounts safely, subscribes to overlay://state,
 * and updates `mode` class on event payloads (string or { state }).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// Hoisted mock state — captured by vi.mock factory at module init.
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

// Waveform is heavy (polls audio level) — stub to a static element.
vi.mock("../components/Waveform", () => ({
  default: ({ mode }: { mode: string }) => (
    <div data-testid="waveform" data-mode={mode} />
  ),
}));

// Import AFTER mocks are registered.
import { OverlayApp } from "../overlay";

describe("OverlayApp", () => {
  let capturedHandler: ((event: { payload: unknown }) => void) | null = null;

  beforeEach(() => {
    capturedHandler = null;
    listenMock.mockImplementation(async (_event, handler) => {
      capturedHandler = handler as (event: { payload: unknown }) => void;
      return () => {}; // unlisten
    });
  });

  afterEach(() => {
    listenMock.mockReset();
  });

  it("mounts with idle mode by default", () => {
    render(<OverlayApp />);
    const overlay = document.querySelector(".overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain("overlay-idle");
  });

  it("subscribes to overlay://state event", () => {
    render(<OverlayApp />);
    expect(listenMock).toHaveBeenCalledWith("overlay://state", expect.any(Function));
  });

  it("updates mode from string payload", async () => {
    render(<OverlayApp />);
    // Wait for listen() promise to resolve and handler to be captured.
    await vi.waitFor(() => expect(capturedHandler).not.toBeNull());

    await act(async () => {
      capturedHandler!({ payload: "recording" });
    });

    const waveform = screen.getByTestId("waveform");
    expect(waveform.dataset.mode).toBe("recording");
  });

  it("updates mode from { state } object payload", async () => {
    render(<OverlayApp />);
    await vi.waitFor(() => expect(capturedHandler).not.toBeNull());

    await act(async () => {
      capturedHandler!({ payload: { state: "transcribing" } });
    });

    expect(screen.getByTestId("waveform").dataset.mode).toBe("transcribing");
  });

  it("ignores malformed payloads gracefully", async () => {
    render(<OverlayApp />);
    await vi.waitFor(() => expect(capturedHandler).not.toBeNull());

    await act(async () => {
      capturedHandler!({ payload: null });
      capturedHandler!({ payload: 42 });
      capturedHandler!({ payload: { not_state: "x" } });
    });

    // Mode unchanged → still idle
    expect(screen.getByTestId("waveform").dataset.mode).toBe("idle");
  });

  it("survives listen() rejection without crashing", async () => {
    listenMock.mockRejectedValueOnce(new Error("not in Tauri"));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<OverlayApp />);

    // Component still renders even when subscription fails.
    expect(screen.getByTestId("waveform")).toBeInTheDocument();
    consoleWarn.mockRestore();
  });
});
