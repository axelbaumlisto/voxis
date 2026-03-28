import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDictionary } from "../useDictionary";
import { mockInvoke, mockDictionaryEntries } from "../../test/mocks/tauri";

describe("useDictionary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads dictionary on mount", async () => {
    const { result } = renderHook(() => useDictionary());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.entries).toEqual(mockDictionaryEntries);
    expect(mockInvoke).toHaveBeenCalledWith("get_dictionary");
  });

  it("adds entry with source and replacement", async () => {
    const { result } = renderHook(() => useDictionary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.add("тдд", "TDD");
    });

    expect(mockInvoke).toHaveBeenCalledWith("add_dictionary_entry", {
      source: "тдд",
      replacement: "TDD",
    });

    // Should reload after add
    const reloadCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_dictionary"
    );
    expect(reloadCalls.length).toBeGreaterThan(1);
  });

  it("updates entry", async () => {
    const { result } = renderHook(() => useDictionary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.update(1, "солидный", "SOLID");
    });

    expect(mockInvoke).toHaveBeenCalledWith("update_dictionary_entry", {
      id: 1,
      source: "солидный",
      replacement: "SOLID",
    });
  });

  it("deletes entry", async () => {
    const { result } = renderHook(() => useDictionary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.remove(1);
    });

    expect(mockInvoke).toHaveBeenCalledWith("delete_dictionary_entry", {
      id: 1,
    });
  });

  it("refreshes after CRUD operations", async () => {
    const { result } = renderHook(() => useDictionary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const initialLoadCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_dictionary"
    ).length;

    // Add
    await act(async () => {
      await result.current.add("test", "TEST");
    });

    let currentCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_dictionary"
    ).length;
    expect(currentCount).toBe(initialLoadCount + 1);

    // Update
    await act(async () => {
      await result.current.update(1, "updated", "UPDATED");
    });

    currentCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_dictionary"
    ).length;
    expect(currentCount).toBe(initialLoadCount + 2);

    // Delete
    await act(async () => {
      await result.current.remove(1);
    });

    currentCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_dictionary"
    ).length;
    expect(currentCount).toBe(initialLoadCount + 3);
  });

  it("handles load error", async () => {
    mockInvoke.mockRejectedValue(new Error("Failed to load dictionary"));

    const { result } = renderHook(() => useDictionary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load dictionary");
    expect(result.current.entries).toEqual([]);
  });

  it("handles add error", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_dictionary") return mockDictionaryEntries;
      if (cmd === "add_dictionary_entry") {
        throw new Error("Duplicate entry");
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useDictionary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      try {
        await result.current.add("солид", "SOLID");
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe("Duplicate entry");
  });

  it("handles update error", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_dictionary") return mockDictionaryEntries;
      if (cmd === "update_dictionary_entry") {
        throw new Error("Entry not found");
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useDictionary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      try {
        await result.current.update(999, "test", "TEST");
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe("Entry not found");
  });

  it("handles delete error", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_dictionary") return mockDictionaryEntries;
      if (cmd === "delete_dictionary_entry") {
        throw new Error("Cannot delete");
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useDictionary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      try {
        await result.current.remove(1);
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe("Cannot delete");
  });

  it("returns correct entry fields", async () => {
    const { result } = renderHook(() => useDictionary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const entry = result.current.entries[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("source");
    expect(entry).toHaveProperty("replacement");
  });
});
