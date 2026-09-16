// crates/tauri-plugin-voxis/guest-js/__tests__/theme-registry.test.ts
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ID, FALLBACK_THEME_SIZE, resolveTheme, resolveThemeSize, ThemeRegistry } from "../src/themes/registry";

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

describe("resolveThemeSize [A6]", () => {
  it("resolves the manifest overlay size for a theme that declares one (lavalamp, 120x120 WebGL)", () => {
    expect(resolveThemeSize("lavalamp")).toEqual({ width: 120, height: 120 });
  });

  it("resolves a different manifest size for a differently-sized theme (living_reed, 160x160)", () => {
    expect(resolveThemeSize("living_reed")).toEqual({ width: 160, height: 160 });
  });

  it("resolves a non-square manifest size (all_aquarium, 340x170)", () => {
    expect(resolveThemeSize("all_aquarium")).toEqual({ width: 340, height: 170 });
  });

  it("falls back to FALLBACK_THEME_SIZE (64x64) for a theme with no overlay_width/overlay_height in its manifest", () => {
    expect(resolveThemeSize("default")).toEqual(FALLBACK_THEME_SIZE);
    expect(resolveThemeSize("handy_pill")).toEqual(FALLBACK_THEME_SIZE);
    expect(resolveThemeSize("neon")).toEqual(FALLBACK_THEME_SIZE);
    expect(resolveThemeSize("winamp_classic")).toEqual(FALLBACK_THEME_SIZE);
  });

  it("falls back to FALLBACK_THEME_SIZE for an unknown/undefined/empty id, same normalization as resolveTheme", () => {
    expect(resolveThemeSize("this-theme-does-not-exist")).toEqual(FALLBACK_THEME_SIZE);
    expect(resolveThemeSize(undefined)).toEqual(FALLBACK_THEME_SIZE);
    expect(resolveThemeSize("")).toEqual(FALLBACK_THEME_SIZE);
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
