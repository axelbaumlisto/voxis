# BLIND review — R2: iOS/Swift + mobile bridge

VERDICT: SHIP

Scope reviewed: `crates/tauri-plugin-voxis/ios/Package.swift`,
`ios/Sources/{AudioCapture,WavWriter,VoxisPlugin,LiveActivity,KeychainSecretStore}.swift`,
`ios/LiveActivityWidget/{VoxisActivityAttributes,StopDictationIntent,VoxisActivityView}.swift`,
`src/mobile.rs`, plus `src/lib.rs` `LiveActivityEventSink`/`init_ios_with` wiring and
`src/models.rs` for the wire contract. No Xcode build (Tauri module unresolvable); reasoned from source.

(Applied memories: review-only task — made no edits, ran no commits, wrote only to the
authoritative output path; did not `find /` or scan `~/.cargo`.)

## Blockers
None. The central criterion — every iOS 17+ symbol is `#available(iOS 17.0, *)`-gated and the
iOS 16 path stays functional — holds across every file I read.

## Should-fix (non-blocking)

- **Stale/contradictory deployment-target comments vs the actual manifest.**
  `AudioCapture.swift:startEngine` ("Package.swift pins `platforms: [.iOS(.v17)]`") and
  `LiveActivity.swift` (VoxisLiveActivityBridge doc: "even though `Package.swift` pins
  `platforms: [.iOS(.v17)]`") both assert a v17 floor, but `Package.swift` actually declares
  `.iOS(.v16)`. Harmless to runtime (the `#available` guards make the file correct at either
  floor, which is the whole point), but the comments now misdescribe the manifest and could
  mislead a future maintainer into "simplifying away" a guard. Fix: correct the two comments to
  say `.iOS(.v16)`.

- **First-run permission prompt blocks the Rust caller thread.**
  `mobile.rs`'s `IosCapture::start` calls `run_mobile_plugin("startCapture", ..)`, which blocks
  (`rx.recv()`) until Swift calls `invoke.resolve`. Swift's `startCapture` only resolves inside
  the `capture.start(...)` completion — which fires *after* `requestPermissionIfNeeded` returns.
  On an undetermined first run that means the calling thread (a Tokio worker via
  `commands::do_start`) is parked for however long the user takes to answer the system dialog.
  Not a deadlock (Swift's `ipcDispatchQueue` is freed immediately, main thread is free to present
  the alert, capture work runs on the dedicated `queue`), and the module doc explicitly defers the
  real fix (`spawn_blocking` at the `commands.rs` call site) as out of scope. Correct behaviorally
  today; worth landing the deferred `commands.rs` fix so a slow permission answer can't pin a
  worker.

- **`AVAudioSession` is never deactivated after `stop()`/interruption.**
  `failWithInterruption`/`teardownEngine` stop the engine and remove the tap but deliberately leave
  the session `.record`-active (documented for the Task 9a/9b background-recording plan). If a host
  ships without the background-audio entitlement this leaves the session (and the orange mic privacy
  indicator / audio-focus interruption of other apps) live until the app backgrounds or the next
  session starts. Acceptable for the stated roadmap, but flag it for hosts that never background-record.

- **`LevelSampleWire.rms` carries the window peak, not a mean RMS.**
  `emitLevelTick` sends `LevelSampleWire(rms: peak, peak: peak, ...)` — both fields are
  `windowPeak.takePeak()`. `models::LevelEvent` has distinct `rms`/`peak` fields and any consumer
  that treats `rms` as an average would be misled. Likely intentional parity with desktop's
  `WindowPeakAccumulator`, but the two fields being identical is worth a one-line note or a real
  mean if a consumer ever needs it.

- **Duplicated cross-target types have no compile-time sync guard.**
  `VoxisActivityAttributes` and `StopDictationIntent` are declared twice (app-side `Sources/` and
  widget-side `LiveActivityWidget/`) and, as the doc comments correctly explain, must match by
  `Codable` shape / intent type-name across the process boundary. This is architecturally correct
  (ActivityKit matches by structure, AppIntents by (bundle id, type name)), but drift silently
  breaks decoding / the Stop button with no compiler error. The doc warnings are thorough; consider
  a lightweight test/lint if this ever changes often.

## Verified OK

- **iOS 17+ gating (primary criterion).** Every 17+ symbol is inside `#available(iOS 17.0, *)`:
  `AVAudioApplication` (`recordPermission`, `requestRecordPermission`, `isInputMuted`,
  `inputMuteStateChangeNotification`, `muteStateKey`) in `init`, `requestPermissionIfNeeded`, and
  the `startEngine` muted read; `Activity.request/update/end`, `ActivityContent.init`,
  `ActivityAuthorizationInfo`, `VoxisActivityAttributes`, `LiveActivityIntent`/`StopDictationIntent`
  in `LiveActivity.swift`; `Button(intent:)` + the whole widget UI in `VoxisActivityView.swift`.
  The `activity` property is typed `Any?` (not `Activity<…>?`) specifically so a stored property
  never forces an unguarded reference to a versioned generic — correct workaround. No unguarded
  17+ symbol found.

- **iOS 16 path functional.** Permission falls back to `AVAudioSession.recordPermission` /
  `requestRecordPermission` (same three states, correct pre-17 API). No mute observer is installed
  on 16 (`muted` stays false unless the RMS≈0 heuristic trips) — matches "no system-mute signal".
  `VoxisLiveActivityBridge.start` hits the `guard #available(iOS 17.0, *) else { NSLog; return }`
  path — logs and continues, no error, no Live Activity. Matches the brief's 16-path expectations.

- **AVAudioEngine lifecycle.** `start/stop/reset` all hop onto the serial `queue` and return; all
  mutable state touched only from `queue` (with `stateLock` for the fields the tap/timer share).
  `mediaServicesWereReset` sets `engineNeedsRebuildAfterReset`, and `startEngine` replaces `engine`
  with a fresh instance *before* reading `inputNode`/installing observers — rebuild ordering is
  correct. Interruption `.began` → `failWithInterruption`; `.ended` deliberately never auto-resumes;
  route `.oldDeviceUnavailable` → fail; `AVAudioEngineConfigurationChange` (registered with
  `object: engine`, delivered via `.main` then hopped to `queue` to avoid the documented
  internal-queue deadlock) → fail; plus an `engine.isRunning` belt-and-braces check in the level
  timer catches a missed config-change notification. `engine.start()` throw path removes the tap,
  removes observers, and clears `running` (no observer leak on early failure).

- **WAV parity + file handles.** `WavWriter.encode` produces canonical 44-byte header, mono, PCM16,
  16 kHz, `sample*32767` clamp with truncate-toward-zero matching `samples_to_wav`; NaN/±inf encode
  as 0 (no `Int16(_:)` trap); `#if DEBUG selfCheck()` asserts header scalar fields + clamp +
  NaN-safety and runs at plugin init. `writeProtectedFile` uses `Data.write(to:options:)` (atomic,
  closes its own handle), `.completeFileProtectionUnlessOpen`, and `isExcludedFromBackup`. No raw
  `FileHandle` left open.

- **Permission prompt doesn't block the dispatch queue.** `requestPermissionIfNeeded` is
  completion-based — no `semaphore`/`DispatchGroup.wait()`. The `queue.async` block returns before
  the prompt is answered; the async completion hops back onto `queue`. (The *Rust* caller still
  blocks — see should-fix above — but the Swift queues stay free.)

- **Bridge command/event contract matches Rust models.** All 10 command names line up
  (`startCapture/stopCapture/resetCapture/secretGet/secretSet/secretDelete/registerIntentChannel/
  liveActivityStart/liveActivityUpdate/liveActivityEnd`). Field casing matches under
  `#[serde(rename_all="camelCase")]`: `StartCaptureArgs{path,capSamples,onLevel}`,
  `CaptureStatsWire{durationMs,samples,peakRms}` vs `StopCaptureResultWire`,
  `LevelSampleWire{rms,peak,muted,capHit}`, `SecretGetResult{value}`,
  `RegisterIntentChannelArgs{onIntent}`, `LiveActivityStartArgs{startedAtMs}`,
  `LiveActivityUpdateArgs{phase,elapsedSeconds,peak}`, and the intent payload `{"action":"stop"}` ↔
  `IntentPayloadWire{action}`. `Channel` is created Rust-side (`IosCapture::new`,
  `register_intent_channel`) and never from JS. No `sessionId` crosses this bridge (single-flight
  lives Rust-side), so nothing to reconcile there. Phase strings `"recording"/"transcribing"/"idle"`
  match `VoxisActivityAttributes.Phase.rawValue`, and `lib.rs` only ever sends the first two.

- **Observer / memory hygiene.** `muteObserver` added in `init` (17+ only), removed in `deinit`;
  the four failure observers removed in `teardownEngine`/`failWithInterruption`/`engine.start` catch/
  `deinit`, each guarded `if let … { removeObserver; = nil }` (idempotent, no double-remove crash).
  Notification blocks capture `[weak self]`; NotificationCenter retains the token, not `self` — no
  cycle.

- **Level-channel thread-safety.** `levelChannel`, `levelTimer`, and `engine` are read/written only
  on the serial `queue` (timer targets `queue`; every observer hops to `queue` before touching
  them). `WindowPeakAccumulator` is `NSLock`-guarded; shared scalar state uses `stateLock`.
  `sawAudio` gating prevents a spurious `muted:true` flash before the first real buffer.

- **Live Activity start/stop/panic paths.** `start/update/end` each guard `#available(iOS 17.0,*)`
  and `as? Activity<…>`; `start` also checks `areActivitiesEnabled` and wraps `Activity.request` in
  do/catch (log-only). `end` uses `dismissalPolicy: .immediate`. All four `VoxisPlugin` handlers
  `invoke.resolve()` unconditionally (ActivityKit failure is never an error — matches Rust-side
  log-only `LiveActivityController`). `stopRequestedByIntent` forwards via the registered channel,
  logs if fired before registration.

## Not covered
- No device/simulator build or byte-for-byte WAV diff against a Rust `samples_to_wav` fixture
  (T8.5 device check; `swiftc -typecheck` can't resolve the Tauri module).
- Runtime ActivityKit / Dynamic Island behavior and the actual `Channel.send` Encodable signature
  against Tauri's Swift package (assumed correct from usage).
- `commands.rs` (out of file list) — the deferred `spawn_blocking` wrapper for the blocking
  `run_mobile_plugin` call is unverified there.
- Host widget-target integration steps in `docs/PLUGIN_IOS_HOST.md` were not opened (naked host is
  a separate reviewer's scope).

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Full iOS/Swift + mobile-bridge review written to /tmp/ado.C4YWdv/blind/R2_ios_swift.md with VERDICT, Blockers (none), Should-fix, Verified-OK, Not-covered, and residual risks."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Read all in-scope Swift sources, mobile.rs, plus lib.rs sink wiring and models.rs for the wire contract. Reasoned from source (no build).",
    "All iOS 17+ symbols confirmed #available-gated; iOS 16 permission/no-mute/no-LiveActivity path confirmed functional.",
    "Bridge command names + camelCase field casing confirmed matching between Swift wire structs and Rust serde models."
  ],
  "residualRisks": [
    "No device/simulator build or byte-for-byte WAV fixture diff performed (T8.5).",
    "Rust caller thread blocks on first-run permission prompt until user answers (documented; deferred commands.rs spawn_blocking fix not verified).",
    "AVAudioSession left active after stop for planned background recording — leaves privacy indicator/audio focus if host lacks background entitlement.",
    "Duplicated cross-target ActivityKit/AppIntent types rely on manual sync (no compile-time guard).",
    "Two AudioCapture.swift/LiveActivity.swift comments claim Package.swift pins .iOS(.v17) but manifest is .iOS(.v16) (comment-only, runtime unaffected)."
  ],
  "noStagedFiles": true,
  "diffSummary": "No code changes; review-only artifact produced.",
  "reviewFindings": [
    "no blockers",
    "should-fix: AudioCapture.swift/LiveActivity.swift - comments say Package.swift pins .iOS(.v17) but manifest is .iOS(.v16)",
    "should-fix: mobile.rs IosCapture::start - blocking run_mobile_plugin parks Rust caller thread through first-run permission prompt (deferred commands.rs fix)",
    "should-fix: AudioCapture.swift - AVAudioSession never deactivated after stop/interruption",
    "note: AudioCapture.swift emitLevelTick sends window peak in both rms and peak fields"
  ],
  "manualNotes": "Primary judge criterion passes: every iOS 17+ API (AVAudioApplication, mute notifications, Activity/ActivityContent/ActivityAuthorizationInfo, LiveActivityIntent, Button(intent:)) is #available(iOS 17.0,*)-gated, and the iOS 16 path (AVAudioSession permission, no mute signal, no Live Activity) is functional. Engine lifecycle, observer removal, WAV parity, and the Swift<->Rust wire contract all check out. Findings are non-blocking."
}
```
