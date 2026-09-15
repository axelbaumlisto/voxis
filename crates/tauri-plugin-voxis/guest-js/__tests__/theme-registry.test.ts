// crates/tauri-plugin-voxis/guest-js/__tests__/theme-registry.test.ts
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ID, resolveTheme, ThemeRegistry } from "../src/themes/registry";

describe("ThemeRegistry", () => {
  it("has a default entry with a mount function", () => {
    const mod = ThemeRegistry[DEFAULT_THEME_ID];
    expect(mod).toBeDefined();
    expect(typeof mod?.mount).toBe("function");
  });

  it("every builtin id maps to a module exporting mount(container, api)", () => {
    for (const [id, mod] of Object.entries(ThemeRegistry)) {
      expect(typeof mod.mount, `theme "${id}" must export mount()`).toBe("function");
    }
  });
});

describe("resolveTheme", () => {
  it("resolves a known id directly", () => {
    expect(resolveTheme("neon")).toBe(ThemeRegistry.neon);
  });

  it("falls back to the default theme and warns for an unknown id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolved = resolveTheme("this-theme-does-not-exist");
    expect(resolved).toBe(ThemeRegistry[DEFAULT_THEME_ID]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("falls back to the default theme for undefined/empty id, without warning (nothing was requested)", () => {
    expect(resolveTheme(undefined)).toBe(ThemeRegistry[DEFAULT_THEME_ID]);
    expect(resolveTheme("")).toBe(ThemeRegistry[DEFAULT_THEME_ID]);
  });
});
