# host-min

The minimal Tauri 2 host for `tauri-plugin-voxis`: one page
(`ui/index.html` + `ui/main.js`, no framework/bundler) with a mounted
`<voxis-overlay theme="default">` (guest-js, Task 5), a Toggle button,
and `<pre id="result">`. Registers the plugin in
`src-tauri/src/main.rs`; capability file (`src-tauri/capabilities/
default.json`) grants `voxis:default`.

## Consent

`main.js` calls `client.setConsent(true)` unconditionally at startup.
**A real host must show its own consent UI before granting this** --
host-min skips that screen entirely because it's a tracer-bullet
harness, not a template for a production consent flow.

## Capture backend + STT wiring (`VOXIS_CAPTURE`/`VOXIS_STT_URL`/`VOXIS_API_KEY`)

The backend switch lives here in host-min (`src/main.rs`), not the
plugin, per the plan's own Task 4 design:

```sh
# MockCapture, unscripted (default) -- no real microphone, no WAV fixture.
cargo run -p host-min

# MockCapture SCRIPTED from a WAV fixture (Task 3.5's own tracer-bullet
# wiring): per-250ms peak/RMS windows computed from the file
# (`wav_to_level_script`, ticked once every 250ms by a background thread
# for as long as a session is recording) and `set_fixture_wav` so
# `stop()` copies the file's own bytes to the session path -- the
# pipeline then uploads REAL bytes, so voxis-fake-stt's sha256 lookup
# matches this exact fixture.
VOXIS_CAPTURE="mock:$PWD/../../../../fixtures/audio/speech.wav" \
VOXIS_STT_URL="http://127.0.0.1:8790/v1/audio/transcriptions" \
VOXIS_API_KEY="anything-fake-stt-never-checks-it" \
  cargo run -p host-min
# (run `cargo run -p voxis-fake-stt` in another terminal first)

# CpalCapture + RdevHotkey (Task 4's real desktop backends) -- prompts
# for microphone permission (and, for the hotkey listener, macOS
# Accessibility/Input Monitoring) on first use. This is the HUMAN GATE
# path: real built-in mic + real Groq, never voxis-fake-stt/MockCapture.
VOXIS_CAPTURE=cpal VOXIS_API_KEY=<your Groq key> cargo run -p host-min
```

- `VOXIS_STT_URL`: written straight into the plugin's own
  `PluginState.pipeline_config.app_config.api_url_override` from
  host-min's own `setup` hook -- the exact field
  `pipeline::run_transcription` reads to build its
  `TranscriptionClient`. **No new plugin command was added for this**:
  `apply_profile`/`get_profile`/`import_profile_from_desktop` are still
  `PluginError::NotImplemented` stubs (Task 2/6/7's job) and `PluginState`'s
  fields are already `pub`, so reaching in directly from the host's own
  `setup` closure is the smallest correct wiring available today.
- `VOXIS_API_KEY`: seeded into the plugin's `SecretStore` under
  `pipeline::API_KEY_SECRET_NAME`. Any non-empty string works against
  `voxis-fake-stt` (it never checks the bearer token); the real HUMAN
  GATE run needs an actual Groq key here (or via desktop Voxis's own
  `import_profile_from_desktop`, once Task 6 implements it -- until
  then, `VOXIS_API_KEY` is the smaller, already-available path).
- `VOXIS_SILENCE_TIMEOUT_MS` (default `3000`): `AppConfig::
  silence_timeout_ms` defaults to 60s, far longer than this tracer
  bullet (or the human gate's 17s silence check) ever waits -- host-min
  always overrides it. Desktop Voxis's own configured value would
  normally reach the plugin via `apply_profile` (Task 2/6/7); until then
  this is a fixed, documented default.

`init_with_capture` (new, additive-only `tauri-plugin-voxis` constructor,
`crates/tauri-plugin-voxis/src/lib.rs`) is what makes the scripted-mock
path possible: it registers the plugin with an already-constructed
`Arc<dyn AudioCapture>` instead of a fresh default `MockCapture`, exactly
what this module's own pre-Task-4 doc comment anticipated ("Task 4/8 ...
are expected to provide their own `init_with_capture`-style
constructor"). No other plugin command/behaviour changed --
`cargo test -p tauri-plugin-voxis --features desktop` is unchanged
(133/0, same as before this task).

**One session per process**: the scripted `MockCapture` is loaded from
its fixture exactly once, at startup (`scripted_mock_capture` in
`src/main.rs`) -- `set_script` fills a queue `tick()` drains and never
refills, so a *second* `start()`/`stop()` cycle in the same `host-min`
process would just see an empty script (indistinguishable from
`StreamDied`), not the fixture replayed again. Fine for this tracer
bullet (`host-min-smoke.sh` always starts a fresh process per scenario);
a host wanting to re-arm the same mock across multiple sessions would
need to re-`set_script` on every `start()` itself.

## guest-js overlay under the CSP

`tauri.conf.json`'s CSP is untouched (`script-src 'self'`, identical to
naked's own). `guest-js/dist/index.js`'s relative imports are
extensionless (`from "./client"`, TS `bundler` module resolution) --
native browser ESM requires the `.js` extension on every specifier, so
loading it directly fails to resolve under `'self'`. Fix: `scripts/
bundle-overlay.sh` runs `bun install --frozen-lockfile && bun run build`
in `guest-js` (producing `dist/index.js`) and then `bun build` (already
this repo's own JS toolchain, no new dependency) to inline that file AND
its `@tauri-apps/api/{core,event}` imports into one flat, dependency-free
ESM file, `ui/vendor/voxis-overlay.bundle.js`. `ui/main.js` imports from
that bundle.

**`ui/vendor/` is gitignored, NOT committed** (review fix F4: a
~44k-line vendored bundle sitting in the tree can silently drift from
`guest-js` with zero signal that it happened). `scripts/
bundle-overlay.sh` is the single source of truth for that directory's
contents and regenerates it from scratch every time; `host-min-smoke.sh`
and the `host-min-e2e` CI job both call it BEFORE building/running
`host-min` (Tauri embeds `frontendDist` at *compile* time, so a
stale/missing bundle at build time silently ships stale/missing JS, not
a build failure -- there is no separate/earlier `cargo build -p
host-min` step in either place for exactly this reason). Manual run:

```sh
bash scripts/bundle-overlay.sh   # from crates/tauri-plugin-voxis/examples/host-min/
cargo run -p host-min
```

An import map remapping every extensionless specifier individually was
considered and rejected: it would need one entry per internal
`guest-js` module (including ones nested inside `themes/registry.js`),
is easy to silently drift out of date, and buys nothing over a one-line
bundle step this toolchain already has.

**Not independently verified in this change**: whether the bundled
overlay renders with zero console CSP violations inside an actual
WebKit/wry webview (this task's environment has no browser-console
capture tool). `cargo build -p host-min` + the real-binary smoke test
below prove the Rust side end-to-end; a manual `cargo run -p host-min`
+ open devtools check is the recommended next step before relying on
this for the HUMAN GATE.

## Real-binary smoke test (`scripts/host-min-smoke.sh`)

Runs the ACTUAL `host-min` binary (not a browser/webview driver) against
a real `voxis-fake-stt` server. Bundles the guest-js overlay
(`scripts/bundle-overlay.sh`) and builds both binaries itself -- no
separate pre-build step needed:

```sh
bash scripts/host-min-smoke.sh
# or, from the repo root: bash scripts/host-min-smoke.sh (thin forwarding
# stub) / bun run e2e:host-min
```

Drives `VOXIS_CAPTURE=mock:<wav>` + `VOXIS_SMOKE_AUTOSTART=1` (starts a
`Mode::Toggle` session ~300ms after boot, grants consent directly since
no webview JS runs for this path, and prints every `voxis://result`/
`voxis://state` event to stdout as `RESULT_EVENT <json>`/`STATE_EVENT
<json>` lines -- see `src/main.rs`'s module doc). Three scenarios,
asserted against real process output:

1. `speech` -> an explicit `stop()` (host-min's own default
   `script_len*250ms+500ms` scheduling once autostarted) lands shortly
   after the WAV finishes "playing", exercising the NORMAL stop path:
   `guardOutcome` is `finalized`, `RESULT_EVENT` contains the fixed
   transcript from `fake-stt-map.json`, `voxis-fake-stt` sees exactly 1
   request.
2. `silence` -> the guard's own `SilenceTimeoutNoSpeech` fires well
   before that scheduled stop (~13s vs ~17.5s -- see the HUMAN GATE
   section below for the underlying math): `guardOutcome` is
   `silenceTimeoutNoSpeech`, `text` is empty, `voxis-fake-stt` sees
   **0** requests -- the guard discards before ever calling out over
   HTTP (the whole point of the DimaTorzok-hallucination fixture: it
   must never be requestable in the first place).
3. `speech-streamdied` -> `VOXIS_SMOKE_NO_STOP=1` disables the scheduled
   stop entirely: once the scripted WAV's ticks run out, the guard's own
   liveness check reports `StreamDied` on its own ~1s later
   (`guardOutcome` is `streamDied`, same fixed transcript still comes
   back) -- this is the scenario that actually exercises the liveness/
   `StreamDied` recovery path (the other two never reach it).

Verified locally (this change): all three scenarios pass, and
`pgrep -f voxis-fake-stt` is empty immediately after the script exits
(review fix F1 -- `start_fake_stt` is a plain function call, never
`$(...)`  command substitution, which forked a subshell that silently
dropped `fake_stt_pid` in the parent and leaked a `voxis-fake-stt`
process on every previous run; `cleanup`'s trap also now covers
`INT`/`TERM` and does a belt-and-braces `pkill -P $$`). CI (`.forgejo/
workflows/ci.yml`'s `host-min-e2e` job, Linux `voxis-ci` docker image,
which has `libwebkit2gtk-4.1`/`libgtk-3`/`xvfb`) runs the same script
under `xvfb-run -a`.

## Playwright / browser e2e: deferred, not added in this change

The plan's acceptance also asks for a Playwright harness (webview
driven via `tauri-driver`, or a browser+IPC-shim fallback for CI). This
was evaluated and NOT implemented here, given this task's 90-minute
budget -- `tauri-driver` needs `WebKitWebDriver` (Linux) which the
`voxis-ci` image does not currently install, and a correct
browser+IPC-shim harness (faking `window.__TAURI__`'s command/event
surface convincingly enough for the mounted overlay + guest-js client)
is itself a non-trivial, multi-hour effort to get right. The real-binary
smoke test above covers the same two scenarios end to end (protocol
compatibility, guard behaviour, event contents) through the ACTUAL
plugin/pipeline/session code, which is arguably the higher-value proof;
it does not, however, verify the DOM/CSP/overlay-rendering side
(`#result` text appearing via a real webview, "no console CSP
violations", "reload during Hold stops the recording within 3s").
Recommended next step: `tauri-driver` on a Linux CI runner once
`webkit2gtk-driver` is added to `Dockerfile.ci`, or a macOS-only manual
Playwright config for local development.

## Contract fixtures: `profile-qr.json`

`crates/tauri-plugin-voxis/contract/fixtures/profile-qr.json` was added
(`{v, host, port, token, k}` shape) but with NO accompanying Rust
snapshot test: no `ProfileQr`-equivalent Rust type exists anywhere in
this codebase yet (QR-based profile import is Task 7's own scope), and
inventing one now to snapshot against would be making that task's type
design decision without its own review. Per the plan's own fallback
("else note for Task 7"), Task 7 owns adding the matching Rust type +
snapshot test against this fixture file.

## HUMAN GATE (real microphone + real Groq, owned by the orchestrator)

```sh
VOXIS_CAPTURE=cpal VOXIS_API_KEY=<real Groq key> \
VOXIS_SILENCE_TIMEOUT_MS=7000 \
  cargo run -p host-min
```

Then, in the opened window: click "Toggle recording", speak a phrase,
click again -- the transcribed text should appear in `#result`. Click
Toggle and stay silent -- `#result` should stay empty (`NoSpeech`
discard, `voxis://result`'s `guardOutcome` is `silenceTimeoutNoSpeech`).
Holding `alt_r` should also start/stop a recording and produce text --
`ui/main.js` calls `client.setHotkey({key: "alt_r", mode: "hold"})`
unconditionally at startup (harmless no-op for every other
`VOXIS_CAPTURE` mode, since `PluginState.hotkey` is only ever `Some` for
`init_desktop()`/`cpal`); a `permissionDenied` rejection (macOS
Accessibility/Input Monitoring not yet granted) is caught and shown as a
visible page hint instead of silently swallowed.

**Silence-timeout math** (`voxis_core::config::SILENCE_WINDOW_MS` = 10s,
`GUARD_POLL_MS` = 250ms -> a 40-poll silence window has to fill before
any silence-based decision is even possible): the tracer bullet's own
`silence.wav` fixture is 17s and uses the default
`VOXIS_SILENCE_TIMEOUT_MS=3000`, i.e. NoSpeech at roughly `10s + 3s =
13s` -- comfortably inside the 17s clip. Real silence has no fixed
length, and 3s of dead air is easy to blow past by accident while
settling into position -- the HUMAN GATE command above uses
`VOXIS_SILENCE_TIMEOUT_MS=7000` instead (`10s + 7s = ~17s` before
`NoSpeech` fires), matching the plan's own "17s of silence" gate
length.

## iOS (Task 8.5 tracer bullet, Simulator stage)

`src-tauri/gen/apple/` (generated by `cargo tauri ios init`, committed)
is the Xcode/XcodeGen project. `src-tauri/src/lib.rs` (not `main.rs`) is
where all the actual host logic lives -- iOS needs a library target with
a `#[tauri::mobile_entry_point]` entry function, so `main.rs` is now
just `fn main() { host_min_lib::run(); }` (desktop builds/run unchanged).

**Precondition: pin the Mac's default audio input to the built-in mic
before any Simulator run** (`brew install switchaudio-osx`, then
`SwitchAudioSource -t input -s "<built-in mic name>"`). The iOS
Simulator's own microphone input passes straight through to whatever the
Mac's own default input device currently is -- an AirPods/Bluetooth
default silently substitutes a different microphone for the Simulator's
passthrough, with no in-Simulator signal that this happened. This bit a
real SPEECH run (`research/plugin-ios/T8_5_simulator.md`'s Scenario (b)):
a garbage transcript initially looked like an acoustics problem but was
actually AirPods being the active input device the whole time; pinning
the input and re-running the identical command produced a real,
on-language transcript. `scripts/host-min-ios-smoke.sh` now checks this
precondition itself and fails loudly (or warns if `SwitchAudioSource`
isn't installed) rather than silently trusting whatever device happens
to be active.

```sh
# Rebuild after any gen/apple/project.yml edit -- `cargo tauri ios build`
# does NOT run xcodegen itself:
(cd src-tauri/gen/apple && xcodegen generate)

# Build for the Simulator (a stale build/ dir from a previous run makes
# the CLI's own rename step fail -- clear it first):
rm -rf src-tauri/gen/apple/build
(cd src-tauri && cargo tauri ios build --debug --target aarch64-sim)

# Install + grant mic permission non-interactively:
xcrun simctl boot <udid>   # no-op if already booted
xcrun simctl install <udid> src-tauri/gen/apple/build/arm64-sim/host-min.app
xcrun simctl privacy <udid> grant microphone top.voxis.hostmin

# Launch -- SIMCTL_CHILD_* MUST be exported in this shell, NOT passed as
# trailing `simctl launch` args (those become the app's own argv instead):
export SIMCTL_CHILD_VOXIS_CAPTURE=ios
export SIMCTL_CHILD_VOXIS_STT_URL="http://127.0.0.1:<fake-stt-port>/v1/audio/transcriptions"
export SIMCTL_CHILD_VOXIS_API_KEY=x
export SIMCTL_CHILD_VOXIS_SMOKE_AUTOSTART=1
export SIMCTL_CHILD_VOXIS_SILENCE_TIMEOUT_MS=7000
xcrun simctl launch <udid> top.voxis.hostmin

# Observe -- println! output shows up in the unified log, not any
# --console-pty/--stdout= redirection (unreliable in headless tooling):
xcrun simctl spawn <udid> log show --predicate 'process == "host-min"'
```

`VOXIS_SMOKE_STOP_AFTER_MS` (new, capture-mode-agnostic): schedules an
explicit `stop()` a fixed number of ms after `smoke_autostart`'s own
`start()` -- needed for a real backend (`ios`/`cpal`) since
`smoke_autostart`'s default stop-scheduling only knows how to compute a
delay from a `mock:<wav>` fixture's own known replay length
(`mock_script_len`), which is `None` for a real capture. `VOXIS_SMOKE_LOG_LEVELS=1`
(new, opt-in) additionally prints every `voxis://level` tick as a
`LEVEL_EVENT <json>` line -- off by default (one print per 250ms poll
would flood the log for no assertion the default smoke scenarios need).

`scripts/host-min-ios-smoke.sh` automates the SILENCE scenario above
end to end (boot/build/install/grant/fake-stt/launch/assert/cleanup).
Full evidence (both SILENCE and a real-Groq SPEECH run, screenshots,
level-tick stats, what the Simulator cannot exercise) is in
`research/plugin-ios/T8_5_simulator.md`; host requirements (`Info.plist`
keys, entitlements, XcodeGen conventions) are in
`docs/PLUGIN_IOS_HOST.md`. The iPad-stand stage (physical mute button,
Smart Folio, backgrounding duration, locked-screen Keychain) is a
separate, human-run pass -- not covered by this Simulator-only section.
