// scripts/__tests__/build-themes.test.ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

describe("build-themes", () => {
  it("bundles every builtin theme into a self-contained ESM + manifest", () => {
    execSync("bun run build:themes", { cwd: path.resolve(__dirname, "../..") });
    const outDir = path.resolve(__dirname, "../../src-tauri/themes/winamp_classic");
    const js = fs.readFileSync(path.join(outDir, "theme.js"), "utf-8");
    expect(js).toContain("export"); // ESM
    expect(js).not.toMatch(/^import /m); // self-contained, no bare imports
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "theme.json"), "utf-8"));
    expect(manifest.manifest_version).toBe(2);
    expect(manifest.entry).toBe("theme.js");
  });
});
