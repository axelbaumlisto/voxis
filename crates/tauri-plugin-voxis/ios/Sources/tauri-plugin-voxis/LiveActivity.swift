import ActivityKit
import AppIntents
import Foundation
import Tauri

/// Task 9a: this plugin's own copies of the two types that must cross
/// the app/widget-extension process boundary -- `Activity<Attributes>
/// .request`/`.update`/`.end` (below, called from the APP process) need
/// `VoxisActivityAttributes` compiled into *this* target
/// (`ios/Sources`, this plugin's own SwiftPM package/app target); the
/// Lock Screen/Dynamic Island Stop button's `perform()` (also always
/// run IN THE APP PROCESS, regardless of which target's copy of
/// `StopDictationIntent` the OS resolved the button through -- Apple's
/// own documented behaviour, plan `[R1-iOS C1]`) needs this app-side
/// copy's body to actually run.
///
/// Both are declared a SECOND time, near-identically, in
/// `../LiveActivityWidget/{VoxisActivityAttributes,StopDictationIntent}
/// .swift` -- the files the HOST adds to its widget-extension target
/// (`docs/PLUGIN_IOS_HOST.md`). This is not an oversight: `ActivityKit`
/// communicates `ContentState` across the process boundary by encoding/
/// decoding it (`Codable`), not by Swift type identity, and Apple's own
/// cross-process `AppIntent` resolution matches by (container app's
/// bundle id, intent type name), not by Swift module -- two
/// independently-compiled, structurally-identical copies of the same
/// named type in two different targets of the same container app are
/// recognised as "the same" by both mechanisms. Proven precedent
/// already in this monorepo's sibling host: naked's own
/// `NakedLiveActivityAttributes` is declared twice exactly this way --
/// once `private` in the app-side plugin
/// (`naked-plugin-lifecycle/ios/Sources/LifecyclePlugin.swift:95`),
/// once in the widget extension
/// (`gen/apple/NakedLiveActivity/NakedLiveActivityAttributes.swift`) --
/// with matching `ContentState` fields but otherwise unrelated code.
/// **Keep both copies of each type below structurally in sync** (same
/// field names/types for `VoxisActivityAttributes`, same type name for
/// `StopDictationIntent`) whenever either changes.
// `@available(iOS 17.0, *)` on the two declarations below (stricter
// than `ActivityAttributes`'s own 16.1 floor/`LiveActivityIntent`'s own
// 17.0 floor would technically require, but matching this package's
// real floor) works around the same SwiftPM deployment-target
// propagation quirk `AudioCapture.swift`'s own module doc already
// documents for `AVAudioApplication` ("some SwiftPM build invocations
// ... do not consistently propagate that deployment target to the
// compiler flags they pass") -- confirmed here too: `swift build`
// (invoked by `swift-rs`'s own build-script support, `build.rs`)
// rejected these two ActivityKit/AppIntents types as unavailable
// without this, even though `Package.swift` pins `platforms:
// [.iOS(.v16)]` (the 17+ types are only reachable through the guards).
// Nothing outside an `#available`-guarded block in this
// file (or anywhere else in `Sources/`) references either type
// unconditionally -- `VoxisLiveActivityBridge`'s own `activity` property
// below is deliberately typed `Any?`, not `Activity<VoxisActivityAttributes>?`,
// for the same reason (a STORED property's type is checked at
// declaration time, which an `@available` on the property alone cannot
// satisfy for a class that itself has no matching `@available`).
@available(iOS 17.0, *)
struct VoxisActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var phase: Phase
        var startedAt: Date
        var elapsedSeconds: Int?
        var peak: Double
    }

    enum Phase: String, Codable, Hashable {
        case recording
        case transcribing
        case idle
    }
}

/// See `VoxisActivityAttributes`'s doc above for why this is declared a
/// second time in `../LiveActivityWidget/StopDictationIntent.swift` --
/// this copy is the one whose `perform()` body actually executes (the
/// widget-extension's own copy only needs to exist so
/// `VoxisActivityView.swift`'s `Button(intent: StopDictationIntent())`
/// has something to construct at UI-build time in that process; its
/// `perform()` is never the one that runs).
@available(iOS 17.0, *)
struct StopDictationIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop dictation"
    static var description = IntentDescription("Stops the active Voxis dictation session.")

    @MainActor
    func perform() async throws -> some IntentResult {
        VoxisLiveActivityBridge.shared?.stopRequestedByIntent()
        return .result()
    }
}

/// App-process Live Activity controller (Task 9a). Drives `ActivityKit`
/// from three Rust-called commands (`VoxisPlugin.liveActivityStart`/
/// `liveActivityUpdate`/`liveActivityEnd`, dispatched from
/// `mobile::LiveActivityController` on the Rust side via
/// `LiveActivityEventSink`'s mirror of `voxis://state`/`voxis://level`),
/// and receives the Lock Screen/Dynamic Island Stop button's intent
/// (`StopDictationIntent` above) through `stopRequestedByIntent()`.
///
/// Every ActivityKit call in this file is wrapped so it can never throw
/// into the pipeline (Task 9a acceptance #2): `#available(iOS 16.2, *)`
/// gates the API surface itself (`ActivityKit`'s own floor for
/// `Activity.request`/`update`/`end` with `ActivityContent`; already
/// below this package's `Package.swift` floor of iOS 17, so this check
/// is always true at runtime today -- kept explicit anyway, same
/// defensive style `AudioCapture.swift`'s own `#available` checks use
/// around `AVAudioApplication`, since not every SwiftPM build invocation
/// reliably propagates the deployment target to the compiler), and
/// `ActivityAuthorizationInfo().areActivitiesEnabled` covers the cases
/// where the *host* hasn't declared `NSSupportsLiveActivities` or the
/// user has disabled Live Activities system-wide -- `Activity.request`
/// throws in both cases rather than silently no-oping, so `start()`
/// always wraps it in `do`/`catch` and only ever logs.
final class VoxisLiveActivityBridge {
    /// Set once, in `VoxisPlugin.init` -- the one instance this app
    /// process ever creates. `StopDictationIntent.perform()` reaches
    /// this through the shared instance rather than any Tauri plugin
    /// registry: `LiveActivityIntent.perform()` runs IN THE APP PROCESS
    /// (Apple's own documented behaviour, plan `[R1-iOS C1]`) but has no
    /// other handle on the running `VoxisPlugin`/`Invoke` machinery to
    /// go through.
    static var shared: VoxisLiveActivityBridge?

    private let queue = DispatchQueue(label: "top.voxis.plugin.liveactivity")

    /// Set once by `registerIntentChannel` (`VoxisPlugin.swift`'s command
    /// of the same name, called from Rust's `mobile.rs::
    /// LiveActivityController::register_intent_channel` exactly once, in
    /// this plugin's own `setup` hook) -- the Rust-created `Channel`
    /// `stopRequestedByIntent` forwards `{"action": "stop"}` through.
    /// `nil` until that command has run once; a Stop tap before then
    /// (should not happen in practice -- the Live Activity itself is
    /// only ever started after `setup` has completed) only logs.
    private var onIntent: Channel?

    /// `Any?`, not `Activity<VoxisActivityAttributes>?` -- see the note
    /// above `VoxisActivityAttributes`'s own declaration for why a
    /// stored property cannot use the versioned generic type directly
    /// without the whole class also being `@available`-gated (which
    /// would then force every `VoxisPlugin.swift` call site that touches
    /// this class to be gated too). Cast back with `as?` inside each
    /// `#available(iOS 17.0, *)`-guarded method below.
    private var activity: Any?

    // MARK: - Rust -> Swift (driven by `voxis://state`/`voxis://level`)

    func registerIntentChannel(_ channel: Channel) {
        queue.async { self.onIntent = channel }
    }

    func start(startedAt: Date) {
        queue.async {
            guard self.activity == nil else { return }
            guard #available(iOS 17.0, *) else {
                NSLog("[voxis] Live Activity unavailable (iOS < 17.0) -- continuing without one, no error")
                return
            }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                NSLog("[voxis] Live Activities disabled (user setting or host is missing NSSupportsLiveActivities) -- continuing without one, no error")
                return
            }
            let state = VoxisActivityAttributes.ContentState(phase: .recording, startedAt: startedAt, elapsedSeconds: nil, peak: 0)
            do {
                self.activity = try Activity.request(
                    attributes: VoxisActivityAttributes(),
                    content: .init(state: state, staleDate: nil)
                )
            } catch {
                NSLog("[voxis] Activity.request failed -- continuing without a Live Activity: \(error)")
            }
        }
    }

    /// `phaseRaw` is `VoxisActivityAttributes.Phase`'s raw string value
    /// (`"recording"`/`"transcribing"`/`"idle"`), not the enum itself --
    /// keeps every OTHER file in `Sources/` (`VoxisPlugin.swift`'s
    /// `liveActivityUpdate` handler) from ever needing to reference the
    /// `@available`-gated `VoxisActivityAttributes` type at all; the
    /// `rawValue` -> `Phase` conversion happens here, already inside this
    /// method's own `#available` guard.
    func update(phaseRaw: String, elapsedSeconds: Int?, peak: Double) {
        queue.async {
            guard #available(iOS 17.0, *), let activity = self.activity as? Activity<VoxisActivityAttributes> else { return }
            let phase = VoxisActivityAttributes.Phase(rawValue: phaseRaw) ?? .recording
            let startedAt = activity.content.state.startedAt
            let state = VoxisActivityAttributes.ContentState(phase: phase, startedAt: startedAt, elapsedSeconds: elapsedSeconds, peak: peak)
            Task {
                await activity.update(.init(state: state, staleDate: nil))
            }
        }
    }

    /// `dismissalPolicy: .immediate` (Task 9a acceptance #2: the activity
    /// must end within ~1s of `stop`/`cancel`) -- the `ActivityKit`
    /// default, left unspecified, keeps a finished activity on the Lock
    /// Screen for up to 4h, which would misrepresent a dictation that
    /// has already ended as still "recording" (or even just "just
    /// finished") long after the fact.
    func end() {
        queue.async {
            guard #available(iOS 17.0, *), let activity = self.activity as? Activity<VoxisActivityAttributes> else { return }
            self.activity = nil
            let finalState = activity.content.state
            Task {
                await activity.end(.init(state: finalState, staleDate: nil), dismissalPolicy: .immediate)
            }
        }
    }

    // MARK: - Swift -> Rust (the Lock Screen/Dynamic Island Stop button)

    /// Called by `StopDictationIntent.perform()` above, in this app
    /// process. Never throws -- an `AppIntent.perform()` failure
    /// surfaces to the user as "the button did nothing" at best, a
    /// system error banner at worst; forwarding to Rust is best-effort
    /// only, same convention as every `mobile::LiveActivityController`
    /// call in the other direction.
    func stopRequestedByIntent() {
        queue.async {
            guard let channel = self.onIntent else {
                NSLog("[voxis] StopDictationIntent fired before registerIntentChannel ran -- dropped")
                return
            }
            channel.send(.dictionary(["action": "stop"]))
        }
    }
}
