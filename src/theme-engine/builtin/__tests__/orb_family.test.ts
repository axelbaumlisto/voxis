// One table-driven gate for the WHOLE orb family: every `orb_*` theme is a
// valid module, and its manifest declares what the kit needs (a credit, the
// same square size in both axes, params that match the shader's defaults).
//
// jsdom has no WebGL, so mounting is covered by e2e/orb-themes.spec.ts (real
// Chromium + SwiftShader). This file is the cheap structural gate that runs
// with every unit-test pass and catches a manifest/param drift immediately.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateThemeModule } from "../../contract";

// `import.meta.dir` is not available in vitest's transform of this file; the
// test runs from the repo root, which is all the path needs.
const BUILTIN = path.resolve(process.cwd(), "src/theme-engine/builtin");
const orbIds = fs
  .readdirSync(BUILTIN, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith("orb_"))
  .map((d) => d.name)
  .sort();

describe("orb family (Orbkit ports)", () => {
  it("found the expected orbs", () => {
    expect(orbIds.length).toBeGreaterThanOrEqual(5);
  });

  for (const id of orbIds) {
    it(`${id}: valid module, manifest agrees with the theme`, async () => {
      const mod = (await import(`../${id}/index.ts`)) as unknown;
      expect(validateThemeModule(mod).ok).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(path.join(BUILTIN, id, "manifest.json"), "utf8"));
      expect(manifest.id).toBe(id);
      // Attribution is the licence condition for the ports: a manifest without
      // it is a bug, not a style choice.
      expect(String(manifest.credit ?? "")).toMatch(/Orbkit/);
      // A square orb rendered into a non-square window would be squashed by
      // orbUV(), which normalises by min(w, h).
      expect(manifest.overlay_width).toBe(manifest.overlay_height);
      expect(manifest.params).toBeTypeOf("object");

      // ONE source of truth check: `DEFAULTS` in the theme and `params` in the
      // manifest are the same numbers. They are generated together, but nothing
      // stopped a hand edit from drifting them apart — and a drifted manifest
      // silently changes what the user sees versus what the shader defaults to.
      const src = fs.readFileSync(path.join(BUILTIN, id, "index.ts"), "utf8");
      const block = src.slice(src.indexOf("const DEFAULTS = {"), src.indexOf("} as const;"));
      const inCode: Record<string, number> = {};
      for (const m of block.matchAll(/([A-Za-z_][A-Za-z0-9_]*):\s*(-?[0-9.]+)/g)) {
        inCode[m[1]] = Number(m[2]);
      }
      const inManifest: Record<string, number> = { ...manifest.params };
      delete (inManifest as { colors?: unknown }).colors;
      expect(Object.keys(inCode).sort()).toEqual(Object.keys(inManifest).sort());
      for (const [k, v] of Object.entries(inCode)) {
        expect(inManifest[k], `${id}.${k}: manifest ${inManifest[k]} vs theme ${v}`).toBeCloseTo(v, 4);
      }
    });
  }
});
