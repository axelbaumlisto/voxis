#!/usr/bin/env bash
# Real-binary tracer-bullet smoke test (Task 3.5 acceptance #4's "the
# real-binary path must exist in some form"): builds and runs the ACTUAL
# `host-min` Tauri binary (not a browser/webview driver) against a real
# `voxis-fake-stt` server, driving it via `VOXIS_CAPTURE=mock:<wav>` +
# `VOXIS_SMOKE_AUTOSTART=1` (see `src/main.rs`'s module doc) and
# asserting on the `RESULT_EVENT`/`STATE_EVENT` lines it prints to
# stdout. Three scenarios:
#   1. speech -> an explicit `stop()` lands shortly after the WAV
#      finishes "playing" (host-min's own `script_len*250ms+500ms`
#      scheduling, the default unless `VOXIS_SMOKE_NO_STOP=1`) so the
#      NORMAL stop path runs: `guardOutcome":"finalized`, the fixed
#      transcript from fake-stt-map.json, exactly 1 fake-stt request.
#   2. silence -> the guard's own `SilenceTimeoutNoSpeech` fires well
#      before that scheduled stop (~13s vs ~17.5s): `guardOutcome":
#      "silenceTimeoutNoSpeech`, `"text":""`, and fake-stt sees EXACTLY 0
#      requests -- the guard must discard before ever calling out over
#      HTTP (the whole point of the DimaTorzok hallucination incident
#      this fixture encodes).
#   3. speech-streamdied -> `VOXIS_SMOKE_NO_STOP=1`, no scheduled stop at
#      all: once the scripted WAV's ticks run out, the guard's liveness
#      check reports `StreamDied` on its own ~1s later
#      (`guardOutcome":"streamDied`) -- the same fixed transcript still
#      comes back (StreamDied still uploads the finished recording), but
#      via the liveness-recovery path instead of an explicit stop.
#
# Local/CI use: needs a real window surface. On a machine with a display
# (this Mac; or CI under `xvfb-run -a`), just run this script directly.
# Regenerates `ui/vendor/voxis-overlay.bundle.js` first (gitignored,
# review fix F4) -- Tauri embeds `frontendDist` at COMPILE time, so a
# stale/missing bundle at `cargo build` time ships stale/missing JS, not
# a build failure.
set -euo pipefail
# Task 8.5 fix: both resolved from the ORIGINAL `$0` in one subshell each
# (not two sequential `cd`s in this shell) -- `$0` stays whatever
# relative-path string the caller invoked this script with (CI/`package.
# json`'s `e2e:host-min` both use the relative `crates/tauri-plugin-voxis/
# examples/host-min/scripts/host-min-smoke.sh`, never the repo-root
# forwarding stub), so a second `cd` relative to the FIRST `cd`'s new cwd
# silently resolved the wrong directory -- `bash crates/tauri-plugin-
# voxis/examples/host-min/scripts/host-min-smoke.sh` from the repo root
# failed outright (`cd: .../scripts/../../../../..: No such file or
# directory`) before this fix, never actually exercised by a run from
# that exact relative path until Task 8.5 needed to invoke it that way
# for its own acceptance criterion #7.
host_min_dir="$(cd "$(dirname "$0")/.." && pwd)"           # -> examples/host-min
repo_root="$(cd "$(dirname "$0")/../../../../.." && pwd)"  # -> repo root
# `target/debug/...`/`fixtures/audio/...` below are repo-root-relative
# (the workspace's single `target/` dir always lives there, regardless of
# which member crate's directory `cargo build` was invoked from) -- land
# in `repo_root`, not `host_min_dir`.
cd "$repo_root"

echo "=== bundling guest-js overlay into ui/vendor ==="
bash "$host_min_dir/scripts/bundle-overlay.sh"

echo "=== building voxis-fake-stt + host-min ==="
cargo build -p voxis-fake-stt -p host-min

fake_stt_bin="target/debug/voxis-fake-stt"
host_min_bin="target/debug/host-min"
fake_stt_log="$(mktemp)"
host_min_log="$(mktemp)"

# REJECT-FIX F1: plain globals, set by `start_fake_stt` called directly
# (never through `$(...)` command substitution, which forks a SUBSHELL --
# `fake_stt_pid=$!` inside one only ever updates that subshell's own copy
# of the variable, never the parent script's, so `cleanup`'s `kill
# "$fake_stt_pid"` silently killed nothing and every run leaked a
# `voxis-fake-stt` process). `fake_stt_port` is parsed from the log file
# after `start_fake_stt` returns instead.
fake_stt_pid=""
fake_stt_port=""
host_min_pid=""

cleanup() {
  [ -n "$host_min_pid" ] && kill "$host_min_pid" 2>/dev/null || true
  [ -n "$fake_stt_pid" ] && kill "$fake_stt_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  # Belt-and-braces (F1): in case either pid tracking above ever races or
  # misses (a child this script spawned re-forking, a signal arriving
  # mid-assignment), sweep every remaining direct child of this script's
  # own PID too. `pkill -P` is a no-op (exit 1, harmless under `|| true`)
  # once everything is already gone.
  pkill -P $$ 2>/dev/null || true
}
trap cleanup EXIT INT TERM

start_fake_stt() {
  "$fake_stt_bin" --port 0 --map "$repo_root/fixtures/audio/fake-stt-map.json" > "$fake_stt_log" 2>&1 &
  fake_stt_pid=$!
  for _ in $(seq 1 50); do
    if grep -q "listening on" "$fake_stt_log" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
  grep -q "listening on" "$fake_stt_log" || { echo "fake-stt never came up:"; cat "$fake_stt_log"; exit 1; }
  fake_stt_port=$(sed -n 's/.*listening on 127.0.0.1:\([0-9]*\).*/\1/p' "$fake_stt_log" | tail -1)
}

# $1=name $2=wav $3=expect_text_grep $4=expect_requests $5=expect_guard_outcome $6=extra_env (optional, e.g. "VOXIS_SMOKE_NO_STOP=1")
run_scenario() {
  local name="$1" wav="$2" expect_grep="$3" expect_requests="$4" expect_guard_outcome="$5" extra_env="${6:-}"

  : > "$fake_stt_log"
  start_fake_stt  # NOT `port=$(start_fake_stt)` -- see the F1 comment above.
  echo "=== [$name] fake-stt on port $fake_stt_port ==="

  env $extra_env \
  VOXIS_CAPTURE="mock:$repo_root/fixtures/audio/$wav" \
  VOXIS_STT_URL="http://127.0.0.1:$fake_stt_port/v1/audio/transcriptions" \
  VOXIS_API_KEY="smoke-dummy-key" \
  VOXIS_SMOKE_AUTOSTART=1 \
  VOXIS_SILENCE_TIMEOUT_MS=3000 \
    "$host_min_bin" > "$host_min_log" 2>&1 &
  host_min_pid=$!

  local deadline=$((SECONDS + 30))
  while [ $SECONDS -lt $deadline ]; do
    if grep -q "RESULT_EVENT" "$host_min_log" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done

  kill "$host_min_pid" 2>/dev/null || true
  wait "$host_min_pid" 2>/dev/null || true
  host_min_pid=""
  kill "$fake_stt_pid" 2>/dev/null || true
  wait "$fake_stt_pid" 2>/dev/null || true
  fake_stt_pid=""

  echo "--- host-min log ($name) ---"
  cat "$host_min_log"
  echo "--- fake-stt log ($name) ---"
  cat "$fake_stt_log"

  if ! grep -q "RESULT_EVENT" "$host_min_log"; then
    echo "FAIL [$name]: no RESULT_EVENT observed within 30s" >&2
    exit 1
  fi
  local result_line
  result_line=$(grep "RESULT_EVENT" "$host_min_log" | tail -1)
  if ! echo "$result_line" | grep -q "$expect_grep"; then
    echo "FAIL [$name]: RESULT_EVENT did not match /$expect_grep/: $result_line" >&2
    exit 1
  fi
  if ! echo "$result_line" | grep -q "\"guardOutcome\":\"$expect_guard_outcome\""; then
    echo "FAIL [$name]: expected guardOutcome=$expect_guard_outcome: $result_line" >&2
    exit 1
  fi
  local actual_requests
  actual_requests=$(grep -c "TRANSCRIBE_REQUEST" "$fake_stt_log" || true)
  if [ "$actual_requests" != "$expect_requests" ]; then
    echo "FAIL [$name]: expected $expect_requests fake-stt request(s), got $actual_requests" >&2
    exit 1
  fi
  echo "PASS [$name]"
}

run_scenario "speech" "speech.wav" "Вот такая у нас сегодняшняя разблюдовка" "1" "finalized"
run_scenario "silence" "silence.wav" "\"text\":\"\"" "0" "silenceTimeoutNoSpeech"
run_scenario "speech-streamdied" "speech.wav" "Вот такая у нас сегодняшняя разблюдовка" "1" "streamDied" "VOXIS_SMOKE_NO_STOP=1"

echo "=== host-min-smoke.sh: all scenarios passed ==="
