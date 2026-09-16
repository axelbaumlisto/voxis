//! iOS mobile bridge (Task 8): registers the Swift `VoxisPlugin`
//! (`ios/Sources/VoxisPlugin.swift`) with Tauri's mobile plugin bridge
//! and implements this crate's `AudioCapture`/`SecretStore` traits on
//! top of six Swift-side commands, reached via
//! `tauri::plugin::PluginHandle::run_mobile_plugin` -- none of these six
//! are part of `build.rs`'s `COMMANDS`/`lib.rs`'s `generate_handler!`:
//! they are an internal Rust<->Swift bridge, invoked only from
//! `IosCapture`/`IosKeychainSecretStore` below, never directly from JS
//! (mirrors `naked-plugin-capture`'s own `mobile.rs`/`CapturePlugin`
//! split: JS calls the plugin's own `#[tauri::command]`s in
//! `commands.rs`, which call into this module's types through the
//! `AudioCapture`/`SecretStore` trait objects already threaded through
//! `PluginState`).
//!
//! **`run_mobile_plugin` is blocking** (Tauri's own
//! `plugin/mobile.rs::run_command` on iOS waits on a `std::sync::mpsc`
//! `rx.recv()` for Swift's `invoke.resolve`/`reject`) -- Task 8
//! acceptance #6. `AudioCapture::start`/`stop`/`reset` and
//! `SecretStore::get`/`set`/`delete` are all synchronous trait methods
//! (`capture.rs`/`secrets.rs`), and both `IosCapture` and
//! `IosKeychainSecretStore` call `run_mobile_plugin` directly, on
//! whatever thread invoked them -- **honestly**: this blocks the calling
//! thread for the duration of one Swift round-trip. There is no
//! `.await` anywhere in this module to yield through.
//!
//! (Review round 2, F2: an earlier revision of this module wrapped every
//! call in `tauri::async_runtime::spawn_blocking` + a `std::sync::mpsc`
//! `rx.recv()`, on the theory that this kept the round-trip off Tokio's
//! async worker pool. It did not: the calling thread still blocked on
//! `rx.recv()` for the exact same duration either way, so the "worker
//! thread pinned for the round-trip" cost was identical, just relocated
//! -- the wrapper added an extra thread hop and an extra doc claim with
//! no real benefit. Removed.)
//!
//! Swift's own command handlers (`VoxisPlugin.swift`) stay short by
//! design -- they dispatch the real work (`AVAudioEngine`/Keychain
//! calls) onto their own `DispatchQueue` and only call
//! `invoke.resolve`/`reject` from that queue's completion, so Tauri's
//! serial `ipcDispatchQueue` is free again immediately, independent of
//! how long the underlying operation (a permission prompt, e.g.) takes
//! -- what this module's own blocking call is actually bounded by is
//! that one Swift-side operation, not the `ipcDispatchQueue` itself.
//!
//! **Follow-up (not done here, out of this task's scope):**
//! `commands.rs`'s `async fn do_start`/`do_stop` call `state.capture.
//! start`/`stop` directly, synchronously, from a Tokio-polled task --
//! that call already blocks whichever Tokio worker thread is running it
//! for the same one-round-trip duration this module's own doc describes
//! (matching desktop's own established precedent: `CpalCapture::stop()`
//! also blocks its caller synchronously, joining two OS threads,
//! `desktop.rs`'s own module doc). Wrapping *that* call site in
//! `tauri::async_runtime::spawn_blocking(..).await` would be the actual
//! fix (it genuinely frees the worker thread while the blocking work
//! runs elsewhere, since `.await`ing a `JoinHandle` yields instead of
//! parking) -- `commands.rs` is not in this task's file list, so that
//! change is deferred, not silently done here.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    plugin::{mobile::PluginInvokeError, PluginApi, PluginHandle},
    AppHandle, Runtime,
};
use tokio::sync::watch;

use voxis_core::profile::Secret;

use crate::capture::{AudioCapture, CaptureError, CaptureStats, LevelSample};
use crate::secrets::{SecretResult, SecretStore};

// Binds this crate's Swift plugin's `@_cdecl("init_plugin_voxis")` entry
// point (`ios/Sources/VoxisPlugin.swift`) to a Rust-callable function
// pointer -- expands to `tauri::swift_rs::swift!(fn init_plugin_voxis()
// -> *const ::std::ffi::c_void);` (see `tauri::ios_plugin_binding!`'s own
// doc comment), same one-line pattern as
// `naked-plugin-capture/src/mobile.rs`. Plain `//` comment, not `///`:
// this expands to a macro invocation, not an item rustdoc can attach
// documentation to.
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_voxis);

/// Registers `VoxisPlugin` with Tauri's iOS bridge during this plugin's
/// own `setup` hook (`lib.rs::init_ios`) and returns the handle
/// `IosCapture`/`IosKeychainSecretStore` wrap.
pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<PluginHandle<R>, Box<dyn std::error::Error>> {
    Ok(api.register_ios_plugin(init_plugin_voxis)?)
}

fn map_invoke_error(e: PluginInvokeError) -> CaptureError {
    match e {
        PluginInvokeError::InvokeRejected(err) => {
            let message = err.message.clone().unwrap_or_else(|| err.to_string());
            match err.code.as_deref() {
                Some("ALREADY_RUNNING") => CaptureError::AlreadyRunning,
                Some("NOT_RUNNING") => CaptureError::NotRunning,
                // S1: the one Swift reject code that has a matching
                // `CaptureError`/`PluginError` variant to surface through
                // (`error.rs`'s `From<CaptureError>` routes this to
                // `PluginError::PermissionDenied`, the SAME `kind` tag
                // desktop's OS-permission path already uses) -- previously
                // collapsed into `Backend`, silently losing the fact that
                // this is a permission denial and not a generic backend
                // failure.
                Some("PERMISSION_DENIED") => CaptureError::PermissionDenied(message),
                // Every reject code `ios/Sources/VoxisPlugin.swift` can
                // actually produce (from `AudioCapture.swift`'s
                // `VoxisCaptureError` statics), enumerated for the record:
                // ALREADY_RUNNING, NOT_RUNNING, PERMISSION_DENIED (all
                // mapped above), INTERRUPTED, and BACKEND -- neither of the
                // last two has a dedicated `CaptureError` variant (an
                // interrupted session is still reported as a backend
                // failure to `stop()`'s caller, same as today), so both
                // fold into `Backend` with the original Swift-side message
                // preserved.
                _ => CaptureError::Backend(message),
            }
        }
        other => CaptureError::Backend(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::plugin::mobile::ErrorResponse;

    use crate::error::PluginError;

    fn rejected(code: &str, message: &str) -> PluginInvokeError {
        PluginInvokeError::InvokeRejected(ErrorResponse {
            code: Some(code.to_string()),
            message: Some(message.to_string()),
            data: (),
        })
    }

    /// S1 acceptance test: a Swift `PERMISSION_DENIED` reject must reach
    /// the frontend as `PluginError`'s `permissionDenied` `kind` tag --
    /// the SAME shape desktop's own OS-permission-denial path
    /// (`hotkey_desktop.rs`'s `PluginError::PermissionDenied`) already
    /// serializes, not collapsed into the generic `capture` kind.
    #[test]
    fn permission_denied_reject_maps_to_permission_denied_capture_error() {
        let err = map_invoke_error(rejected("PERMISSION_DENIED", "microphone permission denied"));
        assert!(matches!(err, CaptureError::PermissionDenied(ref m) if m == "microphone permission denied"));
    }

    #[test]
    fn permission_denied_capture_error_serializes_with_permission_denied_kind() {
        let err = map_invoke_error(rejected("PERMISSION_DENIED", "microphone permission denied"));
        let plugin_err: PluginError = err.into();
        let value = serde_json::to_value(plugin_err).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"kind": "permissionDenied", "message": "microphone permission denied"})
        );
    }

    #[test]
    fn already_running_and_not_running_codes_still_map_as_before() {
        assert!(matches!(map_invoke_error(rejected("ALREADY_RUNNING", "x")), CaptureError::AlreadyRunning));
        assert!(matches!(map_invoke_error(rejected("NOT_RUNNING", "x")), CaptureError::NotRunning));
    }

    #[test]
    fn interrupted_and_unknown_codes_still_collapse_into_backend() {
        assert!(matches!(map_invoke_error(rejected("INTERRUPTED", "session interruption")), CaptureError::Backend(ref m) if m == "session interruption"));
        assert!(matches!(map_invoke_error(rejected("BACKEND", "boom")), CaptureError::Backend(ref m) if m == "boom"));
    }
}

fn box_secret_err(e: PluginInvokeError) -> Box<dyn std::error::Error + Send + Sync> {
    Box::new(std::io::Error::other(e.to_string()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartCaptureArgs {
    path: String,
    cap_samples: usize,
    on_level: Channel<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StopCaptureResultWire {
    duration_ms: u64,
    samples: usize,
    peak_rms: f32,
}

impl From<StopCaptureResultWire> for CaptureStats {
    fn from(w: StopCaptureResultWire) -> Self {
        CaptureStats { duration_ms: w.duration_ms, samples: w.samples, peak_rms: w.peak_rms }
    }
}

/// Decoded from the `Channel`'s `InvokeResponseBody` -- field names
/// match `ios/Sources/AudioCapture.swift`'s `LevelSampleWire`
/// (`#[serde(rename_all = "camelCase")]` on this side, plain camelCase
/// Swift property names on that one; `JSONEncoder`'s default key
/// strategy already emits exactly these names, no `CodingKeys` needed
/// on either side).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LevelSampleWire {
    rms: f32,
    peak: f32,
    muted: bool,
    cap_hit: bool,
}

impl From<LevelSampleWire> for LevelSample {
    fn from(w: LevelSampleWire) -> Self {
        LevelSample { rms: w.rms, peak: w.peak, muted: w.muted, cap_hit: w.cap_hit }
    }
}

#[derive(Serialize)]
struct EmptyArgs {}

/// `AudioCapture` backed by the Swift `VoxisAudioCapture`
/// (`ios/Sources/AudioCapture.swift`) via `startCapture`/`stopCapture`/
/// `resetCapture`. One instance per plugin, matching the trait's own
/// single-session assumption (`capture.rs`'s doc, same as
/// `CpalCapture`/`MockCapture`).
pub struct IosCapture<R: Runtime> {
    handle: PluginHandle<R>,
    level_rx: watch::Receiver<Option<LevelSample>>,
    /// Created exactly once, in `new` -- **not** per `start()` call.
    ///
    /// Review round 2, F5: `tauri::ipc::Channel::new` registers itself in
    /// Tauri's own process-global `CHANNELS` map (`tauri::plugin::mobile::
    /// register_channel`) and nothing in that map is ever removed for a
    /// mobile-bridge channel (there is no matching "unregister" call
    /// anywhere in Tauri's own mobile plugin support, unlike a JS-side
    /// channel, which the webview can eventually drop). A fresh `Channel::
    /// new(..)` on every `start()` therefore leaked one entry per
    /// start/stop cycle for the lifetime of the process. `Channel<TSend>`
    /// is cheap to `Clone` (an `Arc<ChannelInner>` bump -- same `inner.id`,
    /// same registration), so creating it once here and cloning it into
    /// each `StartCaptureArgs` reuses the one registration for every
    /// session instead.
    on_level: Channel<serde_json::Value>,
}

impl<R: Runtime> IosCapture<R> {
    pub fn new(handle: PluginHandle<R>) -> Self {
        let (level_tx, level_rx) = watch::channel(None);
        // Rust-side `Channel`, passed to Swift as a `start` argument --
        // `[R1-iOS C5]`: created here, never from JS. Owns `level_tx`
        // itself (not a per-`start()` clone of it) since the channel
        // itself is now also created once, not per session.
        let on_level = Channel::new(move |body: InvokeResponseBody| {
            match body.deserialize::<LevelSampleWire>() {
                Ok(sample) => {
                    let _ = level_tx.send(Some(sample.into()));
                }
                Err(e) => tracing::warn!(error = %e, "failed to decode an iOS level sample"),
            }
            Ok(())
        });
        Self { handle, level_rx, on_level }
    }
}

impl<R: Runtime> AudioCapture for IosCapture<R> {
    /// `cap_samples` arrives expressed in samples at 16 kHz
    /// (`capture.rs`'s own doc on this trait method) -- Swift's
    /// `AVAudioConverter` already downsamples the tap's native-rate
    /// input to 16 kHz mono before `VoxisAudioCapture` ever compares a
    /// sample count against `capSamples`, so (unlike desktop's
    /// `CpalCapture`, whose native device rate is unknown ahead of time
    /// and needs `desktop::pure::scale_cap_samples`) no rescaling is
    /// needed on this side of the bridge either.
    ///
    /// Calls `run_mobile_plugin` directly, on whatever thread called
    /// this method -- blocking it for one Swift round-trip (this
    /// module's own doc comment).
    fn start(&self, path: &Path, cap_samples: usize) -> Result<(), CaptureError> {
        let args = StartCaptureArgs {
            path: path.to_string_lossy().into_owned(),
            cap_samples,
            on_level: self.on_level.clone(),
        };
        self.handle
            .run_mobile_plugin::<serde_json::Value>("startCapture", args)
            .map(|_| ())
            .map_err(map_invoke_error)
    }

    fn stop(&self) -> Result<CaptureStats, CaptureError> {
        self.handle
            .run_mobile_plugin::<StopCaptureResultWire>("stopCapture", EmptyArgs {})
            .map(Into::into)
            .map_err(map_invoke_error)
    }

    fn level_rx(&self) -> watch::Receiver<Option<LevelSample>> {
        self.level_rx.clone()
    }

    fn reset(&self) {
        // Best-effort, same as the trait's default no-op -- a failed
        // reset call has nowhere useful to report to (the trait method
        // returns `()`), so this only logs (via `map_invoke_error`'s
        // caller doing nothing with the error).
        let _ = self
            .handle
            .run_mobile_plugin::<serde_json::Value>("resetCapture", EmptyArgs {})
            .map(|_| ())
            .map_err(map_invoke_error);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretNameArgs<'a> {
    name: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretSetArgs<'a> {
    name: &'a str,
    value: &'a str,
}

#[derive(Deserialize)]
struct SecretGetResult {
    value: Option<String>,
}

// -- Task 9a: Live Activity / Dynamic Island bridge ---------------------
//
// Two directions cross this bridge, both via the same three plain
// `run_mobile_plugin` calls `IosCapture`/`IosKeychainSecretStore` already
// use (no new IPC mechanism):
//
// - Rust -> Swift: `LiveActivityController::start`/`update`/`end`, driven
//   by `lib.rs`'s `LiveActivityEventSink` decorator observing
//   `voxis://state`/`voxis://level` transitions (`[R1-iOS tactical]`).
//   Best-effort by design (Task 9a acceptance #2: "never throws into the
//   pipeline") -- every one of these three logs and returns on failure,
//   never propagates a `CaptureError`/`PluginError` anywhere.
// - Swift -> Rust: the Lock Screen/Dynamic Island Stop button
//   (`StopDictationIntent`, `ios/LiveActivityWidget/StopDictationIntent.swift`)
//   runs `perform()` **in this app process** (Apple's own documented
//   behaviour for `LiveActivityIntent`, plan `[R1-iOS C1]`) and reaches
//   `VoxisLiveActivityBridge.shared` (`ios/Sources/LiveActivity.swift`),
//   which forwards `{"action": "stop"}` through a Rust-created `Channel`
//   -- same "created once, handed to Swift, never from JS" convention
//   `IosCapture::new`'s own `on_level` channel already established
//   (`[R1-iOS C5]`-adjacent), registered exactly once via
//   `register_intent_channel` (`lib.rs::init_ios_with`, right after
//   `mobile::init` builds the plugin handle).

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterIntentChannelArgs {
    on_intent: Channel<serde_json::Value>,
}

#[derive(Deserialize)]
struct IntentPayloadWire {
    action: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveActivityStartArgs {
    started_at_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveActivityUpdateArgs {
    phase: String,
    elapsed_seconds: Option<u64>,
    peak: f32,
}

/// Rust-side handle onto the Swift `VoxisLiveActivityBridge`
/// (`ios/Sources/LiveActivity.swift`), reached through the same
/// `PluginHandle` `IosCapture`/`IosKeychainSecretStore` already use --
/// one instance, constructed once in `lib.rs::init_ios_with`.
pub struct LiveActivityController<R: Runtime> {
    handle: PluginHandle<R>,
}

impl<R: Runtime> LiveActivityController<R> {
    pub fn new(handle: PluginHandle<R>) -> Self {
        Self { handle }
    }

    /// Registers Rust's own intent-forwarding channel with Swift, once.
    /// `on_stop` runs synchronously on whatever thread decodes the
    /// channel payload (same as `IosCapture`'s `on_level` closure) --
    /// callers that need to `.await` anything (this crate's own
    /// `commands::do_stop`) spawn their own task instead of blocking
    /// this callback.
    pub fn register_intent_channel(&self, on_stop: impl Fn() + Send + Sync + 'static) {
        let channel = Channel::new(move |body: InvokeResponseBody| {
            match body.deserialize::<IntentPayloadWire>() {
                Ok(payload) if payload.action == "stop" => on_stop(),
                Ok(payload) => {
                    tracing::warn!(action = %payload.action, "unrecognised Live Activity intent action")
                }
                Err(e) => tracing::warn!(error = %e, "failed to decode a Live Activity intent payload"),
            }
            Ok(())
        });
        if let Err(e) = self
            .handle
            .run_mobile_plugin::<serde_json::Value>("registerIntentChannel", RegisterIntentChannelArgs { on_intent: channel })
        {
            // Task 9a acceptance #2: dictation itself must still work even
            // if this registration call fails -- there is simply no Stop
            // button forwarding for this process's lifetime.
            tracing::warn!(
                error = %e,
                "registering the Live Activity intent channel failed -- the Stop button (if shown) will not work this session"
            );
        }
    }

    /// Starts a Live Activity for a session that just entered
    /// `Recording`. `started_at_ms` is Unix epoch milliseconds (Swift
    /// reconstructs a `Date` from it) -- best-effort: Swift's own
    /// `liveActivityStart` resolves regardless of whether `ActivityKit`
    /// actually created the activity (`LiveActivity.swift`'s own doc
    /// covers the disabled/unavailable cases); a transport-level failure
    /// here is only logged.
    pub fn start(&self, started_at_ms: u64) {
        if let Err(e) = self
            .handle
            .run_mobile_plugin::<serde_json::Value>("liveActivityStart", LiveActivityStartArgs { started_at_ms })
        {
            tracing::warn!(error = %e, "starting the Live Activity failed -- continuing without it");
        }
    }

    /// Updates the running Live Activity's phase/elapsed/peak. `phase` is
    /// one of `VoxisActivityAttributes.Phase`'s raw values
    /// (`"recording"`/`"transcribing"`/`"idle"`) -- a plain `&str`, not a
    /// shared Rust enum, since this crate's own `models::State` has no
    /// `idle` variant worth threading through for a call site that never
    /// actually sends it (`end()` handles that transition instead).
    pub fn update(&self, phase: &str, elapsed_seconds: Option<u64>, peak: f32) {
        if let Err(e) = self.handle.run_mobile_plugin::<serde_json::Value>(
            "liveActivityUpdate",
            LiveActivityUpdateArgs { phase: phase.to_string(), elapsed_seconds, peak },
        ) {
            tracing::warn!(error = %e, "updating the Live Activity failed -- continuing without it");
        }
    }

    /// Ends the running Live Activity (`dismissalPolicy: .immediate` on
    /// the Swift side -- Task 9a acceptance #2: "at stop/cancel the
    /// activity ends within ~1s", not left on the Lock Screen for the OS
    /// default of up to 4h).
    pub fn end(&self) {
        if let Err(e) = self.handle.run_mobile_plugin::<serde_json::Value>("liveActivityEnd", EmptyArgs {}) {
            tracing::warn!(error = %e, "ending the Live Activity failed -- it may remain visible up to the OS default (4h)");
        }
    }
}

/// `SecretStore` backed by the Swift `VoxisKeychainSecretStore`
/// (`ios/Sources/KeychainSecretStore.swift`) via `secretGet`/`secretSet`/
/// `secretDelete` -- Task 8 acceptance #5. Same blocking
/// `run_mobile_plugin` contract as `IosCapture` above.
pub struct IosKeychainSecretStore<R: Runtime> {
    handle: PluginHandle<R>,
}

impl<R: Runtime> IosKeychainSecretStore<R> {
    pub fn new(handle: PluginHandle<R>) -> Self {
        Self { handle }
    }
}

impl<R: Runtime> SecretStore for IosKeychainSecretStore<R> {
    fn get(&self, name: &str) -> SecretResult<Option<Secret>> {
        let result: SecretGetResult = self
            .handle
            .run_mobile_plugin("secretGet", SecretNameArgs { name })
            .map_err(box_secret_err)?;
        Ok(result.value.map(Secret::new))
    }

    fn set(&self, name: &str, value: &Secret) -> SecretResult<()> {
        // `expose()` only at this serialization boundary (handing the
        // value to the IPC payload that crosses to Swift) -- same
        // convention `secrets.rs`'s `FileSecretStore::set` documents.
        self.handle
            .run_mobile_plugin::<serde_json::Value>("secretSet", SecretSetArgs { name, value: value.expose() })
            .map_err(box_secret_err)?;
        Ok(())
    }

    fn delete(&self, name: &str) -> SecretResult<()> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>("secretDelete", SecretNameArgs { name })
            .map_err(box_secret_err)?;
        Ok(())
    }
}
