import XCTest
@testable import VoxisAudioMath

/// The fixture decoder must round-trip what `WavWriter.encode` writes and
/// refuse every other shape — the same contract `AudioMathTest.kt` pins for
/// the Kotlin mirror.
final class FixtureWavTests: XCTestCase {
    func testRoundTripsWavWriterOutput() {
        let samples: [Float] = [0, 0.5, -0.5, 0.999, -1.0, 0.25]
        let wav = WavWriter.encode(samples: samples, sampleRate: FixtureWav.sampleRate)
        let decoded = FixtureWav.decodePCM16Mono16k(wav)
        XCTAssertNotNil(decoded)
        XCTAssertEqual(decoded!.count, samples.count)
        for (a, b) in zip(decoded!, samples) {
            XCTAssertEqual(a, b, accuracy: 1.0 / 32767.0)
        }
    }

    func testRejectsOtherSampleRates() {
        let wav = WavWriter.encode(samples: [0.1, 0.2], sampleRate: 44_100)
        XCTAssertNil(FixtureWav.decodePCM16Mono16k(wav))
    }

    func testRejectsTruncatedHeaderAndNonRiff() {
        XCTAssertNil(FixtureWav.decodePCM16Mono16k(Data([UInt8](repeating: 0, count: 10))))
        var junk = WavWriter.encode(samples: [0.1], sampleRate: FixtureWav.sampleRate)
        junk.replaceSubrange(0..<4, with: "JUNK".data(using: .ascii)!)
        XCTAssertNil(FixtureWav.decodePCM16Mono16k(junk))
    }

    func testEmptyDataChunkDecodesToNoSamples() {
        let wav = WavWriter.encode(samples: [], sampleRate: FixtureWav.sampleRate)
        XCTAssertEqual(FixtureWav.decodePCM16Mono16k(wav)?.count, 0)
    }
}
