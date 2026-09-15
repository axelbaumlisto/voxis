#!/usr/bin/env bash
# Task 8.5 (iOS Simulator tracer bullet, stage 1): real-binary smoke test
# for `VOXIS_CAPTURE=ios` -- boots a Simulator, builds `host-min` for
# `aarch64-apple-ios-sim` (skipped if `--skip-build` / `HOST_MIN_IOS_SKIP_BUILD=1`
# and a prior build already exists), installs it, grants microphone
# permission non-interactively, starts a local `voxis-fake-stt`, launches
# the app with `VOXIS_SMOKE_AUTOSTART=1` against real Simulator-mic input
# (Mac room noise -- no audio is played for this scenario), and asserts
# the SILENCE scenario's own expected shape: `guardOutcome`
# `silenceTimeoutNoSpeech`, empty `text`, and `voxis-fake-stt` seeing
# EXACTLY ZERO requests (same "the guard must discard before ever calling
# out over HTTP" invariant `host-min-smoke.sh`'s desktop `silence`
# scenario already covers -- this script proves it holds for the REAL
# `AVAudioEngine` capture path too, not just the scripted `MockCapture`).
#
# Deliberately narrow: this is scenario (a) from the plan's Task 8.5 only
# (the one the plan explicitly calls a script-automatable regression, not
# a human-judgment call) -- SPEECH (needs a human to play `speech.wav`
# through the Mac's speakers and a real Groq key) and the iPad-only items
# (system mute button, Smart Folio, backgrounding) stay manual, see
# `research/plugin-ios/T8_5_simulator.md`.
#
# `SIMCTL_CHILD_*` (the mechanism `xcrun simctl launch` uses to set env
# vars in the launched process) MUST be exported in THIS script's own
# environment before calling `simctl launch` -- passing them as trailing
# `simctl launch` arguments does NOT work, they become argv for the app
# instead (learned the hard way running this manually first: `xcrun
# simctl launch --help`'s own last line documents this, easy to miss).
#
# REJECT-FIX (stage 1 evidence round): the Simulator's audio input is
# whatever the MAC's own default input device currently is -- if that's
# AirPods/a Bluetooth headset instead of the built-in mic, the SPEECH
# scenario's acoustic loop (speaker -> Simulator mic) silently degrades
# (garbage transcript, wrong detected language) in a way that looks like
# an acoustics problem but isn't (`research/plugin-ios/T8_5_simulator.md`'s
# corrected root-cause note). This script's own SILENCE scenario doesn't
# depend on transcript content, but the same wrong-input-device trap can
# still shift the ambient noise floor it reads, so the precondition check
# below applies here too.
set -uo pipefail

SIM_NAME="${SIM_NAME:-iPhone 17 Pro}"
SIM_UDID="${SIM_UDID:-}"
BUNDLE_ID="top.voxis.hostmin"
SILENCE_TIMEOUT_MS="${VOXIS_SILENCE_TIMEOUT_MS:-7000}"
# `SILENCE_WINDOW_MS` (10s, voxis_core::config::consts) + the timeout
# above must fill before `SilenceTimeoutNoSpeech` can fire -- give it
# comfortable headroom (real Mac-room-noise timing is not as exact as a
# scripted `MockCapture` fixture).
#
# REJECT-FIX F5: this is now a real wall-clock second budget (`SECONDS`-
# based deadline below), not an iteration count -- the previous version
# ran one `xcrun simctl spawn ... log show --last 1m` call (~3-4s each)
# per "second", so its old default of 25 was actually a 75-100s wait and
# its own failure message ("within 25s") lied about that.
WAIT_SECS="${VOXIS_IOS_SMOKE_WAIT_SECS:-40}"
SKIP_BUILD="${HOST_MIN_IOS_SKIP_BUILD:-0}"
# REJECT-FIX F6: the header above advertises `--skip-build` as a CLI flag,
# not just the env var -- actually parse it.
if [ "${1:-}" = "--skip-build" ]; then
  SKIP_BUILD=1
fi

# Both resolved from the ORIGINAL `$0` in one subshell each (not two
# sequential `cd`s in this shell) -- `$0` stays whatever relative-path
# string the caller invoked this script with, so a second `cd` relative
# to the FIRST `cd`'s new cwd silently resolves the wrong directory.
host_min_dir="$(cd "$(dirname "$0")/.." && pwd)"           # -> examples/host-min
src_tauri_dir="$host_min_dir/src-tauri"
repo_root="$(cd "$(dirname "$0")/../../../../.." && pwd)"  # -> repo root
cd "$repo_root"

fake_stt_pid=""
fake_stt_log=""
log_stream_pid=""
run_log=""
launched=0

cleanup() {
  local exit_code=$?
  if [ "$launched" = "1" ] && [ -n "$SIM_UDID" ]; then
    xcrun simctl terminate "$SIM_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  fi
  if [ -n "$log_stream_pid" ]; then
    kill "$log_stream_pid" >/dev/null 2>&1 || true
    wait "$log_stream_pid" 2>/dev/null || true
  fi
  if [ -n "$fake_stt_pid" ]; then
    kill "$fake_stt_pid" >/dev/null 2>&1 || true
    wait "$fake_stt_pid" 2>/dev/null || true
  fi
  pkill -P $$ >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "=== checking active Mac input device (Simulator inherits it) ==="
# REJECT-FIX F2: the iOS Simulator's audio input passes straight through
# to whatever the MAC's own default input device currently is -- an
# AirPods/Bluetooth mic instead of the built-in mic changes both the
# noise floor this scenario reads and (for a human running the SPEECH
# scenario by hand) the acoustic path entirely, in a way that silently
# looks like an unrelated acoustics/language-detection problem
# (`research/plugin-ios/T8_5_simulator.md`'s corrected root-cause note).
if command -v SwitchAudioSource >/dev/null 2>&1; then
  active_input="$(SwitchAudioSource -t input -c)"
  echo "Active input device: $active_input"
  allowed_substr="${VOXIS_IOS_SMOKE_INPUT:-MacBook}"
  if [ "${VOXIS_IOS_SMOKE_ANY_INPUT:-0}" != "1" ] && ! printf '%s' "$active_input" | grep -qF "$allowed_substr"; then
    echo "FAIL: active Mac input device is '$active_input', which does not contain '$allowed_substr' -- the Simulator inherits this as its own mic input. Run 'SwitchAudioSource -t input -s \"<built-in mic name>\"' first, or set VOXIS_IOS_SMOKE_ANY_INPUT=1 to bypass this check deliberately (e.g. VOXIS_IOS_SMOKE_INPUT to match a different substring)." >&2
    exit 1
  fi
else
  echo "WARN: SwitchAudioSource not found (brew install switchaudio-osx) -- cannot verify the Mac's active input device is the built-in mic, not AirPods/a Bluetooth mic, before this Simulator run." >&2
fi

echo "=== resolving Simulator UDID ==="
if [ -z "$SIM_UDID" ]; then
  SIM_UDID=$(xcrun simctl list devices available | grep -F "$SIM_NAME (" | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)
fi
if [ -z "$SIM_UDID" ]; then
  echo "FAIL: no Simulator matching '$SIM_NAME' found (xcrun simctl list devices available)" >&2
  exit 1
fi
echo "Using Simulator UDID: $SIM_UDID"

echo "=== booting Simulator (no-op if already booted) ==="
xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1 || true

app_path="$src_tauri_dir/gen/apple/build/arm64-sim/host-min.app"
if [ "$SKIP_BUILD" != "1" ] || [ ! -d "$app_path" ]; then
  echo "=== building host-min for aarch64-apple-ios-sim (cargo tauri ios build) ==="
  # A stale `.app` from a previous build makes the CLI's own rename step
  # fail ("Directory not empty") -- clear it first, same fix this task's
  # own manual run needed.
  rm -rf "$src_tauri_dir/gen/apple/build"
  if [ ! -d "$src_tauri_dir/gen/apple" ]; then
    echo "FAIL: $src_tauri_dir/gen/apple does not exist -- run 'cargo tauri ios init' first (Task 8.5 acceptance #1)" >&2
    exit 1
  fi
  (cd "$src_tauri_dir" && cargo tauri ios build --debug --target aarch64-sim)
  build_status=$?
  if [ $build_status -ne 0 ]; then
    echo "FAIL: cargo tauri ios build exited $build_status" >&2
    exit 1
  fi
fi
if [ ! -d "$app_path" ]; then
  echo "FAIL: expected app bundle not found at $app_path after build" >&2
  exit 1
fi

echo "=== installing + granting microphone permission ==="
xcrun simctl install "$SIM_UDID" "$app_path" || { echo "FAIL: simctl install"; exit 1; }
xcrun simctl privacy "$SIM_UDID" grant microphone "$BUNDLE_ID" || { echo "FAIL: simctl privacy grant microphone"; exit 1; }

echo "=== starting voxis-fake-stt ==="
# REJECT-FIX F5: check this build's own exit code -- it used to run
# unchecked, so a build failure here would only surface later as a
# confusing "voxis-fake-stt never came up" from the binary simply not
# existing.
if ! cargo build -p voxis-fake-stt >/dev/null; then
  echo "FAIL: cargo build -p voxis-fake-stt failed" >&2
  exit 1
fi
fake_stt_log="$(mktemp)"
"$repo_root/target/debug/voxis-fake-stt" --port 0 --map "$repo_root/fixtures/audio/fake-stt-map.json" >"$fake_stt_log" 2>&1 &
fake_stt_pid=$!
for _ in $(seq 1 50); do
  grep -q "listening on" "$fake_stt_log" 2>/dev/null && break
  sleep 0.1
done
grep -q "listening on" "$fake_stt_log" || { echo "FAIL: voxis-fake-stt never came up:"; cat "$fake_stt_log"; exit 1; }
fake_stt_port=$(sed -n 's/.*listening on 127.0.0.1:\([0-9]*\).*/\1/p' "$fake_stt_log" | tail -1)
echo "voxis-fake-stt on port $fake_stt_port"

echo "=== launching host-min (VOXIS_CAPTURE=ios, SILENCE scenario, real Simulator mic) ==="
xcrun simctl terminate "$SIM_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
sleep 1

# REJECT-FIX F5: start `log stream` BEFORE `simctl launch`, not
# poll-and-retry `log show --last 1m` AFTER it -- a freshly started
# stream only ever captures output from this point forward, so a
# previous run's still-in-window `RESULT_EVENT` structurally cannot
# appear in it (the old approach's PID filter below is now belt-and-
# braces, not the only thing preventing that mismatch).
run_log="$(mktemp)"
xcrun simctl spawn "$SIM_UDID" log stream --predicate 'process == "host-min"' >"$run_log" 2>&1 &
log_stream_pid=$!

# See this script's own header comment: these MUST be `export`ed in this
# shell, not passed as `simctl launch` trailing args.
export SIMCTL_CHILD_VOXIS_CAPTURE=ios
export SIMCTL_CHILD_VOXIS_STT_URL="http://127.0.0.1:$fake_stt_port/v1/audio/transcriptions"
export SIMCTL_CHILD_VOXIS_API_KEY="smoke-dummy-key"
export SIMCTL_CHILD_VOXIS_SMOKE_AUTOSTART=1
export SIMCTL_CHILD_VOXIS_SILENCE_TIMEOUT_MS="$SILENCE_TIMEOUT_MS"
# REJECT-FIX F5: on by default now (was opt-in-only, `host-min`'s own
# `lib.rs` doc) so both the pass and fail paths below can print a tick-
# count + peak/rms min/max summary -- cheap against a `log stream` file,
# unlike the old `log show`-per-second-of-waiting this replaces.
export SIMCTL_CHILD_VOXIS_SMOKE_LOG_LEVELS="${SIMCTL_CHILD_VOXIS_SMOKE_LOG_LEVELS:-1}"
launch_out=$(xcrun simctl launch "$SIM_UDID" "$BUNDLE_ID" 2>&1)
echo "$launch_out"
echo "$launch_out" | grep -q "^$BUNDLE_ID: " || { echo "FAIL: simctl launch did not report a PID"; exit 1; }
launched=1
launch_pid=$(echo "$launch_out" | sed -n "s/^$BUNDLE_ID: //p" | tail -1)

print_level_summary() {
  python3 - "$run_log" <<'PY'
import json, sys

ticks = 0
peaks, rmss = [], []
with open(sys.argv[1], errors="replace") as f:
    for line in f:
        if "LEVEL_EVENT " not in line:
            continue
        payload = line.split("LEVEL_EVENT ", 1)[1].strip()
        try:
            sample = json.loads(payload)
        except (json.JSONDecodeError, ValueError):
            continue
        ticks += 1
        peaks.append(sample.get("peak"))
        rmss.append(sample.get("rms"))

if ticks:
    print(f"ticks: {ticks}")
    print(f"peak min/max: {min(peaks)} {max(peaks)}")
    print(f"rms  min/max: {min(rmss)} {max(rmss)}")
else:
    print("ticks: 0 (no LEVEL_EVENT observed)")
PY
}

echo "=== waiting up to ${WAIT_SECS}s (wall clock) for RESULT_EVENT ==="
result_line=""
deadline=$((SECONDS + WAIT_SECS))
while [ "$SECONDS" -lt "$deadline" ]; do
  sleep 1
  # Filter to THIS run's own PID (same table-output PID column `log
  # show`/`log stream`'s default style prints) -- belt-and-braces on top
  # of `log_stream_pid` above only having started capturing at launch
  # time in the first place (see the F5 comment above).
  result_line=$(awk -v pid="$launch_pid" '$6 == pid' "$run_log" 2>/dev/null | grep "RESULT_EVENT" | tail -1)
  [ -n "$result_line" ] && break
done

if [ -z "$result_line" ]; then
  echo "FAIL: no RESULT_EVENT observed within ${WAIT_SECS}s" >&2
  echo "--- level summary ---"
  print_level_summary
  echo "--- fake-stt log ---"
  cat "$fake_stt_log"
  exit 1
fi
echo "$result_line"
echo "--- level summary ---"
print_level_summary

json="${result_line#*RESULT_EVENT }"
outcome=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['guardOutcome'])" "$json" 2>/dev/null)
text=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['text'])" "$json" 2>/dev/null)
requests=$(grep -c "TRANSCRIBE_REQUEST" "$fake_stt_log" || true)

fail=0
if [ "$outcome" != "silenceTimeoutNoSpeech" ]; then
  echo "FAIL: expected guardOutcome=silenceTimeoutNoSpeech, got '$outcome' (Mac ambient noise may be above SILENCE_RMS=0.02 right now -- see research/plugin-ios/T8_5_simulator.md's own noise-floor note)" >&2
  fail=1
fi
if [ -n "$text" ]; then
  echo "FAIL: expected empty text, got '$text'" >&2
  fail=1
fi
if [ "$requests" != "0" ]; then
  echo "FAIL: expected 0 voxis-fake-stt requests, got $requests" >&2
  fail=1
fi

if [ "$fail" = "1" ]; then
  echo "--- fake-stt log ---"
  cat "$fake_stt_log"
  exit 1
fi

echo "=== PASS: SILENCE scenario (real Simulator mic, guardOutcome=silenceTimeoutNoSpeech, 0 fake-stt requests) ==="
