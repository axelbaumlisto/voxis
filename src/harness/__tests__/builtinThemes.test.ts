import { describe, it, expect } from "vitest";
import { BUILTIN_THEME_IDS, fetchBuiltinThemeModule } from "../builtinThemes";

describe("builtinThemes", () => {
  it("lists the known builtin theme ids", () => {
    expect(BUILTIN_THEME_IDS).toContain("drifting_contour");
    expect(BUILTIN_THEME_IDS).toContain("radiolarian");
    expect(BUILTIN_THEME_IDS).toContain("default");
    expect(BUILTIN_THEME_IDS.length).toBeGreaterThanOrEqual(10);
  });
  it("resolves a builtin module exporting mount()", async () => {
    const mod = await fetchBuiltinThemeModule("drifting_contour");
    expect(typeof mod.mount).toBe("function");
  });
  it("rejects an unknown theme id", async () => {
    await expect(fetchBuiltinThemeModule("nope__nonexistent")).rejects.toThrow();
  });
});