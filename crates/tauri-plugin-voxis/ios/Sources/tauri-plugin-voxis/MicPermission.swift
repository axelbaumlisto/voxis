import AVFoundation

/// Microphone permission resolution -- lifted out of
/// `VoxisAudioCapture` (BLIND_SDK_swift.md finding #3: that class was
/// doing session/engine/tap/permission/level-math/haptics all at once;
/// this piece needs neither `AVAudioEngine` nor `stateLock`, so it gets
/// its own testable-in-isolation unit). No behaviour change from the
/// method this replaces (`VoxisAudioCapture.requestPermissionIfNeeded`)
/// -- same iOS 16/17 branch, same three-state switch on each.
enum MicPermission {
    /// Task 8 acceptance #4: `AVAudioApplication.requestRecordPermission`
    /// (iOS 17) is asynchronous by design -- its completion runs on an
    /// arbitrary queue, never blocking the caller. This method never
    /// waits on it with a semaphore/`DispatchGroup.wait()`; the whole
    /// point of taking a `completion` closure here (rather than
    /// returning `Bool`) is that the caller's own `queue.async` block has
    /// already returned control to the dispatch queue by the time the
    /// permission prompt (if shown) is answered.
    static func resolve(completion: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted:
                completion(true)
            case .denied:
                completion(false)
            case .undetermined:
                AVAudioApplication.requestRecordPermission { granted in
                    completion(granted)
                }
            @unknown default:
                completion(false)
            }
        } else {
            // iOS 16 (owner 2026-09-16: «пусть работает и на 16-й»): the
            // pre-17 permission API lives on AVAudioSession. Deprecated in
            // 17 but still the only one available on 16 -- same three states.
            let session = AVAudioSession.sharedInstance()
            switch session.recordPermission {
            case .granted:
                completion(true)
            case .denied:
                completion(false)
            case .undetermined:
                session.requestRecordPermission { granted in
                    completion(granted)
                }
            @unknown default:
                completion(false)
            }
        }
    }
}
