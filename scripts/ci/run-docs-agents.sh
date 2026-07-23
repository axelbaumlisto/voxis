#!/usr/bin/env bash
# Advisory docs agents (screenshotter + auditor). This step must NEVER stall or
# fail the release pipeline, and must NOT leak background processes.
#
# Two things were wrong originally: (a) the invocation `pi run <agent> <prompt>`
# is not valid — pi has no `run` subcommand, so it launched INTERACTIVE pi that
# blocked on the TTY forever after doing the work (always timed out at 900s);
# fixed by using `pi -p --append-system-prompt "$(cat agent.md)"` (see run_agent,
# now completes in ~40s). (b) process leakage, handled below.
#
# Why the process-group hardening: docs-screenshotter starts a Vite dev server
# (as `bun run dev` -> `node .../vite` -> esbuild) and a Playwright browser as
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

# Kill whatever holds the Vite dev-server port. This is the ONE stable
# identifier: pi's bash tool runs the agent's commands under its own setsid, so
# a `bun run dev` the screenshotter backgrounds lands in a SEPARATE session
# (PPID=1, distinct PGID) that the agent's process-group kill can't reach. But
# the dev server always binds Vite's port, so port-based reaping catches it no
# matter how it was launched (`bun run dev`, `bunx vite --host ...`, etc.).
DEV_PORT="${VOXIS_DOCS_VITE_PORT:-5173}"
kill_dev_server() {
  if command -v fuser >/dev/null 2>&1; then
    fuser -k -TERM "${DEV_PORT}/tcp" 2>/dev/null || true
    sleep 2
    fuser -k -KILL "${DEV_PORT}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    local pids
    pids=$(lsof -t -i "TCP:${DEV_PORT}" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill -TERM $pids 2>/dev/null
    sleep 2
    pids=$(lsof -t -i "TCP:${DEV_PORT}" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill -KILL $pids 2>/dev/null || true
  fi
}
cleanup_tmp() {
  rm -f /tmp/soupawhisper-vite.pid /tmp/soupawhisper-vite.log \
        /tmp/voxis-vite.pid /tmp/voxis-vite.log 2>/dev/null || true
}
cleanup_all() { kill_dev_server; cleanup_tmp; }
trap cleanup_all EXIT

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
  local agent_file=".pi/agents/${name}.md"
  echo "--- $name (max 900s) ---"

  # IMPORTANT: pi has NO `run` subcommand and no `--agent` flag (v0.81.x).
  # `pi run <name> <prompt>` just passes [run, name, prompt] as message args to
  # an INTERACTIVE pi, which processes them once then blocks on the TTY forever
  # (→ always hit the 900s timeout, even though the work finished in ~40s).
  # Correct non-interactive invocation: `pi -p` (process-and-exit) with the
  # agent definition injected as an appended system prompt. --no-session keeps
  # the CI run ephemeral.
  setsid pi -p --no-session \
    --append-system-prompt "$(cat "$agent_file")" \
    "$prompt Produce the required outputs, then STOP." &
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

  # Reap the whole group (pi + direct children)...
  kill -TERM "-$pgid" 2>/dev/null || true
  sleep 2
  kill -KILL "-$pgid" 2>/dev/null || true
  # ...and the dev server, which pi's setsid may have detached into its own
  # session (PPID=1) beyond the reach of the group kill above.
  kill_dev_server

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
