use super::types::{LlmModel, LlmProvider};

/// Default providers to insert on first run.
pub fn default_providers() -> Vec<LlmProvider> {
    vec![
        LlmProvider {
            id: "groq".into(),
            name: "Groq".into(),
            api_url: "https://api.groq.com/openai/v1/chat/completions".into(),
            models: vec![
                LlmModel {
                    id: "llama-3.3-70b-versatile".into(),
                    name: "Llama 3.3 70B".into(),
                },
                LlmModel {
                    id: "llama-3.1-8b-instant".into(),
                    name: "Llama 3.1 8B Instant".into(),
                },
                LlmModel {
                    id: "mixtral-8x7b-32768".into(),
                    name: "Mixtral 8x7B".into(),
                },
            ],
            default_model: "llama-3.3-70b-versatile".into(),
            builtin: true,
        },
        LlmProvider {
            id: "openai".into(),
            name: "OpenAI".into(),
            api_url: "https://api.openai.com/v1/chat/completions".into(),
            models: vec![
                LlmModel {
                    id: "gpt-4o".into(),
                    name: "GPT-4o".into(),
                },
                LlmModel {
                    id: "gpt-4o-mini".into(),
                    name: "GPT-4o Mini".into(),
                },
                LlmModel {
                    id: "gpt-4-turbo".into(),
                    name: "GPT-4 Turbo".into(),
                },
                LlmModel {
                    id: "gpt-3.5-turbo".into(),
                    name: "GPT-3.5 Turbo".into(),
                },
            ],
            default_model: "gpt-4o-mini".into(),
            builtin: true,
        },
        LlmProvider {
            id: "openrouter".into(),
            name: "OpenRouter".into(),
            api_url: "https://openrouter.ai/api/v1/chat/completions".into(),
            models: vec![
                LlmModel {
                    id: "anthropic/claude-3.5-sonnet".into(),
                    name: "Claude 3.5 Sonnet".into(),
                },
                LlmModel {
                    id: "google/gemini-pro-1.5".into(),
                    name: "Gemini Pro 1.5".into(),
                },
                LlmModel {
                    id: "meta-llama/llama-3.1-70b-instruct".into(),
                    name: "Llama 3.1 70B".into(),
                },
            ],
            default_model: "anthropic/claude-3.5-sonnet".into(),
            builtin: true,
        },
    ]
}
