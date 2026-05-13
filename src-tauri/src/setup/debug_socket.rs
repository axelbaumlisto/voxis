//! Unix-socket debug RPC for e2e screenshot suites.
//!
//! Listens on `~/.config/soupawhisper/debug.sock` (Linux) or
//! `~/Library/Application Support/soupawhisper/debug.sock` (macOS) when
//! the binary was built with `debug_assertions`. Accepts newline-delimited
//! JSON-RPC-ish messages:
//!
//!   {"cmd":"set_handy_theme","theme":"living_reed"}
//!   {"cmd":"set_overlay_state","state":"recording"}
//!   {"cmd":"emit_spectrum","bins":[0.9, 0.9, …]}
//!   {"cmd":"emit_silence"}
//!
//! Each accepted message is forwarded to `app.emit()` for the matching
//! `overlay://*` event. Replies with `{"ok":true}` or
//! `{"ok":false,"error":"…"}`.
//!
//! Why a Unix socket rather than a Tauri command:
//!  - Playwright/Chrome can't invoke Tauri commands without
//!    `window.__TAURI_INTERNALS__`, which only exists inside Tauri
//!    webviews. Test runners speak shell + JSON over a socket trivially.
//!  - Disabled in release builds (`#[cfg(debug_assertions)]` only).
//!
//! SOLID/DRY/KISS:
//!  - SRP: one concern \u2014 parse a message, emit a Tauri event. No
//!    business logic.
//!  - KISS: <100 LoC; no async framework, one thread per connection.
//!  - DRY: shares event names (`overlay://*`) with the legitimate
//!    command path in `commands/debug.rs`; both call `app.emit(\u2026)`.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

const SOCKET_BASENAME: &str = "debug.sock";

#[derive(serde::Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    SetHandyTheme { theme: String },
    SetOverlayState { state: String },
    EmitSpectrum { bins: Vec<f32> },
    EmitSilence,
    Ping,
}

#[derive(serde::Serialize)]
#[serde(untagged)]
enum Response {
    Ok { ok: bool },
    Err { ok: bool, error: String },
}

fn ok() -> Response {
    Response::Ok { ok: true }
}
fn err(msg: impl Into<String>) -> Response {
    Response::Err {
        ok: false,
        error: msg.into(),
    }
}

/// Belt-and-suspenders emit — sends to both `app.emit` (broadcast) and
/// every webview window's `.emit` (targeted). Some Tauri versions drop
/// app-bus events on NSPanel-wrapped webviews; this guarantees delivery.
fn emit_everywhere<T: serde::Serialize + Clone>(
    app: &AppHandle,
    event: &str,
    payload: &T,
) -> Result<(), String> {
    app.emit(event, payload)
        .map_err(|e| format!("app.emit({event}): {e}"))?;
    for (label, window) in app.webview_windows() {
        if let Err(e) = window.emit(event, payload) {
            tracing::debug!("window[{label}].emit({event}) failed: {e}");
        }
    }
    Ok(())
}

fn handle_request(app: &AppHandle, req: Request) -> Response {
    let outcome: Result<(), String> = match req {
        Request::SetHandyTheme { theme } => emit_everywhere(app, "overlay://theme", &theme),
        Request::SetOverlayState { state } => {
            // Accept lower-snake-case matching OverlayState's serde rename.
            let payload: crate::overlay_native::OverlayState =
                match state.to_lowercase().as_str() {
                    "hidden" => crate::overlay_native::OverlayState::Hidden,
                    "idle" => crate::overlay_native::OverlayState::Idle,
                    "recording" => crate::overlay_native::OverlayState::Recording,
                    "transcribing" => crate::overlay_native::OverlayState::Transcribing,
                    other => return err(format!("unknown overlay state '{other}'")),
                };
            emit_everywhere(app, "overlay://state", &payload)
        }
        Request::EmitSpectrum { bins } => {
            let expected = crate::audio::SPECTRUM_BARS;
            if bins.len() != expected {
                return err(format!("expected {expected} bins, got {}", bins.len()));
            }
            let normalised: Vec<f32> = bins.iter().map(|v| v.clamp(0.0, 1.0)).collect();
            emit_everywhere(app, "overlay://spectrum-bins", &normalised)
        }
        Request::EmitSilence => {
            let zeros = vec![0.0f32; crate::audio::SPECTRUM_BARS];
            emit_everywhere(app, "overlay://spectrum-bins", &zeros)
        }
        Request::Ping => Ok(()),
    };
    match outcome {
        Ok(()) => ok(),
        Err(e) => err(e),
    }
}

fn socket_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .ok()
        .or_else(|| dirs::config_dir().map(|d| d.join("soupawhisper")))?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(SOCKET_BASENAME))
}

/// Spawn the debug socket listener on a background thread.
pub fn spawn(app: AppHandle) {
    let Some(path) = socket_path(&app) else {
        tracing::warn!("debug socket: cannot resolve config dir; skipping");
        return;
    };
    let _ = std::fs::remove_file(&path); // stale socket from prior run
    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            tracing::warn!("debug socket: bind {path:?} failed: {e}");
            return;
        }
    };
    tracing::info!("debug socket listening at {path:?}");

    thread::spawn(move || {
        for incoming in listener.incoming() {
            let stream = match incoming {
                Ok(s) => s,
                Err(e) => {
                    tracing::debug!("debug socket accept error: {e}");
                    continue;
                }
            };
            let app_clone = app.clone();
            thread::spawn(move || {
                let mut writer = stream
                    .try_clone()
                    .expect("UnixStream clone for writer half");
                let reader = BufReader::new(stream);
                for line in reader.lines() {
                    let Ok(line) = line else {
                        return;
                    };
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    let resp: Response = match serde_json::from_str::<Request>(line) {
                        Ok(req) => handle_request(&app_clone, req),
                        Err(e) => err(format!("parse '{line}': {e}")),
                    };
                    let body =
                        serde_json::to_string(&resp).unwrap_or_else(|_| "{\"ok\":false}".into());
                    let _ = writeln!(writer, "{body}");
                    let _ = writer.flush();
                }
            });
        }
    });
}
