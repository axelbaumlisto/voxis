import { describe, expect, it } from "vitest";
import { unwrapResult } from "../commandResult";

describe("unwrapResult", () => {
  it("returns data when status is 'ok'", () => {
    expect(unwrapResult({ status: "ok", data: 42 })).toBe(42);
    expect(unwrapResult({ status: "ok", data: "hello" })).toBe("hello");
    expect(unwrapResult({ status: "ok", data: null })).toBe(null);
  });

  it("throws when status is 'error' with the error stringified", () => {
    expect(() =>
      unwrapResult({ status: "error", error: "boom" }),
    ).toThrow(/boom/);
  });

  it("throws a default message when error is undefined", () => {
    expect(() => unwrapResult({ status: "error" })).toThrow(/command failed/);
  });

  it("non-ok status that is also not 'error' still throws", () => {
    // Forward-compat: specta could add new variants. Anything other
    // than 'ok' must throw so callers go through their error path.
    expect(() =>
      unwrapResult({ status: "weird_future_state", data: 1 }),
    ).toThrow();
  });

  it("preserves undefined data when status='ok' (test envs)", () => {
    // Synthetic test envs sometimes have commands.* mocks that resolve
    // with no data field. Defensive default at the call site handles
    // the cast; the helper itself just returns whatever's there.
    const got = unwrapResult<number | undefined>({ status: "ok" });
    expect(got).toBeUndefined();
  });
});
