//! One-shot LAN HTTP server for "Share profile to device"
//! (`[R1-Safety S1/T1/T2]`).
//!
//! `axum` binds to exactly one caller-chosen non-loopback IPv4 (never
//! `0.0.0.0` — enforced by the caller, `profile_share::resolve_bind_ip`
//! only ever returning a LAN interface's address), on an OS-assigned
//! ephemeral port. `GET /profile?token=<token>` is gated by [`TokenGate`]:
//! single-use, bound to whichever peer IP first presents the right token.
//!
//! The listening socket closes on whichever of these happens first:
//! - [`ProfileShareServer`]'s `Drop` (RAII — e.g. the settings panel
//!   closing, or a fresh session replacing this one);
//! - the `ttl` timer (plus [`SHUTDOWN_GRACE`], see its own docs);
//! - `POST_DELIVERY_GRACE` after the first successful GET — long enough
//!   that an immediate retry (double-tap, a dropped response) still gets
//!   a well-formed `410` rather than a bare connection refusal, short
//!   enough that the socket doesn't linger for the rest of the full `ttl`
//!   once the profile has actually been delivered.
//!
//! Every rejection (bad/missing/malformed token, wrong/mismatched IP,
//! already used, expired) returns the exact same status (`410 Gone`) and
//! the exact same fixed-size body (`REJECTED_BODY`), so a network
//! observer can't tell *why* a request failed from response size or shape
//! — only "it failed". (The success response's length is **not**
//! constant — it's the sealed profile's size — but that's expected: only
//! the token-holder's own request path needs this property, and by then
//! they already know the profile's rough size from having asked for it.)
//! The access log likewise never includes the query string (the token
//! lives there), only the fact that a request to `/profile` happened and
//! whether it was accepted.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, RawQuery, State as AxumState};
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use subtle::ConstantTimeEq;
use tokio::net::TcpListener;
use tokio::sync::Notify;

/// Fixed-size body for every rejected `/profile` request. 64 bytes per the
/// plan's acceptance criterion; content is irrelevant (never parsed by a
/// legitimate client, which only ever expects `200` + sealed bytes).
const REJECTED_BODY: [u8; 64] = [0u8; 64];

/// How much longer the *socket* stays open past the logical `ttl` before
/// the hard shutdown timer fires. Without this gap, a request landing
/// right at the `ttl` boundary would race the physical close and get a
/// bare connection refusal instead of the well-formed, constant-size
/// `410` the expiry path is supposed to produce; with it, `expires_at`
/// (checked in the handler) is always reached — and returns `410` — well
/// before the listener itself stops accepting connections.
const SHUTDOWN_GRACE: Duration = Duration::from_millis(500);

/// Why a `/profile` request was rejected. Never surfaced to the client
/// (every variant maps to the same `410` + [`REJECTED_BODY`]) — only used
/// internally / in tests, where distinguishing the reason matters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GateError {
    BadToken,
    AlreadyUsed,
    IpMismatch,
}

/// Single-use, first-IP-bound token gate. Pure and synchronous by design
/// so it's unit-testable without spinning up axum/tokio at all (the plan's
/// "IP binding -> different peer IP -> 410 (unit-test the check fn)"
/// acceptance criterion).
///
/// The IP binds on the **first** call with a matching token (regardless of
/// whether that call ultimately succeeds), before the single-use flag is
/// even consulted: this way a second call from a *different* IP is
/// rejected as `IpMismatch` even if it races the first call before either
/// one would otherwise trip `AlreadyUsed`. A second call from the *same*
/// IP falls through to the `used` check and is rejected as `AlreadyUsed`.
///
/// The token compare itself is constant-time (`subtle::ConstantTimeEq`)
/// over the presented token's *own* length rather than short-circuiting
/// on the first mismatched byte — the token is bearer-equivalent to the
/// sealed profile's decryption key material in transit, so a timing
/// side-channel that speeds up guessing it is worth closing even though
/// the LAN-only, single-use, IP-bound design already makes that attack
/// impractical in practice.
pub(crate) struct TokenGate {
    token: String,
    used: bool,
    bound_ip: Option<IpAddr>,
}

impl TokenGate {
    pub(crate) fn new(token: String) -> Self {
        Self { token, used: false, bound_ip: None }
    }

    pub(crate) fn check(&mut self, presented_token: &str, peer_ip: IpAddr) -> Result<(), GateError> {
        // `[T]::ct_eq` already short-circuits only on length (lengths
        // aren't secret) and is content-independent-time otherwise, so no
        // separate length guard is needed here.
        let tokens_match = bool::from(presented_token.as_bytes().ct_eq(self.token.as_bytes()));
        if !tokens_match {
            return Err(GateError::BadToken);
        }
        match self.bound_ip {
            None => self.bound_ip = Some(peer_ip),
            Some(bound) if bound != peer_ip => return Err(GateError::IpMismatch),
            Some(_) => {}
        }
        if self.used {
            return Err(GateError::AlreadyUsed);
        }
        self.used = true;
        Ok(())
    }
}

/// Extract the `token` query parameter without axum's `Query<T>` extractor:
/// `Query`'s `Rejection` produces its own (variably-sized) `400` response
/// *before* the handler runs at all, which would defeat the constant-size
/// `410` contract for exactly the "missing/malformed token" case. `token`
/// is always base64url (`URL_SAFE_NO_PAD`) — a charset with no characters
/// that need percent-decoding — so a plain `key=value` split is sufficient
/// and never needs to fail differently than "not found".
fn extract_token(raw_query: Option<&str>) -> Option<&str> {
    raw_query?.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == "token").then_some(value)
    })
}

#[derive(Clone)]
struct SharedState {
    gate: Arc<Mutex<TokenGate>>,
    expires_at: Instant,
    sealed_profile: Arc<Vec<u8>>,
    on_delivered: Arc<dyn Fn() + Send + Sync>,
    post_delivery_grace: Duration,
    shutdown_notify: Arc<Notify>,
}

async fn handle_get_profile(
    AxumState(state): AxumState<SharedState>,
    RawQuery(raw_query): RawQuery,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> axum::response::Response {
    if Instant::now() > state.expires_at {
        // Access log: no query string (the token lives there) and no
        // detail about *why* — just that a request happened and its fate.
        tracing::info!("profile_share: GET /profile rejected (expired)");
        return (StatusCode::GONE, REJECTED_BODY.to_vec()).into_response();
    }

    let Some(token) = extract_token(raw_query.as_deref()) else {
        tracing::info!("profile_share: GET /profile rejected (no token)");
        return (StatusCode::GONE, REJECTED_BODY.to_vec()).into_response();
    };

    let outcome = {
        let mut gate = state.gate.lock().unwrap_or_else(|e| e.into_inner());
        gate.check(token, peer.ip())
    };

    match outcome {
        Ok(()) => {
            tracing::info!("profile_share: GET /profile accepted");
            (state.on_delivered)();
            // Arm the post-delivery shutdown: the socket stays open just
            // long enough for an immediate retry to see a proper `410`
            // (module docs), then closes on its own rather than lingering
            // for the rest of `ttl`.
            let shutdown_notify = state.shutdown_notify.clone();
            let grace = state.post_delivery_grace;
            tokio::spawn(async move {
                tokio::time::sleep(grace).await;
                shutdown_notify.notify_one();
            });
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/octet-stream")],
                state.sealed_profile.as_ref().clone(),
            )
                .into_response()
        }
        Err(_) => {
            tracing::info!("profile_share: GET /profile rejected");
            (StatusCode::GONE, REJECTED_BODY.to_vec()).into_response()
        }
    }
}

/// A running QR/LAN share server. `Drop` closes the listening socket
/// immediately (notifies the shutdown signal the server task is always
/// selecting on) — RAII, independent of the `ttl`/post-delivery timers.
pub struct ProfileShareServer {
    shutdown_notify: Arc<Notify>,
    local_addr: SocketAddr,
}

impl ProfileShareServer {
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }
}

impl Drop for ProfileShareServer {
    fn drop(&mut self) {
        self.shutdown_notify.notify_one();
    }
}

/// Start the one-shot server: bind `bind_ip:0` (OS picks the port), serve
/// `sealed_profile` on `GET /profile?token=<token>` gated by [`TokenGate`],
/// and close the socket on `ttl`, `post_delivery_grace` after the first
/// success, or the returned handle's `Drop` — whichever happens first
/// (see module docs). `on_delivered` fires exactly once, synchronously in
/// the request handler, the moment a GET passes the gate — the caller
/// (`profile_share::start_share`) uses it to tell the UI "Delivered"
/// without adding a fifth command just for polling.
pub(crate) async fn start(
    bind_ip: Ipv4Addr,
    token: String,
    sealed_profile: Vec<u8>,
    ttl: Duration,
    post_delivery_grace: Duration,
    on_delivered: Arc<dyn Fn() + Send + Sync>,
) -> std::io::Result<ProfileShareServer> {
    let listener = TcpListener::bind((bind_ip, 0)).await?;
    let local_addr = listener.local_addr()?;

    let shutdown_notify = Arc::new(Notify::new());
    let state = SharedState {
        gate: Arc::new(Mutex::new(TokenGate::new(token))),
        expires_at: Instant::now() + ttl,
        sealed_profile: Arc::new(sealed_profile),
        on_delivered,
        post_delivery_grace,
        shutdown_notify: shutdown_notify.clone(),
    };

    let app = Router::new()
        .route("/profile", get(handle_get_profile))
        .with_state(state);

    let shutdown_notify_for_task = shutdown_notify.clone();
    tokio::spawn(async move {
        let shutdown_signal = async move {
            tokio::select! {
                _ = shutdown_notify_for_task.notified() => {}
                _ = tokio::time::sleep(ttl + SHUTDOWN_GRACE) => {}
            }
        };
        let serve_result = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(shutdown_signal)
        .await;
        if let Err(e) = serve_result {
            tracing::warn!("profile_share: server task ended with error: {e}");
        }
    });

    Ok(ProfileShareServer { shutdown_notify, local_addr })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(ip: &str) -> IpAddr {
        ip.parse().unwrap()
    }

    #[test]
    fn same_ip_repeated_use_is_already_used() {
        let mut gate = TokenGate::new("tok".to_string());
        assert_eq!(gate.check("tok", peer("10.0.0.5")), Ok(()));
        assert_eq!(gate.check("tok", peer("10.0.0.5")), Err(GateError::AlreadyUsed));
    }

    #[test]
    fn different_ip_after_bind_is_ip_mismatch() {
        let mut gate = TokenGate::new("tok".to_string());
        assert_eq!(gate.check("tok", peer("10.0.0.5")), Ok(()));
        assert_eq!(gate.check("tok", peer("10.0.0.9")), Err(GateError::IpMismatch));
    }

    #[test]
    fn wrong_token_is_bad_token_and_does_not_bind_ip() {
        let mut gate = TokenGate::new("tok".to_string());
        assert_eq!(gate.check("nope", peer("10.0.0.5")), Err(GateError::BadToken));
        // A wrong-token attempt must not consume/bind the gate — the real
        // client (same or different IP) can still succeed afterwards.
        assert_eq!(gate.check("tok", peer("10.0.0.9")), Ok(()));
    }

    #[test]
    fn different_length_token_is_bad_token() {
        // `ct_eq` requires equal-length slices; the length guard above must
        // not itself leak anything usable (it's a public property of the
        // token format, not a secret-dependent branch).
        let mut gate = TokenGate::new("a-much-longer-token".to_string());
        assert_eq!(gate.check("short", peer("10.0.0.5")), Err(GateError::BadToken));
    }

    #[test]
    fn rejected_body_is_constant_size() {
        assert_eq!(REJECTED_BODY.len(), 64);
    }

    #[test]
    fn extract_token_reads_the_token_param() {
        assert_eq!(extract_token(Some("token=abc123")), Some("abc123"));
        assert_eq!(extract_token(Some("foo=bar&token=abc123")), Some("abc123"));
        assert_eq!(extract_token(Some("token=abc123&foo=bar")), Some("abc123"));
    }

    #[test]
    fn extract_token_none_when_missing_or_malformed() {
        assert_eq!(extract_token(None), None);
        assert_eq!(extract_token(Some("")), None);
        assert_eq!(extract_token(Some("foo=bar")), None);
        assert_eq!(extract_token(Some("nottoken")), None);
    }
}
