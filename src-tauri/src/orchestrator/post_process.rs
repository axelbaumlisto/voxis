//! Post-processing for transcriptions.
//!
//! SRP: This module handles dictionary replacements and LLM processing only.

use crate::config::AppConfig;
use crate::learning::{CorrectionTracker, LearningMode};
use crate::llm::{DictionarySuggestion, LlmProcessor, LlmResult};
use crate::storage;
use std::time::Instant;
use tauri::AppHandle;

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
    if config.llm.enabled && !config.llm.api_key.is_empty() && word_count > 2 {
        let result = apply_llm(app, config, &final_text).await;
        llm_duration_ms = result.llm_duration_ms;
        if let Some(ref llm) = result.llm_result {
            final_text = llm.text.clone();
        }
        llm_result = result.llm_result;
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

/// Apply LLM processing to text.
async fn apply_llm(app: &AppHandle, config: &AppConfig, text: &str) -> PostProcessResult {
    let llm_start = Instant::now();
    let processor = LlmProcessor::new(crate::llm::LlmConfig {
        api_url: config.llm.api_url.clone(),
        api_key: config.llm.api_key.clone(),
        model: config.llm.model.clone(),
        prompt: config.llm.prompt.clone(),
    });

    match processor.process(text).await {
        Ok(result) => {
            let llm_duration_ms = llm_start.elapsed().as_millis() as u64;
            tracing::info!(
                "LLM processed: \"{}\" -> \"{}\" ({} suggestions)",
                text,
                result.text,
                result.suggestions.len()
            );

            // Process suggestions through CorrectionTracker
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
            tracing::warn!("LLM processing failed: {}", e);
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
