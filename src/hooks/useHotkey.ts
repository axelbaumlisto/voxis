import { useEffect, useRef, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

/**
 * Hook for subscribing to global hotkey press/release events from the Rust backend.
 *
 * SRP: Encapsulates the hotkey event subscription lifecycle (listen + cleanup)
 * so that consuming components only need to provide press/release callbacks.
 *
 * Uses refs to keep callbacks stable and avoid re-subscribing on every render.
 *
 * @param onPress - Called when the hotkey is pressed
 * @param onRelease - Called when the hotkey is released
 */
export function useHotkey(onPress: () => void, onRelease: () => void): void {
  const onPressRef = useRef(onPress);
  const onReleaseRef = useRef(onRelease);

  onPressRef.current = onPress;
  onReleaseRef.current = onRelease;

  const stablePress = useCallback(() => onPressRef.current(), []);
  const stableRelease = useCallback(() => onReleaseRef.current(), []);

  useEffect(() => {
    let unlistenPressed: UnlistenFn | null = null;
    let unlistenReleased: UnlistenFn | null = null;

    const setup = async () => {
      unlistenPressed = await listen("hotkey-pressed", stablePress);
      unlistenReleased = await listen("hotkey-released", stableRelease);
    };

    setup();

    return () => {
      unlistenPressed?.();
      unlistenReleased?.();
    };
  }, [stablePress, stableRelease]);
}
