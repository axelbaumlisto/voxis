#!/usr/bin/env bash
# Task 1a iOS cross-build gate ("Гейты консистентности" #5): `voxis-core`
# must stay buildable for iOS with zero feature flags (no tauri/cpal/rdev/
# enigo/arboard/objc2*/core-foundation). Run from any checkout location;
# `cd` below just anchors relative paths, the workspace root is discovered
# by Cargo walking up from there to the repo-root `Cargo.toml`.
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"

rustup target add aarch64-apple-ios >/dev/null 2>&1 || true
rustup target add aarch64-apple-ios-sim >/dev/null 2>&1 || true

cargo build -p voxis-core --target aarch64-apple-ios
cargo build -p voxis-core --target aarch64-apple-ios-sim

# tauri-plugin-voxis must also stay iOS-buildable without the `desktop`
# feature (default features = [], no cpal/rdev).
cargo build -p tauri-plugin-voxis --target aarch64-apple-ios
cargo build -p tauri-plugin-voxis --target aarch64-apple-ios-sim

# Spotlight indexing the target dir slows/derails iOS cross-builds; skip it.
[ -d ../target ] && touch ../target/.metadata_never_index || true
