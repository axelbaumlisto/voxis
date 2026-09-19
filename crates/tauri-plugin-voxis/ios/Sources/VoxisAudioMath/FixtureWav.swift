import Foundation

/// The debug-only capture fixture's decoder (C3 seam, iOS mirror of
/// `android/.../AudioCapture.kt`'s `FixtureSource`): a 16 kHz mono PCM16 WAV
/// with the plain 44-byte header the desktop `WavWriter`/`voxis-fake-stt`
/// fixtures carry, decoded to the same `[Float]` the microphone path feeds
/// `LevelMath`. Pure and Tauri-free so `swift test` covers it on the Mac.
///
/// Anything else — other rates, stereo, 24-bit, a `LIST` chunk before
/// `data` — is a `nil`, never a best-effort guess: the fixture exists to
/// make a test deterministic, and a silently resampled fixture is the one
/// thing that would make it lie.
public enum FixtureWav {
    public static let sampleRate: UInt32 = 16_000
    public static let headerBytes = 44

    /// `nil` unless `bytes` is exactly the shape above.
    public static func decodePCM16Mono16k(_ bytes: Data) -> [Float]? {
        guard bytes.count >= headerBytes else { return nil }
        let b = [UInt8](bytes)
        guard String(bytes: b[0..<4], encoding: .ascii) == "RIFF",
              String(bytes: b[8..<12], encoding: .ascii) == "WAVE",
              String(bytes: b[12..<16], encoding: .ascii) == "fmt ",
              String(bytes: b[36..<40], encoding: .ascii) == "data" else { return nil }
        let audioFormat = le16(b, 20)
        let channels = le16(b, 22)
        let rate = le32(b, 24)
        let bitsPerSample = le16(b, 34)
        guard audioFormat == 1, channels == 1, rate == sampleRate, bitsPerSample == 16 else { return nil }
        let dataLen = Int(le32(b, 40))
        let avail = b.count - headerBytes
        let n = min(dataLen, avail) / 2
        var out = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let lo = UInt16(b[headerBytes + 2 * i])
            let hi = UInt16(b[headerBytes + 2 * i + 1])
            let s = Int16(bitPattern: lo | (hi << 8))
            // `WavWriter.encode` scales by 32767 (desktop `voxis_core` parity) — the
            // inverse must be the same constant or a round trip is off by one LSB.
            out[i] = Float(s) / 32767.0
        }
        return out
    }

    private static func le16(_ b: [UInt8], _ at: Int) -> UInt16 {
        UInt16(b[at]) | (UInt16(b[at + 1]) << 8)
    }

    private static func le32(_ b: [UInt8], _ at: Int) -> UInt32 {
        UInt32(b[at]) | (UInt32(b[at + 1]) << 8) | (UInt32(b[at + 2]) << 16) | (UInt32(b[at + 3]) << 24)
    }
}
