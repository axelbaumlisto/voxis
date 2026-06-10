/**
 * Tests for useOverlayState — event-driven overlay state hook.
 *
 * Aggregates four Tauri events into a single OverlaySnapshot:
 *   overlay://state         → mode
 *   overlay://audio-level   → audioLevel
 *   overlay://spectrum-bins → spectrumBins
 *   overlay://theme         → themeId
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type EventHandler = (event: { payload: unknown }) => void;

// Hoisted mock state.
const listenMock = vi.fn();
const handlers = new Map<string, EventHandler>();
const unlistens = new Map<string, ReturnType<typeof vi.fn>>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

// Import AFTER mock is registered.
import { useOverlayState } from "../useOverlayState";

function emit(event: string, payload: unknown) {
  const handler = handlers.get(event);
  if (!handler) throw new Error(`no handler registered for ${event}`);
  act(() => {
    handler({ payload });
  });
}

describe("useOverlayState", () => {
  beforeEach(() => {
    handlers.clear();
    unlistens.clear();
    listenMock.mockImplementation(async (event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      const unlisten = vi.fn();
      unlistens.set(event, unlisten);
      return unlisten;
    });
  });

  afterEach(() => {
    listenMock.mockReset();
  });

  it("returns sensible defaults before any events arrive", () => {
    const { result } = renderHook(() => useOverlayState());
    expect(result.current.mode).toBe("idle");
    expect(result.current.audioLevel).toBe(0);
    expect(result.current.spectrumBins).toHaveLength(32);
    expect(result.current.spectrumBins.every((v) => v === 0)).toBe(true);
    // transitional: all bars themes are manifest v2; DEFAULT_THEME is "default"
    // matching Rust DEFAULT_OVERLAY_THEME. Dies in Phase 6.
    expect(result.current.themeId).toBe("default");
  });

  it("subscribes to all four overlay events", async () => {
    renderHook(() => useOverlayState());
    // Yield to async listen() resolutions inside useEffect.
    await act(async () => {
      await Promise.resolve();
    });
    const subscribed = listenMock.mock.calls.map((c) => c[0]);
    expect(subscribed).toContain("overlay://state");
    expect(subscribed).toContain("overlay://audio-level");
    expect(subscribed).toContain("overlay://spectrum-bins");
    expect(subscribed).toContain("overlay://theme");
  });

  it("updates mode from overlay://state (string payload)", async () => {
    const { result } = renderHook(() => useOverlayState());
    await act(async () => {
      await Promise.resolve();
    });
    emit("overlay://state", "recording");
    expect(result.current.mode).toBe("recording");
  });

  it("updates mode from overlay://state ({ state } payload)", async () => {
    const { result } = renderHook(() => useOverlayState());
    await act(async () => {
      await Promise.resolve();
    });
    emit("overlay://state", { state: "transcribing" });
    expect(result.current.mode).toBe("transcribing");
  });

  it("updates audioLevel from overlay://audio-level", async () => {
    const { result } = renderHook(() => useOverlayState());
    await act(async () => {
      await Promise.resolve();
    });
    emit("overlay://audio-level", 0.7);
    expect(result.current.audioLevel).toBeCloseTo(0.7);
  });

  it("clamps audioLevel to [0, 1]", async () => {
    const { result } = renderHook(() => useOverlayState());
    await act(async () => {
      await Promise.resolve();
    });
    emit("overlay://audio-level", 1.5);
    expect(result.current.audioLevel).toBe(1);
    emit("overlay://audio-level", -0.2);
    expect(result.current.audioLevel).toBe(0);
  });

  it("updates spectrumBins from overlay://spectrum-bins", async () => {
    const { result } = renderHook(() => useOverlayState());
    await act(async () => {
      await Promise.resolve();
    });
    const bins = Array.from({ length: 32 }, (_, i) => i / 32);
    emit("overlay://spectrum-bins", bins);
    expect(result.current.spectrumBins).toEqual(bins);
  });

  it("ignores spectrumBins payloads of wrong length (SRP/safety)", async () => {
    const { result } = renderHook(() => useOverlayState());
    await act(async () => {
      await Promise.resolve();
    });
    const before = result.current.spectrumBins;
    emit("overlay://spectrum-bins", [1, 2, 3]);
    expect(result.current.spectrumBins).toBe(before);
  });

  it("updates themeId from overlay://theme", async () => {
    const { result } = renderHook(() => useOverlayState());
    await act(async () => {
      await Promise.resolve();
    });
    emit("overlay://theme", "living_reed");
    expect(result.current.themeId).toBe("living_reed");
  });

  it("ignores invalid mode strings (KISS — keep last known)", async () => {
    const { result } = renderHook(() => useOverlayState());
    await act(async () => {
      await Promise.resolve();
    });
    emit("overlay://state", "recording");
    emit("overlay://state", "nonsense");
    expect(result.current.mode).toBe("recording");
  });

  it("calls all unlisten functions on unmount", async () => {
    const { unmount } = renderHook(() => useOverlayState());
    await act(async () => {
      await Promise.resolve();
    });
    expect(unlistens.size).toBe(4);
    unmount();
    // Allow async unlisten callbacks to flush.
    await act(async () => {
      await Promise.resolve();
    });
    for (const u of unlistens.values()) {
      expect(u).toHaveBeenCalled();
    }
  });

  it("survives missing @tauri-apps/api/event (non-Tauri environment)", async () => {
    listenMock.mockRejectedValueOnce(new Error("no tauri"));
    const { result } = renderHook(() => useOverlayState());
    await act(async () => {
      await Promise.resolve();
    });
    // Defaults preserved, no throw.
    expect(result.current.mode).toBe("idle");
  });
});
