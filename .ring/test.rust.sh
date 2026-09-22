# Ring test entry for the Rust stack (ring ADR 0007, per-stack entry).
#
# The desktop crate `voice` (src-tauri) is excluded: its `ort-sys` build script
# downloads ONNX Runtime at build time, which the offline `--network none`
# sandbox cannot do. The remaining workspace members (voxis-core,
# tauri-plugin-voxis, host-min, voxis-fake-stt) run against the prefetched
# cargo cache the ring provides read-only at $RING_DEPS; cargo needs a writable
# CARGO_HOME even offline, so the cache is copied into the per-run scratch.
# The vitest suite keeps the ring's node stack default; nothing here touches it.
set -eu
cp -a "$RING_DEPS/cargo" "$RING_SCRATCH/cargo"
export CARGO_HOME="$RING_SCRATCH/cargo" CARGO_TARGET_DIR="$RING_SCRATCH/target"
cargo test --locked --offline --workspace --exclude voice
