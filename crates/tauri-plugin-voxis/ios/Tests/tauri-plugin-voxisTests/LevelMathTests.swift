import XCTest
@testable import VoxisAudioMath

/// S2 (BLIND_SDK_swift.md finding #2): asserts `LevelMath`/
/// `WindowPeakAccumulator` (extracted from `AudioCapture.swift`) against
/// the SAME fixture numbers `crates/tauri-plugin-voxis/src/desktop/pure.rs`'s
/// own `#[test]`s use for the equivalent desktop-side pure functions
/// (`accumulate_capped`, `WindowPeakAccumulator`), so both backends are
/// verified against one shared set of expected numbers even though they
/// live in different languages/targets. Lives in `tauri-plugin-voxisTests`
/// (a `.testTarget` depending only on the Tauri-free `VoxisAudioMath`
/// library target) so `swift test` runs on a plain macOS host, no
/// device/simulator/Tauri host app required.
final class LevelMathTests: XCTestCase {
    // MARK: - subChunkPeakRMS
    // Mirrors `pure.rs`'s `accumulate_capped` RMS fixtures: with a
    // `subChunkSeconds` wide enough that the whole fixture chunk is a
    // single sub-chunk, `subChunkPeakRMS` reduces to a plain whole-chunk
    // RMS -- the same number `accumulate_capped` returns for these exact
    // sample vectors.

    func testSubChunkPeakRMSMatchesAccumulateCappedRMSForAlternatingHalfAmplitude() {
        // pure.rs::accumulate_capped_appends_below_cap_without_hitting:
        // rms of [0.5, -0.5, 0.5, -0.5] is 0.5.
        let chunk: [Float] = [0.5, -0.5, 0.5, -0.5]
        let rms = LevelMath.subChunkPeakRMS(chunk, sampleRate: 16_000, subChunkSeconds: 1.0)
        XCTAssertEqual(rms, 0.5, accuracy: 1e-6)
    }

    func testSubChunkPeakRMSMatchesAccumulateCappedRMSForAllOnes() {
        // pure.rs::accumulate_capped_rms_still_computed_once_cap_is_hit:
        // rms of an all-1.0 chunk is 1.0, computed regardless of any cap.
        let chunk: [Float] = [1.0, 1.0]
        let rms = LevelMath.subChunkPeakRMS(chunk, sampleRate: 16_000, subChunkSeconds: 1.0)
        XCTAssertEqual(rms, 1.0, accuracy: 1e-6)
    }

    func testSubChunkPeakRMSEmptyChunkIsZero() {
        XCTAssertEqual(LevelMath.subChunkPeakRMS([], sampleRate: 16_000), 0)
    }

    func testSubChunkPeakRMSTakesMaxAcrossSubChunksNotAverage() {
        // 20ms of silence followed by 20ms at full scale, split into two
        // 10ms sub-chunks at a 1000Hz sample rate (10 samples/sub-chunk):
        // the peak must be the loud sub-chunk's RMS (1.0), not an average
        // that would wash it down towards 0.5.
        let silence = [Float](repeating: 0, count: 10)
        let loud = [Float](repeating: 1.0, count: 10)
        let rms = LevelMath.subChunkPeakRMS(silence + loud, sampleRate: 1000, subChunkSeconds: 0.010)
        XCTAssertEqual(rms, 1.0, accuracy: 1e-6)
    }

    // MARK: - selfCapSlice
    // Same self-cap semantics as `pure.rs`'s `accumulate_capped`: the
    // fixtures below reuse that function's own buffer/chunk/cap numbers
    // and assert the same resulting "how much got appended" / "did this
    // call hit the cap" outcome, translated to `selfCapSlice`'s
    // existingCount/toAppend/hit shape.

    func testSelfCapSliceAppendsWholeChunkBelowCapWithoutHitting() {
        // pure.rs::accumulate_capped_appends_below_cap_without_hitting:
        // empty buffer + 4-sample chunk against cap 10 -> all 4 appended, no hit.
        let (toAppend, hit) = LevelMath.selfCapSlice(existingCount: 0, chunk: [0.5, -0.5, 0.5, -0.5], capSamples: 10)
        XCTAssertEqual(Array(toAppend), [0.5, -0.5, 0.5, -0.5])
        XCTAssertFalse(hit)
    }

    func testSelfCapSliceStopsGrowingPastTheCapAndReportsHit() {
        // pure.rs::accumulate_capped_stops_growing_past_the_cap_and_reports_hit:
        // 3 already buffered + [1,1,1] against cap 4 -> only 1 more sample
        // appended (buffer reaches exactly 4), hit reported.
        let (toAppend, hit) = LevelMath.selfCapSlice(existingCount: 3, chunk: [1.0, 1.0, 1.0], capSamples: 4)
        XCTAssertEqual(Array(toAppend), [1.0])
        XCTAssertTrue(hit)
        XCTAssertEqual(3 + toAppend.count, 4, "must stop at exactly the cap, not grow past it")
    }

    func testSelfCapSliceNoHitWhenChunkKeepsBufferBelowCap() {
        // pure.rs::accumulate_capped_no_hit_when_buffer_already_below_cap_after_chunk
        let (toAppend, hit) = LevelMath.selfCapSlice(existingCount: 0, chunk: [0.1, 0.2], capSamples: 10)
        XCTAssertEqual(Array(toAppend), [0.1, 0.2])
        XCTAssertFalse(hit)
    }

    func testSelfCapSliceAppendsNothingOnceAlreadyAtCap() {
        // pure.rs::accumulate_capped_rms_still_computed_once_cap_is_hit:
        // already at cap (existingCount == capSamples) before this chunk
        // arrives -- nothing more gets appended, but hit is still reported.
        let (toAppend, hit) = LevelMath.selfCapSlice(existingCount: 2, chunk: [1.0, 1.0], capSamples: 2)
        XCTAssertEqual(toAppend.count, 0, "already at cap before this chunk arrived -- nothing more buffered")
        XCTAssertTrue(hit)
    }

    // MARK: - WindowPeakAccumulator
    // Swift-side mirror of `pure.rs`'s `WindowPeakAccumulator` -- same
    // observe-folds-via-max / take-drains-and-resets contract, asserted
    // against that type's own fixture numbers.

    func testWindowPeakAccumulatorTracksTheMaxNotTheLast() {
        // pure.rs::window_peak_accumulator_tracks_the_max_not_the_last
        let acc = WindowPeakAccumulator()
        acc.observe(0.1)
        acc.observe(0.9)
        acc.observe(0.3)
        XCTAssertEqual(acc.takePeak(), 0.9, accuracy: 1e-6)
    }

    func testWindowPeakAccumulatorResetsAfterTake() {
        // pure.rs::window_peak_accumulator_resets_after_take
        let acc = WindowPeakAccumulator()
        acc.observe(0.7)
        _ = acc.takePeak()
        XCTAssertEqual(acc.takePeak(), 0, "takePeak must reset to 0 for the next window")
    }

    // MARK: - near-silent / mute heuristic (iOS-only, no desktop
    // equivalent fixture -- `[R1-iOS C3]`'s own 2-window/threshold rule).

    func testAdvanceNearSilentWindowCountResetsWhenNotEligible() {
        XCTAssertEqual(LevelMath.advanceNearSilentWindowCount(current: 1, peak: 0, eligible: false), 0)
    }

    func testAdvanceNearSilentWindowCountResetsWhenPeakAtOrAboveThreshold() {
        let count = LevelMath.advanceNearSilentWindowCount(
            current: 1,
            peak: LevelMath.defaultNearSilentThreshold,
            eligible: true
        )
        XCTAssertEqual(count, 0, "at/above threshold resets, matching the doc's exclusive '< threshold' condition")
    }

    func testAdvanceNearSilentWindowCountIncrementsBelowThresholdWhileEligible() {
        let count = LevelMath.advanceNearSilentWindowCount(current: 1, peak: 0, eligible: true)
        XCTAssertEqual(count, 2)
    }

    func testMuteHeuristicNotTriggeredBelowTwoWindows() {
        XCTAssertFalse(LevelMath.muteHeuristicTriggered(consecutiveNearSilentWindows: 1, eligible: true))
    }

    func testMuteHeuristicTriggeredAtTwoConsecutiveWindows() {
        XCTAssertTrue(LevelMath.muteHeuristicTriggered(consecutiveNearSilentWindows: 2, eligible: true))
    }

    func testMuteHeuristicNeverTriggeredWhenNotEligible() {
        XCTAssertFalse(LevelMath.muteHeuristicTriggered(consecutiveNearSilentWindows: 5, eligible: false))
    }
}
