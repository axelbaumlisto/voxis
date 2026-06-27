import { useState, useEffect, useMemo, useCallback } from "react";
import { useLlmProviders } from "./useLlmProviders";
import { LlmProvider } from "../lib/commands";
import { getErrorMessage } from "../lib/errors";

/**
 * Hook for provider and model selection logic.
 * SRP: Extracts provider selection logic from ProviderSelect component.
 */
export function useProviderSelection(
  providerId: string,
  modelId: string,
  onProviderChange: (providerId: string, apiUrl: string, defaultModel: string) => void,
  onModelChange: (modelId: string) => void
) {
  const { providers, loading, remove, add, update, reload } = useLlmProviders();
  const [error, setError] = useState<string | null>(null);

  const currentProvider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId]
  );

  const models = useMemo(
    () => currentProvider?.models ?? [],
    [currentProvider]
  );

  const handleProviderChange = useCallback(
    (newProviderId: string) => {
      const provider = providers.find((p) => p.id === newProviderId);
      if (provider) {
        onProviderChange(provider.id, provider.api_url, provider.default_model);
      }
    },
    [providers, onProviderChange]
  );

  // Update model when models list changes
  useEffect(() => {
    if (models.length > 0 && !models.some((m) => m.id === modelId)) {
      onModelChange(models[0].id);
    }
  }, [models, modelId, onModelChange]);

  const handleRemoveProvider = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await remove(id);
        if (id === providerId && providers.length > 1) {
          const remaining = providers.filter((p) => p.id !== id);
          if (remaining.length > 0) {
            handleProviderChange(remaining[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to remove provider:", err);
        setError(getErrorMessage(err));
      }
    },
    [remove, providerId, providers, handleProviderChange]
  );

  const handleAddProvider = useCallback(
    async (provider: Omit<LlmProvider, "builtin">) => {
      await add(provider);
      onProviderChange(provider.id, provider.api_url, provider.default_model);
    },
    [add, onProviderChange]
  );

  const handleUpdateProvider = useCallback(
    async (provider: Omit<LlmProvider, "builtin">) => {
      await update(provider);
      if (provider.id === providerId) {
        onProviderChange(provider.id, provider.api_url, provider.default_model);
      }
    },
    [update, providerId, onProviderChange]
  );

  return {
    providers,
    loading,
    error,
    currentProvider,
    models,
    handleProviderChange,
    handleRemoveProvider,
    handleAddProvider,
    handleUpdateProvider,
    reload,
  };
}
