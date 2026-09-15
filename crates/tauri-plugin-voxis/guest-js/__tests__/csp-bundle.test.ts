// crates/tauri-plugin-voxis/guest-js/__tests__/csp-bundle.test.ts
/**
 * The real CSP enforcement gate (jsdom, used by every other test file in
 * this package, does not implement CSP at all — see overlay.test.ts's
 * doc comment). Instead: build this package for real (`tsc`, same as
 * `bun run build`) and grep every emitted `.js` file for the substrings
 * that would only ever appear if something tried a dynamic Blob/data-URL
 * `import()`, or ran arbitrary string-sourced code at all
 * (`loader.ts`/`fetchModule.ts`'s approach, deliberately not used here —
 * `themes/registry.ts`'s doc comment) — under naked's
 * `default-src 'self'; script-src 'self'`, a `blob:`/`data:` script
 * source is not `'self'` and the load is blocked, and `'unsafe-eval'`
 * isn't in that CSP either, so `eval()`/`new Function(...)` would be
 * blocked too. A regression that reintroduces any of these fails *this*
 * test, not just a manual check.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(PACKAGE_ROOT, "dist");

/**
 * `[fixed per REJECT-FIX L5]` was `execFileSync("npx", ["tsc", ...])` —
 * `npx` re-resolves (and can fetch) a package on every invocation,
 * network-dependent and slower, and isn't guaranteed to run the exact
 * `typescript` devDependency this package already pinned via
 * `bun install`. Invoking the installed binary directly under
 * `node_modules/.bin/` is hermetic (no network, no version drift) and
 * faster.
 */
const TSC_BIN = join(PACKAGE_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");

function listJsFilesRecursively(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listJsFilesRecursively(full));
    } else if (entry.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

beforeAll(() => {
  // Idempotent — `tsc` overwrites `dist/` with the current sources every
  // time, so this is correct whether or not `bun run build` already ran.
  execFileSync(TSC_BIN, ["-p", "tsconfig.json"], { cwd: PACKAGE_ROOT, stdio: "pipe" });
}, 60_000);

describe("built dist/ bundle — CSP guard", () => {
  it("dist/index.js and dist/index.d.ts exist", () => {
    expect(existsSync(join(DIST_DIR, "index.js"))).toBe(true);
    expect(existsSync(join(DIST_DIR, "index.d.ts"))).toBe(true);
  });

  it("no emitted .js file contains a blob: URL string", () => {
    const files = listJsFilesRecursively(DIST_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const contents = readFileSync(file, "utf-8");
      expect(contents.includes("blob:"), `${file} must not reference a blob: URL`).toBe(false);
    }
  });

  it("no emitted .js file contains a data:text/javascript URL string", () => {
    const files = listJsFilesRecursively(DIST_DIR);
    for (const file of files) {
      const contents = readFileSync(file, "utf-8");
      expect(contents.includes("data:text/javascript"), `${file} must not reference a data:text/javascript URL`).toBe(
        false
      );
    }
  });

  it("no emitted .js file calls the dynamic import() form at all (every theme import is static)", () => {
    const files = listJsFilesRecursively(DIST_DIR);
    for (const file of files) {
      const contents = readFileSync(file, "utf-8");
      // A dynamic import() call looks like `import(` (a function call);
      // static `import ... from "..."` never has the open-paren directly
      // after the keyword. `import.meta` doesn't match this pattern either.
      expect(/\bimport\s*\(/.test(contents), `${file} must not use dynamic import()`).toBe(false);
    }
  });

  it("no emitted .js file calls new Function(...) (arbitrary string-sourced code, blocked by CSP without 'unsafe-eval')", () => {
    const files = listJsFilesRecursively(DIST_DIR);
    for (const file of files) {
      const contents = readFileSync(file, "utf-8");
      expect(/\bnew\s+Function\s*\(/.test(contents), `${file} must not use new Function(...)`).toBe(false);
    }
  });

  it("no emitted .js file calls eval(...) (blocked by CSP without 'unsafe-eval')", () => {
    const files = listJsFilesRecursively(DIST_DIR);
    for (const file of files) {
      const contents = readFileSync(file, "utf-8");
      expect(/\beval\s*\(/.test(contents), `${file} must not use eval(...)`).toBe(false);
    }
  });
});
