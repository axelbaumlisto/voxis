import { useState, useCallback, useEffect } from "react";
import {
  getFailedTranscriptions,
  retryTranscription,
  dismissFailedTranscription,
  FailedTranscription,
} from "../lib/commands";
import { getErrorMessage } from "../lib/errors";
import { useTauriEvent } from "./useTauriEvent";

export function useFailedTranscriptions() {
  const [items, setItems] = useState<FailedTranscription[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getFailedTranscriptions();
      setItems(data);
    } catch (e) {
      console.error("Failed to load failed transcriptions:", e);
      setError(getErrorMessage(e));
    }
  }, []);

  // Load on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen for updates
  useTauriEvent("failed-transcriptions-updated", refresh);

  const retry = useCallback(async (id: string) => {
    setRetrying(id);
    setError(null);
    try {
      await retryTranscription(id);
    } catch (e) {
      console.error("Retry failed:", e);
      setError(getErrorMessage(e));
    } finally {
      setRetrying(null);
    }
  }, []);

  const dismiss = useCallback(async (id: string) => {
    setError(null);
    try {
      await dismissFailedTranscription(id);
      await refresh();
    } catch (e) {
      console.error("Dismiss failed:", e);
      setError(getErrorMessage(e));
    }
  }, [refresh]);

  return { items, retry, dismiss, retrying, error };
}
