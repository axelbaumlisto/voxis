# iOS/APPLE PLATFORM review — tauri-plugin-voxis plan

Artifact: `/Users/shamash/work/voxis/.pi/plans/tauri-plugin-voxis.md` (Tasks 8, 8.5, 9, 11, 11b; follow-up «Каталог механизмов Apple»). Blind critic, read-only. No source or plan files modified.

Method note: `web_search`/`fetch_content` tools were not present in this run; evidence was pulled with `curl` from Apple's documentation JSON API (`developer.apple.com/tutorials/data/documentation/*.json`), Tauri's GitHub sources, DuckDuckGo HTML, local repos (`~/work/clipshot`, `~/work/naked`), and **one live probe on this Mac (macOS 26.6.2) compiled with `swiftc`** for the Speech claim.

## Verdict: GO-WITH-CHANGES
Core iOS mechanics in Tasks 8/9/11b are sound and mostly confirmed by Apple docs, but: (a) `com.apple.developer.siri` is not needed for App Intents / App Shortcuts (Task 11b adds a pointless entitlement and a wrong `Files:` path), (b) Task 9 ignores that naked already ships a `NakedLiveActivity` widget-extension target, (c) Task 9 misses the Apple rule that a `LiveActivityIntent` must be compiled into **both** the widget-extension target and the app target, (d) the ru_RU/SpeechTranscriber contradiction is now settled (no Russian) and the plan's follow-up should stop hedging.

## Claims (1–6): status, evidence, impact on plan, fix

### Claim 1 — "LiveActivityIntent (Stop) система выполняет в процессе приложения"
**Status: CONFIRMED.**
- Apple, `LiveActivityIntent`: «When the system performs the intent, the system launches your app process without opening the app, performs the intent, and starts the Live Activity.» — https://developer.apple.com/documentation/appintents/liveactivityintent (iOS 17.0+).
- Apple, «Adding interactivity to widgets and Live Activities»: «By default, the system runs the app intent in the same process as the widget extension. However, if the app intent's `openAppWhenRun` property is true, or if the intent conforms to `LiveActivityIntent`, `AudioRecordingIntent`, … the system performs the app intent in the app's process.» and **«If you adopt the `LiveActivityIntent` protocol, add your custom app intent to your widget extension target and your app target.»** — https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities
- `AudioRecordingIntent` (iOS 18.0+): «you must start a Live Activity when you begin the audio recording and keep it active as long as you record audio. If you don't start a Live Activity, the audio recording stops.» — https://developer.apple.com/documentation/appintents/audiorecordingintent
- Impact: Task 9 Step 0's «флаг доходит напрямую в плагин; App Group не обязателен» is right. But Task 9 says the widget target «Rust не линкует (только SwiftUI-рендер) → без preBuildScripts» and puts `StopDictationIntent` only in `crates/tauri-plugin-voxis/ios/Sources/` — the intent *type* must also be a source of the widget-extension target (target membership / shared file), otherwise the button in the Live Activity cannot reference it.
- Fix: in Task 9 Files/Steps add «`StopDictationIntent.swift` компилируется в оба таргета (app через SwiftPM плагина, widget через `sources:` папку расширения); либо `AppIntentsPackage` (iOS 17+, https://developer.apple.com/documentation/appintents/appintentspackage) если интент живёт в пакете плагина — хост объявляет `struct HostPackage: AppIntentsPackage { includedPackages = [VoxisIntentsPackage.self] }`». Also note: if the app is *suspended* when Stop is tapped, the system launches/resumes it in background to run `perform()`; the plugin's stop path must therefore not depend on the WebView/JS being alive — go Swift → Rust directly (Rust-side `Channel`/closure), not via JS event.

### Claim 2 — Live Activity start only from foreground; `UIBackgroundModes: audio` keeps recording alive
**Status: CONFIRMED (foreground-start rule); PARTIALLY CONFIRMED / UNVERIFIABLE-ON-DEVICE (indefinite background recording).**
- Apple ActivityKit: «You start a Live Activity in your app's code while the app is in the foreground with the `request(attributes:content:pushType:)` function… In general, your app needs to be in the foreground to start a Live Activity. You can update or end a Live Activity from your app while it runs in the background… However, you can start a Live Activity while your app is in the background by using an app intent that conforms to `LiveActivityIntent`.» — https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- `UIBackgroundModes` doc only lists the key and defers to «Configuring background execution modes» — https://developer.apple.com/documentation/bundleresources/information-property-list/uibackgroundmodes . The rule Apple applies in practice (not re-fetched in budget): background execution continues **only while the audio session is active and the engine is actually running I/O**; once the session is deactivated or interrupted and not resumed, the app is suspended within seconds.
- Interruptions (Apple «Handling audio interruptions», https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions): incoming phone call / system alerts interrupt the active session (`.began`); on `.ended` check `AVAudioSession.InterruptionOptions.shouldResume`. Also documented there: **recent iPads hardware-mute the mic when the Smart Folio cover is closed and treat it as an interruption** (option `.overrideMutedMicrophoneInterruption` to opt out) — directly relevant for the iPad stand in Task 8.5/11: a closed cover during a background run will end the recording as an interruption, not as «silence».
- Impact: Task 9 acceptance «при уходе хоста в фон запись продолжается» is achievable only if `AVAudioEngine` is running when the app backgrounds and the session stays active; Task 8's «активация/деактивация симметричны» must not deactivate on `willResignActive`. The follow-up's «держать сессию audio background mode» after a Siri/`AudioRecordingIntent` start is correct only if the *first* activation happened in foreground.
- Fix: Task 8 acceptance: add «сессия не деактивируется при `didEnterBackground`; на `.began` — финализировать запись (StreamDied → Recover), на `.ended && shouldResume` — не автоперезапускать (диктовка не музыка)»; add iPad Smart Folio case to Task 8.5 prog runs (mute-cover → interruption, not RMS-silence). Mark «indefinite background» as verify-on-device (measure how long the OS keeps the process alive with engine running, 10 min target).

### Claim 3 — `AVAudioApplication.inputMuteStateChangeNotification`
**Status: CONFIRMED (API/min version); UNVERIFIABLE-ON-DEVICE (fires for iOS 26 Dynamic Island / Control Center system mic-mute).**
- `inputMuteStateChangeNotification` — iOS 17.0 / iPadOS 17.0 / macOS 14.0 / visionOS 26.0 — https://developer.apple.com/documentation/avfaudio/avaudioapplication/inputmutestatechangenotification
- `isInputMuted` (read-only, iOS 17.0) — https://developer.apple.com/documentation/avfaudio/avaudioapplication/isinputmuted ; `setInputMuted(_:)`: «setting the value to true mutes all sources of audio input in the app… This setting is specific to your app and doesn't affect hardware mute state.» — https://developer.apple.com/documentation/avfaudio/avaudioapplication/setinputmuted(_:) ; userInfo key `muteStateKey` — https://developer.apple.com/documentation/avfaudio/avaudioapplication/mutestatekey
- The plan's key name `AVAudioApplicationMuteStateKey` is the ObjC constant; Swift is `AVAudioApplication.muteStateKey` — fine.
- Not found in budget: an Apple doc stating that the *system* mic-mute affordance in the Dynamic Island / Control Center for a recording app posts this notification. From WWDC23 «What's new in voice processing» (https://developer.apple.com/videos/play/wwdc2023/10235/) the API was introduced alongside system mute UI for voice-processing/VoIP apps; behaviour for a plain `.record` `AVAudioEngine` session on iOS 26 must be measured on the iPad stand (Task 8.5 already plans this — keep it).
- Impact/Fix: Task 8 Step 5 correct in API terms. Add explicit fallback: «если notification не приходит при системном mute — детектировать mute как RMS≈0 (не просто < SILENCE_RMS) в течение ≥ 500 мс и пометить `muted` эвристически». Set plugin minimum iOS 17 (not 16) in `Package.swift`/README because of this API (currently no min-iOS stated in Tasks 8/12).

### Claim 4 — SpeechTranscriber `supportedLocales` for ru_RU on iOS 26
**Status: REFUTED that ru_RU is in `SpeechTranscriber.supportedLocales` (settled by live probe); the plan's «нет → DictationTranscriber» is CONFIRMED.**
- Live probe on this machine, macOS 26.6.2 (25G83), `swiftc` + `Speech`:
  - `SpeechTranscriber.supportedLocales` (30): `de_AT,de_CH,de_DE,en_AU,en_CA,en_GB,en_IE,en_IN,en_NZ,en_SG,en_US,en_ZA,es_CL,es_ES,es_MX,es_US,fr_BE,fr_CA,fr_CH,fr_FR,it_CH,it_IT,ja_JP,ko_KR,pt_BR,pt_PT,yue_CN,zh_CN,zh_HK,zh_TW` — **no `ru_RU`**.
  - `DictationTranscriber.supportedLocales` (54) contains `ru_RU`.
- Apple doc for `supportedLocales`: «The locales that the transcriber can transcribe into, including locales that may not be installed but are downloadable.» — https://developer.apple.com/documentation/speech/speechtranscriber/supportedlocales (Apple publishes no list; it's device-queried).
- Source of the contradiction: the 2025 beta-era list (Gubarenko, https://antongubarenko.substack.com/p/ios-26-speechanalyzer-guide) includes `ru_RU, ar_SA, he_IL, th_TH, …` — 42 locales; the release catalogue is 30. Independent 2026 production source agrees with the probe: swift-speech-lanes README — «Russian, for example, has no `SpeechTranscriber` model and must fall back to `DictationTranscriber`» — https://github.com/ivan-magda/swift-speech-lanes
- Caveat: probe is macOS 26.6, not iOS 26; Apple ships the same SpeechAnalyzer asset catalogue across 26-family OSes, but confirm once on the iPad (one-liner in Task 8.5 log).
- Fix: rewrite the follow-up bullet from «по одним данным нет» to «нет (проверено macOS 26.6.2, 2026-xx): ru → `DictationTranscriber` + `contextualStrings`»; drop the `WER 2.12 %` figure from the `DictationTranscriber` line — that figure belongs to `SpeechTranscriber` benchmarks, DictationTranscriber is the older system-dictation engine with different quality.

### Claim 5 — Tauri 2 mobile plugin bridge
**Status: CONFIRMED on all three points (from Tauri sources).**
- `run_mobile_plugin` **is blocking**: `crates/tauri/src/plugin/mobile.rs` — `let (tx, rx) = channel(); run_command(…, move |response| tx.send(response).unwrap()); let response = rx.recv().unwrap();` — https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/src/plugin/mobile.rs . It blocks the calling Rust thread until Swift calls `invoke.resolve/reject`.
- Swift side: commands are dispatched on a serial `ipcDispatchQueue` (`DispatchQueue(label: "ipc")`), **not the main thread** — `Tauri.swift` lines 24, 61 — https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/mobile/ios-api/Sources/Tauri/Tauri.swift . So a Swift command that blocks the queue blocks all other plugin commands; `stopCapture` should resolve quickly (finalize WAV header, return) and do nothing long.
- `Channel`: `Channel.send` serializes to a JSON string and calls a `@convention(c)` callback straight into Rust (`Channel.swift`, `handler(id, serialize(data))`) — https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/mobile/ios-api/Sources/Tauri/Channel.swift ; Rust registers it in a `Mutex<HashMap<u32, Channel<serde_json::Value>>>` (`ios.rs:35,58`). One FFI call + one small JSON per event: 20 events/s (plan says 4/s at 250 ms) is trivially fine. Only caveat: the Rust `Channel` forwards to JS via IPC if created from JS; create it Rust-side (`Channel::new(|msg| …)`) to keep levels inside the Rust pipeline.
- File path hand-off: the Swift plugin runs **in the same process** as Rust (static `libapp.a` linked into the app, clipshot `project.yml:119` `- framework: libapp.a`); a path under `FileManager.default.temporaryDirectory` or Caches written by Swift is readable by Rust `std::fs` without any sandbox hop. Confirmed by process model; the Tauri docs' own example returns `["path": "/path/to/photo.jpg"]` from Swift for Rust to consume — https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/develop/Plugins/develop-mobile.mdx
- Impact/Fix: Task 8 Step 3 — call `run_mobile_plugin("stop")` from a non-main / spawned-blocking thread (never from the WebView IPC main thread → deadlock risk with `ipcDispatchQueue` is low but blocking the Tauri command thread is real); state this in acceptance.

### Claim 6 — App Intents + AppShortcutsProvider via XcodeGen `sources:` + `entitlements.properties`
**Status: CONFIRMED (mechanics); REFUTED (Siri entitlement is required).**
- clipshot `gen/apple/project.yml`: app target `sources: - path: Sources` (lines 30-31; folder source, XcodeGen compiles every `.swift` under it), `entitlements: path: … properties:` (lines 83-100) with the comment «xcodegen OWNS that file and rewrites it as an empty dict on every generation». Extension target `type: app-extension` (line 174), `DEVELOPMENT_TEAM: GZL949D756` (line 220), `dependencies: - target: ClipshotShare, embed: true` (lines 114-118).
- naked `src-tauri/gen/apple/project.yml`: same shape — `sources: - path: Sources` (line 51), `entitlements: path: naked_iOS/naked_iOS.entitlements / properties:` (lines 90-92), `UIBackgroundModes:` already present (line 70). Dropping `VoxisIntents.swift` into `gen/apple/Sources/naked/` is therefore enough for compilation.
- Apple, App Shortcuts: «Include this type in your app, app extension, Swift package, or library… the shortcuts you create are available as soon as someone installs your app» — https://developer.apple.com/documentation/appintents/app-shortcuts . No entitlement mentioned. `AppShortcutsProvider` iOS 16.0+ — https://developer.apple.com/documentation/appintents/appshortcutsprovider
- Apple, `com.apple.developer.siri`: «The App Store requires the presence of this entitlement for iOS or watchOS apps containing **Intents app extensions** that handle any Siri requests other than shortcut requests.» — https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.siri . That is SiriKit (INIntent extensions), not App Intents. **App Intents / App Shortcuts do not need it.**
- Impact/Fix: Task 11b — remove «entitlement Siri включён» from acceptance and Step 1 (harmless but adds a capability review item and a provisioning-profile change); fix `Files:` — `naked_iOS/naked_iOS.entitlements` is a generated file (see Claim 6 comment), the editable artifact is `project.yml`.

## Strategic findings (max 5)
1. **naked already has a Live Activity extension target** (`~/work/naked/src-tauri/gen/apple/NakedLiveActivity/` alongside `NakedFileProvider`). Task 9 is written as «плагин даёт шаблон, хост добавляет widget-extension по инструкции». For the primary host that is wrong: add the Voxis `ActivityConfiguration` + `StopDictationIntent` **into `NakedLiveActivity`** (one widget bundle can host several `ActivityConfiguration`s); a second widget extension would duplicate signing/team/`NSExtensionPointIdentifier` work and Task 9 Step 0's «все грабли» list. Re-scope Task 9 deliverable to «Swift files + doc for adding to an existing WidgetKit extension; template only for hosts without one».
2. **`LiveActivityIntent` dual-target rule** (Claim 1): the plan's «widget не линкует Rust, без preBuildScripts» is fine, but the intent type must be in both targets or use `AppIntentsPackage`. Missing this = the Stop button compiles in the app and fails in the widget (or vice-versa) — exactly the kind of «инцидент» Step 0 tries to pre-empt.
3. **Stop-from-island while the host is suspended** must be handled Swift→Rust with no WebView dependency (Claim 1/5). The plan routes results «текст пришёл в хост после возврата» — good — but the *stop + transcription trigger* should be specified as Rust-side (`Channel::new` closure / plugin state), not a JS event, or it silently does nothing until the user re-opens the app.
4. **Russian is not in `SpeechTranscriber`** (Claim 4, probe). Any «on-device ru» roadmap item (follow-ups, `TranscriptionEngine` trait) must target `DictationTranscriber`; quality claims (WER 2.12 %) don't transfer.
5. **Minimum iOS for the plugin is 17** (Claim 3: `AVAudioApplication` 17.0; `LiveActivityIntent` 17.0; `AudioRecordingIntent` 18.0). Tasks 8/12 never state a deployment target; put `platforms: [.iOS(.v17)]` in `Package.swift` and in the README, and gate `AudioRecordingIntent` behind `#available(iOS 18, *)`.

## Tactical findings
- Task 8: iPad Smart Folio cover hardware-mutes the mic **as an interruption** (Apple «Handling audio interruptions»); add to Task 8.5 runs (distinct from the Dynamic-Island mute case, which is `inputMuteStateChangeNotification`).
- Task 8: `.playAndRecord` + `.duckOthers` — for pure dictation prefer `.record` (no output route negotiation, no speaker/receiver route flips); if haptics are wanted, `UIImpactFeedbackGenerator` works without an output audio route.
- Task 8 Step 3: `run_mobile_plugin` blocks (Claim 5) — call from `tauri::async_runtime::spawn_blocking`, keep Swift command handlers short (serial `ipcDispatchQueue`).
- Task 9 acceptance «активность завершается ≤ 1 с» — use `activity.end(content, dismissalPolicy: .immediate)`; default policy leaves the activity on Lock Screen up to 4 h.
- Task 11b: `openAppWhenRun = true` is correct for a foreground-mic start; on iOS 18+ consider `AudioRecordingIntent & LiveActivityIntent` for the background start path the follow-up describes — but the doc requires a Live Activity to be started in `perform()` or «the audio recording stops» (Claim 1), so this depends on Task 9 (annotate `Depends:`).
- Follow-up «Каталог»: `LiveActivityIntent` + Control Center control (`ControlWidget`) is iOS 18+, not 17.

## Depends:/Files: annotation errors (if any)
- Task 11b `Files:` lists `src-tauri/gen/apple/naked_iOS/naked_iOS.entitlements` — generated by xcodegen from `project.yml` (`entitlements.properties`, naked `project.yml:90-92`; clipshot comment `project.yml:84-88`). Should be `project.yml`. Also the entitlement itself is unnecessary (Claim 6).
- Task 11b: if the background-start (`AudioRecordingIntent`) variant is intended, it depends on Task 9, not only Task 11.
- Task 9 `Files:` `crates/tauri-plugin-voxis/ios/WidgetExtension/**` (template) — for naked the target already exists (`NakedLiveActivity`); Files for Task 11 should include `src-tauri/gen/apple/NakedLiveActivity/**`.
- Task 8 Step 1 reference `naked-plugin-capture/ios` exists (`~/work/naked/crates/naked-plugin-capture/ios/Sources/CapturePlugin.swift`) — OK.

## Verified-OK
- `LiveActivityIntent` runs in the app process; Stop button can reach the plugin without App Group (Claim 1).
- Live Activity start requires foreground unless started via `LiveActivityIntent` from Control Center/Siri; update/end allowed in background (Claim 2).
- `AVAudioApplication.inputMuteStateChangeNotification` / `isInputMuted` / `muteStateKey` exist, iOS 17+ (Claim 3).
- Tauri iOS bridge: `run_mobile_plugin` blocking; Swift commands on a serial non-main queue; `Channel.send` is a direct FFI callback; same-process file hand-off (Claim 5).
- XcodeGen folder `sources:` + `entitlements.properties` pattern in both clipshot and naked (Claim 6).
- The plan's explicit refusal to depend on App Group for Live Activity Stop, and its `xcodegen generate`-before-build and «xcodegen overwrites .entitlements/Info.plist» warnings, match the clipshot `project.yml` comments.

## Not verified (ran out of budget)
- Whether the iOS 26 Dynamic Island / Control Center system mic-mute posts `inputMuteStateChangeNotification` for a plain `.record` `AVAudioEngine` session (no Apple doc found; must be measured on device — Task 8.5 already plans it).
- How long iOS keeps a background `.record` session alive in practice (plan should measure; Apple gives no number).
- `SpeechTranscriber.supportedLocales` on **iOS** 26 (probe was macOS 26.6.2; catalogue expected identical).
- Whether `AppShortcutsProvider` phrases require a String Catalog for ru (`AppShortcuts.xcstrings`) — plan's Step 3 assumes yes; not checked.
- Values under naked's existing `UIBackgroundModes` (project.yml:70) — whether `audio` is already present.
- WWDC23 «Bring widgets to life» transcript was not fetched (Apple docs above cover the same rule).

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Review-only task: plan and source files untouched; only the bound report path was written. All 6 requested claims addressed in order with status and citations."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Each claim cites Apple doc URLs, Tauri source URLs, local file:line (clipshot/naked project.yml), or the reproducible swiftc probe output on macOS 26.6.2."
    }
  ],
  "changedFiles": [
    "/Users/shamash/.pi/agent/sessions/--Users-shamash-work-voxis--/subagent-artifacts/outputs/a93f3201-efdf-498e-887b-0fc2cb3c18d6/research/plugin-plan/BLIND_review_2_ios_platform.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "curl developer.apple.com/tutorials/data/documentation/{appintents/liveactivityintent,appintents/audiorecordingintent,widgetkit/adding-interactivity-to-widgets-and-live-activities,activitykit/displaying-live-data-with-live-activities,avfaudio/avaudioapplication/*,avfaudio/handling-audio-interruptions,appintents/appintentspackage,appintents/app-shortcuts,bundleresources/entitlements/com.apple.developer.siri,speech/speechtranscriber/supportedlocales}.json",
      "result": "passed",
      "summary": "Apple doc text and availability metadata extracted"
    },
    {
      "command": "curl raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/src/plugin/mobile.rs, src/ios.rs, mobile/ios-api/Sources/Tauri/{Channel,Tauri}.swift; tauri-docs develop-mobile.mdx",
      "result": "passed",
      "summary": "run_mobile_plugin blocks on rx.recv(); Swift commands on serial ipcDispatchQueue; Channel.send = FFI callback"
    },
    {
      "command": "swiftc -O st.swift && ./st (SpeechTranscriber/DictationTranscriber.supportedLocales on macOS 26.6.2)",
      "result": "passed",
      "summary": "SpeechTranscriber: 30 locales, no ru_RU; DictationTranscriber: 54 locales incl. ru_RU"
    },
    {
      "command": "grep/read ~/work/clipshot/gen/apple/project.yml; ~/work/naked/src-tauri/gen/apple/project.yml; ls ~/work/naked/src-tauri/gen/apple",
      "result": "passed",
      "summary": "sources:/entitlements.properties patterns confirmed; NakedLiveActivity target discovered"
    }
  ],
  "validationOutput": [
    "SpeechTranscriber.supportedLocales(30): de_AT,de_CH,de_DE,en_*,es_*,fr_*,it_*,ja_JP,ko_KR,pt_BR,pt_PT,yue_CN,zh_CN,zh_HK,zh_TW — no ru_RU",
    "DictationTranscriber.supportedLocales(54) has ru_RU: true",
    "tauri plugin/mobile.rs run_mobile_plugin: let response = rx.recv().unwrap(); (blocking)",
    "com.apple.developer.siri doc: required only for Intents app extensions (SiriKit), not App Intents"
  ],
  "residualRisks": [
    "System mic-mute → inputMuteStateChangeNotification behaviour for .record sessions on iOS 26 not verifiable from docs; needs device measurement",
    "SpeechTranscriber locale probe was on macOS 26.6.2, not iOS 26",
    "Background recording lifetime not quantified by Apple; must be measured"
  ],
  "noStagedFiles": true,
  "diffSummary": "No repository changes; one report file written at the bound output path.",
  "reviewFindings": [
    "blocker: plan Task 11b - com.apple.developer.siri entitlement not required for App Intents/App Shortcuts; Files: points at xcodegen-generated .entitlements instead of project.yml",
    "blocker: plan Task 9 - LiveActivityIntent must be compiled into both widget-extension and app targets (or AppIntentsPackage); not stated",
    "major: plan Task 9 - naked already has NakedLiveActivity widget-extension target; plan assumes host has none",
    "major: follow-up - Russian confirmed absent from SpeechTranscriber.supportedLocales (macOS 26.6.2 probe); use DictationTranscriber, drop WER 2.12 % claim",
    "minor: Task 8 - iPad Smart Folio mic-mute is an AVAudioSession interruption; add to test matrix; state min iOS 17"
  ],
  "manualNotes": "web_search/fetch_content tools were unavailable in this run; curl against Apple's documentation JSON API and a local swiftc probe were used instead. Soft tool budget reached at 22 calls; items in 'Not verified' were deliberately left."
}
```
