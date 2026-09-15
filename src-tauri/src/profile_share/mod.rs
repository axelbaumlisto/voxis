//! "Share profile to device" (tauri-plugin-voxis plan, Task 7): desktop-side
//! LAN transport for a sealed `VoxisProfile`, plus the file-export path.
//!
//! Two independent ways to hand a profile to another device, both built on
//! `voxis_core::profile::{seal, KeySource}` (Task 2):
//!
//! - **QR + LAN** (`server`/`qr`): a one-shot `axum` HTTP server bound to a
//!   single chosen non-loopback LAN IPv4 (never `0.0.0.0`) serves
//!   `seal(profile, KeySource::Qr { k_qr, code })` once, over a random port,
//!   behind a single-use token bound to the first successful requester's IP.
//!   The QR encodes `{v:1, host, port, token, k}` (no URL scheme — a
//!   third-party app registering a custom scheme must never be able to grab
//!   this); the 6-digit `code` is shown next to the QR as a second factor,
//!   never inside the payload.
//! - **File** (`export_profile_file` in `commands::profile_share`): a
//!   passphrase (user-supplied, or 6 CSPRNG words from the embedded 2048-word
//!   list — ~66 bits — shown once) seals the profile with
//!   `KeySource::Passphrase` for AirDrop/email/USB transport.
//!
//! `[R1-Safety S1/T1/T2]` Only one QR/LAN session is ever active: starting a
//! new one (or the app shutting down) drops the previous
//! `server::ProfileShareServer`, whose `Drop` impl closes the listening
//! socket immediately (RAII), in addition to the 120s timer and the
//! shorter `POST_DELIVERY_GRACE` timer (armed once the first GET succeeds)
//! already built into the server task itself — see `server`'s module docs
//! for the full "what closes the socket, and when" picture, including why
//! a successful GET doesn't close it *immediately*.

pub mod qr;
pub mod server;

#[cfg(test)]
mod tests;

use std::net::Ipv4Addr;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use voxis_core::profile::{self, KeySource, ProfileSecrets, VoxisProfile};

use crate::storage::prompts_sqlite::LlmPromptsStorage;
use crate::storage::{AppPaths, StorageFactory};

/// Production server lifetime: 120s or first successful GET, whichever
/// comes first (plan `[R1-Safety S1]`). Tests use a much shorter TTL so they
/// don't have to sleep two minutes to exercise the expiry path.
const SHARE_SERVER_TTL: Duration = Duration::from_secs(120);

/// How long the socket stays open after the first successful GET before
/// closing on its own (`server`'s module docs) — long enough for an
/// immediate accidental retry to still see a well-formed `410`, short
/// enough that the LAN port doesn't linger for the rest of `SHARE_SERVER_TTL`
/// once the profile has actually been delivered.
const POST_DELIVERY_GRACE: Duration = Duration::from_secs(10);

/// Random token length in bytes before base64url encoding (matches the
/// contract fixture `profile-qr.json`'s `token` shape: an opaque string, not
/// a UUID specifically — this crate picks 16 CSPRNG bytes, base64url-encoded,
/// same width class as the fixture's example UUID).
const TOKEN_BYTES: usize = 16;

/// Words drawn from `wordlist.txt` (2048 entries = 11 bits/word) for a
/// generated file-export passphrase. 6 words * 11 bits = 66 bits of entropy,
/// matching the plan's "≥ 64 bit" requirement.
const PASSPHRASE_WORD_COUNT: usize = 6;

/// The standard BIP-39 English wordlist (2048 words, one per line, public
/// domain / widely reused word list format) — used only as a source of
/// memorable words for the generated file-export passphrase, nothing
/// BIP-39/wallet-specific about its use here.
const WORDLIST: &str = include_str!("wordlist.txt");

/// Errors from any `profile_share` operation. Deliberately does not leak
/// key material (`k_qr`/token/code/passphrase) in any variant's message.
#[derive(Debug, thiserror::Error)]
pub enum ProfileShareError {
    #[error("no non-loopback LAN interface found on this machine")]
    NoLanInterface,
    #[error("interface {0:?} not found (or has no LAN IPv4 address)")]
    InterfaceNotFound(String),
    #[error("failed to enumerate network interfaces: {0}")]
    Interfaces(String),
    #[error("failed to start LAN server: {0}")]
    Server(String),
    #[error("no profile share session is currently active")]
    NoActiveSession,
    #[error("profile error: {0}")]
    Profile(#[from] profile::ProfileError),
    #[error("failed to write profile file: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, ProfileShareError>;

/// One non-loopback IPv4 LAN interface, as offered to the UI for the
/// interface picker (plan: "default first non-loopback, user can pick").
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ShareInterface {
    pub name: String,
    pub ip: String,
}

/// An active (or just-started) QR/LAN share session, as returned to the UI.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ShareSession {
    /// Self-contained SVG markup (no external image service) rendering the
    /// QR payload described in the module docs.
    pub qr_svg: String,
    /// 6-digit second factor, shown next to (never inside) the QR.
    pub code: String,
    pub host: String,
    pub port: u16,
    /// Unix milliseconds; the UI derives its countdown from this instead of
    /// hardcoding the 120s TTL client-side.
    pub expires_at_ms: i64,
}

/// Result of `export_profile_file`. `passphrase` is only populated when the
/// caller didn't supply one — the generated phrase must be shown to the
/// user exactly once, since this is the only place it's ever surfaced.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ExportResult {
    pub passphrase: Option<String>,
}

/// The one currently-active QR/LAN share session, if any. Module-level
/// static (mirrors `voice_lib::TAURI_ASYNC_RUNTIME`'s `OnceLock` pattern one
/// step further: `std::sync::Mutex::new` is `const`, so no `OnceLock`
/// wrapper is needed) rather than Tauri-managed state, so this module adds
/// no new `app.manage()` call — out of scope for this step (see MODIFY
/// ONLY: `setup/mod.rs` is touched only for `generate_handler!`).
static ACTIVE_SESSION: Mutex<Option<server::ProfileShareServer>> = Mutex::new(None);

fn random_bytes<const N: usize>() -> Result<[u8; N]> {
    let mut buf = [0u8; N];
    getrandom::getrandom(&mut buf)
        .map_err(|e| ProfileShareError::Server(format!("CSPRNG failure: {e}")))?;
    Ok(buf)
}

/// 6-digit numeric code, CSPRNG-derived. A 32-bit draw modulo 1_000_000
/// carries a roughly 1-in-4294 (≈ 0.02%) relative bias between the two
/// nearest achievable frequencies — negligible, and acceptable regardless
/// because `code` is a second factor (defence against a photographed QR),
/// not the sealed payload's actual key material (`k_qr` is what needs to
/// be uniform, and it comes straight from `random_bytes` with no
/// reduction).
fn random_code() -> Result<String> {
    let bytes = random_bytes::<4>()?;
    let value = u32::from_be_bytes(bytes) % 1_000_000;
    Ok(format!("{value:06}"))
}

/// `PASSPHRASE_WORD_COUNT` words drawn uniformly from `WORDLIST` (2048 = 2^11
/// entries, so a `u16 % 2048` reduction is exact — 65536 is a multiple of
/// 2048, no modulo bias at all, unlike `random_code`'s decimal code).
fn generate_passphrase() -> Result<String> {
    let words: Vec<&str> = WORDLIST.lines().filter(|l| !l.trim().is_empty()).collect();
    debug_assert_eq!(words.len(), 2048, "wordlist.txt must have exactly 2048 words");
    let mut chosen = Vec::with_capacity(PASSPHRASE_WORD_COUNT);
    for _ in 0..PASSPHRASE_WORD_COUNT {
        let bytes = random_bytes::<2>()?;
        let index = (u16::from_be_bytes(bytes) as usize) % words.len();
        chosen.push(words[index]);
    }
    Ok(chosen.join(" "))
}

/// Non-loopback, non-link-local IPv4 interfaces on this machine, sorted so
/// the UI's dropdown — and the default pick in `resolve_bind_ip` — puts a
/// real network link first. The QR/LAN server only ever binds to one of
/// these — never `0.0.0.0` (`[R1-Safety T1]`).
///
/// Two filters beyond "non-loopback": link-local (`169.254.0.0/16`,
/// `is_link_local()`) addresses are excluded — they're only reachable from
/// the same physical segment with no DHCP/router involved (a dead Wi-Fi
/// association, a directly-wired-but-unconfigured cable) and are never
/// useful for "scan this QR from your phone"; and the sort key ranks names
/// starting with `en` (macOS Wi-Fi/Ethernet: `en0`, `en1`, …) ahead of
/// everything else, so a virtual interface that happens to sort earlier
/// alphabetically (`awdl0`, `bridge100`, `utun0`, …) never wins the
/// "default first non-loopback" pick over a real link.
pub fn list_interfaces() -> Result<Vec<ShareInterface>> {
    let ifaces = if_addrs::get_if_addrs()
        .map_err(|e| ProfileShareError::Interfaces(e.to_string()))?;
    let mut result: Vec<ShareInterface> = ifaces
        .into_iter()
        .filter(|iface| {
            !iface.is_loopback()
                && !iface.is_link_local()
                && matches!(iface.addr, if_addrs::IfAddr::V4(_))
        })
        .map(|iface| ShareInterface {
            name: iface.name.clone(),
            ip: iface.ip().to_string(),
        })
        .collect();
    result.sort_by(|a, b| {
        fn en_rank(name: &str) -> u8 {
            if name.starts_with("en") {
                0
            } else {
                1
            }
        }
        (en_rank(&a.name), &a.name).cmp(&(en_rank(&b.name), &b.name))
    });
    Ok(result)
}

/// Resolve the user's interface choice (by name) or the default (first
/// non-loopback, per `list_interfaces`'s ordering) to a concrete IPv4.
fn resolve_bind_ip(interface: Option<String>) -> Result<Ipv4Addr> {
    let interfaces = list_interfaces()?;
    let chosen = match interface {
        Some(name) => interfaces
            .into_iter()
            .find(|iface| iface.name == name)
            .ok_or(ProfileShareError::InterfaceNotFound(name))?,
        None => interfaces.into_iter().next().ok_or(ProfileShareError::NoLanInterface)?,
    };
    chosen
        .ip
        .parse::<Ipv4Addr>()
        .map_err(|e| ProfileShareError::Interfaces(format!("unparseable interface IP: {e}")))
}

/// Build a `VoxisProfile` + its `ProfileSecrets` from this desktop's own
/// storage — the same four storage abstractions `VoxisProfile::from_storage`
/// (Task 2) takes, wired up exactly like `commands::prompts::store` /
/// `orchestrator::post_process` already do for `LlmPromptsStorage`.
fn build_profile(paths: &AppPaths) -> Result<(VoxisProfile, ProfileSecrets)> {
    let factory = StorageFactory::new(paths.clone());
    let prompts = LlmPromptsStorage::new(paths.prompts_db());
    let (profile, secrets) = VoxisProfile::from_storage(
        &factory.config(),
        &factory.dictionary(),
        &factory.providers(),
        &prompts,
    )?;
    Ok((profile, secrets))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Start a new QR/LAN share session, replacing (and thereby stopping, via
/// `Drop`) any previously active one. `interface` names one of
/// `list_interfaces()`'s entries; `None` picks the default (first
/// non-loopback).
pub async fn start_share(
    paths: AppPaths,
    interface: Option<String>,
    on_delivered: impl Fn() + Send + Sync + 'static,
) -> Result<ShareSession> {
    let bind_ip = resolve_bind_ip(interface)?;
    let (profile, secrets) = build_profile(&paths)?;

    let k_qr = random_bytes::<32>()?;
    let token_bytes = random_bytes::<TOKEN_BYTES>()?;
    let token = profile::encode_base64url(&token_bytes);
    let code = random_code()?;

    let key_source = KeySource::Qr { k_qr, code: code.clone() };
    let sealed = profile::seal(&profile, &secrets, &key_source)?;

    let handle = server::start(
        bind_ip,
        token.clone(),
        sealed,
        SHARE_SERVER_TTL,
        POST_DELIVERY_GRACE,
        std::sync::Arc::new(on_delivered),
    )
    .await
    .map_err(|e| ProfileShareError::Server(e.to_string()))?;
    let port = handle.local_addr().port();

    let payload = qr::QrPayload {
        v: 1,
        host: bind_ip.to_string(),
        port,
        token,
        k: profile::encode_base64url(&k_qr),
    };
    let qr_svg = qr::render_svg(&payload).map_err(|e| ProfileShareError::Server(e.to_string()))?;

    let expires_at_ms = now_ms() + SHARE_SERVER_TTL.as_millis() as i64;

    let mut active = ACTIVE_SESSION.lock().unwrap_or_else(|e| e.into_inner());
    *active = Some(handle);

    Ok(ShareSession {
        qr_svg,
        code,
        host: bind_ip.to_string(),
        port,
        expires_at_ms,
    })
}

/// Stop the currently active QR/LAN session, if any. Idempotent: stopping
/// when nothing is active is not an error.
pub fn stop_share() {
    let mut active = ACTIVE_SESSION.lock().unwrap_or_else(|e| e.into_inner());
    *active = None; // dropping the handle closes the socket (RAII)
}

/// Seal the desktop's own profile under a passphrase and write it to
/// `path`. When `passphrase` is `None`, a fresh one is generated from the
/// embedded wordlist and returned in `ExportResult` for one-time display
/// — the caller must never be able to recover it afterwards (it isn't
/// stored anywhere).
pub fn export_profile_file(
    paths: &AppPaths,
    path: &std::path::Path,
    passphrase: Option<String>,
) -> Result<ExportResult> {
    let (profile, secrets) = build_profile(paths)?;
    let (phrase, generated) = match passphrase {
        Some(p) => (p, None),
        None => {
            let generated = generate_passphrase()?;
            (generated.clone(), Some(generated))
        }
    };
    let sealed = profile::seal(&profile, &secrets, &KeySource::Passphrase(phrase))?;
    std::fs::write(path, sealed)?;
    Ok(ExportResult { passphrase: generated })
}
