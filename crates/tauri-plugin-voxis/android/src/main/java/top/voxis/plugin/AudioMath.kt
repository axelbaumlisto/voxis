package top.voxis.plugin

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Pure numeric rules of the capture pipeline -- the Kotlin mirror of
 * `ios/Sources/VoxisAudioMath/LevelMath.swift` + `WavWriter.swift`, which in
 * turn mirror `src/desktop/pure.rs`. Three implementations, ONE set of
 * numbers: `src/test/.../AudioMathTest.kt` asserts the same fixtures the
 * Swift XCTests and the Rust `#[test]`s use. No Android imports on purpose,
 * so `./gradlew test` runs it on a plain JVM.
 */
object LevelMath {
    /** Desktop's near-silent / mute-heuristic threshold (one home). */
    const val DEFAULT_NEAR_SILENT_THRESHOLD: Float = 0.0005f

    /**
     * Peak RMS over `subChunkSeconds`-sized sub-chunks of a mono Float buffer
     * (Task 8 acceptance #1: "max over 10 ms sub-chunks", not a mean).
     */
    fun subChunkPeakRms(chunk: FloatArray, sampleRate: Double, subChunkSeconds: Double = 0.010): Float {
        if (chunk.isEmpty()) return 0f
        val subChunkSamples = maxOf(1, (sampleRate * subChunkSeconds).toInt())
        var index = 0
        var peak = 0f
        while (index < chunk.size) {
            val end = minOf(index + subChunkSamples, chunk.size)
            var sumSquares = 0f
            for (i in index until end) sumSquares += chunk[i] * chunk[i]
            val rms = kotlin.math.sqrt(sumSquares / (end - index).toFloat())
            if (rms > peak) peak = rms
            index = end
        }
        return peak
    }

    /** Self-cap slicing: how much of `chunk` to append so the total never exceeds `capSamples`, and whether the cap was reached. */
    data class CapSlice(val toAppend: FloatArray, val hit: Boolean)

    fun selfCapSlice(existingCount: Int, chunk: FloatArray, capSamples: Int): CapSlice {
        if (existingCount + chunk.size < capSamples) return CapSlice(chunk, false)
        val remaining = capSamples - existingCount
        val slice = if (remaining > 0) chunk.copyOfRange(0, minOf(remaining, chunk.size)) else FloatArray(0)
        return CapSlice(slice, true)
    }

    /** The 2-consecutive-window near-silent counter ([R1-iOS C3] fallback mute heuristic). */
    fun advanceNearSilentWindowCount(current: Int, peak: Float, eligible: Boolean, threshold: Float = DEFAULT_NEAR_SILENT_THRESHOLD): Int {
        if (!eligible || peak >= threshold) return 0
        return current + 1
    }

    fun muteHeuristicTriggered(consecutiveNearSilentWindows: Int, eligible: Boolean): Boolean =
        eligible && consecutiveNearSilentWindows >= 2
}

/** Peak (not average) RMS since the last `takePeak()` -- `pure.rs`'s `WindowPeakAccumulator`. */
class WindowPeakAccumulator {
    private var peak = 0f
    private val lock = Any()

    fun observe(rms: Float) = synchronized(lock) { if (rms > peak) peak = rms }

    fun takePeak(): Float = synchronized(lock) {
        val v = peak
        peak = 0f
        v
    }
}

/**
 * 16-bit PCM mono WAV, byte-for-byte what `WavWriter.swift` / `voxis_core::
 * audio_wav` produce: 44-byte header, little-endian, samples clamped to
 * [-32768, 32767] and truncated toward zero, non-finite samples encoded as 0.
 */
object WavWriter {
    fun encode(samples: FloatArray, sampleRate: Int): ByteArray {
        val bitsPerSample = 16
        val numChannels = 1
        val byteRate = sampleRate * numChannels * bitsPerSample / 8
        val blockAlign = (numChannels * bitsPerSample / 8).toShort()
        val dataSize = samples.size * 2
        val buf = ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN)
        buf.put("RIFF".toByteArray(Charsets.US_ASCII))
        buf.putInt(36 + dataSize)
        buf.put("WAVE".toByteArray(Charsets.US_ASCII))
        buf.put("fmt ".toByteArray(Charsets.US_ASCII))
        buf.putInt(16)
        buf.putShort(1) // PCM
        buf.putShort(numChannels.toShort())
        buf.putInt(sampleRate)
        buf.putInt(byteRate)
        buf.putShort(blockAlign)
        buf.putShort(bitsPerSample.toShort())
        buf.put("data".toByteArray(Charsets.US_ASCII))
        buf.putInt(dataSize)
        for (s in samples) {
            val pcm = if (s.isFinite()) {
                val scaled = s.toDouble() * 32767.0
                val clamped = maxOf(-32768.0, minOf(32767.0, scaled))
                clamped.toInt().toShort() // toInt() truncates toward zero, like Swift's Int16(Double)
            } else 0
            buf.putShort(pcm)
        }
        return buf.array()
    }
}
