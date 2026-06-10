// src/theme-engine/__tests__/contract.test.ts
import { describe, it, expect } from "vitest";
import { validateThemeModule, THEME_API_VERSION } from "../contract";

describe("validateThemeModule", () => {
  it("accepts a module with a mount function", () => {
    const mod = { mount: () => ({ unmount() {} }) };
    expect(validateThemeModule(mod)).toEqual({ ok: true });
  });

  it("rejects null / non-object", () => {
    expect(validateThemeModule(null).ok).toBe(false);
    expect(validateThemeModule(42).ok).toBe(false);
  });

  it("rejects module without mount", () => {
    const res = validateThemeModule({ foo: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/mount/);
  });

  it("exposes API version 1", () => {
    expect(THEME_API_VERSION).toBe(1);
  });
});
