/**
 * Retry utility for async operations.
 * DRY: Centralizes retry logic used across Layout.tsx and useSettings.ts.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 100) */
  delay?: number;
  /** Optional callback for each retry attempt */
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Execute an async function with retry logic.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Promise resolving to the function result
 * @throws The last error if all retries fail
 *
 * @example
 * const config = await withRetry(() => getConfig(), { maxRetries: 3 });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, delay = 100, onRetry } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        onRetry?.(attempt + 1, error);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
