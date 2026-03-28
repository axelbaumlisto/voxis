/**
 * Extracts error message from unknown error type.
 * Handles Error instances, strings, and other types uniformly.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
