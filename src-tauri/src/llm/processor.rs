//! LLM processor facade for text post-processing.
//!
//! Keeps public API stable while delegating work to pipeline stages.

use std::time::Duration;

use super::config::LlmConfig;
use super::engine;
use super::types::LlmResult;

/// Default timeout for LLM API requests in seconds.
const LLM_TIMEOUT_SECS: u64 = 30;

/// LLM processor for text post-processing.
pub struct LlmProcessor {
    config: LlmConfig,
    client: reqwest::Client,
}

impl LlmProcessor {
    /// Create a new LLM processor with configured timeout.
    pub fn new(config: LlmConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(LLM_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { config, client }
    }

    /// Process text through LLM for grammar correction and suggestions.
    pub async fn process(
        &self,
        text: &str,
    ) -> Result<LlmResult, Box<dyn std::error::Error + Send + Sync>> {
        engine::process_text(&self.client, &self.config, text).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_processor() -> LlmProcessor {
        LlmProcessor::new(LlmConfig {
            api_url: "https://api.example.com".to_string(),
            api_key: "test-key".to_string(),
            model: "test-model".to_string(),
            prompt: "Test prompt".to_string(),
        })
    }

    #[test]
    fn test_processor_new() {
        let config = LlmConfig {
            api_url: "https://api.test.com".to_string(),
            api_key: "my-key".to_string(),
            model: "gpt-4".to_string(),
            prompt: "Fix grammar".to_string(),
        };
        let processor = LlmProcessor::new(config.clone());
        assert_eq!(processor.config.api_url, "https://api.test.com");
        assert_eq!(processor.config.api_key, "my-key");
        assert_eq!(processor.config.model, "gpt-4");
        assert_eq!(processor.config.prompt, "Fix grammar");
    }

    #[test]
    fn test_process_empty_text() {
        let processor = create_test_processor();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(processor.process("")).unwrap();
        assert_eq!(result.text, "");
        assert!(result.suggestions.is_empty());
    }

    #[test]
    fn test_process_whitespace_only() {
        let processor = create_test_processor();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(processor.process("  \t\n  ")).unwrap();
        assert_eq!(result.text, "  \t\n  ");
        assert!(result.suggestions.is_empty());
    }

    #[test]
    fn test_processor_has_timeout_configured() {
        assert_eq!(super::LLM_TIMEOUT_SECS, 30);
    }
}
