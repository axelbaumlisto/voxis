//! Single command-facing error type. Every command in `commands.rs`
//! returns `Result<T, PluginError>` — Tauri 2 requires the `Err` variant
//! of a command's `Result` to be `Serialize` so it can cross the IPC
//! boundary to the frontend as a JS-catchable rejection value.

use serde::Serialize;

use crate::capture::CaptureError;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PluginError {
    /// `start()` while a session is already active (single-flight guard,
    /// `session.rs`).
    #[error("a dictation session is already recording")]
    AlreadyRecording,
    /// `stop`/`cancel`/`hold_lease` referencing a session id that isn't
    /// (or is no longer) the active one. Struct variant (not a newtype
    /// tuple variant) because serde's internally-tagged representation
    /// (`tag = "kind"`) requires every variant to serialize as a map —
    /// a bare `UnknownSession(String)` would fail to serialize under it.
    /// Per-variant `rename_all` (rather than relying on the enum-level
    /// one to cascade to fields) because `#[serde(tag = "kind", rename_all
    /// = "camelCase")]` on the enum only camelCases the tag *value*, not
    /// struct-variant field names.
    #[error("no active session with id {session_id}")]
    #[serde(rename_all = "camelCase")]
    UnknownSession { session_id: String },
    /// `start()` before `set_consent(true)` was recorded for the current
    /// (host, provider) pair (`[R1-Safety S6]`).
    #[error("consent required for provider '{provider_host}' before dictation can start")]
    #[serde(rename_all = "camelCase")]
    ConsentRequired { provider_host: String },
    /// `AudioCapture` backend error, surfaced as-is. Struct variant, same
    /// internally-tagged-enum reason as `UnknownSession` above.
    #[error("capture backend error: {message}")]
    Capture { message: String },
    /// `SecretStore`/`ConsentStore` IO or (de)serialization error.
    #[error("secret/consent store error: {message}")]
    Store { message: String },
    /// `apply_profile`/`import_profile_from_*` — real implementations
    /// land in Task 2/6/7; Task 3's commands are wired but stubbed.
    #[error("not implemented yet: {what}")]
    NotImplemented { what: String },
    /// The pipeline's transcription step (`pipeline.rs`) failed: no API
    /// key in the `SecretStore`, `TranscriptionClient` construction
    /// failed, or the HTTP call itself returned an error (network,
    /// non-2xx, unparseable body). Surfaced as `stop()`'s rejection and a
    /// `voxis://state` `Error` transition — no `voxis://result` event
    /// fires for this outcome (there is no `DictationResult` to publish).
    #[error("transcription failed: {message}")]
    Transcription { message: String },
    /// `set_hotkey` (Task 4 `hotkey_desktop.rs`) given a spec string that
    /// matches neither `voxis_core::hotkey::parse_hotkey` (single named
    /// key) nor `HotkeyCombo::parse` (`"Mod+Mod+Key"`), or whose trailing
    /// combo key has no rdev mapping. Fails loud at registration time
    /// instead of silently keeping the previous hotkey or panicking.
    #[error("invalid hotkey spec: {message}")]
    InvalidHotkey { message: String },
    /// `set_hotkey` (Task 4) detected that the OS-level key listener
    /// (rdev on desktop) failed to start — on macOS this is almost always
    /// a missing Accessibility/Input Monitoring grant. Detected from
    /// `rdev::listen`'s own return value, never from a blocking
    /// permission-prompt call on the hotkey press path (see
    /// `hotkey_desktop.rs` module doc: that pattern caused the original
    /// stuck-recording incident).
    #[error("hotkey permission denied: {message}")]
    PermissionDenied { message: String },
    /// Task 6: `import_profile_from_desktop` found no installed Voxis
    /// desktop on this machine (no `config.db` under
    /// `voxis_core::storage::paths::voxis_desktop_config_dir()`).
    #[error("Voxis desktop installation not found: {message}")]
    NotFound { message: String },
    /// Task 6/7: any failure building/reading/decrypting a `VoxisProfile`
    /// — `voxis_core::profile::ProfileError` (crypto/validation/storage),
    /// a malformed QR payload, or an HTTP-level rejection
    /// (expired/reused token, non-2xx) from the desktop's profile-share
    /// server (`import_profile_from_qr`).
    #[error("profile error: {message}")]
    Profile { message: String },
}

impl From<voxis_core::profile::ProfileError> for PluginError {
    fn from(e: voxis_core::profile::ProfileError) -> Self {
        PluginError::Profile { message: e.to_string() }
    }
}

impl From<CaptureError> for PluginError {
    fn from(e: CaptureError) -> Self {
        PluginError::Capture { message: e.to_string() }
    }
}

impl From<Box<dyn std::error::Error + Send + Sync>> for PluginError {
    fn from(e: Box<dyn std::error::Error + Send + Sync>) -> Self {
        PluginError::Store { message: e.to_string() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn already_recording_serializes_with_kind_tag() {
        let value = serde_json::to_value(PluginError::AlreadyRecording).unwrap();
        assert_eq!(value, serde_json::json!({"kind": "alreadyRecording"}));
    }

    #[test]
    fn unknown_session_carries_the_id() {
        let value =
            serde_json::to_value(PluginError::UnknownSession { session_id: "abc".to_string() }).unwrap();
        assert_eq!(value, serde_json::json!({"kind": "unknownSession", "sessionId": "abc"}));
    }

    #[test]
    fn consent_required_carries_provider_host() {
        let value = serde_json::to_value(PluginError::ConsentRequired {
            provider_host: "api.groq.com".to_string(),
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({"kind": "consentRequired", "providerHost": "api.groq.com"})
        );
    }

    #[test]
    fn capture_error_converts_with_message_preserved() {
        let err: PluginError = CaptureError::AlreadyRunning.into();
        assert_eq!(err, PluginError::Capture { message: "capture already running".to_string() });
    }

    #[test]
    fn not_found_serializes_with_kind_tag() {
        let value =
            serde_json::to_value(PluginError::NotFound { message: "no config.db".to_string() }).unwrap();
        assert_eq!(value, serde_json::json!({"kind": "notFound", "message": "no config.db"}));
    }

    #[test]
    fn profile_error_converts_from_voxis_core_profile_error() {
        let core_err = voxis_core::profile::ProfileError::UnsupportedVersion { found: 2 };
        let err: PluginError = core_err.into();
        assert!(matches!(err, PluginError::Profile { .. }));
        assert!(err.to_string().contains("unsupported profile version 2"));
    }
}
