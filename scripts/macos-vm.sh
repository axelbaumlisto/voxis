#!/usr/bin/env bash
# macOS build VM (Docker-OSX) for building Voxis binaries on spex.
#
# VM image ownership (2026-09-07): voxis used to mount clipshot's prepared
# image directly (rw). Two QEMU processes on one qcow2 corrupted a clipshot
# release (v0.8.77) — voxis now clones its OWN copy (~38 GB) via `clone-image`
# and never touches clipshot's image again. See docs/MACOS_SIGNING_TODO.md
# "VM image ownership + host lock".
set -euo pipefail

SOURCE_VM_DIR="${CLIPSHOT_MACOS_VM_DIR:-$HOME/clipshot-macos-vm}"   # clone SOURCE only
SOURCE_PREPARED="$SOURCE_VM_DIR/mac_hdd_ng.prepared.img"
VM_DIR="${VOXIS_MACOS_VM_DIR:-$HOME/voxis-macos-vm}"                # voxis's OWN copy
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

# ---- Apple signing config (kept OUTSIDE the repo, reusable across projects) --
# Same file/format clipshot's scripts/macos-vm.sh reads (DRY across projects
# on this host — one secrets file, not duplicated per repo):
#   SIGNING_IDENTITY=Developer ID Application: Name (TEAMID)
#   APPLE_API_ISSUER=<issuer uuid>
#   APPLE_API_KEY_ID=<key id>          (also derivable from the .p8 filename)
#   APPLE_API_KEY_PATH=<host path, informational — the .p8 itself lives IN the VM>
# The .p8 API key file lives inside the VM at ~/.appstoreconnect/private_keys/.
# Missing file/vars => cmd_build_gui degrades to an unsigned/ad-hoc build
# (see the SIGNING_IDENTITY/APPLE_API_ISSUER check inside cmd_build_gui).
APPLE_NOTARY_ENV="${APPLE_NOTARY_ENV:-$HOME/secrets/apple-dev/notary.env}"
if [[ -f "$APPLE_NOTARY_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$APPLE_NOTARY_ENV"
fi

# ---- Host-wide macOS-VM lock (shared across voxis + clipshot on this host) --
# Only ONE macOS Docker-OSX container (voxis's or clipshot's) may run at a
# time on this host: two QEMU processes still fight over CPU/RAM/KVM and have
# corrupted a release (clipshot v0.8.77, 2026-09-07) even without a shared
# disk.
#
# Two-part protocol, matching clipshot's current scripts/macos-vm.sh
# (`acquire_macos_vm_slot`) exactly — the exclusion is cross-repo and both
# sides must agree on both parts:
#   1. `flock` on a SHARED lock path only closes the check-then-run race
#      between two SIMULTANEOUS launches (either project). It is NOT held
#      for the container's lifetime by clipshot's own script — clipshot
#      releases it as soon as its own launching process exits, while its
#      container keeps running. Relying on flock alone would miss exactly
#      the incident direction that caused v0.8.77: clipshot's VM already up
#      (its flock long since released) → voxis `naked` → flock free → voxis
#      passes → two QEMUs.
#   2. `docker ps | grep -iE 'macos|osx'` (excluding our own, just-removed
#      container name) is there authoritative "is any macOS VM already up?"
#      gate — ground truth from the container list, re-checked on every
#      call, independent of who still holds (or long ago released) a flock.
#      This is what actually refuses the launch in the corrupted-release
#      direction above.
# voxis additionally holds the flock for the CONTAINER's lifetime (beyond
# what clipshot does), via a detached background holder: `docker run -d`
# returns immediately, so `vm_lock_spawn_holder` forks a subshell that
# INHERITS the already-flock'd fd (flock is tied to the open-file-
# description, not the fd number — a forked child sharing that OFD already
# holds the lock, no re-acquire needed) and polls `docker ps` until the
# container is gone, at which point the subshell exits, its copy of the fd
# closes, and the lock releases. The parent then closes its OWN copy
# (harmless either way — released only once ALL copies close) and returns
# immediately. This is a voxis-side-only extra layer (clipshot does not do
# it); the cross-repo guarantee is carried by the `docker ps` gate (2),
# which works regardless of which side holds or has released the flock.
# `cmd_stop`'s `docker rm -f` makes the holder's next poll see the container
# gone and exit on its own — no PID file, no explicit reaping.
MACOS_VM_LOCK="${MACOS_VM_LOCK:-/home/spex/.macos-vm.lock}"

vm_lock_acquire_or_die() {
  exec {VM_LOCK_FD}>"$MACOS_VM_LOCK" || { echo "ERROR: cannot open lock file $MACOS_VM_LOCK"; exit 1; }
  # Bounded wait, not non-blocking: our OWN previous holder (from a just-
  # `docker rm -f`'d restart of this same VM) polls every 5s and may still
  # hold the flock for a few seconds after the container is gone — a plain
  # `flock -n` would spuriously report contention against ourselves. 15s
  # comfortably covers that window while still failing fast on a real
  # concurrent launch (which does not clear on its own).
  if ! flock -w 15 "$VM_LOCK_FD"; then
    echo "ERROR: another macOS VM is already running on this host (lock: $MACOS_VM_LOCK)."
    echo "Holder (by container name heuristic):"
    docker ps --format '{{.Names}} {{.Status}}' | grep -iE 'macos|osx' \
      || echo "  (none matched 'macos'/'osx' in docker ps — stale lock? check manually)"
    exit 1
  fi
  # Authoritative gate (protocol part 2 above): re-check the actual
  # container list, not just the flock, so a macOS VM started by the OTHER
  # project — which may have already released its own flock — still blocks
  # us. `grep -v "^${NAME}"$'\t'` excludes our own container name safely:
  # both call sites already ran `docker rm -f "$NAME"` immediately before
  # this function, so a real leftover match here can only be someone else's.
  local others
  others=$(docker ps --format '{{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null \
    | grep -iE 'macos|osx' | grep -v "^${NAME}"$'\t' || true)
  if [[ -n "$others" ]]; then
    echo "ERROR: a macOS VM is already running on this host (one per host). Holder:"
    # shellcheck disable=SC2001 # per-line prefix on a multi-line var; sed is clearer here than a parameter expansion
    echo "$others" | sed 's/^/  /'
    exec {VM_LOCK_FD}>&-
    exit 1
  fi
}

vm_lock_spawn_holder() {
  local container="$1"
  local holder_body='while docker ps --filter "name='"$container"'" --format "{{.Names}}" | grep -q .; do sleep 5; done'
  # Detached from stdin/stdout/stderr: the plain `( ... ) &` form otherwise
  # inherits the caller's stdio, so any pipe/ssh/CI-runner invocation
  # (`ssh spex '...'`, `exec.Cmd.Wait`, `| tee`) blocks waiting for EOF until
  # this holder exits — i.e. until the VM is stopped. `setsid -f`, when
  # available, additionally moves the holder into its own session/process
  # group so a runner killing our whole process group (e.g. a step timeout)
  # does not take the holder down with it and leave the container lock-less
  # while still running; falls back to the plain subshell otherwise.
  if command -v setsid >/dev/null 2>&1; then
    setsid -f bash -c "$holder_body" </dev/null >/dev/null 2>&1 &
  else
    ( eval "$holder_body" ) </dev/null >/dev/null 2>&1 &
  fi
  disown
  # Close OUR copy; the backgrounded holder above inherited its own copy of
  # the same open-file-description and keeps the flock held until it exits.
  exec {VM_LOCK_FD}>&- 2>/dev/null || true
}

# Clone clipshot's prepared image into voxis's OWN copy (one-time, ~38 GB).
# Run manually once on spex before the first build-gui/naked; CI does not
# auto-clone (a 38 GB copy has no place inside a release timeout).
cmd_clone_image() {
  [[ -f "$SOURCE_PREPARED" ]] || { echo "ERROR: source image not found at $SOURCE_PREPARED"; exit 1; }
  if [[ "$SOURCE_PREPARED" == "$PREPARED" ]]; then
    echo "ERROR: source and target resolve to the same path ($PREPARED) — refusing to no-op cp onto itself"
    exit 1
  fi
  if [[ -f "$PREPARED" ]]; then
    echo "voxis already owns an image at $PREPARED — nothing to do (delete it first to re-clone)."
    ls -lh "$PREPARED"
    return 0
  fi
  mkdir -p "$VM_DIR"
  echo "Cloning clipshot's prepared image into voxis's own copy (~38 GB, this can take a while) ..."
  echo "  source: $SOURCE_PREPARED"
  echo "  target: $PREPARED"
  cp --reflink=auto "$SOURCE_PREPARED" "$PREPARED"
  ls -lh "$PREPARED"
  echo "Clone complete — voxis now owns its own VM disk (cert + API key already inside"
  echo "the cloned qcow2, no extra copy step needed); safe to run alongside clipshot's VM."
}

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
  vm_lock_acquire_or_die
  # --restart no: the build-VM must NOT auto-start after a host reboot — two macOS VMs (voxis + clipshot) would come up simultaneously, bypassing the launch lock (clipshot made the same change, 65152c06).
  docker run -d --name "$NAME" --restart no \
    -v "$DISK:/home/arch/OSX-KVM/mac_hdd_ng.img" \
    ${BASESYSTEM:+-v "$BASESYSTEM:/home/arch/OSX-KVM/BaseSystem.img"} \
    -e GENERATE_UNIQUE=true \
    -e "MASTER_PLIST_URL=${PLIST}" \
    -e "SHORTNAME=${SHORTNAME}" \
    "${common_args[@]}" "$IMAGE"
  vm_lock_spawn_holder "$NAME"
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
  [[ -f "$PREPARED" ]] || { echo "ERROR: no voxis-owned prepared image at $PREPARED — run: $0 clone-image"; exit 1; }
  docker rm -f "$NAME" 2>/dev/null || true
  vm_lock_acquire_or_die
  docker run -d --name "$NAME" --restart no \
    -v "$PREPARED:/home/arch/OSX-KVM/mac_hdd_ng.img" \
    -e IMAGE_PATH=/home/arch/OSX-KVM/mac_hdd_ng.img \
    -e NOPICKER=true \
    "${common_args[@]}" "$IMAGE"
  vm_lock_spawn_holder "$NAME"
  wait_for_ssh
}

# The VM builds the COMMITTED tree, never the working copy. The host
# checkout at /home/spex/work/voxis is shared with every other job on this
# machine, and v0.1.9 + v0.1.10 (2026-10-06) both shipped without macOS
# because something on the host rewrote src-tauri/Cargo.toml (dropping
# `macos-private-api`) seconds after the release job checked the tag out —
# the tarball picked that up and `transparent()` failed to compile in the VM.
# `git archive HEAD` is exactly the tag's bytes, whatever the working tree
# looks like; any difference is printed so the culprit is at least visible.
sync_source_tarball() {
  local proj_dir="$1"
  if git -C "$proj_dir" rev-parse --verify HEAD >/dev/null 2>&1; then
    local dirty; dirty="$(git -C "$proj_dir" status --porcelain --untracked-files=no)"
    if [[ -n "$dirty" ]]; then
      echo "::warning::host checkout differs from HEAD — the VM gets HEAD's tree, not these edits:"
      echo "$dirty"
      git -C "$proj_dir" --no-pager diff --stat | tail -3
    fi
    git -C "$proj_dir" archive --format=tar.gz -o /tmp/voxis-src.tar.gz HEAD
    echo "source: git archive $(git -C "$proj_dir" rev-parse --short HEAD)"
  else
    ( cd "$proj_dir" && tar czf /tmp/voxis-src.tar.gz \
        --exclude='./target' --exclude='./src-tauri/target' --exclude='./.git' \
        --exclude='./node_modules' --exclude='./dist' -C "$proj_dir" . )
    echo "source: working tree (not a git checkout)"
  fi
}

cmd_build() {
  local proj_dir; proj_dir="$(cd "$(dirname "$0")/.." && pwd)"
  command -v sshpass >/dev/null || { echo "sshpass required"; exit 1; }
  mkdir -p "$proj_dir/artifacts"
  ssh_vm 'echo ok' >/dev/null 2>&1 || cmd_naked
  echo "Syncing source into VM ..."
  sync_source_tarball "$proj_dir"
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
  $scp "$VM_USER@localhost:/Users/$VM_USER/voxis/target/aarch64-apple-darwin/release/voice" "$proj_dir/artifacts/voxis-macos-arm64"
  chmod +x "$proj_dir"/artifacts/voxis-macos-* 2>/dev/null || true
  echo "macOS artifacts in artifacts/:"
  ls -lh "$proj_dir"/artifacts/voxis-macos-* 2>/dev/null
}

# GUI (.app + signed/notarized DMG) build lane — SEPARATE from the headless
# `build` lane above (which stays unchanged: it still produces the bare
# `voxis-macos-arm64` binary that the Homebrew formula pins via
# scripts/ci/update-homebrew.sh). Ported from clipshot's working
# cmd_build_gui/cmd_notary_finish (~/work/clipshot/scripts/macos-vm.sh) —
# same prepared VM image, same Apple signing config file, same lane shape.
# Known pitfalls baked in (carried over from clipshot, still true here):
#   - Tauri's own `--bundles dmg` FAILS in the headless VM (bundle_dmg.sh
#     drives AppleScript window dressing that needs a GUI session) — only
#     `--bundles app`; the DMG is assembled separately via hdiutil below.
#   - The arm64 .app cannot RUN in the x86_64 VM (no Rosetta): verify with
#     `lipo -archs` + `codesign -dv`, never by executing the binary.
#   - Voxis's tauri.conf.json already has `beforeBuildCommand: "bun run
#     build"`, so `cargo tauri build` builds the frontend itself — unlike
#     clipshot, no separate host-side frontend-freshness gate is needed here.
cmd_build_gui() {
  local proj_dir; proj_dir="$(cd "$(dirname "$0")/.." && pwd)"
  command -v sshpass >/dev/null || { echo "sshpass required"; exit 1; }
  mkdir -p "$proj_dir/artifacts"
  # /tmp/voice-*.sh below embed $VM_PASS — not a secret at the default
  # 'alpine', but keep the habit in case it's ever set to a real password.
  umask 077

  if [[ -f "$APPLE_NOTARY_ENV" ]]; then
    echo "Apple signing config: $APPLE_NOTARY_ENV (found)"
  else
    echo "Apple signing config: $APPLE_NOTARY_ENV (MISSING — will ship ad-hoc-signed, unsigned-by-Apple build)"
  fi

  # Version consistency gate (host-side, fail early before any VM work).
  local version tauri_version
  version=$(grep -m1 '^version' "$proj_dir/src-tauri/Cargo.toml" | cut -d'"' -f2)
  [[ -n "$version" ]] || { echo "ERROR: cannot read version from src-tauri/Cargo.toml"; exit 1; }
  tauri_version=$(grep -m1 '"version"' "$proj_dir/src-tauri/tauri.conf.json" | cut -d'"' -f4)
  if [[ "$tauri_version" != "$version" ]]; then
    echo "ERROR: version mismatch: src-tauri/Cargo.toml=$version vs src-tauri/tauri.conf.json=$tauri_version"
    exit 1
  fi

  ssh_vm 'echo ok' >/dev/null 2>&1 || cmd_naked

  echo "Syncing source into VM ..."
  sync_source_tarball "$proj_dir"
  sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -P "$SSH_HOST_PORT" /tmp/voxis-src.tar.gz "$VM_USER@localhost:/tmp/"
  # Preserve target/ across the wipe: reuses Lane 1's (`build`) compiled
  # dependency cache (ort, whisper-rs, ...) so the cargo-tauri build below
  # only rebuilds tauri-dependent crates instead of a full cold build —
  # keeps both lanes inside the CI step's timeout. First-ever run (no prior
  # target/) is a harmless no-op on both sides of the move.
  ssh_vm 'mkdir -p ~/voxis-target-stash && ( [ -d ~/voxis/target ] && mv ~/voxis/target ~/voxis-target-stash/target || ( [ -d ~/voxis/src-tauri/target ] && mv ~/voxis/src-tauri/target ~/voxis-target-stash/target ) || true ); rm -rf ~/voxis && mkdir -p ~/voxis && tar xzf /tmp/voxis-src.tar.gz -C ~/voxis && ( [ -d ~/voxis-target-stash/target ] && mv ~/voxis-target-stash/target ~/voxis/target || true )'

  local vmenv='export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"; source ~/.cargo/env 2>/dev/null || true'
  ssh_vm "$vmenv; cd ~/voxis && bun install --frozen-lockfile"

  # cargo-tauri is expected in the prepared image (installed alongside the
  # Rust toolchain — same image clipshot's GUI lane already relies on).
  # Hand-rolling a .app bundle (Info.plist, icons, resources) without it would
  # be an unverified, easy-to-get-subtly-wrong code path — fail loudly instead.
  ssh_vm "$vmenv; command -v cargo-tauri" >/dev/null 2>&1 || {
    echo "ERROR: cargo-tauri not found in VM (expected at ~/.cargo/bin/cargo-tauri in the"
    echo "       prepared image). Install it in a naked session:"
    echo "       cargo install tauri-cli --version '^2' --locked"
    exit 1
  }
  ssh_vm "$vmenv; cd ~/voxis/src-tauri && rustup target add aarch64-apple-darwin >/dev/null 2>&1 || true"

  echo "Building Tauri GUI (aarch64-apple-darwin, .app bundle only) ..."
  ssh_vm "$vmenv; cd ~/voxis && cargo tauri build --target aarch64-apple-darwin --bundles app" \
    || echo "WARN: cargo-tauri exited non-zero — verifying Voxis.app below"

  local app_path="/Users/$VM_USER/voxis/target/aarch64-apple-darwin/release/bundle/macos/Voxis.app"
  ssh_vm "test -d '$app_path'" || { echo "ERROR: Voxis.app not produced at $app_path"; exit 1; }

  # Verify WITHOUT running the binary (no Rosetta in the x86_64 VM).
  local archs
  archs=$(ssh_vm "lipo -archs '$app_path/Contents/MacOS/voice'" | tr -d '[:space:]')
  [[ "$archs" == "arm64" ]] || { echo "ERROR: expected arm64 binary, lipo -archs says: '$archs'"; exit 1; }
  ssh_vm "codesign -dv '$app_path'" || { echo "ERROR: codesign verification failed on Voxis.app"; exit 1; }
  echo "Verified in VM: lipo=arm64, codesign ok"

  # ---- Developer ID signing + notarization (two-branch lane) ---------------
  # Fires only when BOTH the signing identity (VM login keychain) and the App
  # Store Connect API key (~/.appstoreconnect/private_keys/) are present in
  # the VM; otherwise the ad-hoc-signed .app/DMG from cargo-tauri ships as-is.
  #
  # Branch A (normal): sign (hardened runtime) -> submit -> poll up to
  #   NOTARY_WAIT (default 30m) -> Accepted -> staple app, later staple DMG.
  # Branch B (Apple queue slow): ship the SIGNED-but-unstapled DMG immediately,
  #   record the submission id in artifacts/.notary-pending, finish later with
  #   `macos-vm.sh notary-finish` (waits for Accepted, notarizes+staples the
  #   DMG, re-emits it). Gatekeeper checks Apple's servers online, so an
  #   already-downloaded copy starts opening the moment Apple accepts —
  #   stapling only adds the offline path.
  # Invalid/Rejected always HARD-FAILS — that is a real signing problem, not a
  # queue delay.
  local notarize_ok=0 notarize_pending=0
  local notary_wait="${NOTARY_WAIT:-1800}"
  if [[ -n "${SIGNING_IDENTITY:-}" && -n "${APPLE_API_ISSUER:-}" ]] && ssh_vm 'security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application" && ls ~/.appstoreconnect/private_keys/AuthKey_*.p8 >/dev/null 2>&1'; then
    echo "Developer ID identity + API key found in VM — signing and notarizing ..."
    # `--force` re-signing below discards whatever ad-hoc entitlements Tauri's
    # own build-time signing applied — re-supply them explicitly on BOTH
    # codesign calls, or Hardened Runtime silently blocks mic access and the
    # Accessibility-prompt Apple Event (see src-tauri/Entitlements.plist).
    sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -P "$SSH_HOST_PORT" "$proj_dir/src-tauri/Entitlements.plist" "$VM_USER@localhost:/tmp/voice-entitlements.plist"
    cat > /tmp/voice-sign-notarize.sh <<SIGNEOF
#!/bin/bash
set -euo pipefail
APP="$app_path"
ID="${SIGNING_IDENTITY}"
ENTITLEMENTS=/tmp/voice-entitlements.plist
KEY=\$(ls ~/.appstoreconnect/private_keys/AuthKey_*.p8 | head -1)
KEY_ID=\$(basename "\$KEY" .p8 | sed 's/^AuthKey_//')
ISSUER="${APPLE_API_ISSUER}"
security unlock-keychain -p "$VM_PASS" ~/Library/Keychains/login.keychain-db
# Inner binaries first, then the bundle — Apple's inside-out signing order.
# Incident (v0.1.3 run 4295): notarization returned Invalid because only
# the voice binary was re-signed here — the bundle's second [[bin]],
# typing_bench (Contents/MacOS/typing_bench), kept Tauri's non-Developer-ID
# signature, and notarization validates every Mach-O in the archive. Sign ALL
# executables and any bundled dylibs/frameworks generically instead of naming
# one file.
for f in "\$APP"/Contents/MacOS/* "\$APP"/Contents/Frameworks/*; do
  [ -e "\$f" ] || continue
  file "\$f" | grep -q Mach-O || continue
  codesign --force --options runtime --timestamp --entitlements "\$ENTITLEMENTS" --sign "\$ID" "\$f"
done
codesign --force --options runtime --timestamp --entitlements "\$ENTITLEMENTS" --sign "\$ID" "\$APP"
codesign --verify --strict --deep --verbose=2 "\$APP"
for f in "\$APP"/Contents/MacOS/*; do
  [ -e "\$f" ] || continue
  file "\$f" | grep -q Mach-O || continue
  codesign -d --entitlements :- "\$f" 2>/dev/null | grep -q 'audio-input' || { echo "ERROR: entitlements missing audio-input on \$f after signing"; exit 2; }
done
rm -f /tmp/voice-notarize.zip
ditto -c -k --keepParent "\$APP" /tmp/voice-notarize.zip
# Submit WITHOUT --wait: poll ourselves so a slow Apple queue degrades to
# ship-now-staple-later instead of failing the build.
SUB_OUT=\$(xcrun notarytool submit /tmp/voice-notarize.zip \\
  --key "\$KEY" --key-id "\$KEY_ID" --issuer "\$ISSUER" 2>&1)
SUB_ID=\$(printf '%s\\n' "\$SUB_OUT" | awk '/^  id: /{print \$2; exit}')
[ -n "\$SUB_ID" ] || { echo "ERROR: submission produced no id"; exit 2; }
echo "submission id: \$SUB_ID"
echo "\$SUB_ID" > /tmp/voice-notary-id
DEADLINE=\$(( \$(date +%s) + ${notary_wait} ))
while true; do
  ST=\$(xcrun notarytool info "\$SUB_ID" --key "\$KEY" --key-id "\$KEY_ID" --issuer "\$ISSUER" 2>/dev/null | awk '/status:/{print \$2\$3; exit}')
  echo "  status: \$ST"
  case "\$ST" in
    Accepted)
      xcrun stapler staple "\$APP"
      xcrun stapler validate "\$APP"
      spctl -a -vvv -t exec "\$APP"
      echo "app notarized and stapled"
      exit 0 ;;
    Invalid|Rejected)
      xcrun notarytool log "\$SUB_ID" --key "\$KEY" --key-id "\$KEY_ID" --issuer "\$ISSUER" || true
      echo "ERROR: notarization \$ST"; exit 2 ;;
  esac
  [ \$(date +%s) -lt \$DEADLINE ] || { echo "TIMEOUT: still \$ST after ${notary_wait}s"; exit 3; }
  sleep 30
done
SIGNEOF
    sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -P "$SSH_HOST_PORT" /tmp/voice-sign-notarize.sh "$VM_USER@localhost:/tmp/"
    local notary_rc=0
    ssh_vm 'bash /tmp/voice-sign-notarize.sh' || notary_rc=$?
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
    echo "NOTE: no Developer ID identity/API key in VM (or SIGNING_IDENTITY/APPLE_API_ISSUER"
    echo "      unset on host, e.g. $APPLE_NOTARY_ENV missing) — shipping the ad-hoc-signed"
    echo "      .app/DMG as-is (xattr -cr needed on install)."
  fi

  echo "Packing DMG via hdiutil (headless-safe) ..."
  cat > /tmp/voice-mkdmg.sh <<MKDMG
#!/bin/bash
set -euo pipefail
rm -rf /tmp/dmgroot /tmp/Voxis.dmg
mkdir -p /tmp/dmgroot
cp -R "$app_path" /tmp/dmgroot/
ln -s /Applications /tmp/dmgroot/Applications
hdiutil create -volname "Voxis" -srcfolder /tmp/dmgroot -ov -format UDZO /tmp/Voxis.dmg
MKDMG
  # When the app was Developer ID-signed, also sign + notarize + staple the
  # DMG itself so the download passes Gatekeeper before it's even mounted.
  if [[ "$notarize_ok" == 1 ]]; then
    cat >> /tmp/voice-mkdmg.sh <<DMGSIGN
ID="${SIGNING_IDENTITY}"
KEY=\$(ls ~/.appstoreconnect/private_keys/AuthKey_*.p8 | head -1)
KEY_ID=\$(basename "\$KEY" .p8 | sed 's/^AuthKey_//')
security unlock-keychain -p "$VM_PASS" ~/Library/Keychains/login.keychain-db
codesign --force --timestamp --sign "\$ID" /tmp/Voxis.dmg
# A DMG-level notarization timeout must not drop the whole artifact — the
# .app inside is ALREADY notarized+stapled (Branch A above), so Gatekeeper
# validates it regardless; DMG stapling is only the offline nicety.
if xcrun notarytool submit /tmp/Voxis.dmg \\
  --key "\$KEY" --key-id "\$KEY_ID" --issuer "${APPLE_API_ISSUER}" --wait --timeout 20m; then
  xcrun stapler staple /tmp/Voxis.dmg
  xcrun stapler validate /tmp/Voxis.dmg
  spctl -a -vvv -t open --context context:primary-signature /tmp/Voxis.dmg
  echo "dmg notarized and stapled"
else
  echo "WARN: DMG notarization timed out — shipping DMG with stapled app inside"
fi
DMGSIGN
  elif [[ "$notarize_pending" == 1 ]]; then
    # Pending branch: DMG is still SIGNED locally (no Apple round-trip);
    # notarize+staple happen later in notary-finish.
    cat >> /tmp/voice-mkdmg.sh <<DMGSIGN
ID="${SIGNING_IDENTITY}"
security unlock-keychain -p "$VM_PASS" ~/Library/Keychains/login.keychain-db
codesign --force --timestamp --sign "\$ID" /tmp/Voxis.dmg
echo "dmg signed (notarization pending)"
DMGSIGN
  fi
  sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -P "$SSH_HOST_PORT" /tmp/voice-mkdmg.sh "$VM_USER@localhost:/tmp/"
  ssh_vm 'bash /tmp/voice-mkdmg.sh'

  echo "Pulling DMG to host ..."
  local dmg_out="$proj_dir/artifacts/Voxis_${version}_aarch64.dmg"
  sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -P "$SSH_HOST_PORT" "$VM_USER@localhost:/tmp/Voxis.dmg" "$dmg_out"

  # Size sanity: a real DMG with the app is well over 5MB; anything smaller
  # means a truncated transfer or an empty bundle.
  local dmg_size
  dmg_size=$(wc -c < "$dmg_out" | tr -d '[:space:]')
  if [[ "$dmg_size" -lt $((5 * 1024 * 1024)) ]]; then
    echo "ERROR: DMG suspiciously small (${dmg_size} bytes < 5MB): $dmg_out"; exit 1
  fi
  echo "macOS GUI DMG in artifacts/:"
  ls -lh "$dmg_out"

  # Pending notarization: persist the submission id + artifact name so
  # `notary-finish` can complete the job after Apple's queue catches up.
  if [[ "$notarize_pending" == 1 ]]; then
    local sub_id
    sub_id=$(ssh_vm 'cat /tmp/voice-notary-id 2>/dev/null' | tr -d '[:space:]')
    echo "${sub_id} ${dmg_out}" > "$proj_dir/artifacts/.notary-pending"
    echo "PENDING notarization recorded: id=${sub_id} -> artifacts/.notary-pending"
  else
    rm -f "$proj_dir/artifacts/.notary-pending"
  fi
}

# Finish a notarization that build-gui left pending (Apple queue was slow):
# wait for Accepted on the recorded submission, staple the app copy still in
# the VM, rebuild the DMG from it, notarize+staple the DMG, replace the
# artifact. Requires the same VM to still hold the built .app.
cmd_notary_finish() {
  local proj_dir; proj_dir=$(cd "$(dirname "$0")/.." && pwd)
  umask 077
  local pending="$proj_dir/artifacts/.notary-pending"
  [[ -f "$pending" ]] || { echo "nothing pending ($pending missing)"; exit 0; }
  local sub_id dmg_out
  read -r sub_id dmg_out < "$pending"
  [[ -n "$sub_id" && -n "$dmg_out" ]] || { echo "ERROR: malformed $pending"; exit 1; }
  echo "Finishing notarization: id=$sub_id artifact=$dmg_out"
  cat > /tmp/voice-notary-finish.sh <<FINEOF
#!/bin/bash
set -euo pipefail
KEY=\$(ls ~/.appstoreconnect/private_keys/AuthKey_*.p8 | head -1)
KEY_ID=\$(basename "\$KEY" .p8 | sed 's/^AuthKey_//')
ISSUER="${APPLE_API_ISSUER}"
ID="${SIGNING_IDENTITY}"
APP="/Users/$VM_USER/voxis/target/aarch64-apple-darwin/release/bundle/macos/Voxis.app"
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
xcrun stapler validate "\$APP"
spctl -a -vvv -t exec "\$APP"
rm -rf /tmp/dmgroot /tmp/Voxis.dmg
mkdir -p /tmp/dmgroot
cp -R "\$APP" /tmp/dmgroot/
ln -s /Applications /tmp/dmgroot/Applications
hdiutil create -volname "Voxis" -srcfolder /tmp/dmgroot -ov -format UDZO /tmp/Voxis.dmg
codesign --force --timestamp --sign "\$ID" /tmp/Voxis.dmg
xcrun notarytool submit /tmp/Voxis.dmg --key "\$KEY" --key-id "\$KEY_ID" --issuer "\$ISSUER" --wait --timeout 30m
xcrun stapler staple /tmp/Voxis.dmg
xcrun stapler validate /tmp/Voxis.dmg
spctl -a -vvv -t open --context context:primary-signature /tmp/Voxis.dmg
echo "dmg notarized and stapled"
FINEOF
  sshpass -p "$VM_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -P "$SSH_HOST_PORT" /tmp/voice-notary-finish.sh "$VM_USER@localhost:/tmp/"
  ssh_vm 'bash /tmp/voice-notary-finish.sh' || { echo "ERROR: notary-finish failed"; exit 1; }
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
  clone-image) cmd_clone_image ;;
  naked|start) cmd_naked ;;
  build) cmd_build ;;
  build-gui) cmd_build_gui ;;
  notary-finish) cmd_notary_finish ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  ssh) shift; cmd_ssh "$@" ;;
  *) echo "Usage: $0 {install|save|clone-image|naked|start|build|build-gui|notary-finish|status|stop|ssh}"; exit 2 ;;
esac
