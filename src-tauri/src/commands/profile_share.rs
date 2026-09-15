//! Tauri commands for "Share profile to device" (tauri-plugin-voxis plan,
//! Task 7): thin wrappers over `crate::profile_share`, following the same
//! `paths: State<AppPaths>` pattern as every other command module
//! (`super::get_factory`).

use crate::error::IntoCommandError;
use crate::profile_share::{self, ExportResult, ShareInterface, ShareSession};
use crate::storage::AppPaths;
use tauri::{AppHandle, Emitter, State};

/// Event emitted (no payload) the moment the QR/LAN session's single-use
/// token is redeemed by a successful `GET /profile` — the frontend listens
/// for this to move its "waiting for device…" state to "Delivered".
pub const PROFILE_SHARE_DELIVERED_EVENT: &str = "profile-share-delivered";

/// Start a new QR/LAN "share profile" session, replacing any previously
/// active one. `interface_name` names one of `list_share_interfaces()`'s
/// entries; `None` picks the default (first non-loopback).
///
/// Named `interface_name`, not `interface`: `interface` is a reserved word
/// in strict-mode JS/ES modules, so specta's generated `bindings.ts` (which
/// mirrors this parameter's name verbatim as a JS function parameter)
/// would otherwise fail to even parse under esbuild/vitest.
#[tauri::command]
#[specta::specta]
pub async fn start_profile_share(
    interface_name: Option<String>,
    app: AppHandle,
    paths: State<'_, AppPaths>,
) -> Result<ShareSession, String> {
    profile_share::start_share(paths.inner().clone(), interface_name, move || {
        let _ = app.emit(PROFILE_SHARE_DELIVERED_EVENT, ());
    })
    .await
    .cmd_err()
}

/// Stop the currently active QR/LAN session, if any. Idempotent.
#[tauri::command]
#[specta::specta]
pub fn stop_profile_share() {
    profile_share::stop_share();
}

/// List non-loopback LAN interfaces the QR/LAN server could bind to.
#[tauri::command]
#[specta::specta]
pub fn list_share_interfaces() -> Result<Vec<ShareInterface>, String> {
    profile_share::list_interfaces().cmd_err()
}

/// Seal the desktop's own profile under a passphrase (generating one from
/// the embedded wordlist when `passphrase` is `None`) and write it to
/// `path`.
#[tauri::command]
#[specta::specta]
pub fn export_profile_file(
    path: String,
    passphrase: Option<String>,
    paths: State<AppPaths>,
) -> Result<ExportResult, String> {
    profile_share::export_profile_file(&paths, std::path::Path::new(&path), passphrase).cmd_err()
}
