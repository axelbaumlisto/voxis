// crates/tauri-plugin-voxis/guest-js/vite.harness.config.ts
// Dev-server-only config for `bun run harness:overlay` (root script) /
// `bun run harness` (this package) — serves `harness/index.html`, which
// imports `../src/index.ts` directly (Vite's dev server transpiles TS
// on the fly, no build step needed) with a mock `invoke`/`listen` so
// `<voxis-overlay>` can be eyeballed with fake levels, no Tauri runtime
// required. Not used by `bun run build` (that's plain `tsc`, see
// package.json) — this file exists solely for the interactive harness,
// same split as the root `harness`/`build` scripts for the theme-engine
// harness (`docs/THEME_EDITING.md`).
import { defineConfig } from "vite";

export default defineConfig({
  root: "harness",
  server: {
    port: 4577,
    strictPort: false,
  },
  build: {
    // `dist/` is already gitignored repo-wide; nesting the harness's own
    // build output under it (as `dist/harness`) avoids adding a new
    // ignore entry for a directory nobody needs to build/commit anyway
    // (`bun run harness`/`harness:overlay` only ever run the Vite dev
    // server, never this `build` target).
    outDir: "../dist/harness",
  },
});
