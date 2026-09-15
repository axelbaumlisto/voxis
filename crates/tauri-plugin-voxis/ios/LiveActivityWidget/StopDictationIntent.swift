import AppIntents

/// Widget-extension copy of this type -- see `../Sources/
/// LiveActivity.swift`'s doc comment above its own copy of
/// `StopDictationIntent` for the full explanation. This copy's own
/// `perform()` body is never the one that actually runs: Apple
/// documents `LiveActivityIntent.perform()` as always executing IN THE
/// APP PROCESS (plan `[R1-iOS C1]`), regardless of which target's
/// compiled copy of the type the OS resolved the tapped button through.
/// This copy exists purely so `VoxisActivityView.swift`'s
/// `Button(intent: StopDictationIntent())` has something to construct
/// at UI-build time in THIS (the widget-extension's) process -- the
/// body below is intentionally a harmless no-op, not a second path to
/// Rust.
///
/// **This file is NOT part of `tauri-plugin-voxis`'s own SwiftPM
/// package** -- see `VoxisActivityAttributes.swift`'s own doc comment in
/// this same directory for why, and what the host does with it.
///
/// **`title`/type name must stay in sync** with `../Sources/
/// LiveActivity.swift`'s copy -- Apple's cross-process `AppIntent`
/// resolution matches by (container app's bundle id, intent type name),
/// not by Swift module, so renaming only one copy breaks the button
/// silently (it still renders; tapping it does nothing, because the
/// app-side copy the OS actually tries to run no longer has a matching
/// name).
///
/// `@available(iOS 17.0, *)` mirrors `../Sources/LiveActivity.swift`'s
/// copy -- `LiveActivityIntent` itself is an iOS 17.0+ protocol (unlike
/// `ActivityAttributes`, which only needs 16.1), so this type cannot
/// compile unguarded in a widget-extension target whose
/// `deploymentTarget` is below 17.0 (e.g. naked's existing
/// `NakedLiveActivity` target, pinned at 16.1 -- `docs/
/// PLUGIN_IOS_HOST.md`'s naked walkthrough, "step 0"). Any file in
/// this directory that references this type (`VoxisActivityView.swift`'s
/// `Button(intent: StopDictationIntent())`) must itself be guarded the
/// same way.
@available(iOS 17.0, *)
struct StopDictationIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop dictation"
    static var description = IntentDescription("Stops the active Voxis dictation session.")

    @MainActor
    func perform() async throws -> some IntentResult {
        .result()
    }
}
