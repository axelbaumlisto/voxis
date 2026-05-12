//! Apple Intelligence provider — on-device Foundation Models via FFI.
//!
//! Wraps the existing `crate::apple_intelligence` module (which already provides
//! a sync stub on every platform) so the rest of the LLM pipeline can treat it
//! as just another `LlmProvider`.
//!
//! The underlying FFI is synchronous and may take seconds for inference, so
//! `process()` offloads it onto `tokio::task::spawn_blocking` to keep the
//! async runtime responsive.

use async_trait::async_trait;

use super::LlmProvider;
use crate::apple_intelligence;

/// Default token budget for on-device responses. Foundation Models treats this
/// as an upper bound; smaller transcriptions naturally use fewer tokens.
const DEFAULT_MAX_TOKENS: i32 = 512;

/// On-device LLM provider backed by Apple's Foundation Models framework
/// (macOS 26.0+ / Apple Silicon). On any other platform `is_available()`
/// returns `false` and `process()` returns `Err`.
pub struct AppleIntelligenceProvider {
    name: String,
    max_tokens: i32,
}

impl AppleIntelligenceProvider {
    /// Create a provider with the default token budget.
    pub fn new() -> Self {
        Self {
            name: "Apple Intelligence".to_string(),
            max_tokens: DEFAULT_MAX_TOKENS,
        }
    }

    /// Override the token budget passed to Foundation Models.
    pub fn with_max_tokens(mut self, max_tokens: i32) -> Self {
        self.max_tokens = max_tokens;
        self
    }
}

impl Default for AppleIntelligenceProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl LlmProvider for AppleIntelligenceProvider {
    fn name(&self) -> &str {
        &self.name
    }

    fn is_available(&self) -> bool {
        apple_intelligence::is_available()
    }

    async fn process(&self, system_prompt: &str, user_text: &str) -> Result<String, String> {
        if user_text.trim().is_empty() {
            return Ok(user_text.to_string());
        }

        // FFI call is synchronous and CPU/IO-heavy — keep the runtime healthy.
        let system_prompt = system_prompt.to_string();
        let user_text = user_text.to_string();
        let max_tokens = self.max_tokens;

        tokio::task::spawn_blocking(move || {
            apple_intelligence::process_text_with_system_prompt(
                &system_prompt,
                &user_text,
                max_tokens,
            )
        })
        .await
        .map_err(|e| format!("Apple Intelligence task join error: {e}"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_name() {
        let provider = AppleIntelligenceProvider::new();
        assert_eq!(provider.name(), "Apple Intelligence");
    }

    #[test]
    fn test_with_max_tokens_overrides_default() {
        let provider = AppleIntelligenceProvider::new().with_max_tokens(128);
        assert_eq!(provider.max_tokens, 128);
    }

    #[test]
    fn test_default_max_tokens_constant() {
        let provider = AppleIntelligenceProvider::new();
        assert_eq!(provider.max_tokens, DEFAULT_MAX_TOKENS);
    }

    #[test]
    fn test_is_available_matches_underlying_module() {
        let provider = AppleIntelligenceProvider::new();
        assert_eq!(provider.is_available(), apple_intelligence::is_available());
    }

    #[tokio::test]
    async fn test_process_empty_text_short_circuits() {
        let provider = AppleIntelligenceProvider::new();
        let result = provider.process("sys", "").await.unwrap();
        assert_eq!(result, "");
    }

    /// On any platform that doesn't have Apple Intelligence available, calling
    /// `process()` on a non-empty input must return `Err` rather than panic.
    /// On Apple Silicon the runtime may make this succeed or fail depending on
    /// the OS release, so we only check the "no-panic" guarantee in that case.
    #[tokio::test]
    async fn test_process_returns_err_when_unavailable() {
        let provider = AppleIntelligenceProvider::new();
        let result = provider.process("Fix grammar.", "hello world").await;

        if !provider.is_available() {
            assert!(
                result.is_err(),
                "Provider must return Err when unavailable, got: {:?}",
                result
            );
        }
        // When available we don't assert on the response content (depends on
        // the on-device model) — just that no panic occurred.
        let _ = result;
    }
}
