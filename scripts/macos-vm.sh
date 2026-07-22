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
  status) cmd_status ;;
  stop) cmd_stop ;;
  ssh) shift; cmd_ssh "$@" ;;
  *) echo "Usage: $0 {install|save|naked|start|build|status|stop|ssh}"; exit 2 ;;
esac
