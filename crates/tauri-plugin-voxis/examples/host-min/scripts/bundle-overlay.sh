#!/usr/bin/env bash
# Builds guest-js (`bun install` + `bun run build`, producing
# `dist/index.js`) and bundles it (+ its `@tauri-apps/api` dependency)
# into ONE self-contained ESM file under `ui/vendor/
# voxis-overlay.bundle.js` -- host-min ships no bundler/dev server of its
# own (`ui/index.html` + plain `main.js`, `frontendDist` points straight
# at `ui/`), and `guest-js/dist/*.js`'s own relative imports are
# extensionless (TS `moduleResolution: bundler` output, e.g.
# `import ... from "./client"`) -- native browser ESM requires the `.js`
# extension on every specifier, so loading `dist/index.js` directly under
# `tauri.conf.json`'s `script-src 'self'` CSP fails to resolve. `bun
# build` (already the toolchain's own bundler; no new dependency) inlines
# every relative import AND the `@tauri-apps/api/{core,event}` bare
# imports into one flat file with zero remaining `import` statements --
# see this crate's README.md ("guest-js overlay under the CSP") for why
# this was chosen over an import map (would need a hand-maintained entry
# per internal module, including ones nested inside `themes/
# registry.js`) or a `tauri-driver`-only fix.
#
# `ui/vendor/` is GITIGNORED (review fix F4: a 44k-line vendored bundle
# committed to the tree can silently drift from `guest-js` with no
# signal) -- this script is the single source of truth for that
# directory's contents and MUST run before `cargo build -p host-min`
# (Tauri embeds `frontendDist` at compile time, so a stale/missing bundle
# at build time ships stale/missing JS, not a build failure) --
# `host-min-smoke.sh` and the `.forgejo/workflows/ci.yml` `host-min-e2e`
# job both call this first.
set -euo pipefail
cd "$(dirname "$0")/.."  # -> examples/host-min

guest_js_dir="../../guest-js"
guest_js_dist="$guest_js_dir/dist/index.js"
out_dir="ui/vendor"
out_file="$out_dir/voxis-overlay.bundle.js"

echo "=== guest-js: bun install + bun run build ==="
(cd "$guest_js_dir" && bun install --frozen-lockfile && bun run build)

if [ ! -f "$guest_js_dist" ]; then
  echo "error: $guest_js_dist is still missing after 'bun run build'" >&2
  exit 1
fi

mkdir -p "$out_dir"
bun build "$guest_js_dist" --outfile="$out_file" --format=esm --target=browser

echo "wrote $out_file"
