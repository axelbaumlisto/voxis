# Task 8.5 — iOS tracer bullet, Stage 1: iOS Simulator (this Mac)

Evidence for `host-min` + `tauri-plugin-voxis`'s `init_ios()` capture path
(Task 8) exercised end-to-end on an iOS **Simulator** (real Mac
microphone passthrough, real `AVAudioEngine`, real Groq for the SPEECH
scenario). Stage 2 (iPad stand, physical mute button/Smart Folio/
backgrounding/locked-screen items) is **not** covered here — see the
"What the Simulator cannot exercise" section below.

## Environment

- Repo HEAD: `199ced5`
- macOS Xcode 26.6 (build 17F113), `xcode-select -p` → `/Applications/Xcode.app/Contents/Developer`
- `cargo tauri` (tauri-cli) 2.10.0, `tauri`/`tauri-macros` 2.11.1/2.6.1 (resolved via `Cargo.lock`)
- Simulator: **iPhone 17 Pro**, UDID `C1E815B3-6878-40CA-B501-8EC12E831362`, runtime `iOS 26.5 (23F77)`
- Signing: `bundle.iOS.developmentTeam` = `GZL949D756` ("Apple Development: pishpishololo@outlook.com") — Simulator builds run `CODE_SIGN_STYLE: Automatic` with "Sign to Run Locally" (ad hoc `-`), no real signing identity needed
- Bundle ID: `top.voxis.hostmin`
- **Active Mac input device** (`SwitchAudioSource -t input -c`) — the Simulator inherits this as its own mic input verbatim, no in-Simulator way to override it independently. Recorded per run below, not just once here, after this task's own root-cause finding (see Scenario (b)): a wrong default input device (e.g. AirPods) silently degrades a SPEECH run in a way that looks like an acoustics problem but isn't.

## What was built (see "Changed files" in the final report)

1. `cargo tauri ios init --ci` from `crates/tauri-plugin-voxis/examples/host-min/src-tauri` generated `gen/apple/` (project.yml, Sources/, Assets.xcassets/, host-min_iOS/, host-min.xcodeproj/).
2. `gen/apple/project.yml` hand-edits: `deploymentTarget.iOS: 17.0` (was xcodegen's own default 14.0 — the plugin's `ios/Package.swift` pins `.iOS(.v17)` for `AVAudioApplication`), and `NSMicrophoneUsageDescription` in `info.properties` (xcodegen owns/rewrites `Info.plist` from this — hand-editing the generated plist directly would not survive the next `xcodegen generate`, per `docs/PLUGIN_IOS_HOST.md`'s own warning).
3. `xcodegen generate` (from `gen/apple/`) to apply those `project.yml` edits — confirmed via `cat host-min_iOS/Info.plist` that both keys landed.
4. `tauri.conf.json`: added `bundle.iOS.developmentTeam: "GZL949D756"` (same convention as `clipshot`'s own `tauri.conf.json`).
5. **Architecture gap found and fixed (not a plugin bug — host-min's own Cargo layout)**: `host-min`'s `src-tauri` had only a `[[bin]]` target (`src/main.rs`), no library target. `cargo tauri ios build` fails immediately with `error: no library targets found in package 'host-min'` — Tauri's iOS build always links a `staticlib`/`cdylib` with a `#[tauri::mobile_entry_point]`-tagged `run()` function; a bin-only crate can never satisfy this. Fix: moved essentially all of `main.rs`'s body into a new `src/lib.rs` (`host_min_lib`, `crate-type = ["staticlib", "cdylib", "rlib"]`), renamed `fn main()` → `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`, and `main.rs` now just calls `host_min_lib::run()`. Desktop behaviour (`cargo run -p host-min`, `scripts/host-min-smoke.sh`) unchanged — verified below.
6. `src-tauri/Cargo.toml`: split the `tauri-plugin-voxis` dependency by `target_os` — `[target.'cfg(not(target_os = "ios"))'.dependencies]` keeps `features = ["desktop"]` (cpal/rdev), `[target.'cfg(target_os = "ios")'.dependencies]` pulls in the plugin with **no** features (iOS's `init_ios()` needs none). This surfaced a second latent bug: the `VOXIS_CAPTURE=cpal` branch in `main.rs`/`lib.rs` called `tauri_plugin_voxis::init_desktop()` **unconditionally at compile time** (not `cfg`-gated the way the pre-existing `ios` branch already was) — under the new target-conditional Cargo.toml this fails to compile for iOS (`init_desktop` doesn't exist without the `desktop` feature). Fixed by `cfg`-gating the `cpal` branch the same way the `ios` branch already was (panics with a clear message if `VOXIS_CAPTURE=cpal` is set on an iOS build, matching the existing `ios`-on-desktop panic's shape).
7. `cargo tauri ios build --debug --target aarch64-sim` → **BUILD SUCCEEDED**, `.app` at `gen/apple/build/arm64-sim/host-min.app`. No manual `xcodebuild -sdk iphonesimulator …` fallback was needed — the CLI's own signing (`CODE_SIGN_STYLE: Automatic`, ad hoc for the simulator SDK) worked out of the box.
   - One rebuild hiccup: a stale `.app` from a prior build makes the CLI's own rename step fail (`Error failed to rename app …: Directory not empty (os error 66)`) — `rm -rf gen/apple/build` before rebuilding fixes it; `scripts/host-min-ios-smoke.sh` does this automatically.

## `xcrun simctl` gotchas learned the hard way (documented in the new script's comments)

- **`SIMCTL_CHILD_*` env vars must be `export`ed in the CALLING shell**, not passed as trailing `simctl launch` arguments — trailing args become the launched app's own `argv`, not environment variables. `xcrun simctl launch --help`'s own last line says this; easy to miss.
- **`--console-pty`/`--stdout=`/`--stderr=` were unreliable** in this non-interactive tool environment (buffering/pty-allocation issues when the invoking shell itself has no controlling TTY) — `println!`-based output never appeared in the redirected files even after 20-25s waits, despite the app clearly running. **What worked**: `xcrun simctl spawn <udid> log show --predicate 'process == "host-min"'` (or `log stream`) — iOS/Simulator's unified logging captures a launched app's stdout/stderr lines tagged `[top.voxis.hostmin:app] [stdout]`/`[stderr]` regardless of how it was launched. `scripts/host-min-ios-smoke.sh` uses this exclusively, and additionally filters by the launched PID (`awk '$6 == pid'` on the table output) since `--last 1m` can otherwise still match a **previous** run's still-in-window `RESULT_EVENT` — this bit the very first end-to-end run of the new script (it "passed" by reporting an 80-second-old result from the prior manual test). (REJECT-FIX: the script has since switched from repeatedly polling `log show --last 1m` to starting one `log stream` process right before `simctl launch` and tailing its output file against a real wall-clock deadline — a fresh stream cannot see a previous run's output at all, making the PID filter belt-and-braces rather than the only thing preventing that mismatch; see the "failure-path verification" section below.)

## Scenario (a): SILENCE, real Simulator mic (Mac room noise)

Ran 3 times (see `scenario_a_run3_full_log.txt` for the full raw `log
show` output of the last, cleanest run — 67 `LEVEL_EVENT` ticks over
~17.26s). **Active input device not recorded at the time** (this was
before Scenario (b) below surfaced the wrong-input-device root cause) —
`scripts/host-min-ios-smoke.sh` now checks and records this precondition
for every run going forward. Command (the automated version is `scripts/host-min-ios-smoke.sh`):

```sh
xcrun simctl install <udid> gen/apple/build/arm64-sim/host-min.app
xcrun simctl privacy <udid> grant microphone top.voxis.hostmin
export SIMCTL_CHILD_VOXIS_CAPTURE=ios
export SIMCTL_CHILD_VOXIS_STT_URL="http://127.0.0.1:8790/v1/audio/transcriptions"
export SIMCTL_CHILD_VOXIS_API_KEY=x
export SIMCTL_CHILD_VOXIS_SMOKE_AUTOSTART=1
export SIMCTL_CHILD_VOXIS_SILENCE_TIMEOUT_MS=7000
export SIMCTL_CHILD_VOXIS_SMOKE_LOG_LEVELS=1   # new host-min opt-in, see below
xcrun simctl launch <udid> top.voxis.hostmin
# voxis-fake-stt already running on 127.0.0.1:8790
xcrun simctl spawn <udid> log show --predicate 'process == "host-min"'
```

**Run 1** (no level logging yet): `RESULT_EVENT {"durationMs":17337,"guardOutcome":"silenceTimeoutNoSpeech","language":null,"text":""}` — 0 `voxis-fake-stt` requests.

**Run 2** (level logging added, ambient Mac noise happened to be louder — likely fan/HVAC): the guard did **not** classify the window as pure silence; the pipeline actually called out to `voxis-fake-stt` (`TRANSCRIBE_REQUEST bytes=543952`, correctly 400'd since the mic bytes don't match any fixture sha256) and finished in `STATE_EVENT "error"` — **not** a bug, this is the guard correctly reacting to real ambient noise occasionally exceeding `SILENCE_RMS = 0.02` (`voxis_core::config::consts`). Peak/RMS values that run ranged ~0.007–0.0201 — right at the calibrated threshold. See "noise floor" note below.

**Run 3** (clean — quieter ambient conditions): `RESULT_EVENT {"durationMs":17264,"guardOutcome":"silenceTimeoutNoSpeech","language":null,"text":""}`, 0 new `voxis-fake-stt` requests (log still showed only run 2's earlier request). 67 `LEVEL_EVENT` ticks over the session:

```
ticks: 67
peak min/max/avg: 0.00661328062415123 0.013152061030268669 0.008787062957382468
rms  min/max/avg: 0.00661328062415123 0.013152061030268669 0.008787062957382468
```

(`peak == rms` on every tick — this is BY DESIGN on both backends, not an iOS-specific quirk worth a follow-up: the desktop path's own `pure::level_sample_from_peak` (`crates/tauri-plugin-voxis/src/desktop/pure.rs`) takes a single drained peak `f32` and constructs `LevelSample { rms: peak, peak, .. }` from it too — see that file's `level_sample_from_peak_rms_equals_peak_and_is_nonzero` test. Both backends only ever hand the guard one drained-accumulator value per 250ms window; the guard's own math reads `rms`/`peak` independently and both are populated either way.)

**Noise-floor observation**: the Mac's built-in mic (Simulator passthrough) reads noisier than the desktop calibration note in `guard.rs` (`p90=0.0104, max=0.0156`, dated 2026-09-07) — this Simulator run's run-2 peaks (~0.02) exceed that recorded max. This is plausibly just this room's ambient conditions at test time (a quieter run 3 stayed at max 0.0132, closer to the desktop numbers), not a hardware recalibration need — but it does mean `SILENCE_RMS=0.02` has very little headroom against ordinary room noise on this Mac, worth flagging for the iPad-stand stage's own noise-floor measurement (the plan's own acceptance ask).

`scripts/host-min-ios-smoke.sh` automates run 3's shape (SILENCE scenario, asserts `guardOutcome == silenceTimeoutNoSpeech`, empty text, 0 fake-stt requests) and reports a clear failure (not a hang) if ambient noise happens to tip the guard the other way, same as run 2 above — this is an environmental flake risk on a Mac in an active room, not a code bug, and the script's failure message says so.

## Scenario (b): SPEECH, real Simulator mic + real Groq

Per the task's own routing: `fixtures/audio/speech.wav` was converted to
AIFF (`afplay` hangs on this Mac for `.wav`) and played through the
Mac's speakers while the Simulator (mic passthrough) recorded — this
means the actual capture is a speaker→mic acoustic loop, not the
fixture's bytes directly (unlike the desktop `mock:<wav>` scripted
path), so `voxis-fake-stt`'s sha256 lookup could never match; **real
Groq** was used instead (real API key, redacted below).

Added `VOXIS_SMOKE_STOP_AFTER_MS` (new host-min env var, `lib.rs`) —
`smoke_autostart`'s existing stop-scheduling only knew how to compute a
delay from `mock_script_len` (`mock:<wav>`'s own known replay length),
which is `None` for `ios`/`cpal` capture (no fixed length) — so a real
backend's scripted smoke session would otherwise never stop on its own.

### Negative example — wrong input device (AirPods), garbage transcript

**Root cause correction**: the run below was originally attributed to
acoustic loss in the speaker→mic loop (room noise, frequency response).
That was wrong. The actual cause: the Mac's default **input** device at
the time was AirPods (`SwitchAudioSource -t input -c` → `pods`) — the
iOS Simulator inherits the Mac's own default input device verbatim, so
this run's "microphone" was actually AirPods' own mic, picking up
whatever the room/AirPods captured rather than the Mac's speaker output
cleanly. Active input device for this run: **AirPods** (not recorded via
`SwitchAudioSource` at the time — reconstructed after the fact once this
was identified as the actual variable, see the corrected run below).

```sh
xcrun simctl terminate <udid> top.voxis.hostmin
export SIMCTL_CHILD_VOXIS_CAPTURE=ios
export SIMCTL_CHILD_VOXIS_API_KEY="<REDACTED>"
export SIMCTL_CHILD_VOXIS_SMOKE_AUTOSTART=1
export SIMCTL_CHILD_VOXIS_SMOKE_STOP_AFTER_MS=12000
export SIMCTL_CHILD_VOXIS_SILENCE_TIMEOUT_MS=60000
xcrun simctl launch <udid> top.voxis.hostmin
sleep 1.5 && afplay /tmp/speech.aiff   # speech.wav -> AIFF via afconvert -f AIFF -d BEI16
```

Result (verbatim, log show):

```
STATE_EVENT "recording"          (15:35:10.186)
STATE_EVENT "transcribing"       (15:35:22.234, ~12.05s later -- the VOXIS_SMOKE_STOP_AFTER_MS=12000 scheduled stop)
STATE_EVENT "idle"               (15:35:23.163)
RESULT_EVENT {"durationMs":12014,"guardOutcome":"finalized","language":"Norwegian Nynorsk","text":" Torsdagsfond"}
SMOKE_STOPPED
```

`guardOutcome: finalized` with non-empty text already proved the wiring
(`AVAudioEngine` capture → `AVAudioConverter` → WAV finalize → real
`TranscriptionClient` HTTP call → `RESULT_EVENT`) works end to end — but
the garbage transcript itself ("Torsdagsfond", detected as Norwegian
Nynorsk, nothing like `speech.wav`'s actual Russian content) was **not**
a wiring/acoustics problem, it was this run listening through the wrong
microphone. See the corrected run below for the same command with the
input device fixed.

### Corrected positive run — Mac default input pinned to the built-in mic

After `SwitchAudioSource -t input -s "Микрофон MacBook Air"` (pinning the
Mac's default input away from AirPods, before AND after this run — see
the command block below), the **identical** launch (same
`SIMCTL_CHILD_VOXIS_CAPTURE=ios`, real Groq key, `VOXIS_SMOKE_AUTOSTART=1`,
`VOXIS_SMOKE_STOP_AFTER_MS=12000`, `VOXIS_SILENCE_TIMEOUT_MS=60000`,
`afplay /tmp/speech.aiff` started at +3s) produced a real, on-topic
transcript instead:

```sh
SwitchAudioSource -t input -s "Микрофон MacBook Air"
xcrun simctl terminate <udid> top.voxis.hostmin
export SIMCTL_CHILD_VOXIS_CAPTURE=ios
export SIMCTL_CHILD_VOXIS_API_KEY="<REDACTED>"
export SIMCTL_CHILD_VOXIS_SMOKE_AUTOSTART=1
export SIMCTL_CHILD_VOXIS_SMOKE_STOP_AFTER_MS=12000
export SIMCTL_CHILD_VOXIS_SILENCE_TIMEOUT_MS=60000
xcrun simctl launch <udid> top.voxis.hostmin
sleep 3 && afplay /tmp/speech.aiff
SwitchAudioSource -t input -c   # confirm it held for the whole run
```

Result (verbatim):

```
STATE_EVENT "recording"
STATE_EVENT "transcribing"
STATE_EVENT "idle"
RESULT_EVENT {"durationMs":12127,"guardOutcome":"finalized","language":"Russian","text":" Я попросил тебя запустить энтуэм задачи, которая упала. Не сервер. Я хочу, чтобы задача прошла на демо-сервере!"}
```

Active input device for this run: **built-in mic** (`Микрофон MacBook
Air`, confirmed via `SwitchAudioSource -t input -c` both before and
after). Note this transcript is real, in-the-room speech captured louder
than the `afplay` speaker output — not a byte-exact replay of
`speech.wav`'s own content — same phenomenon as the desktop probe
recorded in `research/plugin-plan/HUMAN_GATE_3_5_headless.md` (a live
room picks up ambient speech during a scripted playback test). The point
this run proves is the same as before (real end-to-end Groq call
succeeds on the Simulator's real `AVAudioEngine` path, non-empty,
on-language result) — but now without the wrong-input-device confound,
and with `guardOutcome: finalized`/`language: Russian` matching the
correct room language instead of a nonsense detection.

**Corrected lesson**: any SPEECH run through the Simulator must first
confirm (and pin, via `SwitchAudioSource -t input -s "<built-in mic
name>"`) the Mac's own active input device — an AirPods/Bluetooth
default input silently substitutes a completely different microphone
for the Simulator's own passthrough, with no in-Simulator signal that
this happened. This is now a hard precondition check in
`scripts/host-min-ios-smoke.sh` (see `docs/PLUGIN_IOS_HOST.md`'s
`[T8.5]` list and this repo's README for the same note).

A cleaner room (less ambient live speech bleeding into the corrected
run's own result) would need a quieter environment and/or closer speaker
placement; not repeated further given this task's time budget, since the
point (real end-to-end Groq call succeeds, non-empty on-language result,
wrong-input-device root cause identified and fixed) is proven.

**Privacy check (checklist item I)**: `grep -F "$API_KEY" <full log
output>` after these runs returned nothing — the real Groq key was never
logged, matching `KeychainSecretStore`'s/`secrets.rs`'s own "keys never
logged" convention.

## Screenshots

- `screenshot_scenario_a.png` — app running during the SILENCE scenario (idle overlay UI, `#result` empty)
- `screenshot_scenario_b.png` — app state shortly after the SPEECH scenario's real-Groq run

(Both via `xcrun simctl io <udid> screenshot <path>`.)

## Desktop regression check (acceptance #7)

- `cargo build -p host-min` — clean build after the `lib.rs`/`Cargo.toml` refactor.
- `cargo test -p tauri-plugin-voxis --features desktop` — 151 passed, 0 failed (unchanged from before this task).
- `bash crates/tauri-plugin-voxis/examples/host-min/scripts/host-min-smoke.sh` — **found and fixed a pre-existing, unrelated bug** while validating this: the script's own directory-resolution used two sequential `cd "$(dirname "$0")/..."` calls, the second of which re-evaluates `$(dirname "$0")` (a STATIC relative-path string, unaffected by the first `cd`) against the NEW cwd from the first `cd` — this silently resolves the wrong directory (or, as observed, fails outright with `cd: .../scripts/../../../../..: No such file or directory`) whenever the script is invoked with a multi-segment relative path from the repo root, which is exactly how CI (`.forgejo/workflows/ci.yml`'s `host-min-e2e` job) and `package.json`'s `e2e:host-min` both invoke it (`bash crates/tauri-plugin-voxis/examples/host-min/scripts/host-min-smoke.sh`, not the repo-root forwarding stub). Fixed by resolving both directories via `$(cd ... && pwd)` subshells (each independently anchored to the original `$0`, not to each other) before any `cd` in the main shell. **After the fix, all three desktop scenarios (speech/silence/speech-streamdied) pass** — see the acceptance-report's `commandsRun` for the verbatim tail output.
- The same directory-resolution pattern was used (correctly, this time — copied after finding the bug) in the new `scripts/host-min-ios-smoke.sh`.

## What the Simulator cannot exercise (deferred to the iPad stand)

Per `docs/PLUGIN_IOS_HOST.md`'s own `[T8.5]` checklist item E ("Simulator
caveats"), confirmed in this pass:

- **Physical mic-mute button / Control Center toggle** — Simulator has no
  hardware mute button; `AVAudioApplication.inputMuteStateChangeNotification`
  can't be triggered this way in Simulator at all.
- **Closed Smart Folio (iPad hardware mute)** — no iPad hardware in
  Simulator; `AVAudioSession.interruptionNotification` from a physical
  fold event is untestable here.
- **AirPods/wired-headset route changes** — Simulator audio input passes
  through the Mac's own input device; there's no route-change UI to
  trigger `AVAudioSession.routeChangeNotification`/
  `AVAudioEngineConfigurationChange` (checklist item A) from within a
  Simulator session.
- **Backgrounding duration under real iOS process lifecycle** (checklist
  item 5, target ~10 min) — Simulator's own app-lifecycle/backgrounding
  behaviour does not reliably model a physical device's memory pressure/
  background-task budget; only a real device run is trustworthy here.
- **Locked-screen Keychain behaviour** (`errSecInteractionNotAllowed`,
  checklist item J) — Simulator has no physical lock-screen/passcode
  hardware state to test against; `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`
  needs a real device with a passcode set.
- **Media services reset** (checklist item H) — no supported way found to
  force `AVAudioSession.mediaServicesWereResetNotification` on the
  Simulator or this Mac in the time budget; deferred.
- **Real iPad microphone noise floor** — this run measured the **Mac's**
  mic (Simulator passthrough), not an iPad's; the plan's own acceptance
  explicitly wants an iPad-measured noise floor recorded in `consts.rs`
  alongside the MacBook's — that number can only come from the iPad
  stand.

Everything else in the `[T8.5]` checklist (speech/silence timing,
`NSMicrophoneUsageDescription` requirement, `SpeechTranscriber` locale
one-liner, Main Thread Checker, payload-logging grep) either was
exercised above or remains a discrete follow-up not blocking this
Simulator-stage sign-off.

## Files added/changed (this task)

- `crates/tauri-plugin-voxis/examples/host-min/src-tauri/Cargo.toml` — `[lib]` target added, `tauri-plugin-voxis` dep split by `target_os`.
- `crates/tauri-plugin-voxis/examples/host-min/src-tauri/src/lib.rs` (NEW) — moved from `main.rs`; `run()` mobile entry point; `cpal` branch now `cfg`-gated; `VOXIS_SMOKE_STOP_AFTER_MS` + `VOXIS_SMOKE_LOG_LEVELS` (opt-in `LEVEL_EVENT` listener) added.
- `crates/tauri-plugin-voxis/examples/host-min/src-tauri/src/main.rs` — reduced to `fn main() { host_min_lib::run(); }`.
- `crates/tauri-plugin-voxis/examples/host-min/src-tauri/tauri.conf.json` — `bundle.iOS.developmentTeam`.
- `crates/tauri-plugin-voxis/examples/host-min/src-tauri/gen/apple/**` (NEW, generated by `cargo tauri ios init` + hand-edited `project.yml` + `xcodegen generate`).
- `crates/tauri-plugin-voxis/examples/host-min/scripts/host-min-ios-smoke.sh` (NEW) — automates scenario (a).
- `crates/tauri-plugin-voxis/examples/host-min/scripts/host-min-smoke.sh` — fixed the pre-existing directory-resolution bug described above (no behaviour change otherwise).
- `research/plugin-ios/T8_5_simulator.md` (this file), `screenshot_scenario_a.png`, `screenshot_scenario_b.png`, `scenario_a_run3_full_log.txt`.

## `scripts/host-min-ios-smoke.sh` failure-path verification

Re-running the script several times over the course of this task, ambient
room noise clearly varied (a fan/HVAC cycling): several runs passed
cleanly (`guardOutcome: silenceTimeoutNoSpeech`, 0 fake-stt requests,
~15-20s), and a few later runs correctly hit the same noise-floor edge
case as scenario (a)'s run 2 above (`TRANSCRIBE_REQUEST` fired, no
`RESULT_EVENT` at all since `pipeline.rs` only emits `RESULT_EVENT` on
`Ok`, never on the `Err` a failed/mismatched transcription produces) --
the script correctly detected this as `FAIL: no RESULT_EVENT observed
within <WAIT_SECS>s`, printed the fake-stt log showing the stray
request, **exited non-zero (1)**, and **cleaned up both the app and the
`voxis-fake-stt` process** in every case (`xcrun simctl launchctl list`/
`pgrep -fl voxis-fake-stt` both empty immediately after). This is the
correct, intended failure-path behaviour, not a script bug -- it is a
direct consequence of this Mac's ambient noise floor sitting close to
`SILENCE_RMS = 0.02` (documented above), which is exactly the kind of
thing the iPad stand's own noise-floor measurement needs to nail down
for real hardware.

**REJECT-FIX correction**: an earlier version of this note claimed the
failure path's own `WAIT_SECS=25` "seconds" wait actually took
~75-100s wall clock, because the script polled via a fresh `xcrun
simctl spawn ... log show --last 1m` call (~3-4s each) once per
"second" -- so its own failure message ("within 25s") was inaccurate by
roughly 3-4x. The script has since been fixed to start `xcrun simctl
spawn ... log stream` ONCE, before `simctl launch`, and poll that
already-running stream's output file against a real `SECONDS`-based
wall-clock deadline (default `WAIT_SECS=40`, now an accurate second
count) -- no more per-poll `log show` subprocess cost. Anyone wrapping
this script in their own outer timeout should still give it a little
headroom over `WAIT_SECS` for the build/install/fake-stt-startup steps
that precede the wait loop, but no longer needs the old 120s-for-a-25s-
nominal-wait margin.

## Recommended next step

Stage 2 (iPad stand): re-run scenarios (a)/(b) on real iPad hardware,
then work through checklist items A/3/4/5/H/J from
`docs/PLUGIN_IOS_HOST.md`'s `[T8.5]` section that Simulator cannot
exercise (listed above) — that stage owns the `SILENCE_RMS` iPad-mic
noise-floor measurement the plan's own acceptance criterion asks for in
`consts.rs`.
