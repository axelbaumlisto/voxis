import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useHistory } from "../useHistory";
import { mockInvoke, mockHistoryEntries } from "../../test/mocks/tauri";

describe("useHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads history entries on mount", async () => {
    const { result } = renderHook(() => useHistory());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.entries).toEqual(mockHistoryEntries);
    expect(mockInvoke).toHaveBeenCalledWith("get_history", { limit: undefined });
  });

  it("loads history with limit", async () => {
    const { result } = renderHook(() => useHistory(10));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockInvoke).toHaveBeenCalledWith("get_history", { limit: 10 });
  });

  it("clears history calls backend", async () => {
    const { result } = renderHook(() => useHistory());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.entries.length).toBeGreaterThan(0);

    await act(async () => {
      await result.current.clear();
    });

    expect(mockInvoke).toHaveBeenCalledWith("clear_history");
    expect(result.current.entries).toEqual([]);
  });

  it("handles empty history", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_history") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useHistory());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBe(null);
  });

  it("handles load error", async () => {
    mockInvoke.mockRejectedValue(new Error("Database error"));

    const { result } = renderHook(() => useHistory());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Database error");
    expect(result.current.entries).toEqual([]);
  });

  it("handles clear error", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_history") return mockHistoryEntries;
      if (cmd === "clear_history") throw new Error("Permission denied");
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useHistory());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.clear();
    });

    expect(result.current.error).toBe("Permission denied");
  });

  it("reloads history", async () => {
    const { result } = renderHook(() => useHistory());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const initialCallCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_history"
    ).length;

    await act(async () => {
      await result.current.reload();
    });

    const finalCallCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_history"
    ).length;

    expect(finalCallCount).toBe(initialCallCount + 1);
  });

  it("returns correct entry fields", async () => {
    const { result } = renderHook(() => useHistory());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const entry = result.current.entries[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("timestamp");
    expect(entry).toHaveProperty("text");
    expect(entry).toHaveProperty("language");
    expect(entry).toHaveProperty("duration");
  });
});
