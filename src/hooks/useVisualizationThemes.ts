import { useCallback, useEffect, useMemo, useState } from "react";
import { getVisualizationThemes, type ThemeInfo } from "../lib/commands";
import type { SettingOption } from "../lib/settingsRegistry";

const FALLBACK_THEME_OPTIONS: SettingOption[] = [
  { label: "Default", value: "default" },
];

function toOption(theme: ThemeInfo): SettingOption {
  return {
    label: theme.name,
    value: theme.id,
  };
}

export function useVisualizationThemes(selectedTheme?: string) {
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadThemes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const loadedThemes = await getVisualizationThemes();
      setThemes(Array.isArray(loadedThemes) ? loadedThemes : []);
    } catch (err) {
      setThemes([]);
      setError(err instanceof Error ? err.message : "Failed to load themes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThemes();
  }, [loadThemes]);

  const options = useMemo(() => {
    const loadedOptions = themes.map(toOption);
    const baseOptions = loadedOptions.length > 0 ? loadedOptions : FALLBACK_THEME_OPTIONS;

    if (selectedTheme && !baseOptions.some((option) => option.value === selectedTheme)) {
      return [
        { label: `${selectedTheme} (missing)`, value: selectedTheme },
        ...baseOptions,
      ];
    }

    return baseOptions;
  }, [selectedTheme, themes]);

  return {
    themes,
    options,
    loading,
    error,
    reload: loadThemes,
  };
}
