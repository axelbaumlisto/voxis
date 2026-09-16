import Foundation

/// Mirrors `voxis_core::audio_wav::samples_to_wav` byte-for-byte (that
/// function's own doc: mono, PCM16, `hound`'s canonical 44-byte header).
/// `Tests/tauri-plugin-voxisTests/WavWriterTests.swift` (S2,
/// BLIND_SDK_swift.md finding #2) asserts this against the same fixture
/// numbers `voxis_core::audio_wav`'s own tests use -- this type lives in
/// the Tauri-free `VoxisAudioMath` target specifically so `swift test`
/// can reach it on a plain macOS host, no device/simulator required. A
/// real byte-for-byte diff against a Rust-encoded fixture file remains a
/// T8.5 device/simulator check; this is the header/clamp/NaN regression
/// gate that runs on every `swift test` instead.
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
public enum WavWriter {
    /// Encodes accumulated 16 kHz mono `Float32` samples (expected range
    /// `-1.0...1.0`) into the WAV bytes above. Same `sample * 32767.0`
    /// clamp-to-`Int16` conversion as `samples_to_wav`'s own
    /// `(sample * 32767.0).clamp(-32768.0, 32767.0) as i16` (Swift's
    /// `Int16(_:)` floating-point initializer truncates toward zero, not
    /// rounds -- `0.5 * 32767.0 == 16383.5` encodes as `16383`, not
    /// `16384`; `WavWriterTests` asserts this explicitly).
    ///
    /// Non-finite input (`NaN`/`+/-infinity`) encodes as silence (`0`)
    /// instead of reaching `Int16(_:)`'s floating-point initializer,
    /// which traps for non-finite values -- review fix "Cheap minors": a
    /// single corrupt/NaN sample (a real possibility from
    /// `AVAudioConverter` on a malformed input format) must not crash
    /// the whole capture session's `stop()` call.
    public static func encode(samples: [Float], sampleRate: UInt32) -> Data {
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
}
