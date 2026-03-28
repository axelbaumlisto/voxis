import { useState, useEffect, useCallback, useRef } from "react";
import { getErrorMessage } from "../lib/errors";

export interface UseAsyncDataResult<T> {
  data: T;
  setData: React.Dispatch<React.SetStateAction<T>>;
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  reload: () => Promise<void>;
}

export interface AsyncDataOptions {
  /** Maximum number of retry attempts. Default: 1 (no retries) */
  maxRetries?: number;
  /** Delay between retries in milliseconds. Default: 100 */
  retryDelay?: number;
}

/**
 * Generic hook for async data fetching with loading/error states.
 * DRY: Single implementation with optional retry support.
 *
 * @param fetchFn - Async function to fetch data
 * @param initialValue - Initial value for data state
 * @param options - Optional retry configuration
 * @returns Object with data, loading, error states and reload function
 */
export function useAsyncData<T>(
  fetchFn: () => Promise<T>,
  initialValue: T,
  options: AsyncDataOptions = {}
): UseAsyncDataResult<T> {
  const { maxRetries = 1, retryDelay = 100 } = options;

  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use ref to store stable fetchFn reference
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  // Track current load generation to handle StrictMode double-mount
  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    const currentLoadId = ++loadIdRef.current;
    setLoading(true);
    setError(null);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await fetchFnRef.current();
        // Only update if this is still the current load
        if (loadIdRef.current === currentLoadId) {
          setData(result);
          setLoading(false);
        }
        return;
      } catch (err) {
        if (attempt < maxRetries - 1) {
          // Retry after delay
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          // Last attempt failed - only update if still current
          if (loadIdRef.current === currentLoadId) {
            setError(getErrorMessage(err));
            setLoading(false);
          }
        }
      }
    }
  }, [maxRetries, retryDelay]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, setData, loading, error, setError, reload: load };
}

/** @deprecated Use useAsyncData with options.maxRetries instead */
export interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * @deprecated Use useAsyncData with options parameter instead.
 * Backward compatibility alias for useAsyncData with retry.
 */
export function useAsyncDataWithRetry<T>(
  fetchFn: () => Promise<T>,
  initialValue: T,
  options: RetryOptions = {}
): UseAsyncDataResult<T> {
  const { maxRetries = 3, retryDelay = 100 } = options;
  return useAsyncData(fetchFn, initialValue, { maxRetries, retryDelay });
}
