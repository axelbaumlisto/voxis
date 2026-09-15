import Foundation

/// Mirrors `voxis_core::audio_wav::samples_to_wav` byte-for-byte (that
/// function's own doc: mono, PCM16, `hound`'s canonical 44-byte header).
/// There is no way to run a Rust unit test against Swift code, so this
/// module doc + `#if DEBUG`'s `selfCheck()` below are this side's
/// closest available regression guard (Task 8 acceptance #1's "document
/// byte-for-byte" requirement) -- a real byte-for-byte diff against a
/// Rust-encoded fixture is a T8.5 device/simulator check, not something
/// this crate's own `cargo test`/`swiftc -typecheck` gates can run.
///
/// Byte layout (little-endian throughout, exactly what `hound::WavWriter`
/// with `WavSpec { channels: 1, bits_per_sample: 16, sample_format: Int,
/// sample_rate }` produces):
///
/// ```text
/// offset  size  field
/// 0       4     "RIFF"
/// 4       4     ChunkSize        = 36 + dataSize
/// 8       4     "WAVE"
/// 12      4     "fmt "
/// 16      4     Subchunk1Size    = 16
/// 20      2     AudioFormat      = 1 (PCM)
/// 22      2     NumChannels      = 1
/// 24      4     SampleRate
/// 28      4     ByteRate         = SampleRate * NumChannels * BitsPerSample/8
/// 32      2     BlockAlign       = NumChannels * BitsPerSample/8
/// 34      2     BitsPerSample    = 16
/// 36      4     "data"
/// 40      4     Subchunk2Size    = dataSize
/// 44      dataSize   PCM16LE samples
/// ```
enum WavWriter {
    /// Encodes accumulated 16 kHz mono `Float32` samples (expected range
    /// `-1.0...1.0`) into the WAV bytes above. Same `sample * 32767.0`
    /// clamp-to-`Int16` conversion as `samples_to_wav`'s own
    /// `(sample * 32767.0).clamp(-32768.0, 32767.0) as i16` (Swift's
    /// `Int16(_:)` floating-point initializer truncates toward zero, not
    /// rounds -- `0.5 * 32767.0 == 16383.5` encodes as `16383`, not
    /// `16384`; `selfCheck()` below asserts this explicitly).
    ///
    /// Non-finite input (`NaN`/`+/-infinity`) encodes as silence (`0`)
    /// instead of reaching `Int16(_:)`'s floating-point initializer,
    /// which traps for non-finite values -- review fix "Cheap minors": a
    /// single corrupt/NaN sample (a real possibility from
    /// `AVAudioConverter` on a malformed input format) must not crash
    /// the whole capture session's `stop()` call.
    static func encode(samples: [Float], sampleRate: UInt32) -> Data {
        let bitsPerSample: UInt32 = 16
        let numChannels: UInt32 = 1
        let byteRate = sampleRate * numChannels * bitsPerSample / 8
        let blockAlign = UInt16(numChannels * bitsPerSample / 8)
        let dataSize = UInt32(samples.count * 2)

        var data = Data(capacity: 44 + Int(dataSize))
        data.append(ascii("RIFF"))
        data.append(le32(36 &+ dataSize))
        data.append(ascii("WAVE"))
        data.append(ascii("fmt "))
        data.append(le32(16))
        data.append(le16(1)) // PCM
        data.append(le16(UInt16(numChannels)))
        data.append(le32(sampleRate))
        data.append(le32(byteRate))
        data.append(le16(blockAlign))
        data.append(le16(UInt16(bitsPerSample)))
        data.append(ascii("data"))
        data.append(le32(dataSize))

        // Review fix "Cheap minors": build the PCM16 samples into a
        // single `[Int16]` buffer and append its raw bytes ONCE, instead
        // of the previous per-sample `Data` allocation (one small `Data`
        // object per sample -- thousands of allocations for even a few
        // seconds of 16kHz audio). `Int16`'s native in-memory layout is
        // little-endian on every real Apple target this plugin ships to
        // (arm64 device/Simulator, x86_64 Simulator), so reinterpreting
        // the buffer's raw bytes via `Data.append<SourceType>(_:)`
        // (Foundation's generic `UnsafeBufferPointer<SourceType>`
        // overload) is exactly the little-endian encoding this format
        // requires -- no manual byte-swap needed for the sample data
        // itself (the header fields above still use explicit `le16`/
        // `le32` since those individual scalar values are worth spelling
        // out regardless of buffer-copy tricks).
        var pcm = [Int16](repeating: 0, count: samples.count)
        for i in 0..<samples.count {
            let sample = samples[i]
            guard sample.isFinite else { continue } // already 0 above
            let clamped = Swift.max(-32768.0, Swift.min(32767.0, Double(sample) * 32767.0))
            pcm[i] = Int16(clamped)
        }
        pcm.withUnsafeBufferPointer { buffer in
            data.append(buffer)
        }

        return data
    }

    private static func ascii(_ s: String) -> Data {
        Data(s.utf8)
    }

    private static func le16(_ value: UInt16) -> Data {
        Data([UInt8(value & 0xff), UInt8((value >> 8) & 0xff)])
    }

    private static func le32(_ value: UInt32) -> Data {
        Data([
            UInt8(value & 0xff),
            UInt8((value >> 8) & 0xff),
            UInt8((value >> 16) & 0xff),
            UInt8((value >> 24) & 0xff)
        ])
    }

    #if DEBUG
    /// Swift-side counterpart of `audio_wav.rs`'s own `test_samples_to_wav`
    /// -- asserts header/magic bytes AND the `fmt` subchunk's scalar
    /// fields (review fix "Cheap minors": extended beyond magic bytes)
    /// for a small known input, plus the clamp/truncation and NaN-safety
    /// behaviour documented on `encode` above. Called once from
    /// `VoxisPlugin.init()` in DEBUG builds only so a layout regression
    /// fails loud the first time the plugin loads in a debug host,
    /// without a Rust test harness on this side of the bridge.
    static func selfCheck() {
        func le16(_ d: Data, _ offset: Int) -> UInt16 {
            UInt16(d[d.startIndex + offset]) | (UInt16(d[d.startIndex + offset + 1]) << 8)
        }
        func le32(_ d: Data, _ offset: Int) -> UInt32 {
            UInt32(d[d.startIndex + offset])
                | (UInt32(d[d.startIndex + offset + 1]) << 8)
                | (UInt32(d[d.startIndex + offset + 2]) << 16)
                | (UInt32(d[d.startIndex + offset + 3]) << 24)
        }

        let zeros = encode(samples: [Float](repeating: 0, count: 1000), sampleRate: 16_000)
        assert(zeros.count == 44 + 1000 * 2, "WavWriter: header+data size mismatch")
        assert(zeros.subdata(in: 0..<4) == Data("RIFF".utf8), "WavWriter: missing RIFF magic")
        assert(zeros.subdata(in: 8..<12) == Data("WAVE".utf8), "WavWriter: missing WAVE magic")
        assert(zeros.subdata(in: 12..<16) == Data("fmt ".utf8), "WavWriter: missing fmt subchunk id")
        assert(zeros.subdata(in: 36..<40) == Data("data".utf8), "WavWriter: missing data subchunk id")

        assert(le32(zeros, 16) == 16, "WavWriter: Subchunk1Size must be 16 (PCM)")
        assert(le16(zeros, 20) == 1, "WavWriter: AudioFormat must be 1 (PCM)")
        assert(le16(zeros, 22) == 1, "WavWriter: NumChannels must be 1 (mono)")
        assert(le32(zeros, 24) == 16_000, "WavWriter: SampleRate mismatch")
        assert(le32(zeros, 28) == 32_000, "WavWriter: ByteRate must be 16000 * 1 * 16/8 = 32000")
        assert(le16(zeros, 32) == 2, "WavWriter: BlockAlign must be 1 * 16/8 = 2")
        assert(le16(zeros, 34) == 16, "WavWriter: BitsPerSample must be 16")

        // Clamp/truncation parity with `samples_to_wav`'s own
        // `(sample * 32767.0).clamp(..) as i16`: [1.0, -1.0, 0.5] ->
        // [32767, -32767, 16383] -- `Int16(_:)` truncates toward zero,
        // so 0.5 * 32767.0 == 16383.5 must become 16383, not 16384.
        let clamp = encode(samples: [1.0, -1.0, 0.5], sampleRate: 16_000)
        let s0 = Int16(bitPattern: le16(clamp, 44))
        let s1 = Int16(bitPattern: le16(clamp, 46))
        let s2 = Int16(bitPattern: le16(clamp, 48))
        assert(s0 == 32767, "WavWriter: 1.0 must clamp to 32767, got \(s0)")
        assert(s1 == -32767, "WavWriter: -1.0 must clamp to -32767, got \(s1)")
        assert(s2 == 16383, "WavWriter: 0.5 must truncate to 16383, got \(s2)")

        // NaN -> 0, not a trap.
        let nanWav = encode(samples: [Float.nan], sampleRate: 16_000)
        assert(le16(nanWav, 44) == 0, "WavWriter: a NaN sample must encode as 0, got \(le16(nanWav, 44))")
    }
    #endif
}
