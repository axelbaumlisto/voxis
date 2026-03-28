//! HTTP client for LLM API communication.

use serde::{Deserialize, Serialize};

/// Response format specification for chat completions API.
#[derive(Debug, Serialize)]
pub struct ResponseFormat {
    pub r#type: String,
}

/// Request body for chat completions API.
#[derive(Debug, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
    pub max_tokens: u32,
    pub response_format: ResponseFormat,
}

#[derive(Debug, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Response from chat completions API.
#[derive(Debug, Deserialize)]
pub struct ChatResponse {
    pub choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
pub struct ChatChoice {
    pub message: ChatMessageResponse,
}

#[derive(Debug, Deserialize)]
pub struct ChatMessageResponse {
    pub content: String,
}

/// Build a chat request for the LLM API.
pub fn build_chat_request(model: &str, prompt: &str, text: &str) -> ChatRequest {
    ChatRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: prompt.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: text.to_string(),
            },
        ],
        temperature: 0.1, // Low temperature for consistent output
        max_tokens: 1024,
        response_format: ResponseFormat {
            r#type: "json_object".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_chat_request() {
        let req = build_chat_request("gpt-4", "System prompt", "User text");

        assert_eq!(req.model, "gpt-4");
        assert_eq!(req.messages.len(), 2);
        assert_eq!(req.messages[0].role, "system");
        assert_eq!(req.messages[0].content, "System prompt");
        assert_eq!(req.messages[1].role, "user");
        assert_eq!(req.messages[1].content, "User text");
        assert!((req.temperature - 0.1).abs() < f32::EPSILON);
        assert_eq!(req.max_tokens, 1024);
    }

    #[test]
    fn test_chat_response_deserialize() {
        let json = r#"{
            "choices": [{
                "message": {
                    "content": "Hello, world!"
                }
            }]
        }"#;

        let response: ChatResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.choices.len(), 1);
        assert_eq!(response.choices[0].message.content, "Hello, world!");
    }

    #[test]
    fn test_chat_response_empty_choices() {
        let json = r#"{"choices": []}"#;
        let response: ChatResponse = serde_json::from_str(json).unwrap();
        assert!(response.choices.is_empty());
    }
}
