package top.voxis.plugin

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The SAME fixture numbers as `ios/Tests/tauri-plugin-voxisTests/
 * {LevelMathTests,WavWriterTests}.swift` and `src/desktop/pure.rs`'s tests --
 * three implementations, one set of expectations.
 */
class AudioMathTest {
    @Test fun subChunkPeakRmsAlternatingHalfAmplitude() {
        assertEquals(0.5f, LevelMath.subChunkPeakRms(floatArrayOf(0.5f, -0.5f, 0.5f, -0.5f), 16_000.0, 1.0), 1e-6f)
    }

    @Test fun subChunkPeakRmsAllOnes() {
        assertEquals(1.0f, LevelMath.subChunkPeakRms(floatArrayOf(1f, 1f), 16_000.0, 1.0), 1e-6f)
    }

    @Test fun subChunkPeakRmsEmptyIsZero() {
        assertEquals(0f, LevelMath.subChunkPeakRms(FloatArray(0), 16_000.0), 0f)
    }

    @Test fun subChunkPeakRmsTakesMaxAcrossSubChunksNotAverage() {
        val chunk = FloatArray(10) { 0f } + FloatArray(10) { 1f }
        assertEquals(1.0f, LevelMath.subChunkPeakRms(chunk, 1000.0, 0.010), 1e-6f)
    }

    @Test fun selfCapSliceAppendsWholeChunkBelowCap() {
        val r = LevelMath.selfCapSlice(0, floatArrayOf(1f, 2f, 3f), 10)
        assertArrayEquals(floatArrayOf(1f, 2f, 3f), r.toAppend, 0f)
        assertFalse(r.hit)
    }

    @Test fun selfCapSliceTruncatesAtCapAndReportsHit() {
        val r = LevelMath.selfCapSlice(8, floatArrayOf(1f, 2f, 3f), 10)
        assertArrayEquals(floatArrayOf(1f, 2f), r.toAppend, 0f)
        assertTrue(r.hit)
        val over = LevelMath.selfCapSlice(10, floatArrayOf(1f), 10)
        assertEquals(0, over.toAppend.size)
        assertTrue(over.hit)
    }

    @Test fun nearSilentCounterResetsWhenNotEligibleOrLoud() {
        assertEquals(0, LevelMath.advanceNearSilentWindowCount(3, 0f, eligible = false))
        assertEquals(0, LevelMath.advanceNearSilentWindowCount(3, 0.01f, eligible = true))
        assertEquals(1, LevelMath.advanceNearSilentWindowCount(0, 0f, eligible = true))
        assertEquals(2, LevelMath.advanceNearSilentWindowCount(1, 0.0001f, eligible = true))
    }

    @Test fun muteHeuristicNeedsTwoWindowsAndEligibility() {
        assertFalse(LevelMath.muteHeuristicTriggered(1, eligible = true))
        assertTrue(LevelMath.muteHeuristicTriggered(2, eligible = true))
        assertFalse(LevelMath.muteHeuristicTriggered(2, eligible = false))
    }

    @Test fun windowPeakAccumulatorKeepsMaxAndDrains() {
        val acc = WindowPeakAccumulator()
        acc.observe(0.2f); acc.observe(0.7f); acc.observe(0.3f)
        assertEquals(0.7f, acc.takePeak(), 0f)
        assertEquals(0f, acc.takePeak(), 0f)
    }

    @Test fun wavHeaderAndLengthForSilence() {
        val wav = WavWriter.encode(FloatArray(100), 16_000)
        assertEquals(44 + 200, wav.size)
        val b = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(wav, 0, 4, Charsets.US_ASCII))
        assertEquals(36 + 200, b.getInt(4))
        assertEquals("WAVE", String(wav, 8, 4, Charsets.US_ASCII))
        assertEquals("fmt ", String(wav, 12, 4, Charsets.US_ASCII))
        assertEquals(16, b.getInt(16))
        assertEquals(1.toShort(), b.getShort(20))
        assertEquals(1.toShort(), b.getShort(22))
        assertEquals(16_000, b.getInt(24))
        assertEquals(32_000, b.getInt(28))
        assertEquals(2.toShort(), b.getShort(32))
        assertEquals(16.toShort(), b.getShort(34))
        assertEquals("data", String(wav, 36, 4, Charsets.US_ASCII))
        assertEquals(200, b.getInt(40))
    }

    @Test fun wavAmplitudeExtremesClampAndTruncate() {
        val wav = WavWriter.encode(floatArrayOf(1f, -1f, 2f, -2f, 0.5f, Float.NaN, Float.POSITIVE_INFINITY), 16_000)
        val b = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(32767.toShort(), b.getShort(44))
        assertEquals((-32767).toShort(), b.getShort(46))
        assertEquals(32767.toShort(), b.getShort(48))
        assertEquals((-32768).toShort(), b.getShort(50))
        assertEquals(16383.toShort(), b.getShort(52)) // 0.5*32767 = 16383.5 -> truncates toward zero
        assertEquals(0.toShort(), b.getShort(54))
        assertEquals(0.toShort(), b.getShort(56))
    }

    @Test fun wavEmptySamplesStillValidHeader() {
        val wav = WavWriter.encode(FloatArray(0), 16_000)
        assertEquals(44, wav.size)
        assertEquals(0, ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN).getInt(40))
    }
}
