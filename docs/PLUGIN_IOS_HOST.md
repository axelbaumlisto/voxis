# `tauri-plugin-voxis` on iOS — host requirements (draft)

> **Status:** draft, written alongside Task 8 (`AVAudioEngine` capture + Keychain
> `SecretStore`, `crates/tauri-plugin-voxis/ios/`). Task 8.5 (iOS Simulator + iPad-stand
> tracer bullet) and Task 9a (Live Activity Swift implementation + this section) have
> landed — see the `[T8.5]`/`[T9a]` markers below. Task 9b (on-device end-to-end
> verification once a host actually wires this in) has not run yet.

This is the checklist for any Tauri 2 host (iPadOS/iOS) that embeds
`tauri-plugin-voxis`. It complements `docs/THEMES.md`/`docs/THEME_EDITING.md` (overlay
visuals, not iOS-specific) and the plan (`.pi/plans/tauri-plugin-voxis.md`), which owns
the *why* behind these requirements — this file is the host-facing *how*.

## Minimum iOS version

**iOS 16.0** (`ios/Package.swift` `platforms: [.iOS(.v16)]`; owner decision 2026-09-16:
iOS 16 stays supported). Everything newer is gated at its call site with
`#available(iOS 17.0, *)`, so a 16.x host embeds the plugin unchanged; what differs on 16:

| Feature | iOS 17+ | iOS 16 |
|---|---|---|
| Mic permission | `AVAudioApplication.requestRecordPermission` | `AVAudioSession.requestRecordPermission` (same three states) |
| System mic-mute (Control Center) | `inputMuteStateChangeNotification` → `muted` on `voxis://level` | no system signal; recording continues, silence guard ends it |
| Live Activity + lock-screen **Stop** | shown (`LiveActivityIntent`) | not shown (`[voxis] Live Activity unavailable (iOS < 17.0)` in the log); stop from the app |

## `Info.plist` keys

| Key | Value | Why |
|---|---|---|
| `NSMicrophoneUsageDescription` | Must **name the actual STT provider** (e.g. "Used to record your voice and send it to Groq for transcription."), not a generic "this app uses your microphone". App Store review checks that the usage string matches what the app actually does with the audio. | **Required — its absence is not a soft failure.** If this key is missing, iOS does not deny the permission gracefully and does not hand the plugin a `PermissionDenied` to report: the OS **terminates the process** the moment `AVAudioApplication.requestRecordPermission`/`AVAudioSession` activation first touches the microphone, with a TCC crash log reading something like `This app has crashed because it attempted to access privacy-sensitive data without a usage description. The app's Info.plist must contain an NSMicrophoneUsageDescription key with a string value explaining to the user how the app uses this data.` This happens on the **very first** `startCapture` call after install — there is no in-app warning beforehand, and no `stop()`/`reject` path in this plugin ever runs, because the process is already gone. Get this key into the host's `Info.plist`/`project.yml` before the first test run, not after. |
| `UIBackgroundModes` → `audio` | **Only add this if the host actually wants recording to survive backgrounding** (dictation while the user switches apps, plan Task 9a/9b's Live Activity flow). Without it, `AVAudioSession` gets deactivated by the OS shortly after the host leaves the foreground, and the *next* `level` tick simply stops (the plugin's own liveness signal, `StreamDied → Recover` — no crash, but the in-flight recording is truncated at background+few-seconds). | App Store guideline 2.5.4 requires the app to actually use background audio, not just declare the mode as a workaround — the host's App Store notes should say "voice dictation continues while switching apps" explicitly. |
| `NSSupportsLiveActivities` | `true`, **only if the host wants the Dynamic Island/Lock Screen indicator** (Task 9a, see the section below) — not needed for Task 8's plain capture path. | Dynamic Island / Lock Screen recording indicator + Stop button (Task 9a; on-device verification is Task 9b). |

The plugin itself ships no `Info.plist` — every key above is the **host's** Xcode
project/`project.yml`, since `NSMicrophoneUsageDescription`'s wording is inherently
host-specific (it must name whichever STT provider the *host's* Voxis profile actually
points at).

**Permission denial carries a Settings deep link.** When the user has previously denied
microphone access (not just "never asked" — iOS never re-prompts once denied),
`startCapture` rejects with `code: "PERMISSION_DENIED"` and `data: { settingsUrl:
"<UIApplication.openSettingsURLString value>" }` (`ios/Sources/VoxisPlugin.swift`) —
the Rust/JS side (`mobile.rs`'s `map_invoke_error`, currently folded into
`CaptureError::Backend` with the message text preserved) has everything it needs to
build an "Open Settings" affordance instead of a dead-end error toast.

## Consent + `PrivacyInfo.xcprivacy`

Per the plan's `[R1-Safety S6]`: `dictate()`/`start()` already refuses until
`set_consent(true)` has been recorded for the (host, provider) pair
(`consent.rs`/`commands::do_start`) — this is enforced by the plugin regardless of host,
not something the host needs to re-implement. What the **host** still owns:

- A privacy-policy paragraph naming the STT provider and that audio leaves the device.
- A `PrivacyInfo.xcprivacy` entry declaring the collected data type. Suggested snippet
  (merge into the host's own manifest — the plugin does not ship its own, since Apple's
  aggregation model expects one manifest per app, not per embedded framework/plugin):

  ```xml
  <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeAudioData</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <false/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
          <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
      </array>
  </dict>
  ```

  (`NSPrivacyCollectedDataTypeOtherUserContent` is the closer fit for the *transcribed
  text* itself, if the host's own manifest doesn't already declare a similar entry for
  text sent to its own backend — add both entries if both audio and text ever leave the
  device through code paths outside this plugin's own `TranscriptionClient` call.)

- **`NSPrivacyAccessedAPITypes` — File timestamp APIs, reason `C617.1`.** This plugin
  reads file timestamps via two paths that end up calling one of Apple's "required
  reason" file-timestamp APIs: `capture::RecDir::sweep`'s `std::fs::read_dir`/
  `fs::remove_file` walk (Rust's stdlib `std::fs::metadata`-equivalent calls under the
  hood on Darwin) over the plugin's own `rec/` scratch directory at every plugin
  startup, and Tauri's own runtime (WKWebView/asset resolution) separately. Declare:

  ```xml
  <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
          <string>C617.1</string>
      </array>
  </dict>
  ```

  (`C617.1` = "Declare this reason to display file timestamps to the person using the
  device... within the app's own container" — matches `RecDir::sweep`'s scope: it only
  ever touches the plugin's own scratch directory under the host's app-cache dir, never
  another app's container or a shared volume.)

## Package/XcodeGen integration

`ios_path("ios")` (this crate's `build.rs`) handles vendoring Tauri's own Swift API
package and linking `libtauri_plugin_voxis.a` automatically whenever the actual Cargo
build target is `aarch64-apple-ios`/`aarch64-apple-ios-sim` **on a macOS host** — no
manual `.tauri/tauri-api` setup needed on the plugin side. What the **host's** own iOS
project (`src-tauri/gen/apple/`, generated by `cargo tauri ios init` — Task 8.5 owns
running that for `examples/host-min`, not this task) needs to get right, learned the
hard way on `clipshot`'s own Tauri-iOS extensions (full detail: Task 9a's own step 0,
`.pi/plans/tauri-plugin-voxis.md`) and worth restating here since it bites on the very
first `cargo tauri ios build` too:

- **`cargo tauri ios build` does not run `xcodegen`** — it edits the existing
  `.xcodeproj` in place. If the host's `gen/apple/project.yml` is hand-edited (adding
  `NSMicrophoneUsageDescription`/`UIBackgroundModes`, e.g.), that edit silently never
  reaches the actual build until `(cd gen/apple && xcodegen generate)` runs first.
  Automate this as a pre-build step, not a one-time manual run.
- **`xcodegen` overwrites `Info.plist`** from `project.yml`'s `info.properties` on every
  `generate` — do not hand-edit the generated `Info.plist` directly, it will not survive
  the next regeneration. All the keys in the table above belong in `project.yml`.
- This plugin's own iOS target links no app-extension/widget (Task 8 ships plain
  capture + Keychain only) — none of clipshot's `outputFiles`/"Multiple commands
  produce libapp.a" ordering issues apply yet. Task 9a's Live Activity work **will**
  need a WidgetBundle target and inherits those lessons at that point, not before.

## Running the pure-math Swift tests (`swift test`, no device/Tauri needed)

`ios/Sources/VoxisAudioMath` (S2, `research/plugin-plan/BLIND_SDK_swift.md` finding #2)
holds the level/cap/WAV rules lifted out of `AudioCapture.swift` — `LevelMath`
(sub-chunk peak RMS, self-cap slicing, the near-silent/mute 2-window heuristic) and
`WavWriter.encode` (byte-for-byte mirror of `voxis_core::audio_wav::samples_to_wav`) —
as a Tauri-free library target, asserted by `ios/Tests/tauri-plugin-voxisTests` against
the SAME fixture numbers `src/desktop/pure.rs`/`voxis_core::audio_wav`'s own Rust tests
use. Plain `cd ios && swift test` does **not** work for this package: SwiftPM plans a
build of every target in the manifest regardless of which target you're testing, which
includes the main `tauri-plugin-voxis` target and its `Tauri` dependency — both `import
UIKit`, which does not exist for a macOS host build, so a bare `swift test` always fails
trying to compile them. Build the test bundle *product* by name first (that only pulls
in `VoxisAudioMath` + the test target, never `tauri-plugin-voxis`/`Tauri`), then run the
already-built bundle:

```bash
cd crates/tauri-plugin-voxis/ios
swift build --product tauri-plugin-voxisPackageTests
swift test --skip-build
```

On a Mac where the invoking shell itself is running under Rosetta translation (`arch`
prints `i386`/`x86_64` on Apple Silicon), prefix both commands with `arch -arm64` — the
SwiftPM XCTest harness otherwise builds/loads an arm64 bundle but expects (and fails to
dlopen) an x86_64 one, unrelated to this package's own code. `scripts/check-ios-build.sh`
runs both commands (with the `arch -arm64` prefix) after its existing `cargo build
--target aarch64-apple-ios*` gates.

## `[T8.5]` device checklist (Simulator first, then iPad stand)

Not run yet — owned by Task 8.5, listed here as the draft checklist this document
promises. Each item's *expected* outcome per the plan/this task's own Swift
implementation (`ios/Sources/AudioCapture.swift`) is noted for that task's Verify step
to confirm against:

1. **Speech, 5s**: `startCapture` → speak → `stopCapture` → WAV plays back, non-silent,
   `peakRms` well above the guard's `SILENCE_RMS` (0.02, desktop-calibrated — iOS mic
   gain may need its own calibration, same note as the plan's own Approach §3).
2. **Silence, ~75s**: guard's own `SilenceTimeoutNoSpeech` fires before any explicit
   `stop()` — no `voxis://result` event, matching desktop's own silence-fixture
   behaviour.
3. **System mic-mute button** (Control Center / Dynamic Island toggle, iOS 17+):
   confirm `AVAudioApplication.inputMuteStateChangeNotification` actually fires for a
   `.record`-category session — Apple's docs do not explicitly confirm this for
   `.record` (only demonstrated for `.playAndRecord` in WWDC materials). If it does
   *not* fire, `AudioCapture.swift`'s `consecutiveNearSilentWindows >= 2` (RMS≈0 for
   ≥500ms) heuristic fallback is what's carrying `muted: true` instead — check the
   `voxis://level` event stream during this scenario to see which path actually fired.
4. **Closed Smart Folio (iPad hardware mute)**: expected to arrive as
   `AVAudioSession.interruptionNotification` `.began` (per the plan's own research
   note), not as a silent recording — confirm `stop()` (called as part of the
   pipeline's `StreamDied → Recover` path) rejects with `INTERRUPTED`, not a fabricated
   clean stop.
5. **Backgrounding duration**: with `UIBackgroundModes: audio` declared, background the
   host mid-recording and measure how long iOS actually keeps the `.record` session
   alive before killing it. Plan's own target: ~10 minutes (desktop's own Hold-mode cap
   is 120s regardless, so this only matters for Toggle-mode long dictations).
6. **`SpeechTranscriber.supportedLocales` one-liner**: confirm on-device (not just the
   macOS 26.6.2 result already recorded in the plan's Follow-ups: `ru_RU` absent from
   `SpeechTranscriber`, present in `DictationTranscriber`) — relevant only once a
   `TranscriptionEngine` on-device path is built (Follow-ups, out of this plan), noted
   here so Task 8.5 captures the iOS-specific number while already on real hardware.
7. **Missing `NSMicrophoneUsageDescription`**: run once with the key deliberately
   removed from the host's `Info.plist`/`project.yml`, confirm the app actually
   terminates on the first `startCapture` call (not a graceful `PermissionDenied`) and
   capture the crash log's TCC message (see the `Info.plist` keys table above) — this
   is a one-time "does our understanding match reality" check, not something to leave
   removed afterwards.

### Review round 2 additions (A–J)

The following were flagged in review as needing a real-hardware/Simulator answer this
document cannot give from source-reading alone — folded into the same T8.5 pass:

- **A. Route change mid-recording**: start a session, then connect a wired headset or
  pair/connect AirPods mid-recording. Confirm `AVAudioSession.routeChangeNotification`
  (`.oldDeviceUnavailable` → `"route: old device unavailable"`) and/or
  `AVAudioEngineConfigurationChange` (→ `"engine configuration change"`, since the new
  input hardware's channel count/sample rate differs and the engine stops itself) fire
  with the *expected, distinct* reason — not a silent truncated recording.
- **B. Tap buffer retention / clicks**: listen to the resulting WAV for audible
  clicks/pops at the `installTap` buffer-size (4096 native-rate frames) boundary —
  confirms the `AVAudioConverter` call's internal buffering doesn't drop/duplicate a
  partial frame at each tap callback edge.
- **C. WAV cmp parity**: byte-compare a device-recorded WAV's header (and a few known
  sample values) against `voxis_core::audio_wav::samples_to_wav`'s output for the same
  synthetic sample array, on the actual device/Simulator build — `WavWriter.swift`'s
  own `#if DEBUG` `selfCheck()` only self-checks Swift's own encoder against its own
  documented layout, not against a real Rust-encoded byte stream.
- **D. Permission prompt while blocked**: trigger `startCapture` on a fresh install
  (permission `.undetermined`) and confirm the system permission dialog still appears
  and answering it actually unblocks the Rust caller — `mobile.rs`'s `IosCapture::start`
  now calls `run_mobile_plugin` directly (review fix F2), which blocks the calling
  thread for the whole round-trip including however long the user takes to answer the
  prompt; confirm this doesn't wedge anything else in the host (e.g. the UI thread, if
  `do_start` is ever called from it).
- **E. Simulator caveats**: note where Simulator behavior is known to diverge from a
  real device before trusting a Simulator-only result — the physical mute
  button/Control Center toggle, Smart Folio, and AirPods pairing are not exercisable in
  Simulator at all (Simulator audio input passes through the Mac's own mic/input
  device); items A, and the `[T8.5]` checklist's own #3/#4 above, need the iPad stand.
- **F. Missing usage key crash**: see item 7 above (folded in from this same review
  round).
- **G. Main Thread Checker**: build and run with Xcode's Main Thread Checker enabled;
  confirm no UIKit-off-main violations fire (`UIImpactFeedbackGenerator` calls were
  moved onto `DispatchQueue.main.async` in review round 2 — this is the check that
  would have caught the original violation on device/Simulator, where source review
  alone cannot).
- **H. Media services reset**: force one if there is a supported way to on the test
  device/Simulator (e.g. `killall mediaserverd`-equivalent, where available) and
  confirm `AVAudioSession.mediaServicesWereResetNotification` →
  `"media services reset"` fires and ends the session cleanly. Rebuilding the plugin's
  own long-lived `AVAudioEngine` instance afterwards (Apple's own recommendation — see
  `AudioCapture.swift`'s observer doc comment) is a noted follow-up, not implemented;
  confirm what the very next `start()` call after a reset actually does (recovers, or
  fails with a clear `BACKEND` error — either is acceptable for now, silently
  succeeding with a broken engine is not).
- **I. Payload logging grep**: grep the plugin's own log output (`tracing`) and the
  Xcode/device console for this run for the literal API key value used in the test —
  confirms "keys never logged" (`KeychainSecretStore.swift`'s own module doc,
  `secrets.rs`'s `Secret`/`expose()` convention) holds under a real run, not just under
  code review.
- **J. Locked-screen finalize**: lock the device mid-`stop()` (or during the
  transcription step that follows it, which reads the API key via `SecretStore::get`)
  and confirm the actual failure mode — see the `[T9a]` note below on
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and `errSecInteractionNotAllowed`.

## `[T8.5]` Simulator stage results (this Mac) — see `research/plugin-ios/T8_5_simulator.md` for full evidence

Ran, not just planned — `host-min`'s own `gen/apple/` project (`cargo tauri ios init` +
`project.yml` edits, `deploymentTarget.iOS: 17.0`, `NSMicrophoneUsageDescription` in
`info.properties`) built and ran on an iPhone 17 Pro Simulator (iOS 26.5), real
`AVAudioEngine` capture via Mac-mic passthrough, both a SILENCE and a real-Groq SPEECH
scenario. Learnings worth keeping close to this document (full detail, verbatim
log/screenshot evidence in `research/plugin-ios/T8_5_simulator.md`):

- **A Tauri iOS host needs a library target, not just a `[[bin]]`.** `cargo tauri ios
  build` always links a `staticlib`/`cdylib` with a `#[tauri::mobile_entry_point]`
  entry function — a host written bin-only (as `host-min` originally was, being a
  desktop-first tracer bullet) fails immediately with `error: no library targets
  found in package`. Any future Tauri-iOS host in this repo needs `src/lib.rs`
  (`crate-type = ["staticlib", "cdylib", "rlib"]`, `pub fn run()`) from the start,
  with `main.rs` just calling into it.
- **A per-target Cargo dependency split (`desktop` feature off-iOS) can silently break
  any OTHER capture-mode branch that wasn't itself already `cfg`-gated** — a
  `VOXIS_CAPTURE=cpal` branch calling `init_desktop()` unconditionally at compile time
  only ever worked because the `desktop` feature used to be on for every target; once
  iOS stopped linking it, that branch needed the same `#[cfg(target_os = "ios")]`
  treatment the `ios` branch already had.
- **`SIMCTL_CHILD_*` env vars for `xcrun simctl launch` must be `export`ed in the
  calling shell** — passing them as trailing `simctl launch` arguments instead makes
  them the launched app's own `argv`, not its environment (`xcrun simctl launch
  --help`'s own last line says so; easy to miss).
- **`--console-pty`/`--stdout=`/`--stderr=` were unreliable for capturing a launched
  Simulator app's stdout** in a non-interactive tooling environment; `xcrun simctl
  spawn <udid> log show/stream --predicate 'process == "<binary>"'` reliably captured
  every `println!` line (tagged `[stdout]`/`[stderr]`) instead — filter by the
  launched PID (`log show`'s own PID column) if a previous run's output could still be
  inside the same `--last` time window.
- **The Simulator's own noise floor (Mac mic passthrough) sits close to `SILENCE_RMS =
  0.02`** — one SILENCE run's ambient room noise (fan/HVAC) pushed peak RMS to ~0.02
  and the guard correctly attempted a real transcription instead of discarding as
  silence (not a bug — the calibration has very little headroom on this hardware).
  The iPad stand's own noise-floor measurement (this document's `[T8.5]` item 6 in the
  plan, `consts.rs`) should keep this in mind.
- **The Simulator's microphone input is whatever the Mac's own default audio INPUT
  device currently is — pin it to the built-in mic before any SPEECH run.** A SPEECH
  scenario run with AirPods as the Mac's default input produced a garbage transcript
  (`" Torsdagsfond"`, detected as Norwegian Nynorsk) that initially looked like an
  acoustics/speaker-quality problem but wasn't: the Simulator was actually listening
  through AirPods' own mic, not the Mac's built-in one, with no in-Simulator signal
  that this had happened. Pinning the input first (`SwitchAudioSource -t input -s
  "<built-in mic name>"`, `brew install switchaudio-osx`) and re-running the identical
  command produced a real, on-language transcript instead (`guardOutcome: finalized`,
  `language: Russian`, real in-room speech). Full evidence in
  `research/plugin-ios/T8_5_simulator.md`'s Scenario (b); `scripts/host-min-ios-smoke.sh`
  now checks this precondition and fails loudly instead of silently trusting whatever
  device happens to be active.

## `[T9a]` Live Activity / Dynamic Island

Implemented (Task 9a) — Swift side + Rust bridge, verifiable without a host:
`ios/Sources/LiveActivity.swift` (app-side `ActivityKit` controller,
`VoxisLiveActivityBridge`), `ios/LiveActivityWidget/{VoxisActivityAttributes,
VoxisActivityView,StopDictationIntent}.swift` (what the **host** adds to its own
widget-extension target), `src/mobile.rs`'s `LiveActivityController` (+ the intent
`Channel`), `src/lib.rs`'s `LiveActivityEventSink` (mirrors `voxis://state`/
`voxis://level` into it), and `src/session.rs`'s `SessionGuard::active_id`. **Task 9b**
owns the on-device, end-to-end check once a host actually has this wired into its own
`WidgetBundle` (naked) — nothing below has run on a device/Simulator yet; see that
task for the honest gap this leaves.

### What starts/stops the activity, and when

`LiveActivityEventSink` (`lib.rs`, `#[cfg(target_os = "ios")]` only) wraps the plugin's
normal `TauriEventSink` and additionally mirrors every `voxis://state`/`voxis://level`
event into `mobile::LiveActivityController`:

| `voxis://state` | Live Activity call |
|---|---|
| `Recording` | `start(startedAtMs)` — fresh `Activity.request`, `phase: .recording` |
| `Transcribing` | `update(phase: "transcribing", elapsedSeconds: <computed>, peak: 0)` |
| `Idle` / `Error` | `end()` — `dismissalPolicy: .immediate` (Task 9a acceptance: ends within ~1s, not the `ActivityKit` default of up to 4h on the Lock Screen) |

`voxis://level` additionally drives `update(phase: "recording", elapsedSeconds: nil, peak)`,
throttled to at most once/second — the Dynamic Island's own elapsed-time text
(`Text(startedAt, style: .timer)`, `VoxisActivityView.swift`) already auto-updates on
device with zero further pushes while `phase == .recording`; only the peak level needs
an actual content push, and not on every ~50ms level tick.

**Never throws into the pipeline** (Task 9a acceptance #2): every
`LiveActivityController::start`/`update`/`end` call on the Rust side, and every
`ActivityKit` call inside `VoxisLiveActivityBridge` on the Swift side, is wrapped so a
failure (Live Activities disabled, `NSSupportsLiveActivities` missing from the host's
`Info.plist`, a transport-level `run_mobile_plugin` error) only logs a warning —
dictation itself is unaffected either way.

### Stop button: Swift → Rust, in-process, no App Group

The Lock Screen/Dynamic Island **Stop** button is bound to `StopDictationIntent`, a
`LiveActivityIntent`. Per Apple's own documented behaviour (confirmed by the plan's own
research, `[R1-iOS C1]`, not yet re-confirmed on-device by this task — that is Task 9b's
job), `perform()` for this intent kind always runs **in the app process** (launching or
resuming it in the background if suspended), never in the widget-extension process —
so this plugin does **not** need an App Group + Darwin-notification fallback to get the
Stop tap back to Rust; it forwards directly:

```
Dynamic Island Stop tap
  -> StopDictationIntent.perform()          (app process, per Apple's own contract)
  -> VoxisLiveActivityBridge.shared?.stopRequestedByIntent()
  -> the Rust-created Channel (registered once via `registerIntentChannel`,
     mobile.rs::LiveActivityController::register_intent_channel)
  -> lib.rs's on_stop closure -> handle_live_activity_stop_intent(&state)
  -> state.sessions.active_id() -> commands::do_stop(&state, id)   (Stop = finalize,
                                                                     like releasing Hold —
                                                                     not Cancel/discard)
```

`handle_live_activity_stop_intent` (`lib.rs`, deliberately **not** target-gated) is unit
tested on this host (`cargo test -p tauri-plugin-voxis`, `live_activity_intent_tests`)
with the existing `MockCapture`/`RecordingSink` doubles — a fake `{"action": "stop"}`
payload path is exercised as far as Rust can go without an iOS process: "no active
session → warn, no-op" and "active session → finalized, exactly like a hotkey release".
If the App-process-execution premise above turns out **not** to hold for this specific
intent kind on real hardware (Task 9b's job to confirm), the fallback is an App Group +
Darwin notification, same as any other host's app↔extension IPC — not implemented here,
since the direct path is what Apple's docs describe and what naked's own Live Activity
work never needed either way (naked's Live Activity has no interactive button at all).

### Why `VoxisActivityAttributes`/`StopDictationIntent` are each declared TWICE

`ios/Sources/LiveActivity.swift` (this plugin's own SwiftPM package, the **app**
target) and `ios/LiveActivityWidget/{VoxisActivityAttributes,StopDictationIntent}.swift`
(what the **host** adds to its widget-**extension** target) each declare their own,
independent copy of both types — not an oversight, and not something to "deduplicate"
by sharing one file across targets:

- `ActivityKit` communicates `ContentState` across the app/extension process boundary by
  `Codable` encode/decode, not by Swift type identity — two independently-compiled,
  structurally-identical copies of `VoxisActivityAttributes` in two different targets
  work correctly as long as their field names/types stay in sync.
- Apple's cross-process `AppIntent` resolution matches by (container app's bundle id,
  intent type name), not by Swift module — a `StopDictationIntent` compiled into the
  app and a same-named one compiled into the extension are recognised as "the same
  intent"; only the **app**-side copy's `perform()` body ever actually executes.
- **Proven precedent already in this monorepo's sibling host**: naked's own
  `NakedLiveActivityAttributes` is declared exactly this way — once `private` inside
  the app-side `naked-plugin-lifecycle/ios/Sources/LifecyclePlugin.swift:95`, once in
  the widget extension's own `gen/apple/NakedLiveActivity/
  NakedLiveActivityAttributes.swift` — same `ContentState` fields, otherwise unrelated
  code, two separate files, two separate targets.

**Keep both copies of each type structurally in sync by hand** whenever either changes
— there is no compiler check across the two files/targets for this (each file's own
module doc comment says so and points at its sibling).

### Adding this to a host that already has a `WidgetBundle` (naked's own case)

Naked already has a Live Activity extension target (`NakedLiveActivity`, `type:
app-extension`, `NSSupportsLiveActivities: true` — `gen/apple/project.yml:254-261`) with
its own `@main struct NakedLiveActivityBundle: WidgetBundle`. Adding Voxis's activity to
an **existing** `WidgetBundle` needs no new Xcode target at all — **except one thing to
decide first**:

0. **Naked's `NakedLiveActivity` extension target is pinned at `deploymentTarget: "16.1"`**
   (`gen/apple/project.yml:257`), but every one of the three `ios/LiveActivityWidget/
   *.swift` files this doc has the host copy in has at least one declaration that is a
   genuine iOS 17.0+ API — `StopDictationIntent` conforms to `LiveActivityIntent`
   (17.0+, stricter than `ActivityAttributes`'s own 16.1 floor), and `VoxisActivityWidget`/
   `VoxisActivityLockScreenView` call `Button(intent: StopDictationIntent())`. Unlike
   naked's own existing `NakedLiveActivityWidget` (no interactive button at all, so it
   never needed anything past `ActivityAttributes`'s 16.1 floor), these three files
   **will not compile unguarded** in an extension target below iOS 17.0 — every
   declaration in them (`VoxisActivityAttributes`, `StopDictationIntent`,
   `VoxisActivityWidget` and its private helper views) is therefore marked
   `@available(iOS 17.0, *)` in this plugin's own copies (verified: `xcrun --sdk
   iphonesimulator swiftc -typecheck -target arm64-apple-ios16.1-simulator
   ios/LiveActivityWidget/*.swift` now passes, as does the same command with `-target
   arm64-apple-ios17.0-simulator`). That alone makes the **files** compile at 16.1, but
   step 2 below ("add `VoxisActivityWidget()` to the existing `WidgetBundle.body`") still
   needs one of these two choices, made **before** step 2:

   - **Option A — bump `NakedLiveActivity.deploymentTarget` to `"17.0"`.** Simplest: step 2
     becomes a plain, unconditional `VoxisActivityWidget()` line, no `#available` needed
     anywhere in the bundle. Consistent with the fact that naked's app target already has
     to raise its own `deploymentTarget.iOS` to 17.0 the moment it depends on
     `tauri-plugin-voxis` at all (`ios/Package.swift`'s `platforms: [.iOS(.v17)]`, this
     doc's own opening `AVAudioApplication` note) — an extension target with a
     `deploymentTarget` below its app target's is unusual, not the normal case. **Cost**:
     naked's own existing (non-interactive) Live Activity — today shipped down to 16.1 —
     stops shipping to 16.1/16.2 devices; anyone still on those OS versions loses it
     entirely, not just the new Voxis one.
   - **Option B — keep `NakedLiveActivity` at 16.1** and register `VoxisActivityWidget()`
     behind an availability check inside `WidgetBundle.body` instead of unconditionally:
     `if #available(iOS 17.0, *) { VoxisActivityWidget() }`. **Verified** this typechecks
     inside `var body: some Widget` at both `-target arm64-apple-ios16.1-simulator` and
     `-target arm64-apple-ios17.0-simulator` (a minimal `WidgetBundle` with one
     unconditional `Widget` and one `@available(iOS 17.0, *)`-gated `Widget` inside an
     `if #available` block, `swiftc -parse-as-library -typecheck`, both targets, exit 0).
     Naked's own existing Live Activity keeps shipping to 16.1/16.2 devices unchanged;
     Voxis's Live Activity simply never appears there (falls back to no Live Activity at
     all on that device, same as this plugin's own `VoxisLiveActivityBridge.start()`
     `#available(iOS 17.0, *)` guard already does app-side).

   **Recommended: Option B.** It costs nothing to naked's existing 16.1/16.2 users (Option
   A silently regresses them) and matches the pattern this plugin already uses everywhere
   else for the same iOS-17 floor (`VoxisLiveActivityBridge.start()`'s own `guard
   #available(iOS 17.0, *) else { ... continuing without one, no error }`) — a Voxis Live
   Activity that simply doesn't appear on a pre-17 device is the same acceptable-degradation
   story as everywhere else in this plugin, not a new one.

1. Copy (or symlink — either is fine, XcodeGen just needs a real path to compile) this
   plugin's three `ios/LiveActivityWidget/*.swift` files into the extension's own
   sources directory (naked: `gen/apple/NakedLiveActivity/`) — or add their real paths
   directly to that target's `sources:` list in `project.yml` (XcodeGen accepts
   individual file paths, not just directories, same as any other `sources:` entry —
   `.pi/plans/tauri-plugin-voxis.md`'s own Task 9a step 0 already established this for
   `gen/apple/project.yml`-driven extensions).
2. Add `VoxisActivityWidget()` as a second entry in the existing `WidgetBundle.body`
   (naked: `NakedLiveActivityBundle.body`, `gen/apple/NakedLiveActivity/
   NakedLiveActivityWidget.swift`) — a `WidgetBundle` can list more than one `Widget`;
   this does **not** replace `NakedLiveActivityWidget()`, it adds alongside it. Per
   step 0's choice: with Option A (deployment target bumped to 17.0) this is a plain
   `VoxisActivityWidget()` line; with Option B (kept at 16.1, recommended) wrap it as
   `if #available(iOS 17.0, *) { VoxisActivityWidget() }`.
3. Also add `StopDictationIntent.swift` (one of the same three files) to the **app**
   target's own sources too — see "why declared twice" above for why this is required,
   not optional; skipping this step means the button renders but tapping it does
   nothing (the OS can't find a matching app-side intent to execute).
4. `NSSupportsLiveActivities: true` is already set for naked (`project.yml`, same key
   this document's `Info.plist` keys table already covers) — a host adding a **fresh**
   extension (one that doesn't exist yet) needs the full `type: app-extension` +
   `NSExtensionPointIdentifier: com.apple.widgetkit-extension` + own `DEVELOPMENT_TEAM`
   + `ActivityKit.framework`/`SwiftUI.framework`/`WidgetKit.framework` `dependencies:`
   block from this task's own step 0 research (`.pi/plans/tauri-plugin-voxis.md`,
   verbatim clipshot/naked XcodeGen lessons — `xcodegen generate` before every build,
   `Info.plist`/entitlements only via `project.yml` properties, the extension's own
   `DEVELOPMENT_TEAM`, no Rust-linking `outputFiles` needed since this widget's Rust
   footprint is zero, pure SwiftUI render).
5. `UIBackgroundModes: audio` (already covered by this doc's `Info.plist` keys table)
   is what actually keeps the dictation session — and therefore the Live Activity that
   mirrors it — alive once the host backgrounds; the 2.5.4 justification text ("voice
   dictation continues while switching apps") applies unchanged.
6. `xcodegen generate` before the next build — this plugin adds no new automation for
   that step; it was already required for every other `project.yml` edit.

### Honest gaps (Task 9b's job, not glossed over here)

- **Foreground-only demonstrated so far.** Everything above is verified by Rust unit
  tests (`live_activity_intent_tests`) and standalone Swift compiles/typechecks
  (`cargo build -p tauri-plugin-voxis --target aarch64-apple-ios[-sim]`; `xcrun --sdk
  iphonesimulator swiftc -typecheck -target arm64-apple-ios16.1-simulator
  ios/LiveActivityWidget/*.swift` and the same at `-target
  arm64-apple-ios17.0-simulator` — both targets, since "step 0" above depends on the
  16.1 one specifically) — **none of it has run inside an actual Dynamic
  Island yet.** Dynamic Island only shows a Live Activity while the host is
  backgrounded (or on the Lock Screen) — this is iOS's own behaviour, not a bug in this
  plugin: a host that starts a session while staying in the foreground the whole time
  will never see it in the Dynamic Island at all, only in Notification Center's
  history once it ends (the plan's own Approach §4 already documents this for the
  overlay/Dynamic Island relationship generally).
- **The Apple-docs "perform() runs in the app process" premise is unconfirmed on
  hardware for this exact intent/app combination** — Task 9b's own job (`docs/
  IPHONE_STAND.md`; plan Task 9b's acceptance criterion is literally "confirm that
  `LiveActivityIntent.perform()` runs in the app process (log the pid); otherwise
  switch on the App Group + Darwin-notification fallback").
- **Locked-screen Keychain read during the Stop-triggered transcription is still
  unresolved.** `KeychainSecretStore.swift` uses
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (`[R1-Safety S2]`, Task 8's own
  acceptance) — deliberately the strictest class that still works for a foreground
  session — but it means a `secretGet` call that happens **while the device is
  locked** (the pipeline's transcription step reads the API key via
  `SecretStore::get`, `pipeline.rs`, right after a Lock-Screen Stop tap finalizes the
  session) fails with `errSecInteractionNotAllowed`, not a slow/blocked prompt. This
  task did not change `KeychainSecretStore.swift`/`pipeline.rs` (outside this task's
  own file scope) — a user stopping dictation from a locked Lock Screen may see a
  transcription failure instead of a result. Two options for whichever task picks this
  up: (a) read the API key up front while still unlocked and hold it in memory for the
  in-flight session only, or (b) surface this specific Keychain failure as its own
  distinct, actionable error. Recorded here so it isn't rediscovered from scratch —
  carried over verbatim from this section's pre-Task-9a draft, still open.

## `[T11]` Host checklist additions — real iPad run findings (naked)

Facts from an actual physical-iPad run of a real host (`naked`, branch
`voxis-plugin`) embedding this plugin — full evidence in
`research/plugin-plan/T11_ipad_run_2026-09-16.md`. These are host-integration
gotchas the plugin itself cannot fix; add them to any new host's own checklist:

- **`xcodegen generate` must be run — and the regenerated output committed —
  after every `project.yml` edit, on the actual on-device deploy path, not
  just in a local/Simulator build script.** The iPad run's first dictation
  tap killed the app with a TCC crash (no `NSMicrophoneUsageDescription` at
  the moment of first mic access) because the device-deploy script
  (`scripts/ios-device-deploy.sh`) built from the **last-committed** generated
  `Info.plist`, which predated an uncommitted `project.yml` edit that had
  already added the key. Running `xcodegen generate` locally and forgetting
  to `git add`/commit the regenerated `gen/apple/**` output reproduces this
  exactly — a host's device-deploy script trusting a stale committed
  `Info.plist` is indistinguishable from never having added the key at all.
  Rule: after any `project.yml` change intended to reach a device build,
  regenerate AND commit before deploying, not just before testing locally.
- **`.vxp` file import needs `UIFileSharingEnabled` (+
  `LSSupportsOpeningDocumentsInPlace`) in the host's `Info.plist`/
  `project.yml`** for `UIDocumentPickerViewController`-based import to be able
  to reach a `.vxp` file placed via the Files app/iTunes-file-sharing/AirDrop
  at all — without it, the picker has nothing to show for a file living
  outside the host's own sandboxed Documents directory. (naked's own iOS
  Simulator stage, Task 11 stage 1, added this; the iPad run confirmed the
  `apply_profile` passphrase-import call itself works once bytes are in hand —
  see the next point for what did NOT work automatable on this specific
  device run.)
- **A deploy script that skips `xcodegen generate` isn't just "missed
  metadata" — it is a silent TCC kill, not a graceful permission denial.**
  Restating the `Info.plist` keys table's own point above with on-device
  confirmation: this is not a theoretical risk, it is the exact failure mode
  hit on first physical use, with no in-app warning beforehand and no
  `PermissionDenied` ever reaching the plugin (the process was already gone).
  A host's own release/deploy tooling needs its own guard (e.g. diff
  `gen/apple/**` against a freshly-run `xcodegen generate` and fail the build
  if they differ) if it wants to catch this before a real device run does.
- **WDA (WebDriverAgent) taps were inert on this specific physical iPad**
  (element clicks and W3C pointer actions, against both the WebView and a
  native document picker), while the accessibility tree and screenshots kept
  working — an unresolved automation-environment issue (`research/
  plugin-plan/T11_ipad_run_2026-09-16.md` finding 2 leaves it undiagnosed:
  automation-mode/testmanagerd state, not something this plugin's own code
  touches). **CDP (`Runtime.evaluate` against an inspectable build,
  `NAKED_IOS_DEVTOOLS=1`) reliably drove the WebView end to end instead** —
  any host planning unattended on-device UI automation (not just manual human
  gate runs) should plan for a CDP-based driving path as the reliable one on
  real hardware, with WDA treated as a fallback that may simply not work on a
  given device/OS combination, not the primary path. Native (non-WebView)
  sheets (e.g. the system document picker) remain undriveable by either path
  on this device — a `devicectl` relaunch was the only way to dismiss one
  once WDA taps stopped working.
- **A toggle-mode stop tap that lands while `start()` is still awaiting the
  system microphone-permission prompt is silently swallowed** (see this
  plugin's own README "Real hard-won lessons" section for the mechanism) —
  confirmed on real hardware, not just in theory: the session ran all the way
  to its silence timeout instead of stopping. A host's own UI needs to track
  "start is pending" and stop/cancel once it resolves; the plugin does not
  expose a way to cancel an in-flight, not-yet-resolved `start()` call today.
