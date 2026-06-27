import { useCallback, useMemo } from "react";
import { addDictionaryEntry, deleteDictionaryEntry, getDictionary, updateDictionaryEntry } from "../lib/commands";
import { useAsyncAction } from "./useAsyncAction";
import { useResource } from "./useResource";

export function useDictionary() {
  const { data, loading, error, setError, reload } = useResource(getDictionary);
  const entries = useMemo(() => data ?? [], [data]);
  const add = useAsyncAction(async (source: string, replacement: string) => addDictionaryEntry(source, replacement), { reload, setError });
  const remove = useAsyncAction(async (id: number) => deleteDictionaryEntry(id), { reload, setError });
  const update = useAsyncAction(async (id: number, source: string, replacement: string) => updateDictionaryEntry(id, source, replacement), { reload, setError });
  const getById = useCallback((id: number) => entries.find((entry) => entry.id === id), [entries]);
  return { entries, items: entries, loading, error, reload, add, remove, update, getById };
}
