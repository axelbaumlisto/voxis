import Foundation
import Tauri
import WebKit

/// `startCapture` args -- field names match `mobile.rs`'s
/// `StartCaptureArgs` under `#[serde(rename_all = "camelCase")]`.
/// `onLevel` decodes straight from the `"__CHANNEL__:<id>"` string the
/// Rust side's `tauri::ipc::Channel` serializes to (`Channel: Decodable`
/// in Tauri's own Swift package) -- created Rust-side, never from JS
/// (`[R1-iOS C5]`).
struct StartCaptureArgs: Decodable {
    let path: String
    let capSamples: Int
    let onLevel: Channel
}

struct SecretNameArgs: Decodable {
    let name: String
}

struct SecretSetArgs: Decodable {
    let name: String
    let value: String
}

struct SecretGetResult: Encodable {
    let value: String?
}

/// `registerIntentChannel` args -- field name matches `mobile.rs`'s
/// `RegisterIntentChannelArgs` (Task 9a).
struct RegisterIntentChannelArgs: Decodable {
    let onIntent: Channel
}

/// `liveActivityStart` args -- field name matches `mobile.rs`'s
/// `LiveActivityStartArgs`. Unix epoch milliseconds, not an ISO string:
/// `Channel`/`Invoke`'s own JSON bridge already has a `Date` ->
/// ISO8601-string convention (`JsonValue.swift`'s `prepare(dictionary:)`)
/// for values *leaving* Swift, but nothing analogous for values
/// *arriving* as plain `Decodable` args -- a plain integer avoids
/// needing a custom `Date` decoding strategy for one field.
struct LiveActivityStartArgs: Decodable {
    let startedAtMs: UInt64
}

/// `liveActivityUpdate` args -- field names match `mobile.rs`'s
/// `LiveActivityUpdateArgs`.
struct LiveActivityUpdateArgs: Decodable {
    let phase: String
    let elapsedSeconds: UInt64?
    let peak: Float
}

/// Tauri iOS plugin entry point (Task 8, +4 commands in Task 9a).
/// Registers ten commands, all invoked from Rust's `mobile.rs` via
/// `PluginHandle::run_mobile_plugin` -- none of these are exposed to JS
/// directly (the plugin's JS-facing commands are the existing eleven in
/// `commands.rs`/`build.rs`'s `COMMANDS`; this class's commands are an
/// internal Rust<->Swift bridge only, matching `naked-plugin-capture`'s
/// own `CapturePlugin`/`Capture<R>` split).
///
/// Every `@objc func <name>(_ invoke: Invoke)` here returns almost
/// immediately -- the actual work (`VoxisAudioCapture`'s engine/Keychain
/// calls) happens off `Invoke`'s own serial `ipcDispatchQueue`, and
/// `invoke.resolve`/`invoke.reject` fire later from that other queue's
/// completion (Task 8 acceptance #6).
class VoxisPlugin: Plugin {
    private let capture = VoxisAudioCapture()
    private let liveActivity = VoxisLiveActivityBridge()

    override init() {
        super.init()
        // Task 9a: the one instance this process ever creates -- see
        // `VoxisLiveActivityBridge.shared`'s own doc for why
        // `StopDictationIntent.perform()` needs a static handle onto it.
        VoxisLiveActivityBridge.shared = liveActivity
        // S2 (BLIND_SDK_swift.md finding #2): `WavWriter.selfCheck()` used
        // to run here as a DEBUG-only `assert()` -- compiled out in
        // release, not a CI gate, and only exercised once an app actually
        // launched in a debug host. It is now a real XCTest
        // (`Tests/tauri-plugin-voxisTests/WavWriterTests.swift`, run via
        // `swift test`), so there is nothing left to call here.
    }

    @objc func startCapture(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(StartCaptureArgs.self)
        capture.start(path: args.path, capSamples: args.capSamples, onLevel: args.onLevel) { result in
            switch result {
            case .success:
                invoke.resolve()
            case .failure(let error):
                // Review fix (BLIND_SDK_swift.md finding #1): the Settings
                // deep-link used to ride along as reject `data` here, but
                // `mobile.rs::map_invoke_error` only ever read `code`/
                // `message` -- the `data` dictionary reached no consumer
                // on either side of the bridge. `error.message` already
                // spells out "open Settings to grant microphone access"
                // (`AudioCapture.swift`'s `VoxisCaptureError.permissionDenied`),
                // so this reject needs nothing beyond the plain message/code
                // every other command here already sends.
                invoke.reject(error.message, code: error.code)
            }
        }
    }

    @objc func stopCapture(_ invoke: Invoke) throws {
        capture.stop { result in
            switch result {
            case .success(let stats):
                invoke.resolve(stats)
            case .failure(let error):
                invoke.reject(error.message, code: error.code)
            }
        }
    }

    @objc func resetCapture(_ invoke: Invoke) throws {
        capture.reset()
        invoke.resolve()
    }

    @objc func secretGet(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SecretNameArgs.self)
        do {
            let value = try VoxisKeychainSecretStore.get(name: args.name)
            invoke.resolve(SecretGetResult(value: value))
        } catch {
            // Keys are never logged (module doc, `KeychainSecretStore.swift`)
            // -- only the OSStatus/decode-failure case name reaches here.
            invoke.reject("keychain get failed: \(error)")
        }
    }

    @objc func secretSet(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SecretSetArgs.self)
        do {
            try VoxisKeychainSecretStore.set(name: args.name, value: args.value)
            invoke.resolve()
        } catch {
            invoke.reject("keychain set failed: \(error)")
        }
    }

    @objc func secretDelete(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SecretNameArgs.self)
        do {
            try VoxisKeychainSecretStore.delete(name: args.name)
            invoke.resolve()
        } catch {
            invoke.reject("keychain delete failed: \(error)")
        }
    }

    // MARK: - Live Activity (Task 9a)
    //
    // All four handlers below resolve immediately regardless of what
    // `VoxisLiveActivityBridge` actually does with the call (Task 9a
    // acceptance #2: ActivityKit failures/unavailability are never
    // errors) -- there is no `invoke.reject` path in any of them, unlike
    // `startCapture`/`secretGet`/etc above, by design.

    @objc func registerIntentChannel(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(RegisterIntentChannelArgs.self)
        liveActivity.registerIntentChannel(args.onIntent)
        invoke.resolve()
    }

    @objc func liveActivityStart(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(LiveActivityStartArgs.self)
        let startedAt = Date(timeIntervalSince1970: Double(args.startedAtMs) / 1000)
        liveActivity.start(startedAt: startedAt)
        invoke.resolve()
    }

    @objc func liveActivityUpdate(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(LiveActivityUpdateArgs.self)
        liveActivity.update(phaseRaw: args.phase, elapsedSeconds: args.elapsedSeconds.map { Int($0) }, peak: Double(args.peak))
        invoke.resolve()
    }

    @objc func liveActivityEnd(_ invoke: Invoke) throws {
        liveActivity.end()
        invoke.resolve()
    }
}

@_cdecl("init_plugin_voxis")
func initPlugin() -> Plugin {
    return VoxisPlugin()
}
