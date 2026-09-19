package top.voxis.plugin

import android.Manifest
import android.app.Activity
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/** `StartCaptureArgs` under `#[serde(rename_all = "camelCase")]` (mobile.rs). */
@InvokeArg
class StartCaptureArgs {
    lateinit var path: String
    var capSamples: Int = 0
    lateinit var onLevel: Channel
}

/**
 * The Android half of tauri-plugin-voxis -- the SAME three commands
 * `ios/Sources/tauri-plugin-voxis/VoxisPlugin.swift` exposes to
 * `src/mobile.rs` (`startCapture`/`stopCapture`/`resetCapture`), the same
 * reject codes (`ALREADY_RUNNING` / `NOT_RUNNING` / `PERMISSION_DENIED`).
 * No Keychain-style secret commands: an Android host injects its own
 * `SecretStore` (`init_android_with(secrets)` requires one). No Live
 * Activity (ActivityKit is iOS).
 *
 * Microphone permission: `RECORD_AUDIO` is a runtime grant. `startCapture`
 * asks first; the system dialog answers through `micPermissionCallback`
 * with the SAME `Invoke`, so the start either proceeds or rejects
 * `PERMISSION_DENIED` -- one command, never a second round-trip for Rust.
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = VoxisPlugin.MIC)
    ]
)
class VoxisPlugin(private val activity: Activity) : Plugin(activity) {
    companion object { const val MIC = "microphone" }

    private val capture = VoxisAudioCapture()

    @Command
    fun startCapture(invoke: Invoke) {
        if (getPermissionState(MIC) != PermissionState.GRANTED) {
            requestPermissionForAlias(MIC, invoke, "micPermissionCallback")
            return
        }
        doStart(invoke)
    }

    @PermissionCallback
    private fun micPermissionCallback(invoke: Invoke) {
        if (getPermissionState(MIC) != PermissionState.GRANTED) {
            val e = VoxisCaptureError.permissionDenied()
            invoke.reject(e.message, e.code)
            return
        }
        doStart(invoke)
    }

    private fun doStart(invoke: Invoke) {
        val args = try { invoke.parseArgs(StartCaptureArgs::class.java) } catch (e: Exception) {
            invoke.reject("startCapture: bad args: $e", "BACKEND"); return
        }
        capture.start(args.path, args.capSamples, args.onLevel) { result ->
            result.fold(
                onSuccess = { invoke.resolve() },
                onFailure = { rejectWith(invoke, it) },
            )
        }
    }

    @Command
    fun stopCapture(invoke: Invoke) {
        capture.stop { result ->
            result.fold(
                onSuccess = { stats ->
                    invoke.resolve(JSObject().apply {
                        put("durationMs", stats.durationMs)
                        put("samples", stats.samples)
                        put("peakRms", stats.peakRms.toDouble())
                    })
                },
                onFailure = { rejectWith(invoke, it) },
            )
        }
    }

    @Command
    fun resetCapture(invoke: Invoke) {
        capture.reset { invoke.resolve() }
    }

    private fun rejectWith(invoke: Invoke, t: Throwable) {
        val e = t as? VoxisCaptureError ?: VoxisCaptureError.backend(t.toString())
        invoke.reject(e.message, e.code)
    }
}
