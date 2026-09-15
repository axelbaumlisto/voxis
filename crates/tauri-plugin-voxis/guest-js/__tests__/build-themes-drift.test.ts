// crates/tauri-plugin-voxis/guest-js/__tests__/build-themes-drift.test.ts
/**
 * `[fixed per REJECT-FIX L1]` `scripts/build-themes.ts`'s module doc
 * comment claims both output directories are "always byte-identical to
 * what the bundler actually produced for that theme" — this test is the
 * guard that actually enforces that claim instead of just asserting it
 * in a comment.
 *
 * Byte-compares the two **checked-in** outputs directly
 * (`src-tauri/themes/<id>/theme.js` vs. this package's own
 * `src/themes/generated/<id>/theme.js`) rather than re-running
 * `bun run build:themes` from inside vitest: both directories are
 * committed build output (same convention — see `git ls-files
 * src-tauri/themes`), so if they ever drift apart (one was regenerated
 * and committed, the other wasn't, or `build-themes.ts` stops writing
 * both from the same `Bun.build` result), this test catches it without
 * needing to shell out to `bun` from the test runner.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..", "..");
const SRC_TAURI_THEMES = join(REPO_ROOT, "src-tauri", "themes");
const GENERATED_THEMES = join(PACKAGE_ROOT, "src", "themes", "generated");

function themeIds(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

describe("build-themes.ts's two outputs (src-tauri/themes, guest-js/src/themes/generated)", () => {
  it("list exactly the same theme ids", () => {
    expect(themeIds(GENERATED_THEMES)).toEqual(themeIds(SRC_TAURI_THEMES));
  });

  it.each(themeIds(GENERATED_THEMES))("%s: theme.js is byte-identical in both outputs", (id) => {
    const fromSrcTauri = readFileSync(join(SRC_TAURI_THEMES, id, "theme.js"));
    const fromGuestJs = readFileSync(join(GENERATED_THEMES, id, "theme.js"));
    expect(fromGuestJs.equals(fromSrcTauri), `${id}/theme.js drifted between the two build-themes.ts outputs`).toBe(
      true
    );
  });

  it.each(themeIds(GENERATED_THEMES))("%s: theme.json is byte-identical in both outputs", (id) => {
    const fromSrcTauri = readFileSync(join(SRC_TAURI_THEMES, id, "theme.json"));
    const fromGuestJs = readFileSync(join(GENERATED_THEMES, id, "theme.json"));
    expect(fromGuestJs.equals(fromSrcTauri), `${id}/theme.json drifted between the two build-themes.ts outputs`).toBe(
      true
    );
  });
});
