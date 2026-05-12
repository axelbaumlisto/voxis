/**
 * Smoke tests for the overlay webview entry shell.
 *
 * HandyPill is stubbed; this suite only verifies that the shell wires the
 * snapshot + smoothed bars + cancel command into HandyPill.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen } from "@testing-library/react";

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

vi.mock("../components/overlay/HandyPill", () => ({
  default: ({
    mode,
    bars,
    visible,
    onCancel,
  }: {
    mode: string;
    bars: number[];
    visible: boolean;
    onCancel?: () => void;
  }) => (
    <div
      data-testid="handy-pill-stub"
      data-mode={mode}
      data-visible={String(visible)}
      data-bar-count={bars.length}
      data-bar-sample={bars[0] ?? 0}
      onClick={() => onCancel?.()}
    />
  ),
}));

import { OverlayApp } from "../overlay";

describe("OverlayApp (HandyPill shell)", () => {
  beforeEach(() => {
    handlers.clear();
    listenMock.mockImplementation(async (event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return () => {};
    });
    invokeMock.mockResolvedValue({ status: "ok", data: null });
  });

  afterEach(() => {
    listenMock.mockReset();
    invokeMock.mockReset();
  });

  it("renders HandyPill with idle mode, hidden, 9 bars by default", () => {
    render(<OverlayApp />);
    const pill = screen.getByTestId("handy-pill-stub");
    expect(pill.dataset.mode).toBe("idle");
    expect(pill.dataset.visible).toBe("false");
    expect(Number(pill.dataset.barCount)).toBe(9);
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

  it("becomes visible when state moves out of idle", async () => {
    render(<OverlayApp />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      handlers.get("overlay://state")!({ payload: "recording" });
    });
    const pill = screen.getByTestId("handy-pill-stub");
    expect(pill.dataset.mode).toBe("recording");
    expect(pill.dataset.visible).toBe("true");
  });

  it("forwards smoothed spectrum bins (length 9) to HandyPill", async () => {
    render(<OverlayApp />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      const bins = new Array(32).fill(1);
      handlers.get("overlay://spectrum-bins")!({ payload: bins });
    });
    const pill = screen.getByTestId("handy-pill-stub");
    expect(Number(pill.dataset.barCount)).toBe(9);
    // First call: 0*0.7 + 1*0.3 = 0.3
    expect(Number(pill.dataset.barSample)).toBeCloseTo(0.3, 3);
  });

  it("calls cancel_operation when HandyPill triggers onCancel", async () => {
    render(<OverlayApp />);
    await act(async () => {
      await Promise.resolve();
    });
    const pill = screen.getByTestId("handy-pill-stub");
    pill.click();
    expect(invokeMock).toHaveBeenCalledWith("cancel_operation");
  });
});
