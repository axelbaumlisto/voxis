import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { handleShortcut, ShortcutContext } from "../lib/keyboardShortcuts";

/**
 * Hook for handling keyboard shortcuts in the layout.
 * SRP: Extracts keyboard handling logic from Layout component.
 *
 * @param lastTranscription - The last transcription text for copy shortcut
 */
export function useKeyboardShortcuts(lastTranscription: string | null): void {
  const navigate = useNavigate();

  // Shortcut context for keyboard handler
  const shortcutContext: ShortcutContext = useMemo(
    () => ({
      navigate,
      lastTranscription,
      hideWindow: () => getCurrentWindow().hide(),
    }),
    [navigate, lastTranscription]
  );

  // Keyboard shortcuts using registry (OCP)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      handleShortcut(e, shortcutContext);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcutContext]);
}
