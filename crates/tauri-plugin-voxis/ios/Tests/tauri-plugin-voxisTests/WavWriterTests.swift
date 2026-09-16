import XCTest
@testable import VoxisAudioMath

/// S2 (BLIND_SDK_swift.md finding #2): `WavWriter.encode` asserted
/// byte-for-byte against `voxis_core::audio_wav::samples_to_wav`'s own
/// `#[test]` fixtures (`crates/voxis-core/src/audio_wav.rs`) -- same
/// mono/PCM16/44-byte-header `hound::WavSpec` shape, same
/// `(sample * 32767.0).clamp(-32768.0, 32767.0)` conversion. Replaces
/// the previous `WavWriter.selfCheck` ad-hoc runtime check with a real
/// XCTest that runs on every `swift test`, no device/simulator required
/// (this type lives in the Tauri-free `VoxisAudioMath` target).
final class WavWriterTests: XCTestCase {
    private func le16(_ data: Data, _ offset: Int) -> UInt16 {
        UInt16(data[data.startIndex + offset]) | (UInt16(data[data.startIndex + offset + 1]) << 8)
    }

    private func le32(_ data: Data, _ offset: Int) -> UInt32 {
        UInt32(data[data.startIndex + offset])
            | (UInt32(data[data.startIndex + offset + 1]) << 8)
            | (UInt32(data[data.startIndex + offset + 2]) << 16)
            | (UInt32(data[data.startIndex + offset + 3]) << 24)
    }

    private func i16Sample(_ data: Data, _ sampleIndex: Int) -> Int16 {
        let offset = 44 + sampleIndex * 2
        let raw = UInt16(data[data.startIndex + offset]) | (UInt16(data[data.startIndex + offset + 1]) << 8)
        return Int16(bitPattern: raw)
    }

    // audio_wav.rs::test_samples_to_wav
    func testEncodeHeaderAndLengthForSilence() {
        let samples = [Float](repeating: 0, count: 1000)
        let wav = WavWriter.encode(samples: samples, sampleRate: 44_100)
        XCTAssertEqual(wav.count, 44 + 1000 * 2)
        XCTAssertEqual(wav.prefix(4), Data("RIFF".utf8))
        XCTAssertEqual(wav[wav.startIndex + 8 ..< wav.startIndex + 12], Data("WAVE".utf8))
    }

    // audio_wav.rs::test_samples_to_wav_various_sample_rates
    func testEncodeSampleRateFieldMatchesInput() {
        for sampleRate: UInt32 in [8_000, 16_000, 22_050, 44_100, 48_000] {
            let samples = [Float](repeating: 0.5, count: Int(sampleRate))
            let wav = WavWriter.encode(samples: samples, sampleRate: sampleRate)
            XCTAssertEqual(le32(wav, 24), sampleRate, "sample rate mismatch for \(sampleRate)")
        }
    }

    // audio_wav.rs::test_samples_to_wav_amplitude_range
    func testEncodeAmplitudeRangeExtremes() {
        let samples: [Float] = [-1.0, 0.0, 1.0, -0.5, 0.5]
        let wav = WavWriter.encode(samples: samples, sampleRate: 44_100)
        XCTAssertEqual(wav.count - 44, 10)
        XCTAssertLessThan(i16Sample(wav, 0), -30_000, "-1.0 must encode as a large negative sample")
        XCTAssertGreaterThan(i16Sample(wav, 2), 30_000, "1.0 must encode as a large positive sample")
    }

    // audio_wav.rs::test_samples_to_wav_edge_values
    func testEncodeClampsOutOfRangeSamples() {
        let samples: [Float] = [-2.0, -1.0, -0.0001, 0.0, 0.0001, 1.0, 2.0]
        let wav = WavWriter.encode(samples: samples, sampleRate: 44_100)
        XCTAssertEqual(wav.count - 44, 14)
        XCTAssertEqual(i16Sample(wav, 0), -32768, "-2.0 must clamp to -32768")
        XCTAssertEqual(i16Sample(wav, 6), 32767, "2.0 must clamp to 32767")
    }

    // audio_wav.rs::test_samples_to_wav_empty
    func testEncodeEmptySamplesStillProducesValidHeader() {
        let wav = WavWriter.encode(samples: [], sampleRate: 44_100)
        XCTAssertEqual(wav.count, 44)
        XCTAssertEqual(wav.prefix(4), Data("RIFF".utf8))
        XCTAssertEqual(wav[wav.startIndex + 8 ..< wav.startIndex + 12], Data("WAVE".utf8))
    }

    // audio_wav.rs::test_samples_to_wav_nan_values -- WavWriter's own doc:
    // non-finite input encodes as silence (0) instead of trapping in
    // Int16's floating-point initializer.
    func testEncodeNonFiniteSamplesEncodeAsSilenceWithoutCrashing() {
        let samples: [Float] = [Float.nan, Float.infinity, -Float.infinity, 0.5]
        let wav = WavWriter.encode(samples: samples, sampleRate: 44_100)
        XCTAssertEqual(wav.prefix(4), Data("RIFF".utf8))
        XCTAssertEqual(i16Sample(wav, 0), 0)
        XCTAssertEqual(i16Sample(wav, 1), 0)
        XCTAssertEqual(i16Sample(wav, 2), 0)
        XCTAssertGreaterThan(i16Sample(wav, 3), 0, "the one finite sample must still encode normally")
    }

    // audio_wav.rs::test_samples_to_wav_single_sample -- Swift's
    // `Int16(_:)` truncates toward zero, not rounds: 0.5 * 32767.0 ==
    // 16383.5 must encode as exactly 16383, not 16384 (WavWriter's own
    // doc comment on this).
    func testEncodeTruncatesTowardZeroNotRounds() {
        let wav = WavWriter.encode(samples: [0.5], sampleRate: 16_000)
        XCTAssertEqual(wav.count, 44 + 2)
        XCTAssertEqual(i16Sample(wav, 0), 16383)
    }

    // Full header layout (WavWriter.swift's own doc table), cross-checked
    // against a non-trivial sample rate/count so byteRate/blockAlign/
    // chunk sizes are all exercised at once.
    func testEncodeFullHeaderLayout() {
        let samples: [Float] = [0.1, -0.2, 0.3]
        let wav = WavWriter.encode(samples: samples, sampleRate: 16_000)
        let dataSize = UInt32(samples.count * 2)

        XCTAssertEqual(wav.prefix(4), Data("RIFF".utf8))
        XCTAssertEqual(le32(wav, 4), 36 &+ dataSize, "ChunkSize = 36 + dataSize")
        XCTAssertEqual(wav[wav.startIndex + 8 ..< wav.startIndex + 12], Data("WAVE".utf8))
        XCTAssertEqual(wav[wav.startIndex + 12 ..< wav.startIndex + 16], Data("fmt ".utf8))
        XCTAssertEqual(le32(wav, 16), 16, "Subchunk1Size == 16 for PCM")
        XCTAssertEqual(le16(wav, 20), 1, "AudioFormat == 1 (PCM)")
        XCTAssertEqual(le16(wav, 22), 1, "NumChannels == 1 (mono)")
        XCTAssertEqual(le32(wav, 24), 16_000, "SampleRate")
        XCTAssertEqual(le32(wav, 28), 16_000 * 1 * 16 / 8, "ByteRate = SampleRate * NumChannels * BitsPerSample/8")
        XCTAssertEqual(le16(wav, 32), UInt16(1 * 16 / 8), "BlockAlign = NumChannels * BitsPerSample/8")
        XCTAssertEqual(le16(wav, 34), 16, "BitsPerSample")
        XCTAssertEqual(wav[wav.startIndex + 36 ..< wav.startIndex + 40], Data("data".utf8))
        XCTAssertEqual(le32(wav, 40), dataSize, "Subchunk2Size == dataSize")
        XCTAssertEqual(wav.count, 44 + Int(dataSize))
    }
}
