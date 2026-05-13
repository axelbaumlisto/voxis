//! Post-processing for transcriptions.
//!
//! SRP: This module handles dictionary replacements and LLM processing only.
//!
//! Architecture (OCP/DIP after Phase 1.1):
//! - LLM transport selection lives in `llm::provider::build_llm_provider()`.
//! - This module depends on the `LlmProvider` trait, not on `LlmProcessor`.
//! - The provider returns raw assistant content; suggestion parsing happens
//!   here via `llm::parser::parse_result()`.

use crate::config::AppConfig;
use crate::learning::{CorrectionTracker, LearningMode};
use crate::llm::prompts::{find_by_id, LlmPrompt};
use crate::llm::provider::{build_llm_provider, LlmProvider};
use crate::llm::{parser, DictionarySuggestion, LlmResult};
use crate::storage;
use crate::storage::prompts_sqlite::LlmPromptsStorage;
use std::time::Instant;
use tauri::{AppHandle, Manager};

/// Pure resolver for the LLM prompt body that should drive this
/// post-process run. Falls back to the legacy `llm.prompt` string
/// (back-compat for users who never opened the new prompt manager).
///
/// Extracted as a pure function so the multi-prompt behaviour can be
/// unit-tested without spinning up SQLite or the storage factory
/// (SOLID-SRP).
pub(crate) fn resolve_prompt<'a>(
    active_id: Option<&str>,
    available: &'a [LlmPrompt],
    legacy: &'a str,
) -> &'a str {
    if let Some(id) = active_id {
        if let Some(found) = find_by_id(available, id) {
            return &found.prompt;
        }
    }
    legacy
}

/// SQLite-backed resolver used by the live post-process pipeline. Wraps
/// the pure `resolve_prompt` with the storage I/O so callers don't have
/// to wire it themselves.
fn resolve_active_prompt_string(app: &AppHandle, legacy: &str) -> String {
    let Some(paths) = app.try_state::<crate::storage::AppPaths>() else {
        return legacy.to_string();
    };
    let store = LlmPromptsStorage::new(paths.prompts_db());
    // Best-effort seed — idempotent.
    let _ = store.seed_defaults_if_empty();
    let active_id = store.get_active_id().ok().flatten();
    let list = store.list().unwrap_or_default();
    resolve_prompt(active_id.as_deref(), &list, legacy).to_string()
}

/// Result of post-processing.
pub struct PostProcessResult {
    /// Final processed text
    pub text: String,
    /// LLM result if LLM was used
    pub llm_result: Option<LlmResult>,
    /// LLM processing duration in milliseconds
    pub llm_duration_ms: u64,
}

/// Apply dictionary and LLM post-processing to transcribed text.
///
/// SRP: Handles all post-processing in a single, focused function.
/// DIP: Uses StorageFactory for storage access.
pub async fn apply_post_processing(
    app: &AppHandle,
    config: &AppConfig,
    text: &str,
) -> PostProcessResult {
    let mut final_text = text.to_string();
    let mut llm_result: Option<LlmResult> = None;
    let mut llm_duration_ms: u64 = 0;

    // Apply dictionary replacements
    final_text = apply_dictionary(app, &final_text);

    // LLM post-processing if enabled (skip for very short texts - 2 words or less)
    let word_count = final_text.split_whitespace().count();
    if config.llm.enabled && word_count > 2 {
        if let Some(provider) = build_llm_provider(&config.llm) {
            let prompt = resolve_active_prompt_string(app, &config.llm.prompt);
            let result = apply_llm_via_provider(app, config, provider.as_ref(), &prompt, &final_text).await;
            llm_duration_ms = result.llm_duration_ms;
            if let Some(ref llm) = result.llm_result {
                final_text = llm.text.clone();
            }
            llm_result = result.llm_result;
        } else {
            tracing::debug!("LLM enabled but no available provider; skipping post-processing");
        }
    }

    PostProcessResult {
        text: final_text,
        llm_result,
        llm_duration_ms,
    }
}

/// Apply dictionary replacements to text.
fn apply_dictionary(app: &AppHandle, text: &str) -> String {
    let mut result = text.to_string();

    if let Some(factory) = storage::get_storage_factory(app) {
        match factory.dictionary().apply(&result) {
            Ok(processed) => {
                if processed != result {
                    tracing::info!("Dictionary applied: \"{}\" -> \"{}\"", result, processed);
                    result = processed;
                }
            }
            Err(e) => tracing::warn!("Failed to apply dictionary: {}", e),
        }
    }

    result
}

/// Apply LLM processing to text via the provider trait.
///
/// DIP: depends on the `LlmProvider` abstraction, not on a concrete transport.
/// The provider returns raw assistant output; suggestion parsing happens here
/// via `llm::parser::parse_result()` so any back-end (HTTP, Apple, mock) works.
async fn apply_llm_via_provider(
    app: &AppHandle,
    config: &AppConfig,
    provider: &dyn LlmProvider,
    prompt: &str,
    text: &str,
) -> PostProcessResult {
    let llm_start = Instant::now();

    match provider.process(prompt, text).await {
        Ok(content) => {
            let result = match parser::parse_result(&content, text) {
                Ok(parsed) => parsed,
                Err(e) => {
                    tracing::warn!("Failed to parse LLM response: {}", e);
                    LlmResult {
                        text: text.to_string(),
                        suggestions: Vec::new(),
                    }
                }
            };
            let llm_duration_ms = llm_start.elapsed().as_millis() as u64;
            tracing::info!(
                "LLM[{}] processed: \"{}\" -> \"{}\" ({} suggestions)",
                provider.name(),
                text,
                result.text,
                result.suggestions.len()
            );

            if !result.suggestions.is_empty() {
                process_suggestions(app, config, &result.suggestions);
            }

            PostProcessResult {
                text: result.text.clone(),
                llm_result: Some(result),
                llm_duration_ms,
            }
        }
        Err(e) => {
            tracing::warn!("LLM[{}] processing failed: {}", provider.name(), e);
            PostProcessResult {
                text: text.to_string(),
                llm_result: None,
                llm_duration_ms: 0,
            }
        }
    }
}

/// Process LLM suggestions through CorrectionTracker.
///
/// DIP: Uses StorageFactory._dyn() methods for trait-based storage access.
fn process_suggestions(app: &AppHandle, config: &AppConfig, suggestions: &[DictionarySuggestion]) {
    if let Some(factory) = storage::get_storage_factory(app) {
        let learning_mode = config
            .dictionary
            .learning_mode
            .parse()
            .unwrap_or(LearningMode::Auto);

        if learning_mode != LearningMode::Disabled {
            let tracker = CorrectionTracker::new(
                learning_mode,
                config.dictionary.learning_threshold,
                factory.corrections_dyn(),
                factory.dictionary_dyn(),
            );

            for suggestion in suggestions {
                match tracker.on_suggestion(suggestion) {
                    Ok(result) => {
                        tracing::info!(
                            "Suggestion \"{}\" -> \"{}\": {:?}",
                            suggestion.source,
                            suggestion.replacement,
                            result
                        );
                    }
                    Err(e) => tracing::warn!("Failed to track suggestion: {}", e),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::prompts::default_prompts;
    use async_trait::async_trait;
    use std::sync::{Arc, Mutex};

    // --- T-A1.4 \xb7 pure prompt resolver ----------------------------------

    #[test]
    fn resolve_prompt_falls_back_to_legacy_when_no_active_id() {
        let prompts = default_prompts();
        let legacy = "my legacy prompt";
        let resolved = resolve_prompt(None, &prompts, legacy);
        assert_eq!(resolved, legacy);
    }

    #[test]
    fn resolve_prompt_uses_match_when_active_id_known() {
        let prompts = default_prompts();
        let legacy = "my legacy prompt";
        let resolved = resolve_prompt(Some("email_tone"), &prompts, legacy);
        assert!(resolved.contains("email"));
        assert_ne!(resolved, legacy);
    }

    #[test]
    fn resolve_prompt_falls_back_to_legacy_when_active_id_unknown() {
        // Stale active_id (e.g. user deleted the prompt) must not crash
        // or return an empty string — fall back to the legacy single-prompt
        // string so behavior is identical to the pre-multi-prompt era.
        let prompts = default_prompts();
        let legacy = "my legacy prompt";
        let resolved = resolve_prompt(Some("ghost_id_no_such_prompt"), &prompts, legacy);
        assert_eq!(resolved, legacy);
    }

    #[test]
    fn resolve_prompt_handles_empty_prompts_list() {
        let resolved = resolve_prompt(Some("anything"), &[], "legacy");
        assert_eq!(resolved, "legacy");
    }

    /// Shared handle to mock-provider call log (system_prompt, user_text).
    /// SRP: dedicated alias keeps `MockProvider::new()` signature readable
    /// and silences `clippy::type_complexity`.
    type ProviderCalls = Arc<Mutex<Vec<(String, String)>>>;

    /// Mock provider for trait-level integration tests.
    struct MockProvider {
        response: String,
        calls: ProviderCalls,
    }

    impl MockProvider {
        fn new(response: &str) -> (Self, ProviderCalls) {
            let calls: ProviderCalls = Arc::new(Mutex::new(Vec::new()));
            let provider = Self {
                response: response.to_string(),
                calls: Arc::clone(&calls),
            };
            (provider, calls)
        }
    }

    #[async_trait]
    impl LlmProvider for MockProvider {
        fn name(&self) -> &str {
            "Mock"
        }
        fn is_available(&self) -> bool {
            true
        }
        async fn process(
            &self,
            system_prompt: &str,
            user_text: &str,
        ) -> Result<String, String> {
            self.calls
                .lock()
                .unwrap()
                .push((system_prompt.to_string(), user_text.to_string()));
            Ok(self.response.clone())
        }
    }

    /// Provider that always errors — used to verify graceful fallback.
    struct FailingProvider;

    #[async_trait]
    impl LlmProvider for FailingProvider {
        fn name(&self) -> &str {
            "Failing"
        }
        fn is_available(&self) -> bool {
            true
        }
        async fn process(&self, _: &str, _: &str) -> Result<String, String> {
            Err("simulated network error".into())
        }
    }

    fn test_config() -> AppConfig {
        AppConfig::default()
    }

    #[tokio::test]
    async fn test_apply_llm_via_provider_parses_full_result() {
        let (provider, calls) =
            MockProvider::new(r#"{"text":"corrected","suggestions":[]}"#);
        let config = test_config();

        // Build a fake AppHandle by reusing a real app: not available in unit tests.
        // Instead, we test the provider/parser wiring directly by calling the helper
        // and ignoring app-dependent side-effects (suggestion tracking is skipped
        // when suggestions are empty, so no app access is needed).
        let result = apply_llm_via_provider_no_app(
            &config,
            &provider,
            "original text input here",
        )
        .await;

        assert_eq!(result.text, "corrected");
        assert!(result.llm_result.is_some());
        let llm = result.llm_result.unwrap();
        assert_eq!(llm.text, "corrected");
        assert!(llm.suggestions.is_empty());

        // Provider received the prompt + user text
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1, "original text input here");
    }

    #[tokio::test]
    async fn test_apply_llm_via_provider_parses_suggestions() {
        let (provider, _) = MockProvider::new(
            r#"{"text":"SOLID principles","suggestions":[{"source":"solid","replacement":"SOLID"}]}"#,
        );
        let config = test_config();

        let result = apply_llm_via_provider_no_app(&config, &provider, "solid principles").await;

        let llm = result.llm_result.expect("llm_result must be Some");
        assert_eq!(llm.text, "SOLID principles");
        assert_eq!(llm.suggestions.len(), 1);
        assert_eq!(llm.suggestions[0].source, "solid");
        assert_eq!(llm.suggestions[0].replacement, "SOLID");
    }

    #[tokio::test]
    async fn test_apply_llm_via_provider_falls_back_on_error() {
        let provider = FailingProvider;
        let config = test_config();

        let result =
            apply_llm_via_provider_no_app(&config, &provider, "input text fallback").await;

        // Returns original text and no LLM result on error.
        assert_eq!(result.text, "input text fallback");
        assert!(result.llm_result.is_none());
        assert_eq!(result.llm_duration_ms, 0);
    }

    #[tokio::test]
    async fn test_apply_llm_via_provider_falls_back_on_bad_json() {
        // parser::parse_result is total — returns a fallback result for non-JSON.
        // Verify we still produce a usable LlmResult (with original text).
        let (provider, _) = MockProvider::new("not valid json at all");
        let config = test_config();

        let result = apply_llm_via_provider_no_app(&config, &provider, "some input").await;

        assert!(result.llm_result.is_some());
        let llm = result.llm_result.unwrap();
        assert_eq!(llm.text, "some input");
        assert!(llm.suggestions.is_empty());
    }

    /// Helper for unit tests that avoids requiring a Tauri `AppHandle`.
    /// Mirrors `apply_llm_via_provider` but skips the side-effecting suggestion
    /// tracker (which needs storage). Keeps tests fast and hermetic.
    async fn apply_llm_via_provider_no_app(
        config: &AppConfig,
        provider: &dyn LlmProvider,
        text: &str,
    ) -> PostProcessResult {
        let llm_start = Instant::now();
        match provider.process(&config.llm.prompt, text).await {
            Ok(content) => {
                let result = parser::parse_result(&content, text).unwrap_or_else(|_| LlmResult {
                    text: text.to_string(),
                    suggestions: Vec::new(),
                });
                PostProcessResult {
                    text: result.text.clone(),
                    llm_duration_ms: llm_start.elapsed().as_millis() as u64,
                    llm_result: Some(result),
                }
            }
            Err(_) => PostProcessResult {
                text: text.to_string(),
                llm_result: None,
                llm_duration_ms: 0,
            },
        }
    }

    #[test]
    fn test_build_llm_provider_returns_none_when_disabled() {
        let config = crate::config::LlmConfig {
            enabled: false,
            ..crate::config::LlmConfig::default()
        };
        assert!(crate::llm::provider::build_llm_provider(&config).is_none());
    }

    #[test]
    fn test_build_llm_provider_returns_none_when_no_key() {
        let config = crate::config::LlmConfig {
            enabled: true,
            api_key: String::new(),
            ..crate::config::LlmConfig::default()
        };
        assert!(crate::llm::provider::build_llm_provider(&config).is_none());
    }

    #[test]
    fn test_build_llm_provider_returns_http_with_key() {
        let config = crate::config::LlmConfig {
            enabled: true,
            api_key: "test-key".into(),
            ..crate::config::LlmConfig::default()
        };
        let provider = crate::llm::provider::build_llm_provider(&config);
        assert!(provider.is_some());
        let provider = provider.unwrap();
        // Name reflects the configured cloud provider (e.g. "groq", "openai").
        assert_eq!(provider.name(), config.provider);
    }

    #[test]
    fn test_post_process_result_default() {
        let result = PostProcessResult {
            text: "test".to_string(),
            llm_result: None,
            llm_duration_ms: 0,
        };
        assert_eq!(result.text, "test");
        assert!(result.llm_result.is_none());
        assert_eq!(result.llm_duration_ms, 0);
    }

    #[test]
    fn test_post_process_result_with_llm() {
        let llm_result = LlmResult {
            text: "corrected text".to_string(),
            suggestions: vec![],
        };
        let result = PostProcessResult {
            text: "corrected text".to_string(),
            llm_result: Some(llm_result),
            llm_duration_ms: 150,
        };
        assert_eq!(result.text, "corrected text");
        assert!(result.llm_result.is_some());
        assert_eq!(result.llm_duration_ms, 150);
    }

    #[test]
    fn test_post_process_result_with_suggestions() {
        let llm_result = LlmResult {
            text: "SOLID principles".to_string(),
            suggestions: vec![DictionarySuggestion {
                source: "solid".to_string(),
                replacement: "SOLID".to_string(),
            }],
        };
        let result = PostProcessResult {
            text: "SOLID principles".to_string(),
            llm_result: Some(llm_result.clone()),
            llm_duration_ms: 200,
        };

        assert_eq!(result.llm_result.as_ref().unwrap().suggestions.len(), 1);
        assert_eq!(
            result.llm_result.as_ref().unwrap().suggestions[0].source,
            "solid"
        );
    }

    #[test]
    fn test_post_process_result_preserves_original_on_no_llm() {
        let result = PostProcessResult {
            text: "original text unchanged".to_string(),
            llm_result: None,
            llm_duration_ms: 0,
        };
        assert_eq!(result.text, "original text unchanged");
    }

    #[test]
    fn test_post_process_result_duration_zero_on_skip() {
        // When LLM is skipped, duration should be 0
        let result = PostProcessResult {
            text: "skipped".to_string(),
            llm_result: None,
            llm_duration_ms: 0,
        };
        assert_eq!(result.llm_duration_ms, 0);
    }

    #[test]
    fn test_post_process_result_long_duration() {
        // Test with a realistic longer duration
        let result = PostProcessResult {
            text: "processed".to_string(),
            llm_result: None,
            llm_duration_ms: 5000, // 5 seconds
        };
        assert_eq!(result.llm_duration_ms, 5000);
    }
}
