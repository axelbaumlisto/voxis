import { useCallback } from "react";
import { getErrorMessage } from "../lib/errors";

/**
 * Options for useAsyncAction hook.
 */
interface UseAsyncActionOptions {
  /** Function to reload data after action completes */
  reload?: () => Promise<void>;
  /** Function to set error message on failure */
  setError?: (error: string | null) => void;
}

/**
 * Hook to create async action handlers with consistent error handling.
 *
 * DRY: Extracts the repeated try-catch-reload-setError pattern
 * found in useLlmProviders, useDictionary, usePendingSuggestions.
 *
 * @param action - The async action function to wrap
 * @param options - Options for reload and error handling
 * @returns A wrapped function with error handling
 *
 * @example
 * ```ts
 * const add = useAsyncAction(
 *   async (name: string) => {
 *     await addItem(name);
 *   },
 *   { reload, setError }
 * );
 * ```
 */
export function useAsyncAction<T extends unknown[]>(
  action: (...args: T) => Promise<void>,
  options: UseAsyncActionOptions,
  deps: React.DependencyList = []
): (...args: T) => Promise<void> {
  const { reload, setError } = options;

  return useCallback(
    async (...args: T) => {
      try {
        await action(...args);
        if (reload) {
          await reload();
        }
      } catch (err) {
        if (setError) {
          setError(getErrorMessage(err));
        }
        throw err;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reload, setError, ...deps]
  );
}

/**
 * Hook to create async action handlers that return a value.
 *
 * Similar to useAsyncAction but preserves the return value.
 *
 * @param action - The async action function to wrap
 * @param options - Options for reload and error handling
 * @returns A wrapped function with error handling
 */
export function useAsyncActionWithResult<T extends unknown[], R>(
  action: (...args: T) => Promise<R>,
  options: UseAsyncActionOptions & { reloadAfter?: boolean },
  deps: React.DependencyList = []
): (...args: T) => Promise<R> {
  const { reload, setError, reloadAfter = true } = options;

  return useCallback(
    async (...args: T): Promise<R> => {
      if (setError) {
        setError(null);
      }
      try {
        const result = await action(...args);
        if (reload && reloadAfter) {
          await reload();
        }
        return result;
      } catch (err) {
        if (setError) {
          setError(getErrorMessage(err));
        }
        throw err;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reload, setError, reloadAfter, ...deps]
  );
}
