import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAsyncData, useAsyncDataWithRetry } from "../useAsyncData";

describe("useAsyncData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns initial value before load completes", () => {
    const fetchFn = vi.fn(() => new Promise<string[]>(() => {})); // Never resolves
    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it("loads data on mount", async () => {
    const mockData = [{ id: 1, name: "Test" }];
    const fetchFn = vi.fn().mockResolvedValue(mockData);

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBe(null);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("sets error on fetch failure", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBe("Network error");
  });

  it("handles string error", async () => {
    const fetchFn = vi.fn().mockRejectedValue("String error");

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("String error");
  });

  it("reload fetches fresh data", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce([1, 2, 3])
      .mockResolvedValueOnce([4, 5, 6]);

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual([1, 2, 3]);

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.data).toEqual([4, 5, 6]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("setData updates data manually", async () => {
    const fetchFn = vi.fn().mockResolvedValue([1, 2, 3]);

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setData([10, 20, 30]);
    });

    expect(result.current.data).toEqual([10, 20, 30]);
  });

  it("setError updates error manually", async () => {
    const fetchFn = vi.fn().mockResolvedValue([1, 2, 3]);

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setError("Manual error");
    });

    expect(result.current.error).toBe("Manual error");
  });

  it("clears error on reload", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("First error"))
      .mockResolvedValueOnce([1, 2, 3]);

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    await waitFor(() => {
      expect(result.current.error).toBe("First error");
    });

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBe(null);
    expect(result.current.data).toEqual([1, 2, 3]);
  });

  it("works with different initial values", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ name: "loaded" });

    const { result } = renderHook(() =>
      useAsyncData(fetchFn, { name: "initial" })
    );

    expect(result.current.data).toEqual({ name: "initial" });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual({ name: "loaded" });
  });

  it("handles null initial value", async () => {
    const fetchFn = vi.fn().mockResolvedValue("loaded");

    const { result } = renderHook(() => useAsyncData(fetchFn, null));

    expect(result.current.data).toBe(null);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe("loaded");
  });

  it("does not update state after unmount", async () => {
    let resolvePromise: (value: string[]) => void;
    const fetchFn = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolvePromise = resolve;
        })
    );

    const { result, unmount } = renderHook(() => useAsyncData(fetchFn, []));

    expect(result.current.loading).toBe(true);

    // Unmount before promise resolves
    unmount();

    // Resolve promise after unmount - should not throw
    resolvePromise!(["late", "data"]);

    // Wait a bit to ensure no state updates happen
    await new Promise((resolve) => setTimeout(resolve, 10));

    // No assertions needed - test passes if no errors are thrown
  });

  it("setData works with function updater", async () => {
    const fetchFn = vi.fn().mockResolvedValue([1, 2, 3]);

    const { result } = renderHook(() => useAsyncData(fetchFn, [] as number[]));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setData((prev) => [...prev, 4]);
    });

    expect(result.current.data).toEqual([1, 2, 3, 4]);
  });
});

describe("useAsyncDataWithRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds on first attempt", async () => {
    const mockData = [1, 2, 3];
    const fetchFn = vi.fn().mockResolvedValue(mockData);

    const { result } = renderHook(() =>
      useAsyncDataWithRetry(fetchFn, [])
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBe(null);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const mockData = [1, 2, 3];
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("First fail"))
      .mockRejectedValueOnce(new Error("Second fail"))
      .mockResolvedValueOnce(mockData);

    const { result } = renderHook(() =>
      useAsyncDataWithRetry(fetchFn, [], { maxRetries: 3, retryDelay: 10 })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBe(null);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("fails after max retries", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("Always fails"));

    const { result } = renderHook(() =>
      useAsyncDataWithRetry(fetchFn, [], { maxRetries: 3, retryDelay: 10 })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBe("Always fails");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("uses default retry options", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Fail"))
      .mockResolvedValueOnce([1]);

    const { result } = renderHook(() =>
      useAsyncDataWithRetry(fetchFn, [])
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual([1]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("respects custom maxRetries", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("Fail"));

    const { result } = renderHook(() =>
      useAsyncDataWithRetry(fetchFn, [], { maxRetries: 5, retryDelay: 1 })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it("reload also retries", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce([1])
      .mockRejectedValueOnce(new Error("Fail"))
      .mockResolvedValueOnce([2]);

    const { result } = renderHook(() =>
      useAsyncDataWithRetry(fetchFn, [], { maxRetries: 2, retryDelay: 10 })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual([1]);

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.data).toEqual([2]);
  });

  it("exposes setData and setError", async () => {
    const fetchFn = vi.fn().mockResolvedValue([1, 2, 3]);

    const { result } = renderHook(() =>
      useAsyncDataWithRetry(fetchFn, [])
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setData([10, 20]);
    });
    expect(result.current.data).toEqual([10, 20]);

    act(() => {
      result.current.setError("Manual error");
    });
    expect(result.current.error).toBe("Manual error");
  });

  it("does not update state after unmount", async () => {
    let rejectPromise: (err: Error) => void;
    const fetchFn = vi.fn(
      () =>
        new Promise<number[]>((_, reject) => {
          rejectPromise = reject;
        })
    );

    const { unmount } = renderHook(() =>
      useAsyncDataWithRetry(fetchFn, [], { maxRetries: 2, retryDelay: 10 })
    );

    unmount();

    // Reject after unmount - should not throw
    rejectPromise!(new Error("Late error"));

    await new Promise((resolve) => setTimeout(resolve, 50));
    // Test passes if no errors are thrown
  });
});
