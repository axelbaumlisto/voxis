// @vitest-environment node
// src/theme-engine/__tests__/loader.test.ts
// jsdom cannot dynamic-import blob URLs; node >= 18 has Blob and URL.
import { describe, it, expect } from "vitest";
import { loadThemeModuleFromSource } from "../loader";

const GOOD_SRC = `export function mount(container, api){ return { unmount(){} }; }`;
const NO_MOUNT_SRC = `export const x = 1;`;
const SYNTAX_ERR_SRC = `export function mount( {`;

describe("loadThemeModuleFromSource", () => {
  it("imports a valid theme module", async () => {
    const mod = await loadThemeModuleFromSource(GOOD_SRC);
    expect(typeof mod.mount).toBe("function");
  });

  it("rejects a module without mount", async () => {
    await expect(loadThemeModuleFromSource(NO_MOUNT_SRC)).rejects.toThrow(/mount/);
  });

  it("rejects a module with syntax errors", async () => {
    await expect(loadThemeModuleFromSource(SYNTAX_ERR_SRC)).rejects.toThrow();
  });
});
