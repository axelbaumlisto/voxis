# `tauri-plugin-voxis` on iOS — host requirements (draft)

> **Status:** draft, written alongside Task 8 (`AVAudioEngine` capture + Keychain
> `SecretStore`, `crates/tauri-plugin-voxis/ios/`). Task 8.5 (iOS Simulator + iPad-stand
> tracer bullet) and Task 9a (Live Activity) will extend this document — see the
> `[T8.5]`/`[T9a]` markers below for what is intentionally not filled in yet.

This is the checklist for any Tauri 2 host (iPadOS/iOS) that embeds
`tauri-plugin-voxis`. It complements `docs/THEMES.md`/`docs/THEME_EDITING.md` (overlay
visuals, not iOS-specific) and the plan (`.pi/plans/tauri-plugin-voxis.md`), which owns
the *why* behind these requirements — this file is the host-facing *how*.

## Minimum iOS version

**iOS 17.0.** Fixed by `ios/Package.swift`'s `platforms: [.iOS(.v17)]` — the plugin uses
`AVAudioApplication` (permission API + `inputMuteStateChangeNotification`, both iOS 17+)
unconditionally. A host targeting an older minimum cannot embed this plugin.

## `Info.plist` keys

| Key | Value | Why |
|---|---|---|
| `NSMicrophoneUsageDescription` | Must **name the actual STT provider** (e.g. "Used to record your voice and send it to Groq for transcription."), not a generic "this app uses your microphone". App Store review checks that the usage string matches what the app actually does with the audio. | **Required — its absence is not a soft failure.** If this key is missing, iOS does not deny the permission gracefully and does not hand the plugin a `PermissionDenied` to report: the OS **terminates the process** the moment `AVAudioApplication.requestRecordPermission`/`AVAudioSession` activation first touches the microphone, with a TCC crash log reading something like `This app has crashed because it attempted to access privacy-sensitive data without a usage description. The app's Info.plist must contain an NSMicrophoneUsageDescription key with a string value explaining to the user how the app uses this data.` This happens on the **very first** `startCapture` call after install — there is no in-app warning beforehand, and no `stop()`/`reject` path in this plugin ever runs, because the process is already gone. Get this key into the host's `Info.plist`/`project.yml` before the first test run, not after. |
| `UIBackgroundModes` → `audio` | **Only add this if the host actually wants recording to survive backgrounding** (dictation while the user switches apps, plan Task 9a/9b's Live Activity flow). Without it, `AVAudioSession` gets deactivated by the OS shortly after the host leaves the foreground, and the *next* `level` tick simply stops (the plugin's own liveness signal, `StreamDied → Recover` — no crash, but the in-flight recording is truncated at background+few-seconds). | App Store guideline 2.5.4 requires the app to actually use background audio, not just declare the mode as a workaround — the host's App Store notes should say "voice dictation continues while switching apps" explicitly. |
| `NSSupportsLiveActivities` | `true`, **only once Task 9a lands** — not needed for Task 8's plain capture path. | Dynamic Island / Lock Screen recording indicator (Task 9a/9b), not implemented yet. |

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

## `[T9a]` Live Activity / Dynamic Island

Not implemented yet — see the plan's Task 9a/9b. This document will gain a
`NSSupportsLiveActivities` + WidgetBundle integration section once that task lands.

**Keychain + locked screen, noted now for when 9a's Live Activity "Stop" button lands:**
`KeychainSecretStore.swift` uses `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` —
deliberately (`[R1-Safety S2]`, Task 8's own acceptance criteria) the strictest class
that still works for a foreground session, but it means any `secretGet`/`secretSet`/
`secretDelete` call that happens **while the device is locked** (e.g. a Live Activity's
"Stop" intent finalizing a transcription — the pipeline's transcription step reads the
API key via `SecretStore::get`, `pipeline.rs`) fails with `errSecInteractionNotAllowed`,
not a slow/blocked prompt. Task 9a/9b's own Stop-intent handling needs to either (a)
read the API key up front while still unlocked and hold it in memory for the
in-flight session only, or (b) surface this specific Keychain failure as its own
distinct error rather than a generic transcription failure, so a user stopping
dictation from a locked Lock Screen gets an actionable message instead of a silent
drop. Not implemented — this is 9a's problem to solve, recorded here so it isn't
rediscovered from scratch.
