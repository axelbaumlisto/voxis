//! LLM HTTP transport — shared chat-completion call used by providers.
//!
//! After removing `LlmProcessor`, this module only exposes
//! `send_chat_completion`, which is reused by `HttpLlmProvider` (DRY).
//! Request construction lives in `client::build_chat_request`; response parsing
//! lives in `parser::parse_result` and is invoked by callers (provider/parser
//! split keeps SRP intact).

use super::client::ChatRequest;
use super::client::ChatResponse;
use super::config::LlmConfig;

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

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::client::build_chat_request;

    fn test_config(url: String) -> LlmConfig {
        LlmConfig {
            api_url: url,
            api_key: "test-key".to_string(),
            model: "test-model".to_string(),
            prompt: "Test prompt".to_string(),
        }
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
}
