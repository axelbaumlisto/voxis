//! Integration tests for the `LlmProvider` trait surface.
//!
//! Per-implementation behaviour lives in `http.rs`; this file verifies the
//! trait itself (object safety, dispatch) and end-to-end HTTP happy-path /
//! error-path with mockito.

use super::*;

/// The trait must be object-safe so callers can hold `Box<dyn LlmProvider>`
/// — this is the whole point of the abstraction (DIP).
#[test]
fn test_provider_trait_is_object_safe() {
    fn assert_object_safe(_: Box<dyn LlmProvider>) {}

    let http_provider: Box<dyn LlmProvider> = Box::new(HttpLlmProvider::new(
        "Test",
        "https://example.com",
        "key",
        "model",
    ));
    assert_object_safe(http_provider);
}

#[tokio::test]
async fn test_http_provider_processes_text() {
    let mut server = mockito::Server::new_async().await;
    let url = format!("{}/v1/chat/completions", server.url());

    let body = r#"{
        "choices": [{"message": {"content": "Hello, world!"}}]
    }"#;

    let mock = server
        .mock("POST", "/v1/chat/completions")
        .match_header("Authorization", "Bearer test-key")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(body)
        .create_async()
        .await;

    let provider = HttpLlmProvider::new("TestLLM", url, "test-key", "gpt-4o-mini");
    let result = provider
        .process("Fix grammar.", "hellow world")
        .await
        .expect("provider should succeed");

    assert_eq!(result, "Hello, world!");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_http_provider_handles_error() {
    let mut server = mockito::Server::new_async().await;
    let url = format!("{}/v1/chat/completions", server.url());

    let mock = server
        .mock("POST", "/v1/chat/completions")
        .with_status(401)
        .with_body("Unauthorized")
        .create_async()
        .await;

    let provider = HttpLlmProvider::new("TestLLM", url, "bad-key", "gpt-4o-mini");
    let err = provider
        .process("sys", "user text")
        .await
        .expect_err("provider should propagate HTTP error");

    assert!(err.contains("401"), "expected 401 in error message: {err}");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_dispatch_through_trait_object() {
    let provider: Box<dyn LlmProvider> = Box::new(HttpLlmProvider::new(
        "Mock",
        "https://invalid.example.com",
        "key",
        "model",
    ));

    // Whitespace short-circuit must work regardless of the concrete type.
    let out = provider.process("sys", "   ").await.unwrap();
    assert_eq!(out, "   ");
    assert_eq!(provider.name(), "Mock");
    assert!(provider.is_available());
}
