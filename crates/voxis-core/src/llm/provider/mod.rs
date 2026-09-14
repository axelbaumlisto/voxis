//! Pluggable LLM provider abstraction.
//!
//! Architecture (SOLID):
//! - **OCP/DIP**: `LlmProvider` trait lets callers depend on the abstraction
//!   rather than a concrete HTTP client. New back-ends (local llama.cpp, mock,
//!   etc.) implement the same trait without touching existing code.
//! - **SRP**: each implementation focuses on one transport:
//!     * `HttpLlmProvider` — OpenAI-compatible HTTP endpoints (Groq / OpenAI / etc.)
//! - **DRY**: `HttpLlmProvider` reuses the existing `engine::send_chat_completion`
//!   request/response plumbing instead of duplicating reqwest setup.
//! - **KISS**: the trait surface is intentionally minimal — three methods,
//!   `String → Result<String>`. Higher-level parsing (suggestions, dictionary
//!   matching) stays in callers, not in the transport layer.

use async_trait::async_trait;

mod http;

#[cfg(test)]
mod tests;

pub use http::HttpLlmProvider;

use crate::config::LlmConfig as AppLlmConfig;

/// Abstraction over an LLM back-end that can post-process text.
///
/// Implementations must be `Send + Sync` so they can be stored as
/// `Box<dyn LlmProvider>` inside Tauri-managed state and called from any thread.
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Human-readable provider name (e.g. `"OpenAI"`, `"Groq"`).
    fn name(&self) -> &str;

    /// Returns `true` when the provider can currently serve requests
    /// (credentials present, runtime feature available, etc.).
    fn is_available(&self) -> bool;

    /// Process `user_text` under the guidance of `system_prompt`.
    ///
    /// Returns the raw model output as a string. Callers (e.g. the LLM pipeline)
    /// are responsible for parsing JSON or extracting suggestions.
    async fn process(&self, system_prompt: &str, user_text: &str) -> Result<String, String>;
}

/// Build an LLM provider from app config.
///
/// SRP: this factory is the single place that knows which concrete provider to
/// instantiate for a given configuration. Callers depend only on the trait.
///
/// Returns `None` when LLM is disabled or no usable provider can be constructed
/// (e.g. missing API key).
pub fn build_llm_provider(config: &AppLlmConfig) -> Option<Box<dyn LlmProvider>> {
    if !config.enabled {
        return None;
    }

    let http = HttpLlmProvider::new(
        config.provider.clone(),
        config.api_url.clone(),
        config.api_key.clone(),
        config.model.clone(),
    );
    if !http.is_available() {
        return None;
    }
    Some(Box::new(http))
}
