/**
 * Helpers for the auto-generated specta command results.
 *
 * Every command in `bindings.ts` resolves to
 *   { status: "ok"; data: T } | { status: "error"; error: string }
 *
 * Components that just want the value should not have to inline the
 * shape check 5 times. `unwrapResult` throws on error (so callers can
 * catch in their own try/catch) and returns the value on success.
 *
 * SOLID:
 *  - SRP: pure 7-line helper, no React, no I/O.
 *  - KISS: zero dependencies. Can be imported from anywhere
 *    in `src/`.
 *
 * Replaces the three identical copies that lived in
 * LlmPromptManager / ShortcutBindingList / OnboardingPage.
 */

export interface CommandResult<T> {
  status: string;
  data?: T;
  error?: unknown;
}

/**
 * Throws if the command resolved to an error variant; otherwise
 * returns `data` (which is unioned with undefined in the type system
 * but is always present when status === "ok"). A defensive `?? null
 * coercion` at the call site keeps things safe in synthetic test
 * envs where mocks return undefined.
 */
export function unwrapResult<T>(result: CommandResult<T>): T {
  if (result.status !== "ok") {
    throw new Error(String(result.error ?? "command failed"));
  }
  return result.data as T;
}
