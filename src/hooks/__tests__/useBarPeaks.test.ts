/**
 * Tests for useBarPeaks — Winamp-style peak-hold-and-decay.
 *
 * Contract (mirrors classic Winamp visualization):
 *  1. Peak snaps INSTANTLY to bar height when bar > peak (peak follows
 *     the wave upwards on every frame).
 *  2. When bar drops below peak, peak DECAYS at a fixed rate per frame
 *     (NOT proportional — classic Winamp behavior is linear gravity).
 *  3. Peak never goes below 0.
 *  4. Length follows `bars.length` (re-sizing is OK).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBarPeaks } from "../useBarPeaks";

describe("useBarPeaks", () => {
  let rafCallbacks: FrameRequestCallback[] = [];
  let rafId = 0;

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function tickFrame(timeMs: number) {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    act(() => {
      cbs.forEach((cb) => cb(timeMs));
    });
  }

  it("returns an array of the same length as input bars", () => {
    const { result } = renderHook(() =>
      useBarPeaks([0.1, 0.2, 0.3, 0.4], 0.01),
    );
    expect(result.current).toHaveLength(4);
  });

  it("peak rises instantly to bar level on first frame", () => {
    const { result, rerender } = renderHook(
      ({ bars }: { bars: number[] }) => useBarPeaks(bars, 0.01),
      { initialProps: { bars: [0.0, 0.0, 0.0] } },
    );
    rerender({ bars: [0.5, 0.7, 0.3] });
    tickFrame(16);
    expect(result.current[0]).toBeCloseTo(0.5);
    expect(result.current[1]).toBeCloseTo(0.7);
    expect(result.current[2]).toBeCloseTo(0.3);
  });

  it("peak decays by `decayPerFrame` when bar drops below peak", () => {
    const { result, rerender } = renderHook(
      ({ bars }: { bars: number[] }) => useBarPeaks(bars, 0.1),
      { initialProps: { bars: [0.8] } },
    );
    tickFrame(16);
    expect(result.current[0]).toBeCloseTo(0.8);

    // Bar drops to 0 — peak should decay linearly.
    rerender({ bars: [0.0] });
    tickFrame(32);
    expect(result.current[0]).toBeCloseTo(0.7);
    tickFrame(48);
    expect(result.current[0]).toBeCloseTo(0.6);
    tickFrame(64);
    expect(result.current[0]).toBeCloseTo(0.5);
  });

  it("peak never decays below zero", () => {
    const { result, rerender } = renderHook(
      ({ bars }: { bars: number[] }) => useBarPeaks(bars, 0.5),
      { initialProps: { bars: [0.3] } },
    );
    tickFrame(16);
    rerender({ bars: [0.0] });
    // Decay 0.5/frame over 5 frames; without clamp would be -2.2
    tickFrame(32);
    tickFrame(48);
    tickFrame(64);
    tickFrame(80);
    tickFrame(96);
    expect(result.current[0]).toBeGreaterThanOrEqual(0);
  });

  it("peak instantly re-snaps if bar exceeds current peak mid-decay", () => {
    const { result, rerender } = renderHook(
      ({ bars }: { bars: number[] }) => useBarPeaks(bars, 0.1),
      { initialProps: { bars: [0.9] } },
    );
    tickFrame(16);
    rerender({ bars: [0.0] });
    tickFrame(32);
    tickFrame(48);
    // Now peak ≈ 0.7 — push a new spike, should snap up.
    rerender({ bars: [0.95] });
    tickFrame(64);
    expect(result.current[0]).toBeCloseTo(0.95);
  });
});
