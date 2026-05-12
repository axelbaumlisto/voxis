//! HTTP-based LLM provider (OpenAI-compatible chat completions API).
//!
//! Reuses `engine::send_chat_completion` (DRY) instead of duplicating
//! reqwest plumbing. Returns raw assistant content; JSON parsing belongs
//! to higher layers.

use async_trait::async_trait;
use std::time::Duration;

use super::LlmProvider;
use crate::llm::client;
use crate::llm::config::LlmConfig;
use crate::llm::engine;

/// Default timeout (seconds) for outbound LLM HTTP requests.
const HTTP_TIMEOUT_SECS: u64 = 30;

/// Generic OpenAI-compatible chat-completions provider.
///
/// Works with Groq, OpenAI, Together, and any other endpoint that speaks the
/// `POST /v1/chat/completions` protocol.
pub struct HttpLlmProvider {
    name: String,
    api_url: String,
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl HttpLlmProvider {
    /// Construct a provider with a custom display name (`"Groq"`, `"OpenAI"`...).
    pub fn new(
        name: impl Into<String>,
        api_url: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            name: name.into(),
            api_url: api_url.into(),
            api_key: api_key.into(),
            model: model.into(),
            client,
        }
    }

    /// Build a transient `LlmConfig` for engine reuse.
    fn config_for(&self, system_prompt: &str) -> LlmConfig {
        LlmConfig {
            api_url: self.api_url.clone(),
            api_key: self.api_key.clone(),
            model: self.model.clone(),
            prompt: system_prompt.to_string(),
        }
    }
}

#[async_trait]
impl LlmProvider for HttpLlmProvider {
    fn name(&self) -> &str {
        &self.name
    }

    /// Available when an API key is configured. We don't ping the endpoint —
    /// that would be a side-effecting operation incompatible with a sync getter.
    fn is_available(&self) -> bool {
        !self.api_key.trim().is_empty()
    }

    async fn process(&self, system_prompt: &str, user_text: &str) -> Result<String, String> {
        if user_text.trim().is_empty() {
            return Ok(user_text.to_string());
        }

        let config = self.config_for(system_prompt);
        let request = client::build_chat_request(&config.model, &config.prompt, user_text);

        engine::send_chat_completion(&self.client, &config, &request)
            .await
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_sets_name() {
        let provider =
            HttpLlmProvider::new("Groq", "https://api.groq.com", "key123", "llama-3.1-8b-instant");
        assert_eq!(provider.name(), "Groq");
    }

    #[test]
    fn test_is_available_with_key() {
        let provider = HttpLlmProvider::new("OpenAI", "https://api.openai.com", "sk-abc", "gpt-4o");
        assert!(provider.is_available());
    }

    #[test]
    fn test_is_available_without_key() {
        let provider = HttpLlmProvider::new("OpenAI", "https://api.openai.com", "", "gpt-4o");
        assert!(!provider.is_available());
    }

    #[test]
    fn test_is_available_whitespace_key_treated_as_missing() {
        let provider =
            HttpLlmProvider::new("OpenAI", "https://api.openai.com", "   \t  ", "gpt-4o");
        assert!(!provider.is_available());
    }

    #[tokio::test]
    async fn test_process_empty_text_short_circuits() {
        let provider = HttpLlmProvider::new("Test", "https://invalid.example.com", "k", "m");
        let result = provider.process("sys", "").await.unwrap();
        assert_eq!(result, "");
    }

    #[tokio::test]
    async fn test_process_whitespace_only_short_circuits() {
        let provider = HttpLlmProvider::new("Test", "https://invalid.example.com", "k", "m");
        let result = provider.process("sys", "   \t\n  ").await.unwrap();
        assert_eq!(result, "   \t\n  ");
    }
}
