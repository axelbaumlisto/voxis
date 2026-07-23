#!/usr/bin/env bash
# Advisory docs agents (screenshotter + auditor). This step must NEVER stall or
# fail the release pipeline, and must NOT leak background processes.
#
# Why the hardening below: docs-screenshotter starts a Vite dev server and a
# Playwright browser as BACKGROUND children. A plain `timeout 900 pi ...` only
# kills `pi` itself on expiry — the backgrounded vite + browser get orphaned
# (reparented to init) and survive forever (observed: a malformed inline
# `bunx vite ... &` bash line hung for 15h and leaked processes). So we:
#   1. run each agent in its own process GROUP (setsid) and kill the whole
#      group on timeout (timeout --kill-after, negative PID signal),
#   2. sweep any vite/playwright leftovers this script's run may have spawned,
#   3. always exit 0.
set -uo pipefail
TAG="${1:-}"
echo "=== Voxis docs agents advisory run ${TAG:+for $TAG} ==="

cleanup_leftovers() {
  # Only target THIS project's docs dev-server + the playwright it launches.
  # Do NOT touch any shared/long-running browser (e.g. a VNC chrome service).
  pkill -f 'vite --host 127.0.0.1 --port 5173' 2>/dev/null || true
  pkill -f 'soupawhisper-vite' 2>/dev/null || true
  pkill -f 'voxis-vite' 2>/dev/null || true
  rm -f /tmp/soupawhisper-vite.pid /tmp/soupawhisper-vite.log \
        /tmp/voxis-vite.pid /tmp/voxis-vite.log 2>/dev/null || true
}
trap cleanup_leftovers EXIT

if ! command -v pi >/dev/null 2>&1; then
  echo "WARNING: pi CLI not found on PATH; skipping docs agents"
  exit 0
fi
if [ ! -f .pi/agents/docs-auditor.md ] || [ ! -f .pi/agents/docs-screenshotter.md ]; then
  echo "WARNING: docs agent definitions missing; skipping"
  exit 0
fi

# Run one agent in its own session/process-group, hard-bounded. On timeout,
# SIGTERM the group, then SIGKILL 30s later if still alive — this reaps the
# agent's backgrounded vite/browser children too, not just the pi process.
run_agent() {
  local name="$1" prompt="$2"
  echo "--- $name (max 900s) ---"
  setsid timeout --kill-after=30s --signal=TERM 900 \
    pi run "$name" "$prompt" \
    && echo "$name: ok" \
    || echo "WARNING: $name failed/timed out (advisory)"
  # Belt-and-suspenders: sweep anything the agent left running.
  cleanup_leftovers
}

run_agent docs-screenshotter "Refresh Voxis docs screenshots ${TAG}"
run_agent docs-auditor "Audit Voxis docs ${TAG}"

# Advisory: never fail the release on docs.
exit 0
