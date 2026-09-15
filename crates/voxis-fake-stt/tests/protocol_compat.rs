//! Mockito-free integration test: spawns `voxis_fake_stt`'s real axum
//! server on an OS-assigned port (`0`) and drives the real
//! `voxis_core::transcription::TranscriptionClient` against it -- the
//! actual end-to-end proof that this server speaks the same multipart-
//! request/`verbose_json`-response protocol the real Groq endpoint does,
//! from the exact client code the plugin's pipeline uses.

use std::collections::HashMap;
use voxis_core::transcription::TranscriptionClient;

async fn spawn_server(map: HashMap<String, String>) -> String {
    let addr = ([127, 0, 0, 1], 0).into();
    let (bound, serve_fut) = voxis_fake_stt::serve(addr, map).await.expect("bind fake-stt server");
    tokio::spawn(serve_fut);
    format!("http://{bound}/v1/audio/transcriptions")
}

#[tokio::test]
async fn known_sha_returns_the_fixed_text_through_the_real_client() {
    let wav_bytes = b"RIFF-fake-wav-bytes-for-protocol-compat-test".to_vec();
    let sha = voxis_fake_stt::sha256_hex(&wav_bytes);
    let mut map = HashMap::new();
    map.insert(sha, "hello from voxis-fake-stt".to_string());

    let url = spawn_server(map).await;
    let client = TranscriptionClient::with_url("dummy-key", None, None, &url).unwrap();

    let result = client.transcribe(wav_bytes).await.unwrap();

    assert_eq!(result.text, "hello from voxis-fake-stt");
}

#[tokio::test]
async fn unknown_sha_is_an_api_error_carrying_the_sha() {
    let url = spawn_server(HashMap::new()).await;
    let client = TranscriptionClient::with_url("dummy-key", None, None, &url).unwrap();
    let wav_bytes = b"never registered".to_vec();
    let expected_sha = voxis_fake_stt::sha256_hex(&wav_bytes);

    let result = client.transcribe(wav_bytes).await;

    let err = result.expect_err("an unregistered sha must not transcribe successfully");
    let message = err.to_string();
    assert!(message.contains(&expected_sha), "error message {message:?} must contain the sha256 {expected_sha:?} so adding a fixture is a one-line diff");
}

/// End-to-end against the *actual* production fixture map + speech WAV
/// this task ships (`fixtures/audio/`), not just synthetic bytes above --
/// proves the real fixtures round-trip through the real client/server
/// pair, not only that the protocol glue works in the abstract.
#[tokio::test]
async fn real_speech_fixture_returns_its_configured_transcript() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.join("../..");
    let map_path = repo_root.join("fixtures/audio/fake-stt-map.json");
    let speech_path = repo_root.join("fixtures/audio/speech.wav");

    let map = voxis_fake_stt::load_map(&map_path).expect("load the real fake-stt-map.json fixture");
    let speech_bytes = std::fs::read(&speech_path).expect("read the real speech.wav fixture");
    let expected_sha = voxis_fake_stt::sha256_hex(&speech_bytes);
    let expected_text = map.get(&expected_sha).cloned().expect(
        "fixtures/audio/fake-stt-map.json must have an entry for sha256(speech.wav) -- fixture map and wav are out of sync",
    );

    let url = spawn_server(map).await;
    let client = TranscriptionClient::with_url("dummy-key", None, None, &url).unwrap();

    let result = client.transcribe(speech_bytes).await.unwrap();

    assert_eq!(result.text, expected_text);
}
