//! LLM processor configuration.

/// LLM processor configuration.
#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub api_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_llm_config_clone() {
        let config = LlmConfig {
            api_url: "https://api.example.com".to_string(),
            api_key: "test-key".to_string(),
            model: "test-model".to_string(),
            prompt: "Test prompt".to_string(),
        };
        let cloned = config.clone();
        assert_eq!(cloned.api_url, config.api_url);
        assert_eq!(cloned.api_key, config.api_key);
        assert_eq!(cloned.model, config.model);
        assert_eq!(cloned.prompt, config.prompt);
    }
}
