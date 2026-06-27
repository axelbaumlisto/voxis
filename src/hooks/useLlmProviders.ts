import { useCallback, useMemo } from "react";
import { addLlmProvider, getLlmProviders, removeLlmProvider, updateLlmProvider, type LlmProvider } from "../lib/commands";
import { useAsyncAction } from "./useAsyncAction";
import { useResource } from "./useResource";

export function useLlmProviders() {
  const { data, loading, error, setError, reload } = useResource(getLlmProviders);
  const providers = useMemo(() => data ?? [], [data]);
  const add = useAsyncAction(async (provider: Omit<LlmProvider, "builtin">) => addLlmProvider(provider), { reload, setError });
  const update = useAsyncAction(async (provider: Omit<LlmProvider, "builtin">) => updateLlmProvider({ ...provider, builtin: false }), { reload, setError });
  const remove = useAsyncAction(async (id: string) => removeLlmProvider(id), { reload, setError });
  const getProvider = useCallback((id: string) => providers.find((provider) => provider.id === id), [providers]);
  const getModelsForProvider = useCallback((id: string) => providers.find((provider) => provider.id === id)?.models ?? [], [providers]);
  return { providers, items: providers, loading, error, reload, add, update, remove, getProvider, getModelsForProvider };
}
