import ActivityKit
import Foundation

/// Widget-extension copy of this type -- see
/// `../Sources/LiveActivity.swift`'s doc comment above its own copy of
/// `VoxisActivityAttributes` for why this exists twice (once here, once
/// there) and why that is correct, not accidental duplication to clean
/// up. **This file is NOT part of `tauri-plugin-voxis`'s own SwiftPM
/// package** (`Package.swift`'s target only globs `../Sources/`) --
/// it, and its two siblings in this directory, are what the HOST adds
/// to its own widget-extension target's `sources:` (`docs/
/// PLUGIN_IOS_HOST.md`'s integration steps; naked's own
/// `NakedLiveActivity` extension target,
/// `src-tauri/gen/apple/project.yml:254-261`, is the worked example).
///
/// Field names/types here **must stay in sync** with `../Sources/
/// LiveActivity.swift`'s copy -- `ActivityKit` round-trips `ContentState`
/// across the app/extension process boundary by `Codable` encode/decode,
/// not Swift type identity, so a drift here (a renamed/retyped field)
/// silently breaks decoding on whichever side didn't get the change,
/// not a compile error on either side.
///
/// `@available(iOS 17.0, *)` mirrors `../Sources/LiveActivity.swift`'s
/// copy -- `ActivityAttributes` itself only needs iOS 16.1, but this
/// copy is gated at 17.0 anyway to stay identical to the app-side copy
/// and because every other declaration in this directory that touches
/// it (`StopDictationIntent.swift`'s own copy, `VoxisActivityView.swift`'s
/// `VoxisActivityWidget`/`VoxisActivityIcon`/`VoxisActivityTimer`/
/// `VoxisActivityLockScreenView`) is itself a genuine 17.0+ API
/// (`LiveActivityIntent`, `Button(intent:)`) -- see `docs/
/// PLUGIN_IOS_HOST.md`'s naked walkthrough, "step 0", for what a host
/// whose widget-extension target is below 17.0 (naked's own
/// `NakedLiveActivity`, pinned at 16.1) needs to do instead.
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
