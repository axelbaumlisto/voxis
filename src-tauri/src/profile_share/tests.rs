//! Integration tests: real `axum` server over real sockets (loopback in
//! tests — production always binds a LAN IP via `resolve_bind_ip`, never
//! loopback, but binding loopback here is the standard way to test an HTTP
//! server without touching the host's actual network interfaces), real
//! `voxis_core::profile::seal`/`open` round trips, and the storage-backed
//! `start_share`/`export_profile_file` entry points against a tempdir.

use std::net::Ipv4Addr;
use std::time::Duration;

use voxis_core::profile::{self, KeySource};

use super::server;
use crate::storage::test_utils::create_temp_paths;

fn sample_sealed(k_qr: [u8; 32], code: &str) -> (voxis_core::profile::VoxisProfile, Vec<u8>) {
    let (_temp, paths) = create_temp_paths();
    let (profile, secrets) = super::build_profile(&paths).unwrap();
    let sealed = profile::seal(
        &profile,
        &secrets,
        &KeySource::Qr { k_qr, code: code.to_string() },
    )
    .unwrap();
    (profile, sealed)
}

async fn start_test_server(token: &str, sealed: Vec<u8>, ttl: Duration) -> server::ProfileShareServer {
    // Generous post-delivery grace: most tests below aren't exercising
    // that timer's own boundary, so give it plenty of room not to fire
    // mid-test and turn a later request into a spurious connection-refused.
    start_test_server_with_grace(token, sealed, ttl, Duration::from_secs(30)).await
}

async fn start_test_server_with_grace(
    token: &str,
    sealed: Vec<u8>,
    ttl: Duration,
    post_delivery_grace: Duration,
) -> server::ProfileShareServer {
    server::start(
        Ipv4Addr::LOCALHOST,
        token.to_string(),
        sealed,
        ttl,
        post_delivery_grace,
        std::sync::Arc::new(|| {}),
    )
    .await
    .expect("test server should start on loopback")
}

#[tokio::test]
async fn successful_get_opens_with_qr_key_source() {
    let k_qr = [7u8; 32];
    let code = "123456";
    let (profile, sealed) = sample_sealed(k_qr, code);
    let handle = start_test_server("tok-123", sealed, Duration::from_secs(5)).await;

    let url = format!("http://{}/profile?token=tok-123", handle.local_addr());
    let response = reqwest::get(&url).await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let body = response.bytes().await.unwrap().to_vec();

    let (opened, _secrets) =
        profile::open(&body, &KeySource::Qr { k_qr, code: code.to_string() }).unwrap();
    assert_eq!(opened, profile);
}

#[tokio::test]
async fn wrong_code_fails_to_open_the_served_body() {
    let k_qr = [7u8; 32];
    let (_profile, sealed) = sample_sealed(k_qr, "123456");
    let handle = start_test_server("tok-abc", sealed, Duration::from_secs(5)).await;

    let url = format!("http://{}/profile?token=tok-abc", handle.local_addr());
    let response = reqwest::get(&url).await.unwrap();
    let body = response.bytes().await.unwrap().to_vec();

    let wrong = profile::open(&body, &KeySource::Qr { k_qr, code: "000000".to_string() });
    assert!(wrong.is_err(), "opening with the wrong code must fail");
}

#[tokio::test]
async fn token_is_single_use_second_get_is_410_with_constant_body() {
    let (_profile, sealed) = sample_sealed([1u8; 32], "111111");
    let handle = start_test_server("tok-once", sealed, Duration::from_secs(5)).await;
    let url = format!("http://{}/profile?token=tok-once", handle.local_addr());

    let first = reqwest::get(&url).await.unwrap();
    assert_eq!(first.status(), reqwest::StatusCode::OK);

    let second = reqwest::get(&url).await.unwrap();
    assert_eq!(second.status(), reqwest::StatusCode::GONE);
    let body = second.bytes().await.unwrap();
    assert_eq!(body.len(), 64, "rejection body must be the constant 64-byte shape");
}

#[tokio::test]
async fn wrong_token_is_410_with_constant_body() {
    let (_profile, sealed) = sample_sealed([2u8; 32], "222222");
    let handle = start_test_server("real-token", sealed, Duration::from_secs(5)).await;

    let url = format!("http://{}/profile?token=not-the-token", handle.local_addr());
    let response = reqwest::get(&url).await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::GONE);
    let body = response.bytes().await.unwrap();
    assert_eq!(body.len(), 64);
}

#[tokio::test]
async fn expired_session_is_410() {
    // The socket stays open a little past `ttl` (`SHUTDOWN_GRACE`)
    // specifically so a request landing right after logical expiry still
    // gets a well-formed 410 instead of racing the physical socket close.
    let (_profile, sealed) = sample_sealed([3u8; 32], "333333");
    let handle = start_test_server("tok-exp", sealed, Duration::from_millis(20)).await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    let url = format!("http://{}/profile?token=tok-exp", handle.local_addr());
    let response = reqwest::get(&url).await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::GONE);
    let body = response.bytes().await.unwrap();
    assert_eq!(body.len(), 64);
}

#[tokio::test]
async fn socket_closes_for_good_after_ttl_plus_grace() {
    let (_profile, sealed) = sample_sealed([6u8; 32], "666666");
    let handle = start_test_server("tok-hardclose", sealed, Duration::from_millis(20)).await;
    let addr = handle.local_addr();

    let mut refused = false;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        if tokio::net::TcpStream::connect(addr).await.is_err() {
            refused = true;
            break;
        }
    }
    assert!(refused, "listener must eventually stop accepting connections (ttl + grace)");
}

#[tokio::test]
async fn drop_closes_the_socket() {
    let (_profile, sealed) = sample_sealed([4u8; 32], "444444");
    let handle = start_test_server("tok-drop", sealed, Duration::from_secs(30)).await;
    let addr = handle.local_addr();
    drop(handle);

    // Graceful shutdown stops accepting *new* connections as soon as the
    // shutdown future resolves; poll briefly since that happens on the
    // server task, not synchronously inside `Drop`.
    let mut last_err = None;
    for _ in 0..50 {
        match tokio::net::TcpStream::connect(addr).await {
            Ok(_) => {
                tokio::time::sleep(Duration::from_millis(20)).await;
                continue;
            }
            Err(e) => {
                last_err = Some(e);
                break;
            }
        }
    }
    assert!(
        last_err.is_some(),
        "socket should refuse connections after the handle is dropped"
    );
}

#[tokio::test]
async fn a_retry_after_success_gets_410_not_connection_refused() {
    // The socket doesn't close *immediately* on success (see server.rs's
    // module docs): a client that retries right after a success
    // (double-tap, dropped response) must see a well-formed 410, not a
    // bare connection refusal — using a longer-than-the-retry grace here
    // so this assertion can't flake against the grace timer itself.
    let (_profile, sealed) = sample_sealed([5u8; 32], "555555");
    let handle =
        start_test_server_with_grace("tok-retry", sealed, Duration::from_secs(5), Duration::from_secs(5))
            .await;
    let url = format!("http://{}/profile?token=tok-retry", handle.local_addr());

    let ok = reqwest::get(&url).await.unwrap();
    assert_eq!(ok.status(), reqwest::StatusCode::OK);

    let retry = reqwest::get(&url).await.unwrap();
    assert_eq!(retry.status(), reqwest::StatusCode::GONE);
    assert_eq!(retry.bytes().await.unwrap().len(), 64);
}

#[tokio::test]
async fn socket_closes_shortly_after_delivery_once_the_post_delivery_grace_elapses() {
    // Same shape as the test above, but with a short grace: after it
    // elapses the socket must be gone rather than lingering for the rest
    // of `ttl` (a much longer TTL here, so only the grace timer explains
    // the close).
    let (_profile, sealed) = sample_sealed([7u8; 32], "777777");
    let handle = start_test_server_with_grace(
        "tok-postdelivery",
        sealed,
        Duration::from_secs(30),
        Duration::from_millis(30),
    )
    .await;
    let addr = handle.local_addr();
    let url = format!("http://{addr}/profile?token=tok-postdelivery");

    let ok = reqwest::get(&url).await.unwrap();
    assert_eq!(ok.status(), reqwest::StatusCode::OK);

    let mut refused = false;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        if tokio::net::TcpStream::connect(addr).await.is_err() {
            refused = true;
            break;
        }
    }
    assert!(
        refused,
        "socket must close on its own shortly after delivery, well before the 30s ttl"
    );
}

#[tokio::test]
async fn on_delivered_fires_exactly_once_on_success() {
    let (_profile, sealed) = sample_sealed([9u8; 32], "999999");
    let count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count_clone = count.clone();
    let handle = server::start(
        Ipv4Addr::LOCALHOST,
        "tok-delivered".to_string(),
        sealed,
        Duration::from_secs(5),
        Duration::from_secs(30),
        std::sync::Arc::new(move || {
            count_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }),
    )
    .await
    .unwrap();

    let url = format!("http://{}/profile?token=tok-delivered", handle.local_addr());
    let _ = reqwest::get(&url).await.unwrap();
    // A second (rejected) GET must not fire the callback again.
    let _ = reqwest::get(&url).await.unwrap();

    assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[tokio::test]
async fn missing_token_query_param_is_410_with_constant_body() {
    let (_profile, sealed) = sample_sealed([8u8; 32], "888888");
    let handle = start_test_server("tok-present", sealed, Duration::from_secs(5)).await;

    let url = format!("http://{}/profile", handle.local_addr());
    let response = reqwest::get(&url).await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::GONE);
    assert_eq!(response.bytes().await.unwrap().len(), 64);
}

#[tokio::test]
async fn malformed_query_string_is_410_with_constant_body() {
    let (_profile, sealed) = sample_sealed([8u8; 32], "888888");
    let handle = start_test_server("tok-present", sealed, Duration::from_secs(5)).await;

    // No `token` key at all in the query string — must be handled exactly
    // like a missing query string, never axum's own variable-length 400.
    let url = format!("http://{}/profile?nottoken=abc&also=not-it", handle.local_addr());
    let response = reqwest::get(&url).await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::GONE);
    assert_eq!(response.bytes().await.unwrap().len(), 64);
}

#[test]
fn list_interfaces_never_includes_loopback_or_link_local() {
    let interfaces = super::list_interfaces().expect("enumerating interfaces should not fail");
    assert!(interfaces.iter().all(|i| {
        i.ip != "127.0.0.1" && i.ip != "::1" && !i.ip.starts_with("169.254.")
    }));
}

#[test]
fn list_interfaces_orders_en_prefixed_first_when_present() {
    // Real-machine-dependent (vacuously true when this box has no `en*`
    // interface, e.g. Linux CI): whenever both kinds are present, every
    // `en*` entry must sort before every non-`en*` entry.
    let interfaces = super::list_interfaces().expect("enumerating interfaces should not fail");
    let last_en = interfaces.iter().rposition(|i| i.name.starts_with("en"));
    let first_non_en = interfaces.iter().position(|i| !i.name.starts_with("en"));
    if let (Some(last_en), Some(first_non_en)) = (last_en, first_non_en) {
        assert!(
            last_en < first_non_en,
            "every en*-named interface must sort before every non-en* one"
        );
    }
}

#[test]
fn generate_passphrase_is_six_words_from_the_wordlist() {
    let phrase = super::generate_passphrase().unwrap();
    let words: Vec<&str> = phrase.split(' ').collect();
    assert_eq!(words.len(), super::PASSPHRASE_WORD_COUNT);
    let wordlist: std::collections::HashSet<&str> = super::WORDLIST.lines().collect();
    for word in words {
        assert!(wordlist.contains(word), "{word:?} must come from the embedded wordlist");
    }
}

#[test]
fn wordlist_has_exactly_2048_unique_entries() {
    let words: std::collections::HashSet<&str> = super::WORDLIST.lines().collect();
    assert_eq!(words.len(), 2048);
}

#[test]
fn export_profile_file_generates_and_reveals_passphrase_once() {
    let (_temp, paths) = create_temp_paths();
    let out_dir = tempfile::tempdir().unwrap();
    let out_path = out_dir.path().join("profile.vxp");

    let result = super::export_profile_file(&paths, &out_path, None).unwrap();
    let generated = result.passphrase.expect("None input must yield a generated passphrase");

    let sealed = std::fs::read(&out_path).unwrap();
    let (opened, _secrets) =
        profile::open(&sealed, &KeySource::Passphrase(generated.clone())).unwrap();
    let (expected_profile, _) = super::build_profile(&paths).unwrap();
    assert_eq!(opened, expected_profile);

    // Wrong passphrase must fail.
    assert!(profile::open(&sealed, &KeySource::Passphrase("wrong words here".to_string())).is_err());
}

#[test]
fn export_profile_file_with_user_passphrase_does_not_echo_it_back() {
    let (_temp, paths) = create_temp_paths();
    let out_dir = tempfile::tempdir().unwrap();
    let out_path = out_dir.path().join("profile.vxp");

    let result = super::export_profile_file(
        &paths,
        &out_path,
        Some("user supplied passphrase words".to_string()),
    )
    .unwrap();
    assert!(result.passphrase.is_none(), "a caller-supplied passphrase is never echoed back");

    let sealed = std::fs::read(&out_path).unwrap();
    let opened = profile::open(
        &sealed,
        &KeySource::Passphrase("user supplied passphrase words".to_string()),
    );
    assert!(opened.is_ok());
}
