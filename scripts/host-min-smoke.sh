#!/usr/bin/env bash
# Forwarding stub (same pattern as root package.json's "e2e:host-min"
# script) -- the real implementation lives under
# crates/tauri-plugin-voxis/examples/host-min/scripts/ (Task 3.5's own
# allowed edit path); this repo-root path exists only so
# `scripts/host-min-smoke.sh` (the plan's own VERIFY command) resolves.
set -euo pipefail
exec "$(dirname "$0")/../crates/tauri-plugin-voxis/examples/host-min/scripts/host-min-smoke.sh" "$@"
