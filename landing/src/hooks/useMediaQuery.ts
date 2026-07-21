import { useCallback, useSyncExternalStore } from "react";

/**
 * SSR-safe media query hook.
 *
 * Uses `useSyncExternalStore` so that:
 * - The server snapshot (and the first client render used for hydration) is
 *   always `false`, matching the server markup exactly (no hydration mismatch).
 * - After hydration React switches to the client snapshot and subscribes to
 *   `MediaQueryList` change events.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === "undefined") return () => {};

      const mediaQuery = window.matchMedia(query);

      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", onStoreChange);
        return () => mediaQuery.removeEventListener("change", onStoreChange);
      }

      mediaQuery.addListener(onStoreChange);
      return () => mediaQuery.removeListener(onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  }, [query]);

  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
