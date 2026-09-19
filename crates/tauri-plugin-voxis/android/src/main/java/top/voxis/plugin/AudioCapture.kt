package top.voxis.plugin

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import java.io.File
import java.io.FileOutputStream

/** Mirrors `VoxisCaptureError` (AudioCapture.swift): `code` is what `mobile.rs::map_invoke_error` matches on. */
class VoxisCaptureError(message: String, val code: String) : Exception(message) {
    companion object {
        val alreadyRunning = VoxisCaptureError("capture already running", "ALREADY_RUNNING")
        val notRunning = VoxisCaptureError("capture not running", "NOT_RUNNING")
        fun permissionDenied() = VoxisCaptureError("microphone permission denied by the user/OS (RECORD_AUDIO)", "PERMISSION_DENIED")
        fun backend(message: String) = VoxisCaptureError(message, "BACKEND")
        fun interrupted(reason: String) = VoxisCaptureError("capture interrupted: $reason", "INTERRUPTED")
    }
}

data class CaptureStats(val durationMs: Long, val samples: Int, val peakRms: Float)

/**
 * The Android capture backend -- the third implementation of ONE contract
 * (`src/capture.rs`'s `AudioCapture` trait, over the wire of `src/mobile.rs`):
 * `start(path, capSamples, onLevel)` / `stop() -> {durationMs, samples,
 * peakRms}` / `reset()`, level ticks every 250 ms `{rms, peak, muted, capHit}`
 * with peak-of-10-ms-RMS semantics, a hard self-cap at `capSamples`, and the
 * 2-window near-silent mute heuristic. File-for-file the shape of
 * `ios/Sources/tauri-plugin-voxis/AudioCapture.swift`; the platform half is
 * `AudioRecord` (16 kHz mono PCM16, `VOICE_RECOGNITION` = no system AGC/
 * echo processing, the closest thing to `AVAudioSession .measurement`).
 *
 * Threading: one `HandlerThread` owns the `AudioRecord` read loop AND the
 * 250 ms tick (posted on the same handler), so the sample buffer needs no
 * lock between them; `start`/`stop`/`reset` hop onto that thread too and
 * complete through callbacks -- exactly the iOS `queue.async` discipline,
 * so `mobile.rs`'s blocking `run_mobile_plugin` sees the same timing.
 */
class VoxisAudioCapture(
    /**
     * C3 test seam, DEBUG builds only (`VoxisPlugin` passes it only when the
     * host APK is debuggable AND the file exists): a 16 kHz mono PCM16 WAV
     * whose samples are streamed in real time INSTEAD of `AudioRecord`, and
     * whose bytes are handed back verbatim on `stop` -- so the emulator lane
     * (no microphone) exercises levels, self-cap, the mute heuristic and the
     * whole Rust pipeline against `voxis-fake-stt`'s sha-keyed map, exactly
     * like desktop's scripted `MockCapture` fixture. Never set in a release
     * build; the path is the app's own external-files dir, writable by `adb`.
     */
    private val fixture: File? = null,
) {
    companion object {
        const val SAMPLE_RATE = 16_000
        private const val TICK_MS = 250L
        /** 20 ms of PCM16 per read: small enough for tick latency, large enough not to spin. */
        private const val READ_FRAMES = SAMPLE_RATE / 50
    }

    private val thread = HandlerThread("top.voxis.plugin.capture").apply { start() }
    private val handler = Handler(thread.looper)

    // All of the below is touched ONLY on `thread`.
    private var record: AudioRecord? = null
    private var running = false
    private var samples = FloatArray(0)
    private var count = 0
    private var capSamples = 0
    private var capHit = false
    private var sawAudio = false
    private var consecutiveNearSilentWindows = 0
    private var overallPeakRms = 0f
    private var startedAt = 0L
    private var currentPath: String? = null
    private var levelChannel: Channel? = null
    private var interruptionReason: String? = null
    private val windowPeak = WindowPeakAccumulator()

    fun start(path: String, capSamples: Int, onLevel: Channel, completion: (Result<Unit>) -> Unit) {
        handler.post {
            if (running) { completion(Result.failure(VoxisCaptureError.alreadyRunning)); return@post }
            fixture?.let { f ->
                val decoded = try { decodeFixture(f) } catch (e: Exception) {
                    completion(Result.failure(VoxisCaptureError.backend("capture fixture $f: $e"))); return@post
                }
                fixtureSamples = decoded
                fixtureCursor = 0
                record = null
                beginSession(path, capSamples, onLevel)
                completion(Result.success(Unit))
                handler.post(readLoop)
                handler.postDelayed(levelTick, TICK_MS)
                return@post
            }
            val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            if (minBuf <= 0) { completion(Result.failure(VoxisCaptureError.backend("AudioRecord.getMinBufferSize=$minBuf: 16 kHz mono PCM16 unsupported"))); return@post }
            val rec = try {
                AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, READ_FRAMES * 2 * 4))
            } catch (e: SecurityException) {
                // No runtime grant: never a crash (iOS killed the process on a
                // missing usage string; here the OS throws -- we translate).
                completion(Result.failure(VoxisCaptureError.permissionDenied())); return@post
            } catch (e: Exception) {
                completion(Result.failure(VoxisCaptureError.backend("AudioRecord init: $e"))); return@post
            }
            if (rec.state != AudioRecord.STATE_INITIALIZED) {
                rec.release()
                completion(Result.failure(VoxisCaptureError.backend("AudioRecord not initialized (state=${rec.state}) -- mic busy or permission missing")))
                return@post
            }
            try { rec.startRecording() } catch (e: IllegalStateException) {
                rec.release(); completion(Result.failure(VoxisCaptureError.backend("startRecording: $e"))); return@post
            }
            if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                rec.release(); completion(Result.failure(VoxisCaptureError.backend("AudioRecord did not enter RECORDING (another app holds the mic?)"))); return@post
            }
            record = rec
            beginSession(path, capSamples, onLevel)
            completion(Result.success(Unit))
            handler.post(readLoop)
            handler.postDelayed(levelTick, TICK_MS)
        }
    }

    private fun beginSession(path: String, capSamples: Int, onLevel: Channel) {
        running = true
        samples = FloatArray(maxOf(capSamples, SAMPLE_RATE))
        count = 0
        this.capSamples = capSamples
        capHit = false
        sawAudio = false
        consecutiveNearSilentWindows = 0
        overallPeakRms = 0f
        startedAt = SystemClock.elapsedRealtime()
        currentPath = path
        levelChannel = onLevel
        interruptionReason = null
        windowPeak.takePeak()
    }

    // -- fixture source (debug builds only; see the constructor doc) --------
    private var fixtureSamples: ShortArray? = null
    private var fixtureCursor = 0

    /** 44-byte-header 16 kHz mono PCM16 only -- the format `WavWriter` writes and the fixtures under fixtures/audio are in. */
    private fun decodeFixture(f: File): ShortArray {
        val bytes = f.readBytes()
        require(bytes.size >= 44 && String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF") { "not a RIFF WAV" }
        val bb = java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        require(bb.getShort(22).toInt() == 1 && bb.getInt(24) == SAMPLE_RATE && bb.getShort(34).toInt() == 16) { "need 16 kHz mono PCM16" }
        require(String(bytes, 36, 4, Charsets.US_ASCII) == "data") { "expected the data chunk at offset 36" }
        val n = (bytes.size - 44) / 2
        val out = ShortArray(n)
        for (i in 0 until n) out[i] = bb.getShort(44 + i * 2)
        return out
    }

    /** Next 20 ms of fixture audio, paced to real time; zeros once the file is exhausted (a silence the guard can time out on). */
    private fun readFixture(dst: ShortArray): Int {
        val src = fixtureSamples ?: return 0
        val elapsedFrames = ((SystemClock.elapsedRealtime() - startedAt) * SAMPLE_RATE / 1000).toInt()
        if (fixtureCursor >= elapsedFrames) { SystemClock.sleep(5); return 0 }
        val n = minOf(dst.size, elapsedFrames - fixtureCursor)
        for (i in 0 until n) {
            val idx = fixtureCursor + i
            dst[i] = if (idx < src.size) src[idx] else 0
        }
        fixtureCursor += n
        return n
    }

    private val pcm = ShortArray(READ_FRAMES)
    private val chunk = FloatArray(READ_FRAMES)

    private val readLoop = object : Runnable {
        override fun run() {
            if (!running || capHit) return
            val rec = record
            if (rec == null && fixtureSamples == null) return
            val n = if (rec != null) rec.read(pcm, 0, READ_FRAMES) else readFixture(pcm)
            if (n < 0) {
                // ERROR_DEAD_OBJECT etc: the stream died under us -- the iOS
                // `failWithInterruption` path; `stop()` reports INTERRUPTED.
                interruptionReason = "AudioRecord.read returned $n"
                running = false
                return
            }
            if (n > 0) {
                for (i in 0 until n) chunk[i] = pcm[i] / 32768f
                val view = chunk.copyOfRange(0, n)
                windowPeak.observe(LevelMath.subChunkPeakRms(view, SAMPLE_RATE.toDouble()))
                sawAudio = true
                val slice = LevelMath.selfCapSlice(count, view, capSamples)
                if (slice.toAppend.isNotEmpty()) {
                    if (count + slice.toAppend.size > samples.size) samples = samples.copyOf(maxOf(samples.size * 2, count + slice.toAppend.size))
                    System.arraycopy(slice.toAppend, 0, samples, count, slice.toAppend.size)
                    count += slice.toAppend.size
                }
                capHit = slice.hit
            }
            handler.post(this)
        }
    }

    private val levelTick = object : Runnable {
        override fun run() {
            if (!running && interruptionReason == null) return
            val peak = windowPeak.takePeak()
            if (peak > overallPeakRms) overallPeakRms = peak
            consecutiveNearSilentWindows = LevelMath.advanceNearSilentWindowCount(consecutiveNearSilentWindows, peak, sawAudio)
            val muted = LevelMath.muteHeuristicTriggered(consecutiveNearSilentWindows, sawAudio)
            val sample = JSObject().apply {
                put("rms", peak.toDouble())
                put("peak", peak.toDouble())
                put("muted", muted)
                put("capHit", capHit)
            }
            try { levelChannel?.send(sample) } catch (_: Exception) {}
            if (!capHit && running) handler.postDelayed(this, TICK_MS)
        }
    }

    fun stop(completion: (Result<CaptureStats>) -> Unit) {
        handler.post {
            if (!running && interruptionReason == null) { completion(Result.failure(VoxisCaptureError.notRunning)); return@post }
            val reason = interruptionReason
            running = false
            interruptionReason = null
            val path = currentPath
            teardown()
            if (reason != null) { completion(Result.failure(VoxisCaptureError.interrupted(reason))); return@post }
            val durationMs = SystemClock.elapsedRealtime() - startedAt
            val collected = samples.copyOfRange(0, count)
            if (path == null) { completion(Result.failure(VoxisCaptureError.backend("no session path recorded for this capture"))); return@post }
            try {
                val f = fixture
                if (f != null && fixtureSamples != null) {
                    // Verbatim, like desktop's MockCapture copying its fixture:
                    // the bytes voxis-fake-stt's sha map knows.
                    f.copyTo(File(path), overwrite = true)
                } else {
                    val wav = WavWriter.encode(collected, SAMPLE_RATE)
                    FileOutputStream(File(path)).use { it.write(wav) }
                }
            } catch (e: Exception) {
                completion(Result.failure(VoxisCaptureError.backend("writing WAV to $path: $e"))); return@post
            }
            completion(Result.success(CaptureStats(durationMs, collected.size, overallPeakRms)))
        }
    }

    fun reset(completion: () -> Unit) {
        handler.post {
            teardown()
            running = false
            count = 0
            interruptionReason = null
            currentPath = null
            completion()
        }
    }

    private fun teardown() {
        handler.removeCallbacks(levelTick)
        handler.removeCallbacks(readLoop)
        levelChannel = null
        record?.let { rec ->
            try { if (rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) rec.stop() } catch (_: Exception) {}
            rec.release()
        }
        record = null
        fixtureSamples = null
        fixtureCursor = 0
    }
}
