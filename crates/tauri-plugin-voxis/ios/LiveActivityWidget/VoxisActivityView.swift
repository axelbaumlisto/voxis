import ActivityKit
import SwiftUI
import WidgetKit

/// The `Widget` the HOST adds to its own **existing** `WidgetBundle`
/// (e.g. naked's `NakedLiveActivityBundle.body`, `src-tauri/gen/apple/
/// NakedLiveActivity/NakedLiveActivityWidget.swift`) -- `docs/
/// PLUGIN_IOS_HOST.md`'s integration steps. Deliberately not `@main`
/// itself: exactly one `@main WidgetBundle` per extension target, and
/// the host already owns that entry point (a host with no existing
/// Live Activity widget target at all creates one per that same doc,
/// where this type becomes the ONLY entry in a fresh `WidgetBundle`).
///
/// **This file is NOT part of `tauri-plugin-voxis`'s own SwiftPM
/// package** -- see `VoxisActivityAttributes.swift`'s own doc comment in
/// this same directory.
///
/// `@available(iOS 17.0, *)` on every declaration in this file --
/// `Button(intent: StopDictationIntent())` below and `StopDictationIntent`
/// itself are both iOS 17.0+ APIs, and every other type here touches
/// `VoxisActivityAttributes`, which is gated the same way (its own doc
/// comment). A host whose widget-extension target has a lower
/// `deploymentTarget` (naked's own `NakedLiveActivity`, pinned at 16.1)
/// must only ever construct `VoxisActivityWidget()` from inside an
/// `if #available(iOS 17.0, *)` check in its own `WidgetBundle.body` --
/// `docs/PLUGIN_IOS_HOST.md`'s naked walkthrough, "step 0", verifies
/// this pattern typechecks at both -target arm64-apple-ios16.1-simulator
/// and -target arm64-apple-ios17.0-simulator.
@available(iOS 17.0, *)
struct VoxisActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: VoxisActivityAttributes.self) { context in
            VoxisActivityLockScreenView(state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.85))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VoxisActivityIcon(phase: context.state.phase)
                        .font(.title2)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VoxisActivityTimer(state: context.state)
                        .font(.title3.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Button(intent: StopDictationIntent()) {
                        Label("Stop", systemImage: "stop.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .tint(.red)
                }
            } compactLeading: {
                VoxisActivityIcon(phase: context.state.phase)
            } compactTrailing: {
                VoxisActivityTimer(state: context.state)
                    .font(.caption2.monospacedDigit())
            } minimal: {
                VoxisActivityIcon(phase: context.state.phase)
            }
        }
    }
}

@available(iOS 17.0, *)
private struct VoxisActivityIcon: View {
    let phase: VoxisActivityAttributes.Phase

    var body: some View {
        Image(systemName: phase == .transcribing ? "waveform" : "mic.fill")
            .foregroundStyle(phase == .transcribing ? Color.blue : Color.red)
            .accessibilityHidden(true)
    }
}

/// `Text(_:style: .timer)` auto-updates on-device with no further
/// content pushes from the app while `phase == .recording` -- pushing a
/// fresh `elapsedSeconds` every tick would burn `ActivityKit`'s own
/// update budget for no visual benefit (`LiveActivityEventSink`'s own
/// doc, `lib.rs`, throttles pushes to >= 1s apart for exactly this
/// reason: the ticking display itself needs none of them). Once
/// `phase != .recording`, `elapsedSeconds` (frozen at the moment
/// `Transcribing` began, `VoxisLiveActivityBridge.update`'s own caller,
/// `lib.rs`'s `LiveActivityEventSink`) is shown as a static `mm:ss`
/// instead -- there is nothing left counting up.
@available(iOS 17.0, *)
private struct VoxisActivityTimer: View {
    let state: VoxisActivityAttributes.ContentState

    var body: some View {
        if state.phase == .recording {
            Text(state.startedAt, style: .timer)
                .frame(minWidth: 40)
        } else {
            Text(elapsedLabel)
        }
    }

    private var elapsedLabel: String {
        guard let seconds = state.elapsedSeconds else { return "--:--" }
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

@available(iOS 17.0, *)
private struct VoxisActivityLockScreenView: View {
    let state: VoxisActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 14) {
            VoxisActivityIcon(phase: state.phase)
                .font(.title2)

            VStack(alignment: .leading, spacing: 4) {
                Text("Voxis dictation")
                    .font(.headline)
                    .foregroundStyle(.white)
                Text(phaseLabel)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.78))
            }

            Spacer(minLength: 12)

            VoxisActivityTimer(state: state)
                .font(.title3.monospacedDigit())
                .foregroundStyle(.white)

            Button(intent: StopDictationIntent()) {
                Label("Stop", systemImage: "stop.fill")
            }
            .tint(.red)
            .buttonStyle(.bordered)
        }
        // Same 16pt horizontal inset naked's own Lock Screen view uses
        // (`NakedLiveActivityLockScreenView`'s own comment, "the system
        // draws the card, not its insets") -- every stock Live Activity
        // uses this inset; without it content sits flush against the
        // card's rounded corners.
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Voxis dictation, \(phaseLabel)")
    }

    private var phaseLabel: String {
        switch state.phase {
        case .recording: return "Recording"
        case .transcribing: return "Transcribing…"
        case .idle: return "Idle"
        }
    }
}
