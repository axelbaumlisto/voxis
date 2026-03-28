import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTauriEvent, useTauriEvents } from "../useTauriEvent";

// Mock the Tauri event API
const mockUnlisten = vi.fn();
const mockListen = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

describe("useTauriEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(mockUnlisten);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to event on mount", async () => {
    const handler = vi.fn();

    renderHook(() => useTauriEvent("test-event", handler));

    // Wait for async setup
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith("test-event", expect.any(Function));
  });

  it("unsubscribes on unmount", async () => {
    const handler = vi.fn();

    const { unmount } = renderHook(() => useTauriEvent("test-event", handler));

    // Wait for async setup
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    unmount();

    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  it("calls handler with event payload", async () => {
    const handler = vi.fn();
    let capturedCallback: ((event: { payload: unknown }) => void) | null = null;

    mockListen.mockImplementation((_eventName, callback) => {
      capturedCallback = callback;
      return Promise.resolve(mockUnlisten);
    });

    renderHook(() => useTauriEvent<string>("test-event", handler));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Simulate event
    act(() => {
      capturedCallback?.({ payload: "test-payload" });
    });

    expect(handler).toHaveBeenCalledWith("test-payload");
  });

  it("updates handler ref when handler changes", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    let capturedCallback: ((event: { payload: unknown }) => void) | null = null;

    mockListen.mockImplementation((_eventName, callback) => {
      capturedCallback = callback;
      return Promise.resolve(mockUnlisten);
    });

    const { rerender } = renderHook(
      ({ handler }) => useTauriEvent<string>("test-event", handler),
      { initialProps: { handler: handler1 } }
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Rerender with new handler
    rerender({ handler: handler2 });

    // Simulate event - should call handler2, not handler1
    act(() => {
      capturedCallback?.({ payload: "data" });
    });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledWith("data");
  });

  it("re-subscribes when eventName changes", async () => {
    const handler = vi.fn();

    const { rerender } = renderHook(
      ({ eventName }) => useTauriEvent(eventName, handler),
      { initialProps: { eventName: "event-1" } }
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockListen).toHaveBeenCalledWith("event-1", expect.any(Function));

    rerender({ eventName: "event-2" });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockUnlisten).toHaveBeenCalled();
    expect(mockListen).toHaveBeenCalledWith("event-2", expect.any(Function));
  });

  it("re-subscribes when deps change", async () => {
    const handler = vi.fn();

    const { rerender } = renderHook(
      ({ dep }) => useTauriEvent("event", handler, [dep]),
      { initialProps: { dep: 1 } }
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const initialCallCount = mockListen.mock.calls.length;

    rerender({ dep: 2 });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockListen.mock.calls.length).toBeGreaterThan(initialCallCount);
  });
});

describe("useTauriEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(mockUnlisten);
  });

  it("subscribes to multiple events", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    renderHook(() =>
      useTauriEvents([
        ["event-1", handler1],
        ["event-2", handler2],
      ])
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockListen).toHaveBeenCalledTimes(2);
    expect(mockListen).toHaveBeenCalledWith("event-1", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("event-2", expect.any(Function));
  });

  it("unsubscribes all events on unmount", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const { unmount } = renderHook(() =>
      useTauriEvents([
        ["event-1", handler1],
        ["event-2", handler2],
      ])
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    unmount();

    // Wait for cleanup
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockUnlisten).toHaveBeenCalledTimes(2);
  });

  it("calls correct handler for each event", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const callbacks: Map<string, (event: { payload: unknown }) => void> =
      new Map();

    mockListen.mockImplementation((eventName, callback) => {
      callbacks.set(eventName, callback);
      return Promise.resolve(mockUnlisten);
    });

    renderHook(() =>
      useTauriEvents([
        ["event-1", handler1],
        ["event-2", handler2],
      ])
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Simulate events
    act(() => {
      callbacks.get("event-1")?.({ payload: "payload-1" });
      callbacks.get("event-2")?.({ payload: "payload-2" });
    });

    expect(handler1).toHaveBeenCalledWith("payload-1");
    expect(handler2).toHaveBeenCalledWith("payload-2");
  });
});
