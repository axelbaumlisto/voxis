// scripts/build-themes.ts
/**
 * Bundles src/theme-engine/builtin/<id>/index.ts into a self-contained
 * ESM `theme.js` (+ copied `theme.json` manifest) for **two** consumers,
 * from the same `Bun.build` output so both are always byte-identical to
 * what the bundler actually produced for that theme:
 *
 * - `src-tauri/themes/<id>/` — seeded to `<config>/themes` at desktop
 *   startup (unchanged; this output's bytes must not change as part of
 *   adding the second target — see guest-js's build-themes round-trip
 *   test, which diffs this directory).
 * - `crates/tauri-plugin-voxis/guest-js/src/themes/generated/<id>/` —
 *   the plugin's static `ThemeRegistry` (Task 5,
 *   `[R1-Safety S3 / R2-Coherence F2]`): guest-js imports these
 *   self-contained modules directly (no `loader.ts`/Blob/data-URL
 *   `import()`, which naked's CSP `script-src 'self'` would block), so
 *   they're checked in the same way `src-tauri/themes` already is
 *   (`git ls-files src-tauri/themes` — committed build output, not
 *   gitignored) rather than generated on the fly before every test run.
 *
 * Run via `bun run build:themes`.
 *
 * Every theme's digest (see `scripts/theme-digest.ts`) of the bytes written to
 * `src-tauri/themes/<id>/` is appended — never removed — to
 * `src-tauri/known-builtin-digests.json`, so the app recognises a copy of this
 * exact bundle as pristine and can move it aside instead of letting it shadow
 * the builtin forever.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  KNOWN_DIGESTS_FILE,
  type KnownDigests,
  themeDigest,
  updateKnownBuiltinDigests,
} from "./theme-digest";

const ROOT = path.resolve(import.meta.dir, "..");

// `[fixed per REJECT-FIX L2]` `Bun.build`'s emitted `// <path>` source
// banner comments (visible inside every `theme.js` output, e.g.
// `// src/theme-engine/renderers/bars.ts`) are computed relative to
// `process.cwd()`, *not* relative to `ROOT`/`import.meta.dir` above —
// even though every path this script passes to `Bun.build` is already
// absolute. Running this script from a different cwd (e.g. guest-js's
// own `bun run build`, which used to `cd` into `guest-js/` first)
// therefore changed those banner comments and made
// `src-tauri/themes/**/theme.js` byte-differ from a run at the repo
// root, breaking the "both outputs are byte-identical to what the
// bundler produced" guarantee this file's own module doc comment makes.
// Forcing `cwd` to `ROOT` here — once, before any `Bun.build` call —
// makes the output deterministic no matter which directory (or `bun
// --cwd ...`) this script was invoked from; verified from both the repo
// root and `crates/tauri-plugin-voxis/guest-js/` in `__tests__/build-
// themes-drift.test.ts`.
process.chdir(ROOT);

const BUILTIN_DIR = path.join(ROOT, "src/theme-engine/builtin");
const OUT_DIRS = [
  path.join(ROOT, "src-tauri/themes"),
  path.join(ROOT, "crates/tauri-plugin-voxis/guest-js/src/themes/generated"),
];

const ids = fs.readdirSync(BUILTIN_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("__") && !e.name.startsWith("_"))
  .map((e) => e.name);

/** Digests of the themes built by this run, merged into the known list below. */
const currentDigests: KnownDigests = {};

for (const id of ids) {
  const entry = path.join(BUILTIN_DIR, id, "index.ts");
  const manifest = path.join(BUILTIN_DIR, id, "manifest.json");

  const result = await Bun.build({
    entrypoints: [entry],
    format: "esm",
    minify: false,        // themes are documentation — keep readable
    target: "browser",
  });
  if (!result.success) {
    console.error(`build failed for ${id}:`, result.logs);
    process.exit(1);
  }
  const themeJs = await result.outputs[0].text();

  for (const outDir of OUT_DIRS) {
    const out = path.join(outDir, id);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "theme.js"), themeJs);
    fs.copyFileSync(manifest, path.join(out, "theme.json"));
  }
  // The digest of what was just built: exactly the two files each bundle
  // folder holds, in the shape `ThemeSource::files` returns them.
  currentDigests[id] = [
    themeDigest([
      { name: "theme.js", bytes: new TextEncoder().encode(themeJs) },
      { name: "theme.json", bytes: fs.readFileSync(manifest) },
    ]),
  ];
  console.log(`built ${id}`);
}

const knownDigestsFile = path.join(ROOT, KNOWN_DIGESTS_FILE);
const appended = updateKnownBuiltinDigests(knownDigestsFile, currentDigests);
console.log(
  appended
    ? `appended ${ids.length} digests to ${KNOWN_DIGESTS_FILE}`
    : `${KNOWN_DIGESTS_FILE} already has every built digest`,
);
