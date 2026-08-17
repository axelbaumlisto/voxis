#!/usr/bin/env bash
# macOS build VM (Docker-OSX) for building unsigned Voxis binaries on spex.
# Uses the prepared clipshot macOS image at ~/clipshot-macos-vm/mac_hdd_ng.prepared.img.
set -euo pipefail

VM_DIR="${CLIPSHOT_MACOS_VM_DIR:-$HOME/clipshot-macos-vm}"
NAME="voxis-macos"
IMAGE="sickcodes/docker-osx:latest"
DISK="$VM_DIR/mac_hdd_ng.img"
PREPARED="$VM_DIR/mac_hdd_ng.prepared.img"
BASESYSTEM="$VM_DIR/BaseSystem.img"
VNC_HOST_PORT="${VNC_HOST_PORT:-5998}"
SSH_HOST_PORT="${SSH_HOST_PORT:-50923}"
VM_USER="${VM_USER:-user}"
VM_PASS="${VM_PASS:-alpine}"

# ---- Apple signing config (kept OUTSIDE the repo, reusable across projects) --
# Same convention as clipshot's macos-vm.sh. File format (key=value):
#   SIGNING_IDENTITY=Developer ID Application: Name (TEAMID)
#   APPLE_API_ISSUER=<issuer uuid>
# The .p8 App Store Connect API key itself lives IN THE VM at
# ~/.appstoreconnect/private_keys/AuthKey_*.p8 (never in the repo, never on the
# host argv). The signing identity + its private key live in the VM login
# keychain. When either the env file or the VM credentials are absent, the
# build-gui lane degrades to an ad-hoc unsigned .app/DMG (Gatekeeper warns;
# xattr -cr on install) — exactly today's behavior for the bare-binary lane.
APPLE_NOTARY_ENV="${APPLE_NOTARY_ENV:-$HOME/secrets/apple-dev/notary.env}"
if [[ -f "$APPLE_NOTARY_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$APPLE_NOTARY_ENV"
fi
SHORTNAME="${SHORTNAME:-sonoma}"  # used by cmd_install (fresh macOS setup) only
PLIST='https://raw.githubusercontent.com/sickcodes/osx-serial-generator/master/config-custom-sonoma.plist'  # cmd_install only

# NOTE: GENERATE_UNIQUE is intentionally NOT set here. It makes Docker-OSX
# regenerate the OpenCore boot disk with fresh serials on every launch, which
# does not match the OpenCore the prepared image was installed with → the VM
# hangs forever at ~100% CPU on a black screen (SSH never comes up; verified
# 2026-07-23). Booting the prepared image must reuse its existing OpenCore, so
# no GENERATE_UNIQUE / MASTER_PLIST_URL / SHORTNAME here.
common_args=(
  --device /dev/kvm
  -p "${SSH_HOST_PORT}:10022"
  -p "${VNC_HOST_PORT}:5901"
  -e CPU='Haswell-noTSX'
  -e CPUID_FLAGS='kvm=on,vendor=GenuineIntel,+invtsc,vmware-cpuid-freq=on'
  -e "RAM=${RAM:-8}"
  -e "CORES=${CORES:-4}"
  -e EXTRA='-display none -vnc 0.0.0.0:1'
)

ssh_vm() {
  sshpass -p "$VM_PASS" ssh -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 \
    -p "$SSH_HOST_PORT" "$VM_USER@localhost" "$@"
}

wait_for_ssh() {
  echo "Waiting for SSH on :${SSH_HOST_PORT} ..."
  for _ in $(seq 1 90); do
    sleep 10
    ssh_vm 'echo ok' >/dev/null 2>&1 && { echo "SSH up"; return 0; }
  done
  echo "ERROR: SSH did not come up"; return 1
}

wait_for_vnc() {
  echo "Waiting for VNC (RFB) on 127.0.0.1:${VNC_HOST_PORT} ..."
  for _ in $(seq 1 60); do
    sleep 10
    local rfb
    rfb=$(timeout 5 bash -c "exec 3<>/dev/tcp/127.0.0.1/${VNC_HOST_PORT}; head -c 11 <&3" 2>/dev/null || true)
    [[ "$rfb" == RFB* ]] && { echo "VNC up: ${rfb}"; return 0; }
    docker ps --filter "name=${NAME}" --format '{{.Status}}' | grep -q Up || {
      echo "ERROR: container exited"; docker logs "$NAME" 2>&1 | tail -8; return 1; }
  done
  echo "ERROR: VNC did not come up"; return 1
}

cmd_install() {
  mkdir -p "$VM_DIR"
  docker rm -f "$NAME" 2>/dev/null || true
  if [[ ! -f "$DISK" || ! -f "$BASESYSTEM" ]]; then
    echo "Seeding disk + BaseSystem from image into $VM_DIR ..."
    local cid; cid=$(docker create "$IMAGE")
    docker cp "$cid:/home/arch/OSX-KVM/mac_hdd_ng.img" "$DISK" 2>/dev/null || true
    docker cp "$cid:/home/arch/OSX-KVM/BaseSystem.img" "$BASESYSTEM" 2>/dev/null || true
    docker rm "$cid" >/dev/null
  fi
  # Fresh install DOES need serial generation + plist (unlike naked boot).
  docker run -d --name "$NAME" --restart unless-stopped \
    -v "$DISK:/home/arch/OSX-KVM/mac_hdd_ng.img" \
    ${BASESYSTEM:+-v "$BASESYSTEM:/home/arch/OSX-KVM/BaseSystem.img"} \
    -e GENERATE_UNIQUE=true \
    -e "MASTER_PLIST_URL=${PLIST}" \
    -e "SHORTNAME=${SHORTNAME}" \
    "${common_args[@]}" "$IMAGE"
  wait_for_vnc
  echo "Install macOS, enable SSH for ${VM_USER}, then run: $0 save"
}

cmd_save() {
  local out="${1:-$PREPARED}"
  echo "Copying live disk image to $out ..."
  cp --reflink=auto "$DISK" "$out"
  ls -lh "$out"
}

cmd_naked() {
  [[ -f "$PREPARED" ]] || { echo "No prepared image at $PREPARED"; exit 1; }
  docker rm -f "$NAME" 2>/dev/null || true
  docker run -d --name "$NAME" --restart unless-stopped \
    -v "$PREPARED:/home/arch/OSX-KVM/mac_hdd_ng.img" \
    -e IMAGE_PATH=/home/arch/OSX-KVM/mac_hdd_ng.img \
    -e NOPICKER=true \
    "${common_args[@]}" "$IMAGE"
  wait_for_ssh
}

cmd_build() {
  local proj_dir; proj_dir="$(cd "$(dirname "$0")/.." && pwd)"
  command -v sshpass >/dev/null || { echo "sshpass required"; exit 1; }
  mkdir -p "$proj_dir/artifacts"
  ssh_vm 'echo ok' >/dev/null 2>&1 || cmd_naked
  echo "Syncing source into VM ..."
  ( cd "$proj_dir" && tar czf /tmp/voxis-src.tar.gz \
      --exclude='./target' --exclude='./src-tauri/target' --exclude='./.git' \
      --exclude='./node_modules' --exclude='./dist' -C "$proj_dir" . )
  sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -P "$SSH_HOST_PORT" /tmp/voxis-src.tar.gz "$VM_USER@localhost:/tmp/"
  ssh_vm 'rm -rf ~/voxis && mkdir -p ~/voxis && tar xzf /tmp/voxis-src.tar.gz -C ~/voxis'
  # PATH: bun lives in ~/.bun/bin (not on the non-interactive SSH login PATH);
  # ~/.cargo/bin holds rustup/cargo. `bun run build` (vite) does NOT need node
  # in the VM — only vitest does, and we don't run tests here.
  local vmenv='export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"; source ~/.cargo/env 2>/dev/null || true'
  ssh_vm "$vmenv; cd ~/voxis && bun install --frozen-lockfile && bun run build"
  # macOS is arm64-only (Apple Silicon). ort rc.12 ships no prebuilt ONNX
  # Runtime for x86_64-apple-darwin (only aarch64), so an Intel-mac build would
  # need ORT compiled from source. Apple Silicon covers all current Macs.
  echo "Building aarch64-apple-darwin ..."
  ssh_vm "$vmenv; cd ~/voxis/src-tauri && rustup target add aarch64-apple-darwin >/dev/null 2>&1 || true; cargo build --release --target aarch64-apple-darwin --bin voice"
  echo "Pulling artifacts ..."
  local scp="sshpass -p $VM_PASS scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -P $SSH_HOST_PORT"
  $scp "$VM_USER@localhost:/Users/$VM_USER/voxis/src-tauri/target/aarch64-apple-darwin/release/voice" "$proj_dir/artifacts/voxis-macos-arm64"
  chmod +x "$proj_dir"/artifacts/voxis-macos-* 2>/dev/null || true
  echo "macOS artifacts in artifacts/:"
  ls -lh "$proj_dir"/artifacts/voxis-macos-* 2>/dev/null
}

# Full signed/notarized GUI lane: boot prepared image, sync source, build the
# Tauri .app for aarch64-apple-darwin, Developer ID-sign + notarize + staple
# (when VM credentials are present), pack a DMG via hdiutil, and pull it back to
# artifacts/. Ported from clipshot's cmd_build_gui, adapted for Voxis:
#   - repo root holds src-tauri/ (tauri.conf.json is under src-tauri/), so
#     cargo-tauri runs from ~/voxis and auto-detects src-tauri.
#   - productName=Voxis => bundle is Voxis.app; the inner Mach-O is the cargo
#     bin `voice` (productName != bin name) so we discover it dynamically.
#   - identifier top.voxis.app; the Developer ID cert is a team cert and signs
#     any bundle id.
# Pitfalls kept from clipshot: Tauri's own --bundles dmg needs a GUI session
# (AppleScript window dressing) and fails headless, so only --bundles app is
# used and the DMG is assembled with hdiutil. The arm64 binary cannot RUN in
# the x86_64 VM (no Rosetta): verify with lipo -archs + codesign, never by
# executing it. Multi-line VM scripts go via scp (nested heredocs through
# double-ssh break quoting).
cmd_build_gui() {
  local proj_dir; proj_dir="$(cd "$(dirname "$0")/.." && pwd)"
  command -v sshpass >/dev/null || { echo "sshpass required"; exit 1; }
  mkdir -p "$proj_dir/artifacts"

  # Version consistency gate (host-side, fail early before any VM work).
  local version tauri_version
  version=$(grep -m1 '^version' "$proj_dir/src-tauri/Cargo.toml" | cut -d'"' -f2)
  [[ -n "$version" ]] || { echo "ERROR: cannot read version from src-tauri/Cargo.toml"; exit 1; }
  tauri_version=$(grep -m1 '"version"' "$proj_dir/src-tauri/tauri.conf.json" | cut -d'"' -f4)
  if [[ "$tauri_version" != *Cargo.toml* && "$tauri_version" != "$version" ]]; then
    echo "ERROR: version mismatch: Cargo.toml=$version vs tauri.conf.json=$tauri_version"; exit 1
  fi

  ssh_vm 'echo ok' >/dev/null 2>&1 || cmd_naked
  echo "Syncing source into VM ..."
  ( cd "$proj_dir" && tar czf /tmp/voxis-src.tar.gz \
      --exclude='./target' --exclude='./src-tauri/target' --exclude='./.git' \
      --exclude='./node_modules' --exclude='./dist' -C "$proj_dir" . )
  sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -P "$SSH_HOST_PORT" /tmp/voxis-src.tar.gz "$VM_USER@localhost:/tmp/"
  ssh_vm 'rm -rf ~/voxis && mkdir -p ~/voxis && tar xzf /tmp/voxis-src.tar.gz -C ~/voxis'

  # bun builds the frontend IN the VM (vite only needs bun, not node); then
  # cargo-tauri wraps the release binary into Voxis.app. arm64-only: ort rc.12
  # ships no x86_64-apple-darwin ONNX Runtime prebuilt.
  local vmenv='export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"; source ~/.cargo/env 2>/dev/null || true'
  echo "Building frontend in VM ..."
  ssh_vm "$vmenv; cd ~/voxis && bun install --frozen-lockfile && bun run build"
  echo "Building Tauri GUI (aarch64-apple-darwin, .app bundle only) ..."
  ssh_vm "$vmenv; cd ~/voxis && rustup target add aarch64-apple-darwin >/dev/null 2>&1 || true; ~/.cargo/bin/cargo-tauri build --target aarch64-apple-darwin --bundles app" \
    || echo "WARN: cargo-tauri exited non-zero — verifying .app below"

  local app_path="/Users/$VM_USER/voxis/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Voxis.app"
  ssh_vm "test -d '$app_path'" || { echo "ERROR: Voxis.app not produced at $app_path"; exit 1; }

  # Discover the inner Mach-O name (productName Voxis != cargo bin `voice`).
  local inner_bin
  inner_bin=$(ssh_vm "ls '$app_path/Contents/MacOS/' | head -1" | tr -d '[:space:]')
  [[ -n "$inner_bin" ]] || { echo "ERROR: no binary in $app_path/Contents/MacOS"; exit 1; }
  echo "Inner binary: $inner_bin"

  # Verify WITHOUT running (no Rosetta in the x86_64 VM).
  local archs
  archs=$(ssh_vm "lipo -archs '$app_path/Contents/MacOS/$inner_bin'" | tr -d '[:space:]')
  [[ "$archs" == "arm64" ]] || { echo "ERROR: expected arm64 binary, lipo -archs says: '$archs'"; exit 1; }
  echo "Verified in VM: lipo=arm64"

  # ---- Developer ID signing + notarization (two-branch lane) ---------------
  # Fires only when BOTH the signing identity (VM login keychain) and the
  # App Store Connect API key (~/.appstoreconnect/private_keys/) are present in
  # the VM; otherwise the ad-hoc unsigned lane ships (xattr -cr on install).
  # Branch A (normal): sign (hardened runtime) -> submit -> poll up to
  #   NOTARY_WAIT (default 30m) -> Accepted -> staple app, then staple DMG.
  # Branch B (Apple queue slow): ship the SIGNED-but-unstapled DMG now, record
  #   the submission id in artifacts/.notary-pending, finish later via
  #   `macos-vm.sh notary-finish`. Invalid/Rejected always HARD-FAILS.
  local notarize_ok=0 notarize_pending=0
  local notary_wait="${NOTARY_WAIT:-1800}"
  if [[ -n "${SIGNING_IDENTITY:-}" && -n "${APPLE_API_ISSUER:-}" ]] && ssh_vm 'security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application" && ls ~/.appstoreconnect/private_keys/AuthKey_*.p8 >/dev/null 2>&1'; then
    echo "Developer ID identity + API key found in VM — signing and notarizing ..."
    cat > /tmp/vx-sign-notarize.sh <<SIGNEOF
#!/bin/bash
set -euo pipefail
APP="$app_path"
BIN="$inner_bin"
ID="${SIGNING_IDENTITY}"
KEY=\$(ls ~/.appstoreconnect/private_keys/AuthKey_*.p8 | head -1)
KEY_ID=\$(basename "\$KEY" .p8 | sed 's/^AuthKey_//')
ISSUER="${APPLE_API_ISSUER}"
security unlock-keychain -p "$VM_PASS" ~/Library/Keychains/login.keychain-db
# Inner binary first, then the bundle — Apple's inside-out signing order.
codesign --force --options runtime --timestamp --sign "\$ID" "\$APP/Contents/MacOS/\$BIN"
codesign --force --options runtime --timestamp --sign "\$ID" "\$APP"
codesign --verify --strict --verbose=2 "\$APP"
rm -f /tmp/voxis-notarize.zip
ditto -c -k --keepParent "\$APP" /tmp/voxis-notarize.zip
# Submit WITHOUT --wait: we own the polling budget so a slow queue degrades to
# ship-now-staple-later. Capture output FIRST (early-exit awk on a live pipe =
# SIGPIPE 141 under pipefail), then parse.
SUB_OUT=\$(xcrun notarytool submit /tmp/voxis-notarize.zip \\
  --key "\$KEY" --key-id "\$KEY_ID" --issuer "\$ISSUER" 2>&1)
SUB_ID=\$(printf '%s\\n' "\$SUB_OUT" | awk '/^  id: /{print \$2; exit}')
[ -n "\$SUB_ID" ] || { echo "ERROR: submission produced no id"; echo "\$SUB_OUT"; exit 2; }
echo "submission id: \$SUB_ID"
echo "\$SUB_ID" > /tmp/voxis-notary-id
DEADLINE=\$(( \$(date +%s) + ${notary_wait} ))
while true; do
  ST=\$(xcrun notarytool info "\$SUB_ID" --key "\$KEY" --key-id "\$KEY_ID" --issuer "\$ISSUER" 2>/dev/null | awk '/status:/{print \$2\$3; exit}')
  echo "  status: \$ST"
  case "\$ST" in
    Accepted) xcrun stapler staple "\$APP"; echo "app notarized and stapled"; exit 0 ;;
    Invalid|Rejected)
      xcrun notarytool log "\$SUB_ID" --key "\$KEY" --key-id "\$KEY_ID" --issuer "\$ISSUER" || true
      echo "ERROR: notarization \$ST"; exit 2 ;;
  esac
  [ \$(date +%s) -lt \$DEADLINE ] || { echo "TIMEOUT: still \$ST after ${notary_wait}s"; exit 3; }
  sleep 30
done
SIGNEOF
    sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -P "$SSH_HOST_PORT" /tmp/vx-sign-notarize.sh "$VM_USER@localhost:/tmp/"
    local notary_rc=0
    ssh_vm 'bash /tmp/vx-sign-notarize.sh' || notary_rc=$?
    case "$notary_rc" in
      0) notarize_ok=1 ;;
      3)
        notarize_pending=1
        echo "WARN: Apple queue slow — shipping SIGNED (unstapled) DMG now;"
        echo "      run 'scripts/macos-vm.sh notary-finish' later to staple."
        ;;
      *)
        echo "ERROR: Developer ID signing/notarization failed (rc=$notary_rc) — refusing"
        echo "       to ship. Invalid/Rejected means a real signing problem, not a queue."
        exit 1
        ;;
    esac
  else
    echo "NOTE: no Developer ID identity/API key in VM — ad-hoc lane (xattr -cr needed on install)"
  fi

  echo "Packing DMG via hdiutil (headless-safe) ..."
  cat > /tmp/vx-mkdmg.sh <<MKDMG
#!/bin/bash
set -euo pipefail
rm -rf /tmp/dmgroot /tmp/Voxis.dmg
mkdir -p /tmp/dmgroot
cp -R "$app_path" /tmp/dmgroot/
ln -s /Applications /tmp/dmgroot/Applications
hdiutil create -volname "Voxis" -srcfolder /tmp/dmgroot -ov -format UDZO /tmp/Voxis.dmg
MKDMG
  if [[ "$notarize_ok" == 1 ]]; then
    cat >> /tmp/vx-mkdmg.sh <<DMGSIGN
ID="${SIGNING_IDENTITY}"
KEY=\$(ls ~/.appstoreconnect/private_keys/AuthKey_*.p8 | head -1)
KEY_ID=\$(basename "\$KEY" .p8 | sed 's/^AuthKey_//')
security unlock-keychain -p "$VM_PASS" ~/Library/Keychains/login.keychain-db
codesign --force --timestamp --sign "\$ID" /tmp/Voxis.dmg
xcrun notarytool submit /tmp/Voxis.dmg \\
  --key "\$KEY" --key-id "\$KEY_ID" --issuer "${APPLE_API_ISSUER}" --wait --timeout 20m
xcrun stapler staple /tmp/Voxis.dmg
echo "dmg notarized and stapled"
DMGSIGN
  elif [[ "$notarize_pending" == 1 ]]; then
    cat >> /tmp/vx-mkdmg.sh <<DMGSIGN
ID="${SIGNING_IDENTITY}"
security unlock-keychain -p "$VM_PASS" ~/Library/Keychains/login.keychain-db
codesign --force --timestamp --sign "\$ID" /tmp/Voxis.dmg
echo "dmg signed (notarization pending)"
DMGSIGN
  fi
  sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -P "$SSH_HOST_PORT" /tmp/vx-mkdmg.sh "$VM_USER@localhost:/tmp/"
  ssh_vm 'bash /tmp/vx-mkdmg.sh'

  echo "Pulling DMG to host ..."
  local dmg_out="$proj_dir/artifacts/Voxis_${version}_aarch64.dmg"
  sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -P "$SSH_HOST_PORT" "$VM_USER@localhost:/tmp/Voxis.dmg" "$dmg_out"

  # Also emit the bare arm64 binary (the now-signed inner Mach-O) + tarball so
  # the existing Homebrew formula (installs voxis-macos-arm64) keeps working
  # unchanged alongside the DMG. inner_bin was discovered above.
  local scp="sshpass -p $VM_PASS scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -P $SSH_HOST_PORT"
  if $scp "$VM_USER@localhost:$app_path/Contents/MacOS/$inner_bin" "$proj_dir/artifacts/voxis-macos-arm64"; then
    chmod +x "$proj_dir/artifacts/voxis-macos-arm64"
    tar -C "$proj_dir/artifacts" -czf "$proj_dir/artifacts/voxis-macos-arm64.tar.gz" voxis-macos-arm64
    echo "bare binary + tarball emitted for Homebrew: artifacts/voxis-macos-arm64{,.tar.gz}"
  else
    echo "WARN: could not emit bare arm64 binary (Homebrew lane skipped this build)"
  fi

  local dmg_size
  dmg_size=$(wc -c < "$dmg_out" | tr -d '[:space:]')
  if [[ "$dmg_size" -lt $((5 * 1024 * 1024)) ]]; then
    echo "ERROR: DMG suspiciously small (${dmg_size} bytes < 5MB): $dmg_out"; exit 1
  fi
  echo "macOS GUI DMG in artifacts/:"
  ls -lh "$dmg_out"

  if [[ "$notarize_pending" == 1 ]]; then
    local sub_id
    sub_id=$(ssh_vm 'cat /tmp/voxis-notary-id 2>/dev/null' | tr -d '[:space:]')
    echo "${sub_id} ${dmg_out}" > "$proj_dir/artifacts/.notary-pending"
    echo "PENDING notarization recorded: id=${sub_id} -> artifacts/.notary-pending"
  else
    rm -f "$proj_dir/artifacts/.notary-pending"
  fi
}

# Finish a notarization that build-gui left pending (Apple queue was slow):
# wait for Accepted on the recorded submission, staple the app copy still in
# the VM, rebuild+notarize+staple the DMG, and replace the artifact.
cmd_notary_finish() {
  local proj_dir; proj_dir=$(cd "$(dirname "$0")/.." && pwd)
  local pending="$proj_dir/artifacts/.notary-pending"
  [[ -f "$pending" ]] || { echo "nothing pending ($pending missing)"; exit 0; }
  local sub_id dmg_out
  read -r sub_id dmg_out < "$pending"
  [[ -n "$sub_id" && -n "$dmg_out" ]] || { echo "ERROR: malformed $pending"; exit 1; }
  echo "Finishing notarization: id=$sub_id artifact=$dmg_out"
  local app_path="/Users/$VM_USER/voxis/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Voxis.app"
  cat > /tmp/vx-notary-finish.sh <<FINEOF
#!/bin/bash
set -euo pipefail
KEY=\$(ls ~/.appstoreconnect/private_keys/AuthKey_*.p8 | head -1)
KEY_ID=\$(basename "\$KEY" .p8 | sed 's/^AuthKey_//')
ISSUER="${APPLE_API_ISSUER}"
ID="${SIGNING_IDENTITY}"
APP="$app_path"
while true; do
  ST=\$(xcrun notarytool info "$sub_id" --key "\$KEY" --key-id "\$KEY_ID" --issuer "\$ISSUER" 2>/dev/null | awk '/status:/{print \$2\$3; exit}')
  echo "  status: \$ST"
  case "\$ST" in
    Accepted) break ;;
    Invalid|Rejected)
      xcrun notarytool log "$sub_id" --key "\$KEY" --key-id "\$KEY_ID" --issuer "\$ISSUER" || true
      echo "ERROR: notarization \$ST"; exit 2 ;;
  esac
  sleep 60
done
security unlock-keychain -p "$VM_PASS" ~/Library/Keychains/login.keychain-db
xcrun stapler staple "\$APP"
rm -rf /tmp/dmgroot /tmp/Voxis.dmg
mkdir -p /tmp/dmgroot
cp -R "\$APP" /tmp/dmgroot/
ln -s /Applications /tmp/dmgroot/Applications
hdiutil create -volname "Voxis" -srcfolder /tmp/dmgroot -ov -format UDZO /tmp/Voxis.dmg
codesign --force --timestamp --sign "\$ID" /tmp/Voxis.dmg
xcrun notarytool submit /tmp/Voxis.dmg --key "\$KEY" --key-id "\$KEY_ID" --issuer "\$ISSUER" --wait --timeout 30m
xcrun stapler staple /tmp/Voxis.dmg
echo "dmg notarized and stapled"
FINEOF
  sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -P "$SSH_HOST_PORT" /tmp/vx-notary-finish.sh "$VM_USER@localhost:/tmp/"
  ssh_vm 'bash /tmp/vx-notary-finish.sh' || { echo "ERROR: notary-finish failed"; exit 1; }
  sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -P "$SSH_HOST_PORT" "$VM_USER@localhost:/tmp/Voxis.dmg" "$dmg_out"
  rm -f "$pending"
  echo "Stapled DMG re-emitted: $dmg_out"
  ls -lh "$dmg_out"
}

cmd_status() {
  docker ps --filter "name=${NAME}"
  ssh_vm 'echo ssh-ok' 2>/dev/null || true
}
cmd_stop() { docker rm -f "$NAME" 2>/dev/null || true; }
cmd_ssh() { ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "$SSH_HOST_PORT" "${1:-$VM_USER}@localhost"; }

case "${1:-status}" in
  install) cmd_install ;;
  save) shift; cmd_save "$@" ;;
  naked|start) cmd_naked ;;
  build) cmd_build ;;
  build-gui) cmd_build_gui ;;
  notary-finish) cmd_notary_finish ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  ssh) shift; cmd_ssh "$@" ;;
  *) echo "Usage: $0 {install|save|naked|start|build|build-gui|notary-finish|status|stop|ssh}"; exit 2 ;;
esac
