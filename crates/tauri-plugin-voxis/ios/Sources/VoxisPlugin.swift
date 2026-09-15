import Foundation
import Tauri
import UIKit
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

/// Tauri iOS plugin entry point (Task 8). Registers six commands, all
/// invoked from Rust's `mobile.rs` via `PluginHandle::run_mobile_plugin`
/// -- none of these are exposed to JS directly (the plugin's JS-facing
/// commands are the existing eleven in `commands.rs`/`build.rs`'s
/// `COMMANDS`; this class's commands are an internal Rust<->Swift
/// bridge only, matching `naked-plugin-capture`'s own
/// `CapturePlugin`/`Capture<R>` split).
///
/// Every `@objc func <name>(_ invoke: Invoke)` here returns almost
/// immediately -- the actual work (`VoxisAudioCapture`'s engine/Keychain
/// calls) happens off `Invoke`'s own serial `ipcDispatchQueue`, and
/// `invoke.resolve`/`invoke.reject` fire later from that other queue's
/// completion (Task 8 acceptance #6).
class VoxisPlugin: Plugin {
    private let capture = VoxisAudioCapture()

    override init() {
        super.init()
        #if DEBUG
        WavWriter.selfCheck()
        #endif
    }

    @objc func startCapture(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(StartCaptureArgs.self)
        capture.start(path: args.path, capSamples: args.capSamples, onLevel: args.onLevel) { result in
            switch result {
            case .success:
                invoke.resolve()
            case .failure(let error):
                if error.code == "PERMISSION_DENIED" {
                    // Task 8 acceptance #4: deep-link hint to Settings,
                    // carried as reject `data` (not baked into `message`)
                    // so the Rust/JS side can build its own UI copy
                    // around the raw URL string.
                    invoke.reject(
                        error.message,
                        code: error.code,
                        data: .dictionary(["settingsUrl": UIApplication.openSettingsURLString])
                    )
                } else {
                    invoke.reject(error.message, code: error.code)
                }
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
}

@_cdecl("init_plugin_voxis")
func initPlugin() -> Plugin {
    return VoxisPlugin()
}
