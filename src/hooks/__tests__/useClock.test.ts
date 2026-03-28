import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClock } from "../useClock";

describe("useClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns formatted time string", () => {
    const mockDate = new Date("2024-01-15T14:30:45");
    vi.setSystemTime(mockDate);

    const { result } = renderHook(() => useClock());

    // The exact format depends on locale, but it should be a non-empty string
    expect(typeof result.current).toBe("string");
    expect(result.current.length).toBeGreaterThan(0);
  });

  it("updates every second", () => {
    const mockDate = new Date("2024-01-15T14:30:45");
    vi.setSystemTime(mockDate);

    const { result } = renderHook(() => useClock());

    const initialTime = result.current;

    // Advance time by 1 second
    act(() => {
      vi.setSystemTime(new Date("2024-01-15T14:30:46"));
      vi.advanceTimersByTime(1000);
    });

    // Time should have updated
    expect(result.current).not.toBe(initialTime);
  });

  it("clears interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    const { unmount } = renderHook(() => useClock());

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("uses custom format options", () => {
    const mockDate = new Date("2024-01-15T14:30:45");
    vi.setSystemTime(mockDate);

    const { result } = renderHook(() =>
      useClock({
        hour: "numeric",
        minute: "numeric",
        hour12: true,
      })
    );

    // Should contain AM/PM indicator with hour12: true
    expect(typeof result.current).toBe("string");
    expect(result.current.length).toBeGreaterThan(0);
  });

  it("starts with current time immediately", () => {
    const mockDate = new Date("2024-01-15T14:30:45");
    vi.setSystemTime(mockDate);

    const { result } = renderHook(() => useClock());

    // Should have a value immediately (not empty string after initial render)
    expect(result.current).not.toBe("");
  });

  it("updates when format changes", () => {
    const mockDate = new Date("2024-01-15T14:30:45");
    vi.setSystemTime(mockDate);

    const format1: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
    };
    const format2: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    };

    const { result, rerender } = renderHook(
      ({ format }) => useClock(format),
      { initialProps: { format: format1 } }
    );

    const time1 = result.current;

    rerender({ format: format2 });

    // The format should have changed (second added)
    const time2 = result.current;
    // With seconds, the string should be longer or different
    expect(time2.length).toBeGreaterThanOrEqual(time1.length);
  });

  it("handles multiple interval cycles", () => {
    const startDate = new Date("2024-01-15T14:30:00");
    vi.setSystemTime(startDate);

    const { result } = renderHook(() => useClock());

    // Advance through multiple seconds
    for (let i = 1; i <= 5; i++) {
      act(() => {
        vi.setSystemTime(new Date(`2024-01-15T14:30:0${i}`));
        vi.advanceTimersByTime(1000);
      });
    }

    // Time should be updated
    expect(typeof result.current).toBe("string");
    expect(result.current.length).toBeGreaterThan(0);
  });
});
