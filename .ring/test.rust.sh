# Ring test entry for the Rust stack (ring ADR 0007, per-stack entry).
#
# Two workspace members are excluded because their build scripts cannot run in
# the ring's sandbox (read-only source tree, no network):
#   - `voice` (src-tauri): `ort-sys` downloads ONNX Runtime at build time;
#   - `host-min` (the plugin's example app): tauri's build script writes its
#     generated permission manifests into the source tree (measured on ring
#     run eb6bca01: "Read-only file system (os error 30)").
# voxis-core, tauri-plugin-voxis and voxis-fake-stt run against the prefetched
# cargo cache the ring provides read-only at $RING_DEPS; cargo needs a writable
# CARGO_HOME even offline, so the cache is copied into the per-run scratch.
# The vitest suite keeps the ring's node stack default; nothing here touches it.
set -eu
cp -a "$RING_DEPS/cargo" "$RING_SCRATCH/cargo"
export CARGO_HOME="$RING_SCRATCH/cargo" CARGO_TARGET_DIR="$RING_SCRATCH/target"
cargo test --locked --offline --workspace --exclude voice --exclude host-min
