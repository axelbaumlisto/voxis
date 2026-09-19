#!/usr/bin/env bash
# B2 (2026-09-19): the ONE way to cut a `plugin-v*` tag. Runs every gate the
# plugin's mobile halves depend on and that no desktop test run covers, THEN
# tags. plugin-v0.3.0 was tagged with a stray `}` in the iOS-only mobile.rs;
# the tag is immutable, so it cost a 0.3.1. A `plugin-v*` tag also never
# triggers release.yml (its filter is `v*`), so nothing downstream would have
# caught it either.
#
#   scripts/tag-plugin.sh 0.4.2 "one-line message"
#
# Refuses when: the tree is dirty, the version does not match
# crates/tauri-plugin-voxis/Cargo.toml, or any gate is red.
set -euo pipefail
cd "$(dirname "$0")/.."

ver="${1:?usage: tag-plugin.sh <X.Y.Z> <message>}"
msg="${2:?usage: tag-plugin.sh <X.Y.Z> <message>}"
tag="plugin-v$ver"

[ -z "$(git status --porcelain)" ] || { echo "tree is dirty -- commit first" >&2; exit 1; }
crate_ver="$(grep -m1 '^version = ' crates/tauri-plugin-voxis/Cargo.toml | sed 's/version = "\(.*\)"/\1/')"
[ "$crate_ver" = "$ver" ] || { echo "Cargo.toml says $crate_ver, you asked for $ver" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && { echo "$tag already exists (tags are immutable: bump instead)" >&2; exit 1; }

echo "=== desktop: cargo test + clippy -D warnings (tauri-plugin-voxis, voxis-core) ==="
cargo test -p voxis-core -p tauri-plugin-voxis --features tauri-plugin-voxis/desktop -q
cargo clippy -p voxis-core -p tauri-plugin-voxis --features tauri-plugin-voxis/desktop --all-targets -- -D warnings

echo "=== guest-js: build + test ==="
(cd crates/tauri-plugin-voxis/guest-js && bun install --frozen-lockfile >/dev/null && bun run build >/dev/null && bun run test >/dev/null)

if [ "$(uname -s)" = "Darwin" ]; then
  echo "=== iOS: scripts/check-ios-build.sh (cross-build + Swift package tests) ==="
  bash scripts/check-ios-build.sh
else
  echo "::warning::not macOS -- iOS gate skipped here; release.yml's macOS-VM lane is the other place it runs" >&2
fi

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
[ -d "$sdk/ndk" ] || sdk="$HOME/Android/Sdk"
ndk="$(ls -d "$sdk"/ndk/* 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "$ndk" ]; then
  host="$(uname -s | tr 'A-Z' 'a-z')-x86_64"; [ "$(uname -s)" = "Darwin" ] && host="darwin-x86_64"
  bin="$ndk/toolchains/llvm/prebuilt/$host/bin"
  clang="$(ls "$bin"/aarch64-linux-android*-clang 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$clang" ]; then
    echo "=== Android: cargo check aarch64-linux-android (NDK $ndk) ==="
    rustup target add aarch64-linux-android >/dev/null
    CC_aarch64_linux_android="$clang" AR_aarch64_linux_android="$bin/llvm-ar" \
    CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$clang" \
      cargo check -p voxis-core -p tauri-plugin-voxis --target aarch64-linux-android
  else
    echo "::warning::NDK found but no aarch64 clang under $bin -- Android gate skipped" >&2
  fi
else
  echo "::warning::no Android NDK on this machine -- Android gate skipped here; ci.yml runs it on the runner host" >&2
fi

git tag -a "$tag" -m "tauri-plugin-voxis $ver -- $msg"
echo "tagged $tag at $(git rev-parse --short HEAD); push with: git push forgejo $tag"
