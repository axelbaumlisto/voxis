/**
 * Contract tests for useSmoothBars hook — exponential smoothing of bar levels.
 *
 * Mirrors the smoothing pattern Handy uses in RecordingOverlay.tsx:
 *   smoothed[i] = prev[i] * (1 - alpha) + input[i] * alpha
 * with alpha defaulting to 0.3 (Handy's value).
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSmoothBars } from "../useSmoothBars";

describe("useSmoothBars", () => {
  it("returns array of requested length on first call", () => {
    const { result } = renderHook(() => useSmoothBars([1, 1, 1, 1, 1], { size: 9 }));
    expect(result.current).toHaveLength(9);
  });

  it("smooths from zeros toward input on first call with alpha=0.3", () => {
    const { result } = renderHook(() =>
      useSmoothBars([1, 1, 1, 1, 1, 1, 1, 1, 1], { size: 9 }),
    );
    // prev=0, input=1, alpha=0.3 → smoothed = 0*0.7 + 1*0.3 = 0.3
    for (const v of result.current) {
      expect(v).toBeCloseTo(0.3, 5);
    }
  });

  it("converges toward input on repeated calls", () => {
    const { result, rerender } = renderHook(({ input }) => useSmoothBars(input, { size: 9 }), {
      initialProps: { input: new Array(9).fill(1) },
    });
    // First call: 0.3
    expect(result.current[0]).toBeCloseTo(0.3, 5);
    // Second: 0.3*0.7 + 1*0.3 = 0.51
    rerender({ input: new Array(9).fill(1) });
    expect(result.current[0]).toBeCloseTo(0.51, 5);
    // Third: 0.51*0.7 + 1*0.3 = 0.657
    rerender({ input: new Array(9).fill(1) });
    expect(result.current[0]).toBeCloseTo(0.657, 3);
  });

  it("truncates oversized input to requested size", () => {
    const { result } = renderHook(() =>
      useSmoothBars(new Array(32).fill(0.5), { size: 9 }),
    );
    expect(result.current).toHaveLength(9);
    for (const v of result.current) {
      expect(v).toBeCloseTo(0.15, 5); // 0 * 0.7 + 0.5 * 0.3
    }
  });

  it("pads undersized input with zeros at the tail", () => {
    const { result } = renderHook(() => useSmoothBars([1, 1, 1], { size: 9 }));
    expect(result.current.slice(0, 3).every((v) => Math.abs(v - 0.3) < 1e-5)).toBe(true);
    expect(result.current.slice(3).every((v) => v === 0)).toBe(true);
  });

  it("honors custom alpha", () => {
    const { result } = renderHook(() =>
      useSmoothBars([1, 1, 1, 1, 1, 1, 1, 1, 1], { size: 9, alpha: 0.5 }),
    );
    // 0 * 0.5 + 1 * 0.5 = 0.5
    for (const v of result.current) {
      expect(v).toBeCloseTo(0.5, 5);
    }
  });

  it("size=0 returns empty array", () => {
    const { result } = renderHook(() => useSmoothBars([1, 1, 1], { size: 0 }));
    expect(result.current).toEqual([]);
  });

  it("ignores invalid input (non-array) and keeps previous state", () => {
    const { result, rerender } = renderHook(
      ({ input }: { input: number[] | null }) =>
        useSmoothBars(input, { size: 4 }),
      { initialProps: { input: [1, 1, 1, 1] as number[] | null } },
    );
    expect(result.current[0]).toBeCloseTo(0.3, 5);
    rerender({ input: null });
    // No change: prev preserved
    expect(result.current[0]).toBeCloseTo(0.3, 5);
  });

  it("decay: input back to zero pulls smoothed down", () => {
    const { result, rerender } = renderHook(({ input }) => useSmoothBars(input, { size: 3 }), {
      initialProps: { input: [1, 1, 1] },
    });
    // a few rounds at 1 to push smoothed up
    for (let i = 0; i < 10; i++) {
      rerender({ input: [1, 1, 1] });
    }
    const high = result.current[0];
    expect(high).toBeGreaterThan(0.9);
    // then input drops to 0
    rerender({ input: [0, 0, 0] });
    expect(result.current[0]).toBeLessThan(high);
    expect(result.current[0]).toBeCloseTo(high * 0.7, 3);
  });

  it("preserves smoothed state across the component lifetime via ref", () => {
    // Sanity check: useRef-backed buffer survives re-renders without resetting.
    const { result, rerender } = renderHook(({ input }) => useSmoothBars(input, { size: 2 }), {
      initialProps: { input: [1, 1] },
    });
    const first = result.current[0];
    act(() => {
      rerender({ input: [1, 1] });
    });
    expect(result.current[0]).toBeGreaterThan(first);
  });
});
