import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePendingSuggestions } from "../usePendingSuggestions";
import { mockInvoke, resetMocks } from "../../test/mocks/tauri";
import { PendingSuggestion } from "../../lib/commands";

const mockSuggestions: PendingSuggestion[] = [
  {
    id: 1,
    original_text: "солид",
    suggested_replacement: "SOLID",
    context: "discussing architecture",
    frequency: 3,
    created_at: "2024-01-15 10:00:00",
  },
  {
    id: 2,
    original_text: "кисс",
    suggested_replacement: "KISS",
    context: "design principles",
    frequency: 2,
    created_at: "2024-01-15 11:00:00",
  },
];

describe("usePendingSuggestions", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("Loading", () => {
    it("loads suggestions on mount", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_pending_suggestions") {
          return [...mockSuggestions];
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.suggestions).toEqual(mockSuggestions);
    });

    it("returns loading state initially", () => {
      mockInvoke.mockImplementation(async () => new Promise(() => {}));

      const { result } = renderHook(() => usePendingSuggestions());

      expect(result.current.loading).toBe(true);
      expect(result.current.suggestions).toEqual([]);
    });

    it("handles load error", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_pending_suggestions") {
          throw new Error("Failed to load suggestions");
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe("Failed to load suggestions");
      expect(result.current.suggestions).toEqual([]);
    });
  });

  describe("approve", () => {
    it("calls approveSuggestion and reloads", async () => {
      let approved = false;
      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_pending_suggestions") {
          return approved ? [] : [...mockSuggestions];
        }
        if (cmd === "approve_suggestion") {
          expect(args?.id).toBe(1);
          approved = true;
          return undefined;
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.approve(1);
      });

      expect(mockInvoke).toHaveBeenCalledWith("approve_suggestion", { id: 1 });
      expect(result.current.suggestions).toEqual([]);
    });

    it("handles approve error", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_pending_suggestions") {
          return [...mockSuggestions];
        }
        if (cmd === "approve_suggestion") {
          throw new Error("Approval failed");
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.approve(1);
        } catch (err) {
          caughtError = err as Error;
        }
      });

      expect(caughtError?.message).toBe("Approval failed");
      // Error should be set in the hook state
      await waitFor(() => {
        expect(result.current.error).toBe("Approval failed");
      });
    });
  });

  describe("reject", () => {
    it("calls rejectSuggestion and reloads", async () => {
      let rejected = false;
      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_pending_suggestions") {
          return rejected ? [mockSuggestions[0]] : [...mockSuggestions];
        }
        if (cmd === "reject_suggestion") {
          expect(args?.id).toBe(2);
          rejected = true;
          return undefined;
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.reject(2);
      });

      expect(mockInvoke).toHaveBeenCalledWith("reject_suggestion", { id: 2 });
      expect(result.current.suggestions).toEqual([mockSuggestions[0]]);
    });

    it("handles reject error", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_pending_suggestions") {
          return [...mockSuggestions];
        }
        if (cmd === "reject_suggestion") {
          throw new Error("Rejection failed");
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.reject(1);
        } catch (err) {
          caughtError = err as Error;
        }
      });

      expect(caughtError?.message).toBe("Rejection failed");
      await waitFor(() => {
        expect(result.current.error).toBe("Rejection failed");
      });
    });
  });

  describe("approveAll", () => {
    it("approves all suggestions in sequence", async () => {
      const approvedIds: number[] = [];
      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "get_pending_suggestions") {
          return approvedIds.length === 2 ? [] : [...mockSuggestions];
        }
        if (cmd === "approve_suggestion") {
          approvedIds.push(args?.id as number);
          return undefined;
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.approveAll();
      });

      expect(approvedIds).toContain(1);
      expect(approvedIds).toContain(2);
      expect(result.current.suggestions).toEqual([]);
    });
  });

  describe("reload", () => {
    it("fetches fresh data", async () => {
      let callCount = 0;
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_pending_suggestions") {
          callCount++;
          return callCount === 1 ? [...mockSuggestions] : [];
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.suggestions).toEqual(mockSuggestions);

      await act(async () => {
        await result.current.reload();
      });

      expect(result.current.suggestions).toEqual([]);
    });
  });

  describe("generateFromHistory", () => {
    it("calls reprocessHistoryForSuggestions", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_pending_suggestions") {
          return [];
        }
        if (cmd === "reprocess_history_for_suggestions") {
          return { processed: 10, suggestions_found: 3, recorded: 3, promoted: 0, skipped: 7 };
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let reprocessResult;
      await act(async () => {
        reprocessResult = await result.current.generateFromHistory(50);
      });

      expect(reprocessResult).toEqual({
        processed: 10,
        suggestions_found: 3,
        recorded: 3,
        promoted: 0,
        skipped: 7,
      });
      expect(mockInvoke).toHaveBeenCalledWith("reprocess_history_for_suggestions", {
        limit: 50,
      });
    });

    it("sets generating state during generation", async () => {
      let resolvePromise: (value: unknown) => void;
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_pending_suggestions") {
          return [];
        }
        if (cmd === "reprocess_history_for_suggestions") {
          return new Promise((resolve) => {
            resolvePromise = resolve;
          });
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Start generation
      let generatePromise: Promise<unknown>;
      act(() => {
        generatePromise = result.current.generateFromHistory();
      });

      // Should be generating
      expect(result.current.generating).toBe(true);

      // Resolve the promise
      await act(async () => {
        resolvePromise!({ processed: 5, suggestions_found: 1, recorded: 1, promoted: 0, skipped: 4 });
        await generatePromise;
      });

      // Should no longer be generating
      expect(result.current.generating).toBe(false);
    });

    it("reloads suggestions after generation", async () => {
      let callCount = 0;
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_pending_suggestions") {
          callCount++;
          return callCount > 1 ? [...mockSuggestions] : [];
        }
        if (cmd === "reprocess_history_for_suggestions") {
          return { processed: 5, suggestions_found: 2, recorded: 2, promoted: 0, skipped: 3 };
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.suggestions).toEqual([]);

      await act(async () => {
        await result.current.generateFromHistory();
      });

      expect(result.current.suggestions).toEqual(mockSuggestions);
    });

    it("handles generation error", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_pending_suggestions") {
          return [];
        }
        if (cmd === "reprocess_history_for_suggestions") {
          throw new Error("Generation failed");
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.generateFromHistory();
        } catch (err) {
          caughtError = err as Error;
        }
      });

      expect(caughtError?.message).toBe("Generation failed");
      await waitFor(() => {
        expect(result.current.error).toBe("Generation failed");
      });
      expect(result.current.generating).toBe(false);
    });
  });

  describe("getById", () => {
    it("returns suggestion by id", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_pending_suggestions") {
          return [...mockSuggestions];
        }
        return undefined;
      });

      const { result } = renderHook(() => usePendingSuggestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.getById(1)).toEqual(mockSuggestions[0]);
      expect(result.current.getById(2)).toEqual(mockSuggestions[1]);
      expect(result.current.getById(999)).toBeUndefined();
    });
  });
});
