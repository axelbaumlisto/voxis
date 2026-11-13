// scripts/__tests__/build-themes.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { themeDigest } from "../theme-digest";

const ROOT = path.resolve(__dirname, "../..");
const THEMES_DIR = path.join(ROOT, "src-tauri/themes");
const KNOWN_DIGESTS = path.join(ROOT, "src-tauri/known-builtin-digests.json");

/** One theme folder's digest, read the way `ThemeSource::files` reads it. */
function digestOfDir(dir: string): string {
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    // `Dirent.isFile()` is lstat-based, so symlinks are not regular files.
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      bytes: new Uint8Array(fs.readFileSync(path.join(dir, entry.name))),
    }));
  return themeDigest(files);
}

describe("build-themes", () => {
  // Both tests assert on the output of one build.
  beforeAll(() => {
    execSync("bun run build:themes", { cwd: ROOT });
  }, 120_000);

  it("bundles every builtin theme into a self-contained ESM + manifest", () => {
    const outDir = path.join(THEMES_DIR, "winamp_classic");
    const js = fs.readFileSync(path.join(outDir, "theme.js"), "utf-8");
    expect(js).toContain("export"); // ESM
    expect(js).not.toMatch(/^import /m); // self-contained, no bare imports
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "theme.json"), "utf-8"));
    expect(manifest.manifest_version).toBe(2);
    expect(manifest.entry).toBe("theme.js");
  });

  it("appends the digest of every theme it built to known-builtin-digests.json", () => {
    const known: Record<string, string[]> = JSON.parse(
      fs.readFileSync(KNOWN_DIGESTS, "utf-8"),
    );
    const ids = fs
      .readdirSync(THEMES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const digest = digestOfDir(path.join(THEMES_DIR, id));
      const knownForId = known[id];
      expect(knownForId, `no known digests for bundled theme '${id}'`).toBeDefined();
      // Guards the list's shape: a digest appended as a string instead of an
      // array would spread into single hex characters, each of which could
      // still satisfy a `toContain` on a digest that was already listed.
      for (const entry of knownForId) {
        expect(entry, `malformed digest for '${id}'`).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(knownForId, `digest ${digest} of bundled theme '${id}' is missing`).toContain(
        digest,
      );
    }
  });
});
