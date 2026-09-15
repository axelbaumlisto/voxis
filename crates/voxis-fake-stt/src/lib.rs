//! `voxis-fake-stt`: a deterministic, network-free stand-in for the
//! Groq-compatible `/v1/audio/transcriptions` endpoint
//! (`voxis_core::transcription::TranscriptionClient`'s own target),
//! used by CI and `host-min`'s mock path only.
//!
//! Protocol: accepts the exact multipart shape
//! `TranscriptionClient::transcribe` sends (`file` part = WAV bytes,
//! plus the text fields `build_form_text_params` builds: `model`,
//! `response_format=verbose_json`, optional `language`/`task`) and
//! responds with the same JSON shape `TranscriptionClient` parses on
//! success (`voxis_core::transcription::TranscriptionResult`:
//! `{text, language?, duration?}`).
//!
//! Mapping: `sha256(uploaded WAV bytes)` -> fixed text, loaded from a
//! JSON file (`fixtures/audio/fake-stt-map.json`, `{sha256hex: text}`).
//! An unrecognised sha gets HTTP 400 with the sha in the body (JSON
//! `{"error": {"message": "..."}}`, matching `TranscriptionClient`'s own
//! `ApiErrorResponse` shape so the sha shows up directly in
//! `TranscriptionError::ApiError`'s message) -- this makes "add a
//! fixture" a one-line diff: run once against real Groq/real speech,
//! copy the sha out of the 400 body into the map file.

pub mod silence_gen;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// `sha256(bytes)` as lowercase hex -- the one hashing implementation
/// every lookup (server handler, tests, and any tool generating a new
/// fixture) shares (DRY).
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// `fixtures/audio/fake-stt-map.json`'s shape: `sha256(wav bytes) ->
/// fixed transcript text`. A plain `HashMap`, not a wrapper struct --
/// the file itself is the map, nothing else to model.
pub type FixtureMap = HashMap<String, String>;

/// Loads and parses a fixture map JSON file. The only error path this
/// returns is "file missing/unreadable/not valid JSON" -- an empty map
/// (`{}`) is valid (every upload just 400s).
pub fn load_map(path: &Path) -> Result<FixtureMap, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("reading fixture map {}: {e}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|e| format!("parsing fixture map {}: {e}", path.display()))
}

/// Pure lookup: the sha256(wav_bytes) -> Ok(text) or Err(sha) core the
/// HTTP handler and unit tests both exercise directly, with no axum/HTTP
/// involved.
pub fn lookup<'a>(map: &'a FixtureMap, wav_bytes: &[u8]) -> Result<&'a str, String> {
    let sha = sha256_hex(wav_bytes);
    match map.get(&sha) {
        Some(text) => Ok(text.as_str()),
        None => Err(sha),
    }
}

/// The response shape `TranscriptionClient` parses on success
/// (`voxis_core::transcription::TranscriptionResult`, reimplemented here
/// rather than depended on directly -- this crate is the *server side*
/// of that contract and should not need voxis-core as a normal
/// dependency, only as a dev-dependency for its own protocol-compat
/// test).
#[derive(Debug, Serialize, Deserialize)]
struct VerboseJsonResponse {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
}

/// The error shape `TranscriptionClient` tries to parse first on a
/// non-2xx response (`ApiErrorResponse { error: { message } }`) --
/// matching it means the sha ends up directly in
/// `TranscriptionError::ApiError`'s message instead of the less useful
/// `TranscriptionError::ApiError("HTTP 400: <raw body>")` fallback.
#[derive(Debug, Serialize)]
struct ApiErrorBody {
    error: ApiErrorDetail,
}

#[derive(Debug, Serialize)]
struct ApiErrorDetail {
    message: String,
}

fn bad_sha_response(sha: &str) -> Response {
    let body = ApiErrorBody {
        error: ApiErrorDetail {
            message: format!("voxis-fake-stt: no fixture registered for sha256 {sha}"),
        },
    };
    (StatusCode::BAD_REQUEST, Json(body)).into_response()
}

async fn transcribe(
    State(map): State<Arc<FixtureMap>>,
    mut multipart: Multipart,
) -> Response {
    // Only the `file` part matters for the lookup -- the text fields
    // (`model`/`response_format`/`language`/`task`) are accepted and
    // ignored, same as this server needing no real model to run.
    let mut wav_bytes: Option<Vec<u8>> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                return (StatusCode::BAD_REQUEST, format!("multipart error: {e}")).into_response();
            }
        };
        if field.name() == Some("file") {
            match field.bytes().await {
                Ok(bytes) => wav_bytes = Some(bytes.to_vec()),
                Err(e) => {
                    return (StatusCode::BAD_REQUEST, format!("reading file part: {e}")).into_response();
                }
            }
        }
    }

    let Some(wav_bytes) = wav_bytes else {
        return (StatusCode::BAD_REQUEST, "missing multipart 'file' part").into_response();
    };

    // `scripts/host-min-smoke.sh`'s silence scenario greps this line to
    // assert the guard's `SilenceTimeoutNoSpeech` discard truly never
    // reaches this server ("request count == 0") -- one line per
    // request received, regardless of the lookup outcome below.
    println!("TRANSCRIBE_REQUEST bytes={}", wav_bytes.len());

    match lookup(&map, &wav_bytes) {
        Ok(text) => Json(VerboseJsonResponse { text: text.to_string(), language: None }).into_response(),
        Err(sha) => bad_sha_response(&sha),
    }
}

/// Builds the axum router, ready for `axum::serve`.
pub fn build_router(map: FixtureMap) -> Router {
    Router::new()
        .route("/v1/audio/transcriptions", post(transcribe))
        .with_state(Arc::new(map))
}

/// Binds `addr` (pass port `0` for an OS-assigned ephemeral port, used
/// by tests) and serves `build_router(map)` until the returned future is
/// dropped/aborted. Returns the actual bound address so callers that
/// asked for port `0` can discover what they got.
pub async fn serve(addr: SocketAddr, map: FixtureMap) -> std::io::Result<(SocketAddr, impl std::future::Future<Output = ()>)> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;
    let app = build_router(map);
    let fut = async move {
        let _ = axum::serve(listener, app).await;
    };
    Ok((bound, fut))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_is_stable_and_lowercase() {
        let sha = sha256_hex(b"hello world");
        assert_eq!(sha, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    }

    #[test]
    fn lookup_finds_a_registered_sha() {
        let mut map = FixtureMap::new();
        let sha = sha256_hex(b"fake wav bytes");
        map.insert(sha.clone(), "hello world".to_string());

        let result = lookup(&map, b"fake wav bytes");

        assert_eq!(result, Ok("hello world"));
    }

    #[test]
    fn lookup_returns_the_sha_for_an_unknown_upload() {
        let map = FixtureMap::new();

        let result = lookup(&map, b"never seen this before");

        assert_eq!(result, Err(sha256_hex(b"never seen this before")));
    }

    #[test]
    fn load_map_rejects_a_missing_file() {
        let result = load_map(Path::new("/nonexistent/fake-stt-map.json"));
        assert!(result.is_err());
    }

    #[test]
    fn load_map_parses_a_real_map_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("map.json");
        std::fs::write(&path, r#"{"abc123": "hello"}"#).unwrap();

        let map = load_map(&path).unwrap();

        assert_eq!(map.get("abc123"), Some(&"hello".to_string()));
    }
}

