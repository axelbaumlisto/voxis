#!/usr/bin/env bash
# Voxis macOS app build on the shared macOS 26 VM (spex) — runs INSIDE the guest.
#
#   ~/macos-xcode26-vm/vm.sh build voxis <sha> -- 'bash scripts/ci/mac-shared-vm.sh'
#
# vm.sh already sets up everything this script needs before running it:
#   - cwd = ~/src/voxis at <sha> (`git checkout --force --detach <sha>` +
#     `git clean -ffdx` keeping CLEAN_KEEP, so this is the committed tree);
#   - build.keychain unlocked (the Developer ID identity) and
#     `~/.secrets/apple.env` sourced, which gives SIGNING_IDENTITY,
#     APPLE_NOTARY_PROFILE=team-notary (stored in build.keychain by
#     `vm.sh creds --import`), APPLE_API_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID;
#   - PATH with ~/.cargo/bin + ~/.bun/bin.
# Artifacts are written to ./artifacts-mac/ (apps/voxis.conf's ARTIFACTS) and
# vm.sh rsyncs that dir to ~/macos-xcode26-vm/out/voxis/<sha>/artifacts-mac/.
#
# This script is the app's ONLY macOS lane: one run produces the signed .app ->
# notarized + stapled -> DMG -> notarized + stapled, plus the bare arm64 binary
# Homebrew pins, which is re-signed and therefore notarized on its own (a bare
# Mach-O cannot be stapled; its ticket is looked up online by Gatekeeper).
#
# The signing/notarization steps follow the parts that worked in the retired
# Docker-OSX lane; every step here is fatal, with no "degrade to ad-hoc"
# branches.
set -euo pipefail

# Repo root of the checkout vm.sh synced (scripts/ci/mac-shared-vm.sh -> ../..).
cd "$(dirname "$0")/../.."

TRIPLE=aarch64-apple-darwin
APP="target/$TRIPLE/release/bundle/macos/Voxis.app"
ENTITLEMENTS=src-tauri/Entitlements.plist
OUT=artifacts-mac
NOTARY_TIMEOUT=30m

die() { echo "ERROR: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

# ---- preconditions -----------------------------------------------------------
VERSION=$(grep -m1 '^version' src-tauri/Cargo.toml | cut -d'"' -f2)
[[ -n "$VERSION" ]] || die "cannot read version from src-tauri/Cargo.toml"
TAURI_VERSION=$(grep -m1 '"version"' src-tauri/tauri.conf.json | cut -d'"' -f4)
[[ "$TAURI_VERSION" == "$VERSION" ]] \
  || die "version mismatch: src-tauri/Cargo.toml=$VERSION vs src-tauri/tauri.conf.json=$TAURI_VERSION"
echo "version: $VERSION"

# Signing state comes from the shared VM's creds layer. Fail here, loudly, rather
# than shipping anything unsigned: this lane has no ad-hoc fallback.
[[ -n "${SIGNING_IDENTITY:-}" ]] \
  || die "SIGNING_IDENTITY is empty — vm.sh sources ~/.secrets/apple.env from the creds layer; check the creds layer is the imported one"
[[ -n "${APPLE_NOTARY_PROFILE:-}" ]] \
  || die "APPLE_NOTARY_PROFILE is empty — expected team-notary (stored in build.keychain by 'vm.sh creds --import')"
# No `... | grep -q` here or below: `pipefail` would turn a harmless SIGPIPE from
# grep's early exit into a failed step.
identities=$(security find-identity -v -p codesigning) || identities=''
[[ "$identities" == *'Developer ID Application'* ]] \
  || die "no 'Developer ID Application' identity in the keychain — is build.keychain unlocked/imported? ($identities)"
installed_targets=$(rustup target list --installed)
[[ $'\n'"$installed_targets"$'\n' == *$'\n'"$TRIPLE"$'\n'* ]] \
  || die "rustup target $TRIPLE not installed in the guest (vm.sh layer voxis --prepare: rustup target add $TRIPLE)"

rm -rf "$OUT"
mkdir -p "$OUT"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# ---- build -------------------------------------------------------------------
T0=$SECONDS
step "bun install --frozen-lockfile"
bun install --frozen-lockfile

step "tauri build --target $TRIPLE --bundles app (signing as $SIGNING_IDENTITY)"
# CI=true: headless, so tauri skips the Finder/AppleScript window dressing.
export CI=true
# Tauri signs the .app it bundles with this identity (overriding the config's
# "-" ad-hoc placeholder); the inside-out re-sign below is still required for
# the extra binaries in Contents/MacOS.
export APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY"
# Tauri starts its own notarization when any of these is set — a second, UNSTAPLED
# pass. The notary steps at the bottom are the only ones allowed to talk to Apple
# (same reason naked's mac.sh/scripts/build-mac.sh unsets them).
unset APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH APPLE_ID APPLE_PASSWORD
# `--bundles app` only: Tauri's own DMG bundler drives AppleScript window
# dressing that needs a GUI session and fails headless; the DMG is assembled
# with hdiutil below for the same reason.
bun run tauri build --target "$TRIPLE" --bundles app
BUILD_SECONDS=$((SECONDS - T0))
echo "BUILD_SECONDS=$BUILD_SECONDS"

[[ -d "$APP" ]] || die "no .app at $APP"
[[ -x "$APP/Contents/MacOS/voice" ]] || die "no voice binary in $APP/Contents/MacOS"

# ---- sign (inside-out) + verify ---------------------------------------------
step "signing $APP"
# Inner binaries first, then the bundle — Apple's inside-out signing order.
# Incident (v0.1.3 run 4295): notarization returned Invalid because only
# `voice` was re-signed — the bundle's second [[bin]], typing_bench
# (Contents/MacOS/typing_bench), kept Tauri's non-Developer-ID signature, and
# notarization validates every Mach-O in the archive. Sign ALL executables and
# bundled dylibs/frameworks generically instead of naming one file.
#
# `--force` discards whatever entitlements Tauri's own build-time signing
# applied, so re-supply them on BOTH codesign calls: without them Hardened
# Runtime silently blocks mic access and the Accessibility-prompt Apple Event.
for f in "$APP"/Contents/MacOS/* "$APP"/Contents/Frameworks/*; do
  [[ -e "$f" ]] || continue
  [[ "$(file -b "$f")" == *Mach-O* ]] || continue
  codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$SIGNING_IDENTITY" "$f"
done
codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$SIGNING_IDENTITY" "$APP"

step "verifying signature, arch and entitlements"
codesign --verify --strict --deep --verbose=2 "$APP"
# The arm64 .app cannot RUN in the x86_64 guest (no Rosetta): verify with
# `lipo` + `codesign`, never by executing the binary.
for f in "$APP"/Contents/MacOS/*; do
  [[ -e "$f" ]] || continue
  [[ "$(file -b "$f")" == *Mach-O* ]] || continue
  archs=$(lipo -archs "$f" | tr -d '[:space:]')
  [[ "$archs" == "arm64" ]] || die "expected arm64, lipo -archs says '$archs' for $f"
  ent=$(codesign -d --entitlements :- "$f" 2>/dev/null) || ent=''
  [[ "$ent" == *audio-input* ]] || die "entitlements missing audio-input on $f after signing"
  cs_info=$(codesign -d --verbose=2 "$f" 2>&1) || die "codesign cannot read the signature of $f: $cs_info"
  [[ "$cs_info" == *'flags=0x10000(runtime)'* ]] || die "hardened runtime not enabled on $f"
done
codesign -d --verbose=2 "$APP" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier)' || true
echo "signature, arch (arm64) and entitlements OK on every Mach-O in Contents/MacOS"

# ---- notarize + staple (used for the .app and the .dmg; notarize only for the
# ---- bare Mach-O, which has no bundle to staple a ticket into) ---------------
# `--wait` is required; the output is captured and printed even on failure so a
# rejected submission (or an auth/agreement error from Apple, which is in the
# output and not in the exit code) is never swallowed by `set -e` — v0.1.16
# died at exactly this point with nothing but rc=1.
notarize_and_staple() { # <path to .app, .dmg or bare Mach-O>
  local target=$1
  local submit_path=$target zip=''
  if [[ "$target" != *.dmg ]]; then
    # notarytool takes a zip for a bundle and for a bare Mach-O alike; `ditto`
    # keeps the bundle's metadata. Only disk images are submitted as-is.
    zip="$WORK/$(basename "$target").zip"
    rm -f "$zip"
    ditto -c -k --keepParent "$target" "$zip"
    submit_path=$zip
  fi
  echo "submitting $(basename "$submit_path") to Apple (timeout $NOTARY_TIMEOUT)"
  local out rc=0 id status
  out=$(xcrun notarytool submit "$submit_path" --keychain-profile "$APPLE_NOTARY_PROFILE" \
          --wait --timeout "$NOTARY_TIMEOUT" 2>&1) || rc=$?
  printf '%s\n' "$out"
  id=$(printf '%s\n' "$out" | awk '/^ *id: /{print $2; exit}')
  status=$(printf '%s\n' "$out" | awk '/^ *status: /{print $2; exit}')
  if [[ $rc -ne 0 || "$status" != "Accepted" ]]; then
    echo "ERROR: notarization of $target failed (rc=$rc, status=${status:-unknown})" >&2
    if [[ -n "$id" ]]; then
      xcrun notarytool log "$id" --keychain-profile "$APPLE_NOTARY_PROFILE" || true
    fi
    return 1
  fi
  if [[ "$target" == *.app || "$target" == *.dmg ]]; then
    xcrun stapler staple "$target"
    xcrun stapler validate "$target"
    if [[ "$target" == *.app ]]; then
      spctl -a -vv -t exec "$target"
    else
      spctl -a -t open --context context:primary-signature -v "$target"
    fi
    echo "notarized + stapled: $target"
    return 0
  fi
  # A bare Mach-O cannot be stapled (nothing holds a ticket), and Gatekeeper's
  # online ticket lookup for it can lag right after acceptance, so this check is
  # informational only: notarytool status Accepted above is the gate.
  spctl -a -vv -t exec "$target" || true
  echo "notarized (bare Mach-O, not stapled): $target"
}

NOTARIZE_T0=$SECONDS
step "notarizing $APP"
notarize_and_staple "$APP"

# ---- DMG ---------------------------------------------------------------------
step "building + signing the DMG"
DMG="$OUT/Voxis_${VERSION}_aarch64.dmg"
rm -rf "$WORK/dmgroot"
mkdir -p "$WORK/dmgroot"
ditto "$APP" "$WORK/dmgroot/Voxis.app"
ln -s /Applications "$WORK/dmgroot/Applications"
hdiutil create -volname "Voxis" -srcfolder "$WORK/dmgroot" -ov -format UDZO "$DMG"
codesign --force --timestamp --sign "$SIGNING_IDENTITY" "$DMG"

step "notarizing $DMG"
notarize_and_staple "$DMG"

# ---- bare arm64 binary for Homebrew -----------------------------------------
step "bare arm64 binary for Homebrew (voxis-macos-arm64)"
# Ship the SIGNED in-bundle `voice` (not a second plain `cargo build` copy):
# Homebrew installs exactly this file as `voxis` (homebrew-tap/Formula/voxis.rb,
# scripts/ci/update-homebrew.sh; its test runs `voxis --version`, which main.rs
# answers with `voxis <version>` before the GUI starts), so brew users get the
# same Developer-ID signed, hardened-runtime Mach-O the DMG ships — one build,
# no chance of the two diverging.
cp "$APP/Contents/MacOS/voice" "$OUT/voxis-macos-arm64"
chmod +x "$OUT/voxis-macos-arm64"
# The copy still carries the bundle-bound signature (Info.plist/CodeResources
# hashes) and does not verify standalone — re-sign it as a plain Mach-O.
codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$SIGNING_IDENTITY" "$OUT/voxis-macos-arm64"
codesign --verify --strict --verbose=2 "$OUT/voxis-macos-arm64"
archs=$(lipo -archs "$OUT/voxis-macos-arm64" | tr -d '[:space:]')
[[ "$archs" == "arm64" ]] || die "expected arm64, lipo -archs says '$archs' for voxis-macos-arm64"
# That re-sign gives the bare binary its own cdhash, so the .app's notarization
# does not cover it: without this step the developer-ID signature is rejected by
# Gatekeeper (`source=Unnotarized Developer ID`) for anyone who downloads the
# binary from the GitHub release in a browser. Homebrew escapes it only because
# brew installs without the quarantine attribute.
step "notarizing $OUT/voxis-macos-arm64"
notarize_and_staple "$OUT/voxis-macos-arm64"
NOTARIZE_SECONDS=$((SECONDS - NOTARIZE_T0))
echo "NOTARIZE_SECONDS=$NOTARIZE_SECONDS"
# Same archive layout the formula expects (binary at the tarball root, no
# directory prefix; `bin.install "voxis-macos-arm64"`).
tar -C "$OUT" -czf "$OUT/voxis-macos-arm64.tar.gz" voxis-macos-arm64

# ---- report ------------------------------------------------------------------
for a in "Voxis_${VERSION}_aarch64.dmg" voxis-macos-arm64 voxis-macos-arm64.tar.gz; do
  [[ -s "$OUT/$a" ]] || die "expected artifact missing or empty: $OUT/$a"
done
step "artifacts in $PWD/$OUT"
ls -lh "$OUT"
shasum -a 256 "$OUT"/*
echo
echo "BUILD_SECONDS=$BUILD_SECONDS"
echo "NOTARIZE_SECONDS=$NOTARIZE_SECONDS"
