import { useEffect, useRef, DependencyList } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

/**
 * Hook for subscribing to Tauri events with automatic cleanup.
 *
 * DRY: Extracts the repeated listen/unlisten pattern from useRecording
 * and other hooks that need to listen to Tauri events.
 *
 * @param eventName - The name of the Tauri event to listen to
 * @param handler - The callback function to handle event payloads
 * @param deps - Optional dependency array for re-subscribing
 *
 * @example
 * ```ts
 * useTauriEvent<RecordingState>("state-changed", (state) => {
 *   setState(state);
 * });
 * ```
 */
export function useTauriEvent<T>(
  eventName: string,
  handler: (payload: T) => void,
  deps: DependencyList = []
): void {
  const handlerRef = useRef(handler);

  // Keep handler ref up to date
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.transformCallback !== "function") {
        return; // Safely skip in mocked E2E environments
      }
      unlisten = await listen<T>(eventName, (event) => {
        handlerRef.current(event.payload);
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, ...deps]);
}

/**
 * Hook for subscribing to multiple Tauri events with automatic cleanup.
 *
 * @param events - Array of [eventName, handler] tuples
 * @param deps - Optional dependency array for re-subscribing
 *
 * @example
 * ```ts
 * useTauriEvents([
 *   ["state-changed", handleState],
 *   ["transcription", handleTranscription],
 *   ["error", handleError],
 * ]);
 * ```
 */
export function useTauriEvents<T extends unknown[]>(
  events: { [K in keyof T]: [string, (payload: T[K]) => void] },
  deps: DependencyList = []
): void {
  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = [];

    for (const [eventName, handler] of events) {
      if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.transformCallback !== "function") {
        continue; // Safely skip in mocked E2E environments
      }
      unlisteners.push(listen(eventName, (event) => handler(event.payload)));
    }

    return () => {
      Promise.all(unlisteners).then((fns) => {
        for (const fn of fns) {
          fn();
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps]);
}
