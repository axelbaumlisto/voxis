import { useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { clearHistory as clearHistoryCmd, getHistory } from "../lib/commands";
import { getErrorMessage } from "../lib/errors";
import { useResource } from "./useResource";

export function useHistory(limit?: number) {
  const { data, setData, loading, error, setError, reload } = useResource(() => getHistory(limit), { maxRetries: 3, retryDelay: 100 });
  const entries = data ?? [];

  useEffect(() => {
    const unlistenPromise = listen("history-updated", reload);
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [reload]);

  const clear = useCallback(async () => {
    try { await clearHistoryCmd(); setData([]); }
    catch (err) { setError(getErrorMessage(err)); }
  }, [setData, setError]);

  return { entries, items: entries, loading, error, reload, clear };
}
