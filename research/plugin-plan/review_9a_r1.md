VERDICT: REJECT-FIX

## Findings

1. **[MAJOR] `docs/PLUGIN_IOS_HOST.md` §"Adding this to a host that already has a `WidgetBundle`" — naked's own worked example does not actually compile as described, and the doc never flags it.**
   - `crates/tauri-plugin-voxis/ios/LiveActivityWidget/StopDictationIntent.swift:27` declares
     `struct StopDictationIntent: LiveActivityIntent { ... }` with **no `@available(iOS 17.0, *)`
     guard** (unlike the app-side copy, `ios/Sources/LiveActivity.swift:79`, which does have one).
     `LiveActivityIntent` is an iOS-17.0-floor API.
   - `ios/LiveActivityWidget/VoxisActivityView.swift:17` (`struct VoxisActivityWidget: Widget`) and
     lines 34/113 (`Button(intent: StopDictationIntent())`) also carry no `@available` guard.
   - The doc's own worked integration target, naked's `NakedLiveActivity` extension, is pinned at
     `deploymentTarget: "16.1"` (`~/work/naked/src-tauri/gen/apple/project.yml:257` — the exact file
     the diff/doc repeatedly cites as precedent, e.g. `docs/PLUGIN_IOS_HOST.md` "naked's own
     `NakedLiveActivity`… `gen/apple/project.yml:254-261`"). Adding these three unguarded files to a
     target whose deployment target is 16.1 is a hard Swift compile error ("`LiveActivityIntent` is
     only available in iOS 17.0 or newer"), not a soft warning.
   - The typecheck evidence the doc/diff cites for this (`xcrun --sdk iphonesimulator swiftc
     -typecheck -target arm64-apple-ios17.0-simulator ios/LiveActivityWidget/*.swift`,
     `docs/PLUGIN_IOS_HOST.md:414`) explicitly forces the compile target to **17.0**, not naked's
     real 16.1 — so this specific, doc-recommended integration path was never actually exercised,
     and the doc's claim "adding Voxis's activity to an existing `WidgetBundle` needs no new Xcode
     target at all" is unverified/likely false for the concrete host named as the example.
   - **Fix (either is acceptable, doesn't require redoing the design):** (a) add
     `@available(iOS 17.0, *)` to `StopDictationIntent` and `VoxisActivityWidget` in
     `LiveActivityWidget/*.swift` (mirroring the `ios/Sources` copy) and document that a host whose
     existing extension target sits below 17.0 (like naked, today) must either raise that target's
     `deploymentTarget` to 17.0 or wrap the added sources in an `#available` check before compiling
     them in; or (b) state explicitly in the doc's naked walkthrough that step 0 is "bump
     `NakedLiveActivity`'s `deploymentTarget` to 17.0" and note the consequence (that extension no
     longer runs its existing Live Activity content on 16.1/16.2 devices). Right now neither is
     stated, and the as-shipped files silently assume a 17.0 floor the cited host does not have.

## Pre-verified facts agree/disagree

- Agree: core 470/0, plugin desktop 157/0, clippy clean after the lib.rs:520 `cfg_attr(not(target_os
  = "ios"), allow(dead_code))` fix — confirmed present exactly there, on
  `handle_live_activity_stop_intent`, and confirmed necessary/correct (function is otherwise unused
  outside the `#[cfg(target_os = "ios")]` closure in `init_ios_with`, but exercised by
  `#[cfg(test)]` regardless of target).
- Agree: iOS clippy/build claims are consistent with the diff's structure; cannot independently
  re-run cargo per task constraints — took pre-verified facts as given for the Rust side.
- Agree: host-min smoke / guest-js facts are out of scope for this diff (no host-min or guest-js
  files touched by `diff_9a.patch`); the working tree's other modified files (contract fixtures,
  guest-js, `capture.rs`, `desktop.rs`, `profile_source.rs`, `voxis-core/src/profile/*`,
  `storage/*`) belong to a different, disjoint parallel task and are correctly out of this diff's
  scope.
- Disagree/gap: the "iOS device build + clippy --target ios clean" and "0 orphans" facts say nothing
  about typechecking the widget files against the *actual* deployment target of a real host
  extension (16.1 for the one host that exists in this workspace tree, naked) — the reported
  typecheck ran at 17.0, which does not exercise the failure mode above.

## Checked and OK

- `LiveActivityWidget/{VoxisActivityAttributes,StopDictationIntent}.swift` are **not** globbed into
  the plugin's own SwiftPM package: `ios/Package.swift`'s only target has `path: "Sources"`, so the
  widget files are purely something the host adds to its own extension `sources:` — confirmed. None
  of the three files import `Tauri`; only `ActivityKit`/`SwiftUI`/`WidgetKit`/`AppIntents`/
  `Foundation` — confirmed.
- `VoxisActivityAttributes`/`StopDictationIntent` structural sync between the two copies
  (`ios/Sources/LiveActivity.swift` vs `ios/LiveActivityWidget/*.swift`): field names/types
  (`phase`, `startedAt`, `elapsedSeconds: Int?`, `peak: Double`; `Phase` = `recording`/
  `transcribing`/`idle`) and intent `title`/`description` strings are identical between the two
  copies — verified by direct diff. The widget copy's `perform()` is a documented no-op by design
  (only the app-process copy's body, which calls `VoxisLiveActivityBridge.shared?.
  stopRequestedByIntent()`, actually runs); this is consistent with Apple's documented
  cross-process `AppIntent` resolution-by-name behaviour cited in the plan.
- `VoxisLiveActivityBridge` (`ios/Sources/LiveActivity.swift`): every `ActivityKit` call
  (`start`/`update`/`end`) is inside a serial `DispatchQueue`, gated by `#available(iOS 17.0, *)`
  and `ActivityAuthorizationInfo().areActivitiesEnabled`, and `Activity.request` is wrapped in
  `do`/`catch` that only logs — matches "never throws into the pipeline" and "backgrounded-start
  failure = log, not crash." `activity: Any?` (not `Activity<VoxisActivityAttributes>?`) is
  correctly justified (stored-property availability limitation, matching precedent already in
  `AudioCapture.swift`). `end()` uses `dismissalPolicy: .immediate` as required.
- `lib.rs`'s `LiveActivityEventSink<R>` (cfg `target_os = "ios"` only): wraps `inner.emit` and
  always calls it first/unconditionally — the webview still gets every event unchanged.
  `Recording → start`, `Transcribing → update`, `Idle|Error → end` mapping matches the plan; the
  `voxis://level` throttle (>=1s, gated on `started_at.is_some()`) is correctly implemented with a
  `std::sync::Mutex`, no lock held across `.await` (there is no `.await` in `emit` at all — every
  `LiveActivityController` call is a synchronous `run_mobile_plugin`, consistent with the existing
  `IosCapture`/`IosKeychainSecretStore` calling convention already in this crate). `pipeline.rs` is
  untouched, matching the stated scope.
- `handle_live_activity_stop_intent` (`lib.rs:521`): `sessions.active_id()` → `commands::do_stop`
  (finalize, matching hotkey-release semantics, not `cancel`/discard) → warn-and-no-op when no
  active session. Both branches unit-tested
  (`stop_intent_with_no_active_session_is_a_harmless_no_op`,
  `stop_intent_finalizes_the_active_session_like_a_hotkey_release`) using the existing
  `MockCapture`/`RecordingSink` doubles; tests pass the pre-verified 470/0 count. Deliberately not
  `#[cfg(target_os = "ios")]`-gated so it's host-testable, consistent with the `cfg_attr` dead-code
  annotation discussed above.
- `mobile.rs`'s `LiveActivityController<R>`: `register_intent_channel`'s `Channel` decode closure is
  synchronous and calls `on_stop()` inline; the actual `.await`-needing work
  (`handle_live_activity_stop_intent`) is spawned via `tauri::async_runtime::spawn` from the
  `on_stop` closure passed in from `lib.rs::init_ios_with`, not blocked on inside the channel
  callback — correctly avoids blocking Swift's dispatch of the intent payload. Field-name/JSON-key
  correspondence between the four Rust arg structs (`RegisterIntentChannelArgs`,
  `LiveActivityStartArgs`, `LiveActivityUpdateArgs`, and `end`'s `EmptyArgs`) and the four matching
  Swift `Decodable` structs in `VoxisPlugin.swift` checked field-by-field — consistent
  (`camelCase` renaming matches on both sides).
- `session.rs::SessionGuard::active_id()`: single `Mutex::lock()`, no `.await` inside the critical
  section, returns a clone of the id — read-only, matches the supervisor-approved ~5-line widening.
  `active_id_mirrors_has_active` test present and exercises empty → active → ended transitions.
- `docs/PLUGIN_IOS_HOST.md`: the pre-existing Keychain/locked-screen caveat (Task 8's
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` vs. a Stop-triggered transcription while locked)
  is carried over verbatim into the new "Honest gaps" section rather than dropped — good, matches
  requirement #6's "honest note" expectation. The doc's own "Foreground-only demonstrated so far"
  and "Apple-docs premise is unconfirmed on hardware" paragraphs correctly defer on-device proof to
  Task 9b and do not overclaim.
- Four new Swift `@objc` commands (`registerIntentChannel`, `liveActivityStart`,
  `liveActivityUpdate`, `liveActivityEnd`) — matches the 1:1 Rust→Swift call surface
  (`LiveActivityController::register_intent_channel`/`start`/`update`/`end`); no evidence of
  gold-plating (no extra commands, no unused fields/branches found in `LiveActivityController` or
  `VoxisLiveActivityBridge`).

## Minors

- `docs/PLUGIN_IOS_HOST.md`'s naked walkthrough (steps 1–6) never states what deployment target the
  target *itself* needs, only that `NSSupportsLiveActivities: true` is "already set" — worth folding
  the deploymentTarget requirement into the same numbered list once the Major finding above is
  fixed, rather than leaving it implicit.
- The `ios/Sources/LiveActivity.swift` copy of `VoxisActivityAttributes`/`StopDictationIntent`
  carries an explicit `@available(iOS 17.0, *)` purely to work around a documented SwiftPM
  deployment-target-propagation quirk for `swift build` (matches `AudioCapture.swift` precedent);
  the widget copies have no equivalent comment explaining why *they* omit it — even after the Major
  fix, a one-line note ("guarded here because the host's extension target deployment target is not
  guaranteed by this plugin — see docs") would keep the two files' asymmetry self-documenting.
- `LiveActivityEventSink::emit`'s `Transcribing` branch always sends `peak: 0.0` — harmless (the
  Dynamic Island's timer view ignores `peak` once `phase != .recording`), but worth a one-line
  comment noting it's intentionally a dummy value, matching the file's otherwise very thorough
  documentation style.
