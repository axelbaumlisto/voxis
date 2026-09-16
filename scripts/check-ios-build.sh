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

# S2/S3 (BLIND_SDK_swift.md finding #2): the pure numeric level/cap/WAV
# rules live in the Tauri-free `VoxisAudioMath` SwiftPM target
# (`ios/Sources/VoxisAudioMath`) precisely so they're testable on a plain
# macOS host -- but `swift test` with no arguments still plans a build of
# EVERY target in the package (a SwiftPM default, not specific to this
# package), including the main `tauri-plugin-voxis` target and its `Tauri`
# dependency, both of which `import UIKit` and cannot compile for a macOS
# host at all. Building the test bundle PRODUCT by name first (which only
# pulls in its own dependency graph -- `VoxisAudioMath` + the test target,
# never `tauri-plugin-voxis`/`Tauri`) and then running `swift test
# --skip-build` against that already-built bundle is the one invocation
# order that actually stays inside the Tauri-free subgraph.
cd ../crates/tauri-plugin-voxis/ios
arch -arm64 swift build --product tauri-plugin-voxisPackageTests
arch -arm64 swift test --skip-build
