//! Pluggable LLM provider abstraction.
//!
//! Architecture (SOLID):
//! - **OCP/DIP**: `LlmProvider` trait lets callers depend on the abstraction
//!   rather than a concrete HTTP / native client. New back-ends (Apple
//!   Intelligence, local llama.cpp, mock) implement the same trait without
//!   touching existing code.
//! - **SRP**: each implementation focuses on one transport:
//!     * `HttpLlmProvider` — OpenAI-compatible HTTP endpoints (Groq / OpenAI / etc.)
//!     * `AppleIntelligenceProvider` — on-device Foundation Models on Apple Silicon
//! - **DRY**: `HttpLlmProvider` reuses the existing `engine::send_chat_completion`
//!   request/response plumbing instead of duplicating reqwest setup.
//! - **KISS**: the trait surface is intentionally minimal — three methods,
//!   `String → Result<String>`. Higher-level parsing (suggestions, dictionary
//!   matching) stays in callers, not in the transport layer.

use async_trait::async_trait;

mod apple;
mod http;

#[cfg(test)]
mod tests;

pub use apple::AppleIntelligenceProvider;
pub use http::HttpLlmProvider;

/// Abstraction over an LLM back-end that can post-process text.
///
/// Implementations must be `Send + Sync` so they can be stored as
/// `Box<dyn LlmProvider>` inside Tauri-managed state and called from any thread.
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Human-readable provider name (e.g. `"OpenAI"`, `"Apple Intelligence"`).
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
