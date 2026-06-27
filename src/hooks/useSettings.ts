import { useState, useCallback, useEffect } from "react";
import { getConfig, saveConfig, AppConfig } from "../lib/commands";
import { getErrorMessage } from "../lib/errors";
import { withRetry } from "../lib/retry";

/** UI state for settings (consolidated - DRY). */
interface SettingsUIState {
  loading: boolean;
  error: string | null;
  saving: boolean;
}

interface UseSettingsResult {
  config: AppConfig | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  updateConfig: (updates: Partial<AppConfig>) => void;
  updateNestedConfig: (path: string, value: unknown) => void;
  save: () => Promise<void>;
  reload: () => Promise<void>;
  hasChanges: boolean;
}

/**
 * Helper to set nested value in AppConfig using dot notation path.
 * KISS: Uses spread operator for cleaner nested updates.
 */
function setNestedValue(
  obj: AppConfig,
  path: string,
  value: unknown
): AppConfig {
  const parts = path.split(".");
  if (parts.length === 1) {
    return { ...obj, [path]: value } as AppConfig;
  }

  const [parent, child] = parts;
  const parentObj = obj[parent as keyof AppConfig];
  if (typeof parentObj === "object" && parentObj !== null) {
    return {
      ...obj,
      [parent]: {
        ...(parentObj as Record<string, unknown>),
        [child]: value,
      },
    };
  }
  return obj;
}

/**
 * Hook for managing app settings.
 * Loads config on mount with retry, tracks changes, and saves to backend.
 * DRY: Consolidates loading/error/saving into single UI state object.
 */
export function useSettings(): UseSettingsResult {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<AppConfig | null>(null);
  // DRY: Consolidated UI state
  const [ui, setUi] = useState<SettingsUIState>({
    loading: true,
    error: null,
    saving: false,
  });

  // Load with retry logic for initial Tauri IPC readiness (DRY: uses withRetry)
  const load = useCallback(async () => {
    setUi((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const cfg = await withRetry(() => getConfig(), {
        maxRetries: 3,
        delay: 100,
      });
      setConfig(cfg);
      setOriginalConfig(cfg);
    } catch (err) {
      setUi((prev) => ({ ...prev, error: getErrorMessage(err) }));
    } finally {
      setUi((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateConfig = useCallback((updates: Partial<AppConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  /**
   * Update nested config value using dot notation path.
   * e.g., "overlay.enabled" -> config.overlay.enabled
   * KISS: Uses simple helper function for nested updates.
   */
  const updateNestedConfig = useCallback((path: string, value: unknown) => {
    setConfig((prev) => {
      if (!prev) return null;
      return setNestedValue(prev, path, value);
    });
  }, []);

  const save = useCallback(async () => {
    if (!config) return;
    setUi((prev) => ({ ...prev, saving: true, error: null }));
    try {
      await saveConfig(config);
      setOriginalConfig(config);
      // Emit custom event for Layout to pick up
      window.dispatchEvent(new CustomEvent("config-saved"));
    } catch (err) {
      setUi((prev) => ({ ...prev, error: getErrorMessage(err) }));
      throw err;
    } finally {
      setUi((prev) => ({ ...prev, saving: false }));
    }
  }, [config]);

  const hasChanges =
    config !== null &&
    originalConfig !== null &&
    JSON.stringify(config) !== JSON.stringify(originalConfig);

  return {
    config,
    loading: ui.loading,
    error: ui.error,
    saving: ui.saving,
    updateConfig,
    updateNestedConfig,
    save,
    reload: load,
    hasChanges,
  };
}
