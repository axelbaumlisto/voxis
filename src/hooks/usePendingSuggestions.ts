import { useState, useCallback } from "react";
import {
  getPendingSuggestions,
  approveSuggestion,
  rejectSuggestion,
  reprocessHistoryForSuggestions,
  PendingSuggestion,
  ReprocessResult,
} from "../lib/commands";
import { useAsyncData } from "./useAsyncData";
import { useAsyncAction } from "./useAsyncAction";
import { getErrorMessage } from "../lib/errors";

interface UsePendingSuggestionsResult {
  suggestions: PendingSuggestion[];
  /** Alias for suggestions (LSP compliance) */
  items: PendingSuggestion[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  approve: (id: number) => Promise<void>;
  reject: (id: number) => Promise<void>;
  approveAll: () => Promise<void>;
  generateFromHistory: (limit?: number) => Promise<ReprocessResult>;
  generating: boolean;
  getById: (id: number) => PendingSuggestion | undefined;
}

/**
 * Hook for managing pending dictionary suggestions.
 */
export function usePendingSuggestions(): UsePendingSuggestionsResult {
  const {
    data: suggestions,
    loading,
    error,
    setError,
    reload,
  } = useAsyncData(getPendingSuggestions, []);

  const [generating, setGenerating] = useState(false);

  // DRY: Use useAsyncAction for consistent error handling
  const approve = useAsyncAction(
    async (id: number) => {
      await approveSuggestion(id);
    },
    { reload, setError }
  );

  const reject = useAsyncAction(
    async (id: number) => {
      await rejectSuggestion(id);
    },
    { reload, setError }
  );

  const approveAll = useAsyncAction(
    async () => {
      // Approve all in sequence
      for (const suggestion of suggestions) {
        await approveSuggestion(suggestion.id);
      }
    },
    { reload, setError },
    [suggestions]
  );

  const generateFromHistory = useCallback(
    async (limit?: number): Promise<ReprocessResult> => {
      setGenerating(true);
      setError(null);
      try {
        const result = await reprocessHistoryForSuggestions(limit);
        await reload();
        return result;
      } catch (err) {
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setGenerating(false);
      }
    },
    [reload, setError]
  );

  const getById = useCallback(
    (id: number) => {
      return suggestions.find((s) => s.id === id);
    },
    [suggestions]
  );

  return {
    suggestions,
    items: suggestions, // LSP alias
    loading,
    error,
    reload,
    approve,
    reject,
    approveAll,
    generateFromHistory,
    generating,
    getById,
  };
}
