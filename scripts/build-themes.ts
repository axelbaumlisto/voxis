// scripts/build-themes.ts
/**
 * Bundles src/theme-engine/builtin/<id>/index.ts into
 * src-tauri/themes/<id>/theme.js (self-contained ESM) and copies
 * manifest.json → theme.json. Run via `bun run build:themes`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const BUILTIN_DIR = path.join(ROOT, "src/theme-engine/builtin");
const OUT_DIR = path.join(ROOT, "src-tauri/themes");

const ids = fs.readdirSync(BUILTIN_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("__"))
  .map((e) => e.name);

for (const id of ids) {
  const entry = path.join(BUILTIN_DIR, id, "index.ts");
  const manifest = path.join(BUILTIN_DIR, id, "manifest.json");
  const out = path.join(OUT_DIR, id);
  fs.mkdirSync(out, { recursive: true });

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
  fs.writeFileSync(path.join(out, "theme.js"), await result.outputs[0].text());
  fs.copyFileSync(manifest, path.join(out, "theme.json"));
  console.log(`built ${id}`);
}
