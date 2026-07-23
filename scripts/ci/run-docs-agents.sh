#!/usr/bin/env bash
# Advisory docs agents (screenshotter + auditor). This step must NEVER stall or
# fail the release pipeline, and must NEVER leak background processes onto the
# shared host.
#
# CONTAINERIZED MODEL (why this is safe now):
#   The docs-screenshotter spawns a Vite dev server + a Playwright browser, and
#   `pi -p` itself can linger after finishing (its RSS memory-guard blocks a
#   clean exit). Historically these ran as HOST processes, so a hung/lingering
#   run left `bun run dev`/vite/esbuild/chromium/pi orphaned on spex for hours,
#   and cleanup meant `kill`/`fuser` on the shared machine — which is dangerous
#   (it can hit unrelated pi sessions and other projects).
#
#   Instead we run each agent INSIDE a dedicated, named, ephemeral container
#   (`docker run --name ...`). Everything the agent spawns (pi, node/vite,
#   esbuild, chromium) is a process INSIDE that container. Teardown is a single
#   `docker rm -f <name>` which kills the container's entire PID namespace at
#   once — no host process ever survives, and we never signal a host PID. The
#   worst case (a wedged run) is bounded by MAX_RUNTIME and still cleaned up by
#   `docker rm -f`, touching nothing outside the container.
#
# pi -p lingers even in-container (it does not always exit cleanly after the
# work is done), and its stdout is heavily buffered when not a TTY (so stdout
# silence is NOT a reliable progress signal). Instead we watch the agents' real
# output: both write under docs-site/ (screenshotter -> images/*.png, auditor
# -> *.md). Once the newest mtime anywhere under docs-site/ has stopped
# advancing for IDLE_SETTLE seconds (past a MIN_RUNTIME floor), the work is
# done and we tear the container down instead of waiting the full MAX_RUNTIME.
set -uo pipefail
TAG="${1:-}"
echo "=== Voxis docs agents advisory run ${TAG:+for $TAG} (containerized) ==="

# --- config knobs -----------------------------------------------------------
DOCS_IMAGE="${VOXIS_DOCS_IMAGE:-voxis-docs:latest}"
MAX_RUNTIME="${VOXIS_DOCS_MAX_RUNTIME:-900}"   # hard wall-clock ceiling per agent
IDLE_SETTLE="${VOXIS_DOCS_IDLE_SETTLE:-90}"    # docs-site quiet window => reap early
MIN_RUNTIME="${VOXIS_DOCS_MIN_RUNTIME:-120}"   # don't reap before this floor
WATCH_DIR="${VOXIS_DOCS_WATCH_DIR:-docs-site}" # agents' real output tree
PI_AGENT_DIR="${VOXIS_PI_AGENT_DIR:-$HOME/.pi/agent}"  # pi auth/config (mounted read-only)

# --- preflight ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "WARNING: docker not found; skipping docs agents (advisory)"; exit 0
fi
if ! docker image inspect "$DOCS_IMAGE" >/dev/null 2>&1; then
  echo "WARNING: image $DOCS_IMAGE missing (build with scripts/ci/build-docs-image.sh); skipping"; exit 0
fi
if [ ! -f .pi/agents/docs-auditor.md ] || [ ! -f .pi/agents/docs-screenshotter.md ]; then
  echo "WARNING: docs agent definitions missing; skipping"; exit 0
fi
if [ ! -d "$PI_AGENT_DIR" ]; then
  echo "WARNING: pi config not found at $PI_AGENT_DIR; skipping"; exit 0
fi

# Tear down EVERY container we started, no matter how we exit. Names are unique
# to this run (PID-scoped) so we never touch unrelated containers.
RUN_TAG="docs-$$"
cleanup_containers() {
  docker ps -aq --filter "name=voxis-${RUN_TAG}-" 2>/dev/null | while read -r cid; do
    [ -n "$cid" ] && docker rm -f "$cid" >/dev/null 2>&1 || true
  done
}
trap cleanup_containers EXIT

# Run one agent inside its own ephemeral container, bounded by MAX_RUNTIME with
# idle-settle early-reap. The container's whole PID namespace is torn down via
# `docker rm -f` — nothing leaks to the host.
run_agent() {
  local name="$1" prompt="$2"
  local cname="voxis-${RUN_TAG}-${name}"
  echo "--- $name (image $DOCS_IMAGE, max ${MAX_RUNTIME}s, idle-settle ${IDLE_SETTLE}s) ---"

  docker rm -f "$cname" >/dev/null 2>&1 || true

  # -d: detached; we stream logs ourselves for idle-settle detection.
  # --user: run as the invoking uid so files written under /w (docs-site/) are
  #         host-owned, matching the rest of CI.
  # mounts: repo at /w (rw, for docs-site output); pi config read-only, pointed
  #         at directly via PI_CODING_AGENT_DIR (no copy needed).
  # The agent's own bash tool starts Vite/Playwright INSIDE this container.
  docker run -d --name "$cname" \
    -v "$PWD":/w -w /w \
    -v "$PI_AGENT_DIR":/pi-agent-ro:ro \
    -e HOME=/tmp/agenthome \
    -e PI_CODING_AGENT_DIR=/tmp/agenthome/pi-agent \
    -e PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    --user "$(id -u):$(id -g)" \
    "$DOCS_IMAGE" \
    bash -lc '
      set -uo pipefail
      mkdir -p /tmp/agenthome
      # Copy the (read-only mounted) pi config into a writable location so pi
      # can write its own cache/lock/session bookkeeping without touching the
      # host config. --no-session keeps it ephemeral regardless.
      cp -r /pi-agent-ro /tmp/agenthome/pi-agent
      pi -p --no-session \
        --append-system-prompt "$(cat ".pi/agents/'"$name"'.md")" \
        "'"$prompt"' Produce the required outputs, then STOP."
    ' >/dev/null 2>&1 || { echo "WARNING: $name failed to start (advisory)"; return 0; }

  # newest mtime (epoch secs) anywhere under WATCH_DIR; 0 if empty/missing.
  newest_mtime() {
    find "$WATCH_DIR" -type f -printf '%T@\n' 2>/dev/null \
      | cut -d. -f1 | sort -n | tail -1
  }

  local waited=0 rc=0
  local last_out_mtime; last_out_mtime=$(newest_mtime)
  local last_change_at; last_change_at=$(date +%s)
  while docker inspect -f '{{.State.Running}}' "$cname" 2>/dev/null | grep -q true; do
    if [ "$waited" -ge "$MAX_RUNTIME" ]; then
      echo "WARNING: $name exceeded ${MAX_RUNTIME}s — removing container"
      rc=124; break
    fi
    # Idle-settle on the REAL output tree: if docs-site/ hasn't changed for
    # IDLE_SETTLE seconds (past MIN_RUNTIME), the agent finished its writes and
    # pi is just lingering => reap now.
    local cur; cur=$(newest_mtime)
    if [ -n "$cur" ] && [ "$cur" != "$last_out_mtime" ]; then
      last_out_mtime="$cur"; last_change_at=$(date +%s)
    fi
    if [ "$waited" -ge "$MIN_RUNTIME" ]; then
      local idle=$(( $(date +%s) - last_change_at ))
      if [ "$idle" -ge "$IDLE_SETTLE" ]; then
        echo "$name: ${WATCH_DIR} idle ${idle}s after ${waited}s — work done, reaping container"
        break
      fi
    fi
    sleep 5; waited=$((waited + 5))
  done

  # If the container exited on its own, capture its real exit code.
  if [ "$rc" -eq 0 ]; then
    local state
    state=$(docker inspect -f '{{.State.Running}}' "$cname" 2>/dev/null || echo false)
    if [ "$state" = "false" ]; then
      rc=$(docker inspect -f '{{.State.ExitCode}}' "$cname" 2>/dev/null || echo 0)
    fi
  fi

  # Single, namespace-scoped teardown: kills pi + vite + chromium in one shot.
  docker rm -f "$cname" >/dev/null 2>&1 || true

  if [ "$rc" -eq 0 ]; then echo "$name: ok"; else echo "WARNING: $name rc=$rc (advisory)"; fi
}

run_agent docs-screenshotter "Refresh Voxis docs screenshots ${TAG}"
run_agent docs-auditor "Audit Voxis docs ${TAG}"

# Advisory: never fail the release on docs.
exit 0
