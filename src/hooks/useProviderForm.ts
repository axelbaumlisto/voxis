import { useState, useEffect, useCallback } from "react";
import { LlmProvider } from "../lib/commands";
import { validateProviderForm } from "../lib/providerValidation";
import {
  parseModelsFromText,
  modelsToText,
  generateProviderId,
  isDuplicateProviderId,
} from "../lib/providers";
import { getErrorMessage } from "../lib/errors";

/**
 * Form mode for provider editing.
 */
export type ProviderFormMode = "add" | "edit";

/**
 * Provider form state and handlers.
 * SRP: Separates form logic from UI rendering.
 */
export interface UseProviderFormResult {
  // Form state
  name: string;
  setName: (value: string) => void;
  apiUrl: string;
  setApiUrl: (value: string) => void;
  modelsText: string;
  setModelsText: (value: string) => void;
  defaultModel: string;
  setDefaultModel: (value: string) => void;
  error: string | null;
  saving: boolean;

  // Derived state
  models: Array<{ id: string; name: string }>;
  canSubmit: boolean;

  // Actions
  handleSubmit: () => Promise<void>;
  resetForm: () => void;
}

interface UseProviderFormOptions {
  mode: ProviderFormMode;
  provider?: LlmProvider;
  existingIds: string[];
  onSave: (provider: Omit<LlmProvider, "builtin">) => Promise<void>;
  onClose: () => void;
}

/**
 * Hook for managing provider form state, validation, and submission.
 * DRY: Extracts repeated form logic from ProviderModal.
 * SRP: Single responsibility - form state management.
 */
export function useProviderForm({
  mode,
  provider,
  existingIds,
  onSave,
  onClose,
}: UseProviderFormOptions): UseProviderFormResult {
  const [name, setName] = useState(provider?.name ?? "");
  const [apiUrl, setApiUrl] = useState(provider?.api_url ?? "");
  const [modelsText, setModelsText] = useState("");
  const [defaultModel, setDefaultModel] = useState(provider?.default_model ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Initialize modelsText from provider models
  useEffect(() => {
    if (provider?.models) {
      setModelsText(modelsToText(provider.models));
    }
  }, [provider]);

  // Parse models from textarea text
  const models = parseModelsFromText(modelsText);

  // Check if form can be submitted
  const canSubmit = !saving && name.trim().length > 0 && apiUrl.trim().length > 0;

  // Reset form to initial state
  const resetForm = useCallback(() => {
    setName(provider?.name ?? "");
    setApiUrl(provider?.api_url ?? "");
    setModelsText(provider?.models ? modelsToText(provider.models) : "");
    setDefaultModel(provider?.default_model ?? "");
    setError(null);
    setSaving(false);
  }, [provider]);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    setError(null);

    const id = mode === "edit" ? provider!.id : generateProviderId(name);

    // Use validation utility
    const validationErrors = validateProviderForm({
      name,
      apiUrl,
      models,
    });

    if (validationErrors.length > 0) {
      setError(validationErrors[0]);
      return;
    }

    // Check for duplicate ID (only for add mode)
    if (mode === "add" && isDuplicateProviderId(id, existingIds)) {
      setError(`Provider with ID "${id}" already exists`);
      return;
    }

    const selectedDefault = defaultModel || models[0]?.id || "";

    setSaving(true);
    try {
      await onSave({
        id,
        name: name.trim(),
        api_url: apiUrl.trim(),
        models,
        default_model: selectedDefault,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [mode, provider, name, apiUrl, models, defaultModel, existingIds, onSave, onClose]);

  return {
    // Form state
    name,
    setName,
    apiUrl,
    setApiUrl,
    modelsText,
    setModelsText,
    defaultModel,
    setDefaultModel,
    error,
    saving,

    // Derived state
    models,
    canSubmit,

    // Actions
    handleSubmit,
    resetForm,
  };
}
