//! LLM request engine for processor pipeline.
//!
//! Combines request building, API execution, and pipeline orchestration.

use super::client::{build_chat_request, ChatRequest, ChatResponse};
use super::config::LlmConfig;
use super::parser::parse_result;
use super::types::LlmResult;

/// Build request payload from LLM config + source text.
pub fn build_request(config: &LlmConfig, text: &str) -> ChatRequest {
    build_chat_request(&config.model, &config.prompt, text)
}

/// Send chat completion request and return assistant message content.
pub async fn send_chat_completion(
    http_client: &reqwest::Client,
    config: &LlmConfig,
    request: &ChatRequest,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let response = http_client
        .post(&config.api_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(request)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("LLM API error {}: {}", status, error_text).into());
    }

    let chat_response: ChatResponse = response.json().await?;
    let content = chat_response
        .choices
        .first()
        .map(|choice| choice.message.content.clone())
        .ok_or("LLM returned no choices")?;

    Ok(content)
}

/// Execute post-processing pipeline:
/// 1) Empty input short-circuit
/// 2) Prompt/request build
/// 3) LLM API call
/// 4) Result parsing
pub async fn process_text(
    http_client: &reqwest::Client,
    config: &LlmConfig,
    text: &str,
) -> Result<LlmResult, Box<dyn std::error::Error + Send + Sync>> {
    if text.trim().is_empty() {
        return Ok(LlmResult {
            text: text.to_string(),
            suggestions: Vec::new(),
        });
    }

    let request = build_request(config, text);
    let content = send_chat_completion(http_client, config, &request).await?;

    parse_result(&content, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(url: String) -> LlmConfig {
        LlmConfig {
            api_url: url,
            api_key: "test-key".to_string(),
            model: "test-model".to_string(),
            prompt: "Test prompt".to_string(),
        }
    }

    #[test]
    fn test_build_request_uses_model_and_prompt_from_config() {
        let config = LlmConfig {
            api_url: "https://api.example.com".to_string(),
            api_key: "test-key".to_string(),
            model: "gpt-4o-mini".to_string(),
            prompt: "Fix punctuation".to_string(),
        };

        let request = build_request(&config, "hello world");
        assert_eq!(request.model, "gpt-4o-mini");
        assert_eq!(request.messages[0].content, "Fix punctuation");
        assert_eq!(request.messages[1].content, "hello world");
    }

    #[tokio::test]
    async fn test_send_chat_completion_success() {
        let mut server = mockito::Server::new_async().await;
        let url = format!("{}/v1/chat/completions", server.url());
        let config = test_config(url.clone());

        let response_body = r#"{
            "choices": [{
                "message": {
                    "content": "{\"text\":\"Hello\",\"suggestions\":[]}"
                }
            }]
        }"#;

        let mock = server
            .mock("POST", "/v1/chat/completions")
            .match_header("Authorization", "Bearer test-key")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body)
            .create_async()
            .await;

        let request = build_chat_request(&config.model, &config.prompt, "hello");
        let result = send_chat_completion(&reqwest::Client::new(), &config, &request)
            .await
            .unwrap();

        assert!(result.contains("Hello"));
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_send_chat_completion_http_error() {
        let mut server = mockito::Server::new_async().await;
        let url = format!("{}/v1/chat/completions", server.url());
        let config = test_config(url.clone());

        let mock = server
            .mock("POST", "/v1/chat/completions")
            .with_status(401)
            .with_body("Unauthorized")
            .create_async()
            .await;

        let request = build_chat_request(&config.model, &config.prompt, "hello");
        let err = send_chat_completion(&reqwest::Client::new(), &config, &request)
            .await
            .unwrap_err()
            .to_string();

        assert!(err.contains("401"));
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_pipeline_returns_early_for_empty_text() {
        let client = reqwest::Client::new();
        let config = LlmConfig {
            api_url: "https://api.example.com".to_string(),
            api_key: "test-key".to_string(),
            model: "test-model".to_string(),
            prompt: "Test prompt".to_string(),
        };

        let result = process_text(&client, &config, "   ").await.unwrap();
        assert_eq!(result.text, "   ");
        assert!(result.suggestions.is_empty());
    }
}
