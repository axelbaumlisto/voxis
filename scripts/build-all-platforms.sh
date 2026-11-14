#!/usr/bin/env bash
# Build Voxis GUI-only release artifacts on a Linux host.
# Linux and Windows are built here, in Docker. macOS is NOT built here: it runs in
# `.forgejo/workflows/release.yml` on the shared macOS 26 / Xcode 26 VM
# (`~/macos-xcode26-vm/vm.sh build voxis <sha> -- 'bash scripts/ci/mac-shared-vm.sh'`),
# which is also the only lane with the signing/notarization credentials.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
# Release artifacts go to artifacts/, NOT dist/. dist/ is vite's build outDir
# (emptyOutDir wipes it on every `bun run build`); with parallel Linux+Windows
# lanes both calling the frontend build, a vite build in one lane would delete
# the release binary another lane already copied into dist/. Keep them separate.
OUTPUT_DIR="$PROJECT_DIR/artifacts"
VERSION=$(grep '^version' "$PROJECT_DIR/src-tauri/Cargo.toml" | head -1 | sed 's/.*"\(.*\)"/\1/')

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[ALL]${NC} $1"; }
warn() { echo -e "${YELLOW}[ALL]${NC} $1"; }
err()  { echo -e "${RED}[ALL]${NC} $1"; }

DO_LINUX=1; DO_WINDOWS=1
for a in "$@"; do
  case "$a" in
    # Accepted (release.yml passes it) and a no-op: macOS is never built here.
    --no-macos)     ;;
    --linux-only)   DO_WINDOWS=0 ;;
    --windows-only) DO_LINUX=0 ;;
    --macos-only)
      info "macOS is not built by this script — it runs in release.yml on the shared macOS 26 VM:"
      info "  ~/macos-xcode26-vm/vm.sh build voxis <sha> -- 'bash scripts/ci/mac-shared-vm.sh'"
      exit 0 ;;
    *) err "unknown flag: $a"; exit 2 ;;
  esac
done

mkdir -p "$OUTPUT_DIR"
declare -a RESULTS

run_logged_step() {
  local log="$1"; shift
  "$@" > "$log" 2>&1
}

wait_lane() {
  local lane="$1"; shift
  local -n names_ref="$1"; shift
  local -n pids_ref="$1"; shift
  local -n logs_ref="$1"; shift
  for i in "${!pids_ref[@]}"; do
    local name="${names_ref[$i]}" log="${logs_ref[$i]}"
    if wait "${pids_ref[$i]}"; then
      RESULTS+=("OK   $name")
      info "$lane: $name completed ✅"
      tail -5 "$log" 2>/dev/null || true
    else
      RESULTS+=("FAIL $name")
      err "$lane: $name FAILED — log tail:"
      tail -40 "$log" 2>/dev/null || true
    fi
  done
}

build_frontend_if_needed() {
  cd "$PROJECT_DIR"
  if [ ! -s dist/index.html ] || [ "$(wc -c < dist/index.html 2>/dev/null || echo 0)" -lt 500 ]; then
    info "Building frontend (dist)..."
    bun install --frozen-lockfile && bun run build
  fi
}

build_linux_gui() {
  cd "$PROJECT_DIR"
  # Drop last run's Linux outputs first: if this build fails, nothing stale may
  # be left behind looking like a fresh artifact.
  rm -f "$OUTPUT_DIR/voxis-linux-x64-gui" "$OUTPUT_DIR"/Voxis_*_amd64.deb "$OUTPUT_DIR"/Voxis-*.x86_64.rpm
  # v0.1.16 post-mortem: a failed `docker build` was ignored (no `set -e` in a
  # backgrounded function), `docker create` then reused an OLDER image under the
  # shared `:latest` tag, and a stale binary + 0.1.15 .deb/.rpm were published.
  # Create the container from THIS build's image id, never the host-wide
  # `:latest` tag another clone may have just retagged.
  local iidfile cid
  iidfile=$(mktemp)
  DOCKER_BUILDKIT=0 docker build --network host --iidfile "$iidfile" \
    -f Dockerfile.gui-linux -t voxis-linux-gui:latest . \
    || { echo "ERROR: Linux GUI docker build failed" >&2; rm -f "$iidfile"; return 1; }
  cid=$(docker create "$(cat "$iidfile")") || { rm -f "$iidfile"; return 1; }
  rm -f "$iidfile"
  docker cp "$cid:/voxis" "$OUTPUT_DIR/voxis-linux-x64-gui"
  docker cp "$cid:/bundle/." "$OUTPUT_DIR/" 2>/dev/null || true
  docker rm "$cid" >/dev/null
  chmod +x "$OUTPUT_DIR/voxis-linux-x64-gui"
  if [ ! -s "$OUTPUT_DIR/voxis-linux-x64-gui" ]; then
    echo "ERROR: Linux GUI binary not produced" >&2
    return 1
  fi
  if [ ! -f "$OUTPUT_DIR/Voxis_${VERSION}_amd64.deb" ]; then
    echo "ERROR: .deb for $VERSION not produced (stale image?)" >&2
    ls -la "$OUTPUT_DIR"/Voxis_*_amd64.deb 2>/dev/null || true
    return 1
  fi
}

build_windows_gui() {
  cd "$PROJECT_DIR"
  build_frontend_if_needed
  DOCKER_BUILDKIT=0 docker build --network host -f Dockerfile.windows-gui -t voxis-winguienv:latest .
  docker volume create voxis-wintarget >/dev/null
  docker run --rm -v voxis-wintarget:/t alpine sh -c '
    rm -f /t/x86_64-pc-windows-msvc/release/bundle/nsis/Voxis_*_x64-setup.exe
    rm -f /t/x86_64-pc-windows-msvc/release/voice.exe
  ' 2>/dev/null || true
  docker run --rm --network host \
    -v "$PROJECT_DIR":/app \
    -v voxis-wintarget:/tmp/wintarget \
    -e CARGO_TARGET_DIR=/tmp/wintarget \
    -w /app voxis-winguienv:latest \
    bash -euo pipefail -c 'bun install --frozen-lockfile && bun run build && cargo tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis' \
    || warn "tauri Windows build exited non-zero; verifying artifacts anyway"
  docker run --rm -v voxis-wintarget:/t -v "$OUTPUT_DIR":/out alpine sh -c '
    b=/t/x86_64-pc-windows-msvc/release
    cp "$b"/bundle/nsis/Voxis_*_x64-setup.exe /out/ 2>/dev/null
    cp "$b/voice.exe" /out/voxis-windows-x64-gui.exe 2>/dev/null
    chown -R '"$(id -u):$(id -g)"' /out
  '
  if [ ! -f "$OUTPUT_DIR/Voxis_${VERSION}_x64-setup.exe" ]; then
    echo "ERROR: NSIS installer not produced: Voxis_${VERSION}_x64-setup.exe" >&2
    ls -la "$OUTPUT_DIR"/Voxis_* 2>/dev/null || true
    return 1
  fi
  if [ ! -s "$OUTPUT_DIR/voxis-windows-x64-gui.exe" ]; then
    echo "ERROR: Windows GUI exe not produced" >&2
    return 1
  fi
}

LANE_LOGS_DIR=""
if [[ $DO_LINUX -eq 1 ]] || [[ $DO_WINDOWS -eq 1 ]]; then
  cd "$PROJECT_DIR"
  LANE_LOGS_DIR="$(mktemp -d)"
  info "Lane logs: $LANE_LOGS_DIR"
  lane_names=(); lane_pids=(); lane_logs=()
  if [[ $DO_LINUX -eq 1 ]]; then
    log="$LANE_LOGS_DIR/linux-gui.log"
    info "Starting: linux-gui"
    run_logged_step "$log" build_linux_gui &
    lane_names+=("linux-gui")
    lane_pids+=("$!")
    lane_logs+=("$log")
  fi
  if [[ $DO_WINDOWS -eq 1 ]]; then
    log="$LANE_LOGS_DIR/windows-gui-nsis.log"
    info "Starting: windows-gui-nsis"
    run_logged_step "$log" build_windows_gui &
    lane_names+=("windows-gui-nsis")
    lane_pids+=("$!")
    lane_logs+=("$log")
  fi
  wait_lane "GUI" lane_names lane_pids lane_logs
fi

if [[ -n "$LANE_LOGS_DIR" ]]; then
  if printf '%s\n' "${RESULTS[@]}" | grep -q '^FAIL'; then
    warn "Keeping lane logs after failure: $LANE_LOGS_DIR"
  else
    rm -rf "$LANE_LOGS_DIR"
  fi
fi

echo
info "──────── SUMMARY ────────"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo
info "dist/ artifacts:"
ls -lh "$OUTPUT_DIR"/voxis-* "$OUTPUT_DIR"/Voxis_* 2>/dev/null | awk '{print "  ",$5,$NF}' || true

printf '%s\n' "${RESULTS[@]}" | grep -q '^FAIL' && exit 1 || exit 0
