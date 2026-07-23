#!/usr/bin/env bash
# Advisory docs agents (screenshotter + auditor). This step must NEVER stall or
# fail the release pipeline, and must NOT leak background processes.
#
# Why the hardening below: docs-screenshotter starts a Vite dev server (as
# `bun run dev` -> `node .../vite` -> esbuild) and a Playwright browser as
# BACKGROUND children. A plain `timeout 900 pi ...` only signals `pi` on expiry
# — its backgrounded dev-server/browser get orphaned (reparented to init) and
# survive forever (observed: a hung run left `bun run dev` + vite + esbuild
# alive for 15h). Pattern-matching specific vite invocations is fragile (the
# agent may launch `bunx vite --host ...` OR `bun run dev`), so instead we run
# each agent in its OWN process group (setsid) and, on completion/timeout, kill
# the ENTIRE group — reaping every descendant regardless of how it was spawned.
set -uo pipefail
TAG="${1:-}"
echo "=== Voxis docs agents advisory run ${TAG:+for $TAG} ==="

# Best-effort cleanup of tmp files the docs agents write. Process reaping is
# handled per-agent via the process group (see run_agent), which is robust to
# however the dev server was launched.
cleanup_tmp() {
  rm -f /tmp/soupawhisper-vite.pid /tmp/soupawhisper-vite.log \
        /tmp/voxis-vite.pid /tmp/voxis-vite.log 2>/dev/null || true
}
trap cleanup_tmp EXIT

if ! command -v pi >/dev/null 2>&1; then
  echo "WARNING: pi CLI not found on PATH; skipping docs agents"
  exit 0
fi
if [ ! -f .pi/agents/docs-auditor.md ] || [ ! -f .pi/agents/docs-screenshotter.md ]; then
  echo "WARNING: docs agent definitions missing; skipping"
  exit 0
fi

# Run one agent bounded to 900s in its OWN process group, then tear the whole
# group down so no backgrounded dev-server/browser survives.
#
# - `setsid ... &` starts the agent as the leader of a new process group whose
#   PGID == the child PID, so every descendant (pi, bun, node/vite, esbuild,
#   playwright browser) shares that PGID.
# - We wait up to 900s; if still alive we escalate TERM -> (10s) KILL to the
#   whole group via `kill -SIGNAL -PGID` (negative PID = process group).
# - On normal exit we STILL kill the group, because pi may leave a detached
#   dev server running after it returns.
run_agent() {
  local name="$1" prompt="$2"
  echo "--- $name (max 900s) ---"

  setsid pi run "$name" "$prompt" &
  local pgid=$!   # setsid child is a group leader: PGID == its PID

  local waited=0 rc=0
  while kill -0 "$pgid" 2>/dev/null; do
    if [ "$waited" -ge 900 ]; then
      echo "WARNING: $name exceeded 900s — terminating process group"
      kill -TERM "-$pgid" 2>/dev/null || true
      sleep 10
      kill -KILL "-$pgid" 2>/dev/null || true
      rc=124
      break
    fi
    sleep 5
    waited=$((waited + 5))
  done

  if [ "$rc" -eq 0 ]; then
    wait "$pgid" 2>/dev/null || rc=$?
  fi

  # Always reap the whole group: pi may leave a detached dev server behind even
  # on a clean exit. Harmless if the group is already gone.
  kill -TERM "-$pgid" 2>/dev/null || true
  sleep 2
  kill -KILL "-$pgid" 2>/dev/null || true

  if [ "$rc" -eq 0 ]; then
    echo "$name: ok"
  else
    echo "WARNING: $name failed/timed out (advisory, rc=$rc)"
  fi
  cleanup_tmp
}

run_agent docs-screenshotter "Refresh Voxis docs screenshots ${TAG}"
run_agent docs-auditor "Audit Voxis docs ${TAG}"

# Advisory: never fail the release on docs.
exit 0
