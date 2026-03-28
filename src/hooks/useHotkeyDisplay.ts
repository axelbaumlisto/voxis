import { useState, useCallback, useEffect } from "react";
import { getConfig } from "../lib/commands";
import { formatHotkey } from "../lib/status";
import { withRetry } from "../lib/retry";

/**
 * Hook for loading and displaying the configured hotkey.
 * SRP: Extracts hotkey loading logic from Layout.tsx.
 * DRY: Uses shared withRetry utility.
 *
 * @returns Object with hotkey string and reload function
 */
export function useHotkeyDisplay(): { hotkey: string; reload: () => void } {
  const [hotkey, setHotkey] = useState("Ctrl+R");

  const reload = useCallback(async () => {
    try {
      const config = await withRetry(() => getConfig(), {
        maxRetries: 3,
        delay: 100,
      });
      setHotkey(formatHotkey(config.hotkey));
    } catch {
      // Keep default hotkey on failure
    }
  }, []);

  useEffect(() => {
    reload();

    const handleConfigSaved = () => reload();
    window.addEventListener("config-saved", handleConfigSaved);
    return () => window.removeEventListener("config-saved", handleConfigSaved);
  }, [reload]);

  return { hotkey, reload };
}
