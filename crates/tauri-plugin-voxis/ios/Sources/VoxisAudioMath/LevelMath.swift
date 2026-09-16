import Foundation

/// Pure, `AVAudioEngine`-free numeric rules shared by `AudioCapture.swift`'s
/// tap/level-tick pipeline -- lifted out (BLIND_SDK_swift.md finding #2/#3)
/// so they can be asserted against the SAME fixture numbers
/// `crates/tauri-plugin-voxis/src/desktop/pure.rs`'s own `#[test]`s use,
/// via this module's sibling `Tests/tauri-plugin-voxisTests` target. This
/// type (and `WindowPeakAccumulator`/`WavWriter` alongside it) lives in the
/// `VoxisAudioMath` library target specifically because it has NO `import
/// Tauri` -- the main `tauri-plugin-voxis` target does, and `swift test`
/// cannot link that target's Tauri dependency on a plain macOS host, so
/// the pure math needed its own Tauri-free target to be testable at all.
public enum LevelMath {
    /// Desktop's own near-silent/mute-heuristic threshold
    /// (`AudioCapture.swift`'s previous inline `nearSilentThreshold`) --
    /// pulled out as a default parameter here so the constant has exactly
    /// one home instead of living only as a magic number at the call site.
    public static let defaultNearSilentThreshold: Float = 0.0005

    /// Peak RMS over `subChunkSeconds`-sized sub-chunks of an
    /// already-converted mono `Float32` buffer (Task 8 acceptance #1:
    /// "max over 10 ms sub-chunks, mirroring desktop's own
    /// `WindowPeakAccumulator`"). Desktop's `accumulate_capped` computes
    /// one RMS per whole native-device chunk and folds it into its own
    /// `WindowPeakAccumulator` via `observe`; iOS re-chunks the
    /// already-16kHz signal into fixed 10 ms windows first (its tap
    /// buffer size varies by device/route) and returns the max RMS across
    /// those windows -- the single number this function returns is what
    /// the caller then feeds into ITS `WindowPeakAccumulator.observe`
    /// (once, not per sub-chunk: `observe`'s own max-fold makes observing
    /// this pre-reduced peak once equivalent to observing every sub-chunk
    /// RMS individually).
    public static func subChunkPeakRMS(_ chunk: [Float], sampleRate: Double, subChunkSeconds: Double = 0.010) -> Float {
        guard !chunk.isEmpty else { return 0 }
        let subChunkSamples = max(1, Int(sampleRate * subChunkSeconds))
        var index = 0
        var peak: Float = 0
        while index < chunk.count {
            let end = min(index + subChunkSamples, chunk.count)
            let sub = chunk[index..<end]
            let sumSquares = sub.reduce(Float(0)) { $0 + $1 * $1 }
            let rms = (sumSquares / Float(sub.count)).squareRoot()
            peak = max(peak, rms)
            index = end
        }
        return peak
    }

    /// Self-cap slicing (`[R1-Arch S2]`) -- the SAME semantics as
    /// desktop's `accumulate_capped`/`MockCapture`'s own self-cap: stop
    /// appending once `capSamples` (already expressed at 16kHz, same rate
    /// this buffer is already at -- no `scale_cap_samples`-style rescale
    /// needed on this side of the bridge, `mobile.rs`'s own doc on
    /// `IosCapture::start`) is reached, independent of anything above it.
    /// Returns the slice of `chunk` the caller should actually append
    /// (never more than `capSamples - existingCount`) and whether this
    /// call reached/exceeded the cap.
    public static func selfCapSlice(existingCount: Int, chunk: [Float], capSamples: Int) -> (toAppend: ArraySlice<Float>, hit: Bool) {
        guard existingCount + chunk.count >= capSamples else {
            return (chunk[...], false)
        }
        let remaining = capSamples - existingCount
        let slice = remaining > 0 ? chunk.prefix(remaining) : chunk.prefix(0)
        return (slice, true)
    }

    /// Advances the 2-consecutive-window near-silent counter
    /// (`[R1-iOS C3]`'s fallback mute heuristic): resets to 0 whenever the
    /// heuristic isn't `eligible` yet (no real tap buffer processed this
    /// session, `sawAudio`'s own doc in `AudioCapture.swift`) or the
    /// window's peak is at/above `threshold`; otherwise increments.
    public static func advanceNearSilentWindowCount(
        current: Int,
        peak: Float,
        eligible: Bool,
        threshold: Float = defaultNearSilentThreshold
    ) -> Int {
        guard eligible, peak < threshold else { return 0 }
        return current + 1
    }

    /// The 2-window rule itself: `true` once
    /// `advanceNearSilentWindowCount` has returned >= 2 while still
    /// `eligible` -- >= 500ms of near-zero RMS at the 250ms tick cadence.
    public static func muteHeuristicTriggered(consecutiveNearSilentWindows: Int, eligible: Bool) -> Bool {
        eligible && consecutiveNearSilentWindows >= 2
    }
}

/// Tracks the peak (not average) RMS observed since the last
/// `takePeak()` -- Swift-side mirror of desktop's own
/// `WindowPeakAccumulator` (`crates/tauri-plugin-voxis/src/desktop/pure.rs`):
/// `observe` folds each reading in via `max`, `takePeak` drains and
/// resets to 0. `NSLock`-guarded because `observe` runs on the capture
/// queue (tap callbacks) while `takePeak` runs on the same queue's timer
/// -- serialized in practice (both hop through `queue`), but the lock
/// keeps this type correct even if that changes.
public final class WindowPeakAccumulator {
    private var peak: Float = 0
    private let lock = NSLock()

    public init() {}

    public func observe(_ rms: Float) {
        lock.lock()
        defer { lock.unlock() }
        peak = max(peak, rms)
    }

    public func takePeak() -> Float {
        lock.lock()
        defer { lock.unlock() }
        let value = peak
        peak = 0
        return value
    }
}
