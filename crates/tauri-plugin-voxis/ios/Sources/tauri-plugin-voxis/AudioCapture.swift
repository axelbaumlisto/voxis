import AVFoundation
import Foundation
import Tauri
import UIKit
import VoxisAudioMath

/// Rust-facing error shape (`mobile.rs`'s `map_invoke_error` switches on
/// `code`); `message` is what `PluginInvokeError::InvokeRejected`
/// ultimately surfaces to `CaptureError::Backend`.
struct VoxisCaptureError: Error {
    let message: String
    let code: String

    static let alreadyRunning = VoxisCaptureError(message: "capture already running", code: "ALREADY_RUNNING")
    static let notRunning = VoxisCaptureError(message: "capture not running", code: "NOT_RUNNING")
    // Task 8 acceptance #4: denial carries a Settings deep-link hint --
    // baked directly into `message` below (review fix, BLIND_SDK_swift.md
    // finding #1: an earlier revision carried `UIApplication.
    // openSettingsURLString` as reject `data` instead, but
    // `mobile.rs::map_invoke_error` never read it, so that machinery had
    // no reader on either side of the bridge; the message text alone is
    // the hint the frontend actually gets).
    static let permissionDenied = VoxisCaptureError(
        message: "microphone permission denied -- open Settings to grant microphone access",
        code: "PERMISSION_DENIED"
    )

    static func backend(_ message: String) -> VoxisCaptureError {
        VoxisCaptureError(message: message, code: "BACKEND")
    }

    // Task 8 acceptance #2: `.began` interruption (call, Siri, system
    // alert, closed Smart Folio) and `.oldDeviceUnavailable` route change
    // both finalize the same way -- the pipeline's own liveness poll
    // (`level_rx` ticks stopping) is the *first* signal it sees
    // (`StreamDied -> Recover`); by the time `stop()` is actually called
    // (as part of that Recover path) this is what it rejects with,
    // mirroring desktop `CpalCapture`'s own "record the cause, `stop()`
    // returns `Err`" convention for a stream that died mid-session
    // (`desktop/pure.rs`'s `record_stream_runtime_error`).
    static func interrupted(_ reason: String) -> VoxisCaptureError {
        VoxisCaptureError(message: "capture interrupted: \(reason)", code: "INTERRUPTED")
    }
}

/// Wire shape for `stopCapture`'s success payload -- field names match
/// `capture.rs::CaptureStats` under `#[serde(rename_all = "camelCase")]`
/// (`mobile.rs`'s `CaptureStatsWire` decodes this).
struct CaptureStatsWire: Encodable {
    let durationMs: UInt64
    let samples: Int
    let peakRms: Float
}

/// Level sample sent through the Rust-created `Channel` every 250 ms --
/// field names match `capture.rs::LevelSample` under
/// `#[serde(rename_all = "camelCase")]` (`mobile.rs`'s `LevelSampleWire`
/// decodes this on the other end).
private struct LevelSampleWire: Encodable {
    let rms: Float
    let peak: Float
    let muted: Bool
    let capHit: Bool
}

/// `AVAudioEngine` capture backend behind `VoxisPlugin`'s `startCapture`/
/// `stopCapture`/`resetCapture` commands (Task 8). One instance per
/// plugin, one session (`start`/`stop` pair) at a time -- same
/// single-session assumption as desktop's `CpalCapture`/`MockCapture`.
///
/// All mutable state is only ever touched from `queue` (a dedicated
/// serial `DispatchQueue`, NOT the Tauri `ipcDispatchQueue` `VoxisPlugin`'s
/// `@objc` command handlers run on) -- `start`/`stop`/`reset` all hop
/// onto `queue` immediately and return, so the command handler itself
/// stays short (Task 8 acceptance #6's own requirement: "Swift handlers
/// must be short ... long work on your own DispatchQueue").
final class VoxisAudioCapture {
    static let sampleRate: Double = 16_000

    // `[ADO-8]`: `var`, not `let` -- a `mediaServicesWereReset`
    // notification documents every `AVAudioSession`-related object
    // (including a previously-built `AVAudioEngine`) as invalid
    // afterwards; `engineNeedsRebuildAfterReset` (set by that
    // notification's handler) makes the *next* `startEngine()` replace
    // this with a fresh instance instead of reusing the now-possibly-
    // invalid one, rather than being permanently stuck failing until the
    // whole process restarts.
    private var engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private var outputFormat: AVAudioFormat!

    private let queue = DispatchQueue(label: "top.voxis.plugin.capture")
    private let stateLock = NSLock()

    private var running = false
    private var samples: [Float] = []
    private var capSamples = Int.max
    private var capHit = false
    private var startInstant: DispatchTime?
    private var overallPeakRms: Float = 0
    private var muted = false
    /// Set by `failWithInterruption` -- the *next* `stop()` call rejects
    /// with this instead of returning fabricated success stats (Task 8
    /// acceptance #2).
    private var interruptionReason: String?
    private var currentPath: String?
    /// Set by the `mediaServicesWereResetNotification` handler; consumed
    /// (and cleared) at the top of the next `startEngine()` -- see
    /// `engine`'s own doc comment above.
    private var engineNeedsRebuildAfterReset = false

    private let windowPeak = WindowPeakAccumulator()
    private var levelChannel: Channel?
    private var levelTimer: DispatchSourceTimer?
    private var consecutiveNearSilentWindows = 0

    private var interruptionObserver: NSObjectProtocol?
    private var routeChangeObserver: NSObjectProtocol?
    private var configChangeObserver: NSObjectProtocol?
    private var mediaServicesResetObserver: NSObjectProtocol?
    private var muteObserver: NSObjectProtocol?
    /// Set once `processTap` has appended at least one real buffer this
    /// session -- gates the RMS≈0 "muted" heuristic in `emitLevelTick`
    /// (review fix: without this, the very first 1-2 level ticks after
    /// `start()` -- before the input hardware has actually produced any
    /// samples yet, e.g. Bluetooth mic negotiation -- read `peak == 0`
    /// from an accumulator nothing has `observe()`-d into yet, which is
    /// indistinguishable from "genuinely muted" without this flag, and
    /// would flash `muted: true` in the overlay at t=500ms for a session
    /// that was never actually muted).
    private var sawAudio = false

    // MARK: - debug capture fixture (C3 seam, iOS mirror of the Kotlin one)
    //
    // In a DEBUG build only, `<Documents>/voxis-capture-fixture.wav` (16 kHz
    // mono PCM16, 44-byte header) replaces the microphone: its samples are
    // streamed into the SAME level/cap path the tap feeds, paced to real
    // time, and `stop()` hands back the file's ORIGINAL bytes verbatim so
    // `voxis-fake-stt`'s sha map matches. Release builds never look for the
    // file — `#if DEBUG` removes the code, not just the branch.
    private var fixtureBytes: Data?
    private var fixtureSamples: [Float] = []
    private var fixtureCursor = 0
    private var fixtureTimer: DispatchSourceTimer?
    static let fixtureFileName = "voxis-capture-fixture.wav"

    init() {
        // Mute observer lives for the object's whole lifetime (not just
        // while a session is running) -- Task 8 step 5: iOS 17+'s system
        // mic-mute button/Control Center toggle can flip independently of
        // whether we're mid-`start()`, and this class has no other way to
        // learn the CURRENT mute state at the moment a fresh session
        // starts other than `AVAudioApplication.shared.isInputMuted`
        // (polled below) plus this notification while running.
        if #available(iOS 17.0, *) {
            muteObserver = NotificationCenter.default.addObserver(
                forName: AVAudioApplication.inputMuteStateChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in
                guard let self else { return }
                let notified = note.userInfo?[AVAudioApplication.muteStateKey] as? Bool
                let isMuted = notified ?? AVAudioApplication.shared.isInputMuted
                self.queue.async {
                    self.stateLock.lock()
                    self.muted = isMuted
                    self.stateLock.unlock()
                }
            }
        }
    }

    deinit {
        if let o = muteObserver { NotificationCenter.default.removeObserver(o) }
        removeFailureObservers()
    }

    // MARK: - start

    func start(path: String, capSamples: Int, onLevel: Channel, completion: @escaping (Result<Void, VoxisCaptureError>) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }

            self.stateLock.lock()
            let alreadyRunning = self.running
            self.stateLock.unlock()
            if alreadyRunning {
                completion(.failure(.alreadyRunning))
                return
            }

            #if DEBUG
            if let fixture = Self.loadFixture() {
                self.startFixture(fixture, path: path, capSamples: capSamples, onLevel: onLevel, completion: completion)
                return
            }
            #endif

            MicPermission.resolve { granted in
                self.queue.async {
                    guard granted else {
                        completion(.failure(.permissionDenied))
                        return
                    }
                    self.startEngine(path: path, capSamples: capSamples, onLevel: onLevel, completion: completion)
                }
            }
        }
    }

    #if DEBUG
    /// `(originalBytes, decodedSamples)` when the fixture file is present and
    /// well-formed; `nil` otherwise (absent file = the ordinary microphone).
    /// A present-but-malformed file is logged and IGNORED rather than
    /// half-used — see `FixtureWav`'s doc for why.
    private static func loadFixture() -> (Data, [Float])? {
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return nil }
        let url = docs.appendingPathComponent(fixtureFileName)
        guard let bytes = try? Data(contentsOf: url) else { return nil }
        guard let samples = FixtureWav.decodePCM16Mono16k(bytes) else {
            NSLog("voxis capture fixture at %@ is not 16 kHz mono PCM16 with a 44-byte header; using the microphone", url.path)
            return nil
        }
        return (bytes, samples)
    }

    /// Fixture start: no AVAudioSession, no permission prompt, no engine —
    /// a 250 ms timer feeds `ingestConverted` 4000 samples per tick (real
    /// time at 16 kHz) until the file runs out, then keeps ticking silence
    /// so the guard sees a natural trailing pause. Levels/cap/mute all go
    /// through the same code the tap uses; only the SOURCE is swapped.
    private func startFixture(_ fixture: (Data, [Float]), path: String, capSamples: Int, onLevel: Channel, completion: @escaping (Result<Void, VoxisCaptureError>) -> Void) {
        stateLock.lock()
        samples.removeAll(keepingCapacity: true)
        self.capSamples = capSamples > 0 ? capSamples : .max
        capHit = false
        overallPeakRms = 0
        interruptionReason = nil
        consecutiveNearSilentWindows = 0
        sawAudio = false
        muted = false
        running = true
        startInstant = DispatchTime.now()
        currentPath = path
        fixtureBytes = fixture.0
        fixtureSamples = fixture.1
        fixtureCursor = 0
        stateLock.unlock()

        let perTick = Int(Self.sampleRate) / 4
        let feeder = DispatchSource.makeTimerSource(queue: queue)
        feeder.schedule(deadline: .now(), repeating: .milliseconds(250))
        feeder.setEventHandler { [weak self] in
            guard let self else { return }
            let end = min(self.fixtureCursor + perTick, self.fixtureSamples.count)
            let chunk: [Float] = self.fixtureCursor < end
                ? Array(self.fixtureSamples[self.fixtureCursor..<end])
                : [Float](repeating: 0, count: perTick)
            self.fixtureCursor = end
            self.ingestConverted(chunk)
        }
        fixtureTimer = feeder
        feeder.resume()

        levelChannel = onLevel
        startLevelTimer()
        NSLog("voxis capture: DEBUG fixture in use (%d samples) instead of the microphone", fixture.1.count)
        completion(.success(()))
    }
    #endif

    private func startEngine(path: String, capSamples: Int, onLevel: Channel, completion: @escaping (Result<Void, VoxisCaptureError>) -> Void) {
        let session = AVAudioSession.sharedInstance()
        do {
            // `.record`, NOT `.playAndRecord`: no output-route negotiation
            // (haptics still work with no audio output route) -- Task 8
            // acceptance #1 / plan `[R1-iOS tactical]`. `.measurement`
            // disables the system's own signal processing (AGC/noise
            // suppression) so the guard's RMS thresholds see the same raw
            // signal desktop's `cpal` capture does.
            try session.setCategory(.record, mode: .measurement)
            try session.setActive(true)
        } catch {
            completion(.failure(.backend("AVAudioSession activation failed: \(error)")))
            return
        }

        // `[ADO-8]`: rebuild `engine` now, before anything below reads
        // `engine.inputNode`/calls `engine.prepare()`/`engine.start()`,
        // if the previous instance was invalidated by a media services
        // reset -- see `engine`'s own doc comment.
        if engineNeedsRebuildAfterReset {
            engine = AVAudioEngine()
            engineNeedsRebuildAfterReset = false
        }

        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Self.sampleRate, channels: 1, interleaved: false) else {
            completion(.failure(.backend("could not build the 16kHz mono output AVAudioFormat")))
            return
        }
        guard let converter = AVAudioConverter(from: inputFormat, to: outFormat) else {
            completion(.failure(.backend("could not build AVAudioConverter for the input node's format")))
            return
        }
        self.converter = converter
        self.outputFormat = outFormat

        stateLock.lock()
        samples.removeAll(keepingCapacity: true)
        self.capSamples = capSamples > 0 ? capSamples : .max
        capHit = false
        overallPeakRms = 0
        interruptionReason = nil
        consecutiveNearSilentWindows = 0
        sawAudio = false
        // Package.swift pins `platforms: [.iOS(.v16)]` (17+ APIs are
        // `#available`-gated at every call site), but some SwiftPM
        // build invocations (notably `swift-rs`'s own linker driver,
        // which built this exact package during the iOS cross-build
        // gate) do not consistently propagate that deployment target to
        // the compiler flags they pass -- explicit `#available` checks
        // around every `AVAudioApplication` use keep this file correct
        // either way, matching the style already used for the mute
        // notification observer in `init()` and `MicPermission.resolve`
        // (`MicPermission.swift`).
        if #available(iOS 17.0, *) {
            muted = AVAudioApplication.shared.isInputMuted
        }
        running = true
        startInstant = DispatchTime.now()
        currentPath = path
        stateLock.unlock()

        installFailureObservers()

        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            self?.queue.async {
                self?.processTap(buffer: buffer)
            }
        }

        do {
            engine.prepare()
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            // Review fix F4: observers were installed just above, before
            // this `engine.start()` attempt -- a throw here must not
            // leak them (the class only ever calls
            // `removeFailureObservers()` again from `teardownEngine`/
            // `failWithInterruption`, neither of which runs on this
            // early-return path).
            removeFailureObservers()
            stateLock.lock()
            running = false
            stateLock.unlock()
            completion(.failure(.backend("AVAudioEngine start failed: \(error)")))
            return
        }

        levelChannel = onLevel
        startLevelTimer()
        // Review fix "Cheap minors": `UIImpactFeedbackGenerator` is UIKit
        // and expects main-thread use (Main Thread Checker flags this on
        // device) -- `startEngine` itself runs on `queue`, not main.
        DispatchQueue.main.async {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }
        completion(.success(()))
    }

    // MARK: - tap -> converter -> accumulate (self-cap)

    /// Runs on `queue` (dispatched from the tap callback, never inline in
    /// it -- `AVAudioEngine` tap callbacks run on an internal realtime
    /// audio thread that must not block on `stateLock`/allocate
    /// unboundedly; hopping to `queue` immediately keeps that thread
    /// free, at the cost of processing slightly after the callback
    /// itself returns, which is harmless here since nothing downstream
    /// needs sample-accurate timing).
    private func processTap(buffer: AVAudioPCMBuffer) {
        guard let converter, let outputFormat else { return }
        let ratio = outputFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
        guard let outBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }

        var conversionError: NSError?
        var consumed = false
        let status = converter.convert(to: outBuffer, error: &conversionError) { _, outStatus in
            if consumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            outStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, let channelData = outBuffer.floatChannelData else {
            return
        }

        let frameCount = Int(outBuffer.frameLength)
        guard frameCount > 0 else { return }
        let pointer = channelData[0]
        let chunk = Array(UnsafeBufferPointer(start: pointer, count: frameCount))
        ingestConverted(chunk)
    }

    /// The one path every 16 kHz mono chunk takes — from the converted tap
    /// buffer in production, from the fixture feeder in a DEBUG test run.
    /// Runs on `queue`.
    private func ingestConverted(_ chunk: [Float]) {
        // Peak RMS over 10 ms sub-chunks within this 250 ms window (Task 8
        // acceptance #1: "max over 10 ms sub-chunks, mirroring desktop's
        // WindowPeakAccumulator") -- desktop's own cpal callback happens
        // to fire at a native buffer size close to this already; iOS's
        // `installTap` buffer size varies by device/route, so this
        // explicit re-chunking of the (already-converted, 16kHz) signal
        // keeps the level metric's granularity comparable across
        // backends regardless of the native tap buffer size. S2
        // (BLIND_SDK_swift.md finding #2): the actual sub-chunking/RMS math
        // now lives in `LevelMath.subChunkPeakRMS` (`VoxisAudioMath`
        // target), tested against the same fixture numbers
        // `desktop/pure.rs` uses -- `observe`'s own max-fold makes
        // observing this single pre-reduced peak equivalent to observing
        // every sub-chunk RMS individually, so behaviour is unchanged.
        let peakSinceLastEmit = LevelMath.subChunkPeakRMS(chunk, sampleRate: Self.sampleRate)
        windowPeak.observe(peakSinceLastEmit)

        stateLock.lock()
        defer { stateLock.unlock() }
        guard running, !capHit else { return }

        // Review fix "Cheap minors": at least one real tap buffer has now
        // been processed this session -- gates the RMS≈0 muted heuristic
        // in `emitLevelTick` (see `sawAudio`'s own doc comment).
        sawAudio = true
        overallPeakRms = max(overallPeakRms, peakSinceLastEmit)

        // Self-cap (`[R1-Arch S2]`): stop appending once `capSamples` is
        // reached, independent of the guard/pipeline above -- same
        // contract as desktop's `accumulate_capped`/`MockCapture`'s own
        // self-cap. `capSamples` arrives already expressed at 16kHz
        // (`capture.rs`'s own doc on `AudioCapture::start`) and this
        // buffer is already the 16kHz-converted signal, so no rate
        // scaling is needed here (unlike desktop's `CpalCapture`, whose
        // native device rate is unknown ahead of time). Slicing itself is
        // `LevelMath.selfCapSlice` (S2), tested against the same
        // `accumulate_capped` fixture numbers `desktop/pure.rs` uses.
        let (toAppend, hit) = LevelMath.selfCapSlice(existingCount: samples.count, chunk: chunk, capSamples: capSamples)
        samples.append(contentsOf: toAppend)
        capHit = hit
    }

    // MARK: - level ticks (250ms)

    private func startLevelTimer() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + .milliseconds(250), repeating: .milliseconds(250))
        timer.setEventHandler { [weak self] in
            self?.emitLevelTick()
        }
        levelTimer = timer
        timer.resume()
    }

    private func emitLevelTick() {
        // Review fix F1 belt-and-braces: `AVAudioEngineConfigurationChange`
        // (observed below) is the primary signal for "the engine stopped
        // itself mid-session" (hardware format change -- AirPods/BT/wired
        // mic connect), but if that notification is ever missed/delayed,
        // this timer -- which keeps firing regardless, since it is driven
        // by `queue`'s own `DispatchSourceTimer`, independent of the
        // engine -- would otherwise keep ticking `rms: 0` forever: the
        // near-silent heuristic below would call that "muted", the guard
        // would treat it as silence, and `stop()` would return a
        // fabricated success over truncated audio (desktop review M2's
        // exact failure class). Checking `engine.isRunning` directly here
        // catches that even if the notification never arrives.
        var engineExpected = true
        #if DEBUG
        engineExpected = fixtureTimer == nil  // the fixture feeder has no engine to check
        #endif
        if engineExpected && !engine.isRunning {
            failWithInterruption(reason: "engine stopped")
            return
        }

        let peak = windowPeak.takePeak()

        stateLock.lock()
        let hit = capHit
        var isMuted = muted
        let heuristicEligible = sawAudio
        stateLock.unlock()

        // Fallback heuristic (`[R1-iOS C3]`): if the system mute button's
        // notification never fires for a `.record` session on some
        // OS/device combination (unmeasured until T8.5 on real
        // hardware), detect RMS ~= 0 for >= 500ms (2 consecutive 250ms
        // windows) as muted -- the guard already treats real silence and
        // `muted: true` identically, so this heuristic being
        // indistinguishable from genuine silence in the false-positive
        // direction is harmless; the failure mode this guards against is
        // "mic is muted but we keep recording zeros and hallucinate",
        // same rationale as `capture.rs`'s own `LevelSample.muted` doc.
        // Review fix "Cheap minors": gated on `sawAudio` (at least one
        // real tap buffer this session) -- before the input hardware has
        // produced anything at all (the first tick or two after
        // `start()`), `peak` reads 0 from an accumulator nothing has fed
        // yet, which is NOT the same condition as "muted" and must not
        // flash `muted: true` in the overlay before any audio has had a
        // chance to arrive.
        // S2 (BLIND_SDK_swift.md finding #2): the counter/threshold logic
        // itself now lives in `LevelMath.advanceNearSilentWindowCount`/
        // `muteHeuristicTriggered` (`VoxisAudioMath` target) -- same
        // `nearSilentThreshold`/2-window rule, tested in isolation.
        consecutiveNearSilentWindows = LevelMath.advanceNearSilentWindowCount(
            current: consecutiveNearSilentWindows,
            peak: peak,
            eligible: heuristicEligible
        )
        isMuted = isMuted || LevelMath.muteHeuristicTriggered(consecutiveNearSilentWindows: consecutiveNearSilentWindows, eligible: heuristicEligible)

        let sample = LevelSampleWire(rms: peak, peak: peak, muted: isMuted, capHit: hit)
        try? levelChannel?.send(sample)

        if hit {
            // Self-cap reached: stop ticking (mirrors `MockCapture`'s own
            // "no more ticks past cap_samples") -- the tick that already
            // carried `capHit: true` is this session's last one; the
            // pipeline's `guard_adapter` treats that as an immediate
            // MaxDuration stop already, same as `guard_step`'s own
            // `cap_hit` parameter.
            levelTimer?.cancel()
            levelTimer = nil
        }
    }

    // MARK: - interruptions / route changes / engine + media failures
    // (Task 8 acceptance #2, review fix F1)

    /// Installs every notification observer that can end a session out
    /// from under it: `AVAudioSession` interruptions/route changes
    /// (original Task 8 scope) plus two review-round additions --
    /// `AVAudioEngineConfigurationChange` (F1: the engine stops *itself*
    /// on an input hardware format change -- AirPods/BT/wired mic
    /// connect mid-recording -- without posting an interruption or route
    /// change at all) and `mediaServicesWereResetNotification` (a full
    /// audio-subsystem reset; every `AVAudioSession`-related object,
    /// including this class's own long-lived `engine`, is documented by
    /// Apple as invalid afterwards). All four route through
    /// `failWithInterruption` with a **distinct** reason string per site
    /// so a `stop()` rejection (or a log of it) says which one actually
    /// fired, instead of a single generic "interrupted".
    private func installFailureObservers() {
        let center = NotificationCenter.default
        interruptionObserver = center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            self?.handleInterruption(note)
        }
        routeChangeObserver = center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            self?.handleRouteChange(note)
        }
        // `object: engine` (not `nil`) -- Apple's own doc for this
        // notification: register it on the specific engine instance.
        // `queue: .main` (an `OperationQueue`, decoupling this from
        // whatever thread posts the notification) matters more here than
        // for the two observers above: Apple's header explicitly warns
        // the notification "happens on an internal dispatch queue" and
        // that synchronously tearing the engine down from directly
        // inside that callback can deadlock -- routing through `.main`
        // first, then hopping to `queue` inside the handler (same as
        // `handleInterruption`/`handleRouteChange` already do), avoids
        // that entirely.
        configChangeObserver = center.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: .main
        ) { [weak self] _ in
            self?.queue.async {
                self?.failWithInterruption(reason: "engine configuration change")
            }
        }
        mediaServicesResetObserver = center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.queue.async {
                // `[ADO-8]`: ends the current session the same way any
                // other interruption does (no silent truncation reported
                // as success) AND marks `engine` for rebuild -- every
                // `AVAudioSession`-related object, including this class's
                // long-lived `engine`, is documented by Apple as invalid
                // after this notification. Without the flag, `engine` was
                // a `let` reused as-is by the next `startEngine()`, which
                // could then fail every session from here on (until the
                // whole process restarts) instead of just this one.
                self?.engineNeedsRebuildAfterReset = true
                self?.failWithInterruption(reason: "media services reset")
            }
        }
    }

    private func removeFailureObservers() {
        if let o = interruptionObserver {
            NotificationCenter.default.removeObserver(o)
            interruptionObserver = nil
        }
        if let o = routeChangeObserver {
            NotificationCenter.default.removeObserver(o)
            routeChangeObserver = nil
        }
        if let o = configChangeObserver {
            NotificationCenter.default.removeObserver(o)
            configChangeObserver = nil
        }
        if let o = mediaServicesResetObserver {
            NotificationCenter.default.removeObserver(o)
            mediaServicesResetObserver = nil
        }
    }

    private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        switch type {
        case .began:
            // Phone call, Siri, system alert, closed Smart Folio on iPad
            // (hardware-mute surfaces to the app as an interruption, not
            // silence, per the plan's own research note) -- finalize as
            // StreamDied: stop the engine now so `level_rx` ticks STOP
            // (the liveness signal `StreamDied -> Recover` polls for) and
            // record the reason for the next `stop()` call to reject with.
            queue.async { [weak self] in
                self?.failWithInterruption(reason: "session interruption")
            }
        case .ended:
            // Dictation is not music: never auto-resume even if the
            // system reports `.shouldResume` in `AVAudioSessionInterrup
            // tionOptionKey` (Task 8 acceptance #2 / plan `[R1-iOS C2]`).
            break
        @unknown default:
            break
        }
    }

    private func handleRouteChange(_ note: Notification) {
        guard let info = note.userInfo,
              let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else { return }
        if reason == .oldDeviceUnavailable {
            queue.async { [weak self] in
                self?.failWithInterruption(reason: "route: old device unavailable")
            }
        }
    }

    private func failWithInterruption(reason: String) {
        stateLock.lock()
        let wasRunning = running
        if wasRunning {
            running = false
            interruptionReason = reason
        }
        stateLock.unlock()
        guard wasRunning else { return }

        levelTimer?.cancel()
        levelTimer = nil
        levelChannel = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        removeFailureObservers()
        // Deliberately NOT deactivating `AVAudioSession` here or on any
        // app-lifecycle notification (`didEnterBackground`/
        // `willResignActive` -- this class installs no observer for
        // either): background recording (plan Task 9a/9b) requires the
        // session to survive the app leaving the foreground, and an
        // interruption's `.ended` case above already declines to
        // reactivate/resume on its own.
    }

    // MARK: - stop

    func stop(completion: @escaping (Result<CaptureStatsWire, VoxisCaptureError>) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }

            self.stateLock.lock()
            guard self.running || self.interruptionReason != nil else {
                self.stateLock.unlock()
                completion(.failure(.notRunning))
                return
            }
            let reason = self.interruptionReason
            self.running = false
            self.interruptionReason = nil
            let collected = self.samples
            let start = self.startInstant
            let peak = self.overallPeakRms
            let path = self.currentPath
            self.stateLock.unlock()

            self.teardownEngine()

            if let reason {
                completion(.failure(.interrupted(reason)))
                return
            }

            let durationMs: UInt64 = start.map {
                UInt64((DispatchTime.now().uptimeNanoseconds &- $0.uptimeNanoseconds) / 1_000_000)
            } ?? 0
            var wav = WavWriter.encode(samples: collected, sampleRate: UInt32(Self.sampleRate))
            #if DEBUG
            if let original = self.fixtureBytes {
                // Verbatim, so sha256(file) == the fake-stt map key (MockCapture semantics).
                wav = original
                self.fixtureBytes = nil
            }
            #endif

            guard let path else {
                completion(.failure(.backend("no session path recorded for this capture")))
                return
            }
            do {
                try self.writeProtectedFile(data: wav, path: path)
            } catch {
                completion(.failure(.backend("writing WAV to \(path): \(error)")))
                return
            }

            // Review fix "Cheap minors": main-thread, same reason as the
            // `start()`-side haptic above.
            DispatchQueue.main.async {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            completion(.success(CaptureStatsWire(durationMs: durationMs, samples: collected.count, peakRms: peak)))
        }
    }

    /// Writes `data` to `path` with `FileProtectionType.completeUnlessOpen`
    /// (readable/writable while this process holds it open, encrypted at
    /// rest the moment the device locks) and marks it excluded from
    /// iCloud/iTunes backup -- Task 8 acceptance #1 / plan `[R1-Safety S5]`.
    /// `path` is already inside the plugin's own `rec/` scratch dir
    /// (`capture.rs::RecDir`/`RecFile`, created 0600-equivalent by the
    /// Rust side before `start()` is ever called) -- this just fills in
    /// the WAV bytes and applies iOS's own protection/backup attributes
    /// on top.
    private func writeProtectedFile(data: Data, path: String) throws {
        let url = URL(fileURLWithPath: path)
        try data.write(to: url, options: [.completeFileProtectionUnlessOpen])
        var excluded = URLResourceValues()
        excluded.isExcludedFromBackup = true
        var mutableUrl = url
        try mutableUrl.setResourceValues(excluded)
    }

    private func teardownEngine() {
        #if DEBUG
        fixtureTimer?.cancel()
        fixtureTimer = nil
        #endif
        levelTimer?.cancel()
        levelTimer = nil
        levelChannel = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        removeFailureObservers()
    }

    // MARK: - reset

    /// Best-effort "back to idle" regardless of a prior `stop()` failure
    /// -- mirrors `AudioCapture::reset()`'s contract (`capture.rs`): the
    /// next `start()` must succeed even if the previous session ended via
    /// an interruption/error path that never called `stop()` cleanly.
    func reset() {
        queue.async { [weak self] in
            guard let self else { return }
            self.teardownEngine()
            self.stateLock.lock()
            self.running = false
            self.samples.removeAll()
            self.interruptionReason = nil
            self.currentPath = nil
            #if DEBUG
            self.fixtureBytes = nil
            self.fixtureSamples = []
            #endif
            self.stateLock.unlock()
        }
    }
}
