/**
 * Clipboard utilities for copying text.
 * DRY: Centralizes clipboard logic from HistoryPage and keyboardShortcuts.
 */

import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Copy text to clipboard.
 * @returns true if successful, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    console.error("Failed to copy to clipboard");
    return false;
  }
}

/**
 * Hook for copying text to clipboard with feedback state.
 *
 * @param timeout - Duration in ms to show copied state (default: 2000)
 * @returns Object with copied state and copy function
 *
 * @example
 * ```tsx
 * const { copied, copy } = useCopyToClipboard();
 * <button onClick={() => copy(text)}>
 *   {copied ? "Copied!" : "Copy"}
 * </button>
 * ```
 */
export function useCopyToClipboard(timeout = 2000): {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
} {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      const success = await copyToClipboard(text);
      if (success) {
        setCopied(true);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => setCopied(false), timeout);
      }
      return success;
    },
    [timeout]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { copied, copy };
}
