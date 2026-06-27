//! Pending suggestions-related Tauri commands.
//!
//! Architecture (SOLID after LlmProcessor removal):
//! - OCP/DIP: batch processing depends on `LlmProvider` trait, not concrete
//!   `LlmProcessor`. Construction lives in a single factory (`build_batch_provider`).
//! - SRP: `process_batch_via_provider` is a pure function (no Tauri state),
//!   making it directly unit-testable with mock providers.
//! - DRY: reuses `crate::llm::parser::parse_result` — same parser the
//!   live post-processing pipeline uses.

use crate::config::BATCH_SUGGESTIONS_PROMPT;
use crate::error::BoxedIntoCommandError;
use crate::learning::{CorrectionTracker, LearningMode};
use crate::llm::provider::{HttpLlmProvider, LlmProvider};
use crate::llm::{parser, DictionarySuggestion, LlmResult};
use crate::storage::{AppPaths, StorageFactory, TrackedSuggestion};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use super::get_factory;

// =============================================================================
// Helper Functions
// =============================================================================

/// Create a CorrectionTracker with config from storage.
/// DRY: Extracts repeated tracker creation pattern.
/// DIP: Uses factory._dyn() methods for trait-based storage.
fn create_tracker(factory: &StorageFactory) -> Result<CorrectionTracker, String> {
    let config = factory.config().load().unwrap_or_default();
    let mode = config
        .dictionary
        .learning_mode
        .parse()
        .unwrap_or(LearningMode::Auto);

    Ok(CorrectionTracker::new(
        mode,
        config.dictionary.learning_threshold,
        factory.corrections_dyn(),
        factory.dictionary_dyn(),
    ))
}

/// Action to perform on a suggestion.
enum SuggestionAction {
    Approve,
    Reject,
}

/// Target for a suggestion action.
enum SuggestionTarget {
    ById(i64),
    BySource(String, String),
}

/// Execute a suggestion action (approve/reject) on a target.
/// DRY: Consolidates the 4 approve/reject commands into a single helper.
fn execute_suggestion_action(
    factory: &StorageFactory,
    action: SuggestionAction,
    target: SuggestionTarget,
) -> Result<(), String> {
    let tracker = create_tracker(factory)?;

    match (action, target) {
        (SuggestionAction::Approve, SuggestionTarget::ById(id)) => tracker.approve(id).cmd_err(),
        (SuggestionAction::Approve, SuggestionTarget::BySource(source, replacement)) => {
            tracker.approve_by_source(&source, &replacement).cmd_err()
        }
        (SuggestionAction::Reject, SuggestionTarget::ById(id)) => tracker.reject(id).cmd_err(),
        (SuggestionAction::Reject, SuggestionTarget::BySource(source, replacement)) => {
            tracker.reject_by_source(&source, &replacement).cmd_err()
        }
    }
}

// =============================================================================
// Batch LLM Processing Helpers
// =============================================================================

/// Build a one-off `LlmProvider` for batch suggestion processing.
///
/// SRP: this factory is the single place that decides how to construct an
/// LLM transport for batch reprocessing. Unlike `crate::llm::provider::build_llm_provider`
/// (which respects `config.llm.enabled` for the live post-processing pipeline),
/// batch reprocessing is an explicit user action and uses Groq-specific
/// endpoint/model regardless of the post-process toggle.
///
/// Returns `None` when no usable API key is available.
///
/// Key resolution: prefer the dedicated `llm.api_key`, but fall back to the
/// top-level transcription `api_key`. Both target the same Groq account
/// (batch always hits `GROQ_CHAT_URL`), so a user who configured only the
/// transcription key can still generate suggestions without re-entering it.
fn build_batch_provider(config: &crate::config::AppConfig) -> Option<Box<dyn LlmProvider>> {
    let api_key = batch_api_key(config)?;
    Some(Box::new(HttpLlmProvider::new(
        format!("{}-batch", config.llm.provider),
        crate::config::GROQ_CHAT_URL.to_string(),
        api_key,
        "llama-3.3-70b-versatile".to_string(),
    )))
}

/// The API key batch reprocessing should use: dedicated LLM key first, else
/// the top-level transcription key (same Groq account). `None` if both blank.
fn batch_api_key(config: &crate::config::AppConfig) -> Option<String> {
    let llm_key = config.llm.api_key.trim();
    if !llm_key.is_empty() {
        return Some(llm_key.to_string());
    }
    let top_key = config.api_key.trim();
    if !top_key.is_empty() {
        return Some(top_key.to_string());
    }
    None
}

/// Send `batch_input` through `provider` with `batch_prompt` and parse the
/// model output into a structured `LlmResult`.
///
/// SRP: pure function — no Tauri state, no storage, no events. Easily
/// unit-testable with mock providers.
/// DRY: delegates parsing to `crate::llm::parser::parse_result` so the batch
/// path uses the same parsing logic as the live post-processing pipeline.
async fn process_batch_via_provider(
    provider: &dyn LlmProvider,
    batch_prompt: &str,
    batch_input: &str,
) -> Result<LlmResult, String> {
    let content = provider.process(batch_prompt, batch_input).await?;
    parser::parse_result(&content, batch_input).map_err(|e| e.to_string())
}

/// Collect history entry texts into JSON array for batch LLM processing.
fn collect_history_texts(entries: &[crate::storage::HistoryEntry]) -> String {
    let texts: Vec<&str> = entries.iter().map(|e| e.text.as_str()).collect();
    serde_json::to_string(&texts).unwrap_or_default()
}

/// Process LLM suggestions through the correction tracker.
fn process_llm_suggestions(
    tracker: &CorrectionTracker,
    suggestions: &[DictionarySuggestion],
) -> usize {
    suggestions
        .iter()
        .filter(|s| tracker.on_suggestion(s).is_ok())
        .count()
}

// =============================================================================
// Types
// =============================================================================

/// Pending suggestion entry for frontend display.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PendingSuggestion {
    pub id: i64,
    pub source: String,
    pub replacement: String,
    pub count: u32,
    pub first_seen: String,
    pub last_seen: String,
}

impl From<TrackedSuggestion> for PendingSuggestion {
    fn from(s: TrackedSuggestion) -> Self {
        Self {
            id: s.id,
            source: s.source,
            replacement: s.replacement,
            count: s.count,
            first_seen: s.first_seen,
            last_seen: s.last_seen,
        }
    }
}

/// Result of reprocessing history through LLM.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ReprocessResult {
    pub processed: usize,
    pub suggestions_found: usize,
}

// =============================================================================
// Commands
// =============================================================================

/// Get all pending suggestions.
#[tauri::command]
#[specta::specta]
pub fn get_pending_suggestions(paths: State<AppPaths>) -> Result<Vec<PendingSuggestion>, String> {
    let pending = get_factory(&paths).corrections().get_pending().cmd_err()?;
    Ok(pending.into_iter().map(PendingSuggestion::from).collect())
}

/// Get count of pending suggestions.
#[tauri::command]
#[specta::specta]
pub fn get_pending_count(paths: State<AppPaths>) -> Result<usize, String> {
    get_factory(&paths).corrections().pending_count().cmd_err()
}

/// Approve a pending suggestion and add to dictionary.
#[tauri::command]
#[specta::specta]
pub fn approve_suggestion(id: i64, paths: State<AppPaths>) -> Result<(), String> {
    execute_suggestion_action(
        &get_factory(&paths),
        SuggestionAction::Approve,
        SuggestionTarget::ById(id),
    )
}

/// Approve a suggestion by source and replacement.
#[tauri::command]
#[specta::specta]
pub fn approve_suggestion_by_source(
    source: String,
    replacement: String,
    paths: State<AppPaths>,
) -> Result<(), String> {
    execute_suggestion_action(
        &get_factory(&paths),
        SuggestionAction::Approve,
        SuggestionTarget::BySource(source, replacement),
    )
}

/// Reject a pending suggestion.
#[tauri::command]
#[specta::specta]
pub fn reject_suggestion(id: i64, paths: State<AppPaths>) -> Result<(), String> {
    execute_suggestion_action(
        &get_factory(&paths),
        SuggestionAction::Reject,
        SuggestionTarget::ById(id),
    )
}

/// Reject a suggestion by source and replacement.
#[tauri::command]
#[specta::specta]
pub fn reject_suggestion_by_source(
    source: String,
    replacement: String,
    paths: State<AppPaths>,
) -> Result<(), String> {
    execute_suggestion_action(
        &get_factory(&paths),
        SuggestionAction::Reject,
        SuggestionTarget::BySource(source, replacement),
    )
}

/// Reprocess history entries through LLM to generate suggestions.
#[tauri::command]
#[specta::specta]
pub async fn reprocess_history_for_suggestions(
    limit: Option<usize>,
    paths: State<'_, AppPaths>,
    app: AppHandle,
) -> Result<ReprocessResult, String> {
    let factory = get_factory(&paths);
    let config = factory.config().load().unwrap_or_default();

    if batch_api_key(&config).is_none() {
        return Err(
            "No Groq API key configured. Add your API key in Settings.".to_string(),
        );
    }

    let entries = factory.history().load(limit).cmd_err()?;
    if entries.is_empty() {
        return Ok(ReprocessResult {
            processed: 0,
            suggestions_found: 0,
        });
    }

    // Process batch through LLM via trait abstraction (OCP/DIP).
    let batch_input = collect_history_texts(&entries);
    let provider = build_batch_provider(&config)
        .ok_or_else(|| "LLM API key not configured".to_string())?;
    let result =
        process_batch_via_provider(provider.as_ref(), BATCH_SUGGESTIONS_PROMPT, &batch_input)
            .await?;

    // Track suggestions.
    let tracker = create_tracker(&factory)?;
    let suggestions_found = process_llm_suggestions(&tracker, &result.suggestions);

    let _ = app.emit("suggestions-updated", ());

    Ok(ReprocessResult {
        processed: entries.len(),
        suggestions_found,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::SuggestionStatus;

    #[test]
    fn test_pending_suggestion_from_tracked() {
        let tracked = TrackedSuggestion {
            id: 1,
            source: "test".into(),
            replacement: "Test".into(),
            count: 5,
            status: SuggestionStatus::Pending,
            first_seen: "2024-01-01".into(),
            last_seen: "2024-01-02".into(),
        };

        let pending: PendingSuggestion = tracked.into();
        assert_eq!(pending.id, 1);
        assert_eq!(pending.source, "test");
        assert_eq!(pending.count, 5);
    }

    #[test]
    fn test_reprocess_result_serialize() {
        let result = ReprocessResult {
            processed: 10,
            suggestions_found: 3,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"processed\":10"));
        assert!(json.contains("\"suggestions_found\":3"));
    }

    #[test]
    fn test_pending_suggestion_serde_roundtrip() {
        let suggestion = PendingSuggestion {
            id: 1,
            source: "солид".into(),
            replacement: "SOLID".into(),
            count: 3,
            first_seen: "2024-01-01".into(),
            last_seen: "2024-01-05".into(),
        };
        let json = serde_json::to_string(&suggestion).unwrap();
        let deserialized: PendingSuggestion = serde_json::from_str(&json).unwrap();
        assert_eq!(suggestion.id, deserialized.id);
        assert_eq!(suggestion.source, deserialized.source);
        assert_eq!(suggestion.count, deserialized.count);
    }

    #[test]
    fn test_pending_suggestion_all_fields() {
        let suggestion = PendingSuggestion {
            id: 42,
            source: "souprawhisper".into(),
            replacement: "SoupaWhisper".into(),
            count: 10,
            first_seen: "2024-06-01".into(),
            last_seen: "2024-06-15".into(),
        };
        assert_eq!(suggestion.id, 42);
        assert_eq!(suggestion.source, "souprawhisper");
        assert_eq!(suggestion.replacement, "SoupaWhisper");
        assert_eq!(suggestion.count, 10);
        assert_eq!(suggestion.first_seen, "2024-06-01");
        assert_eq!(suggestion.last_seen, "2024-06-15");
    }

    #[test]
    fn test_reprocess_result_deserialize() {
        let json = r#"{"processed":25,"suggestions_found":7}"#;
        let result: ReprocessResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.processed, 25);
        assert_eq!(result.suggestions_found, 7);
    }

    #[test]
    fn test_reprocess_result_zero_values() {
        let result = ReprocessResult {
            processed: 0,
            suggestions_found: 0,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"processed\":0"));
        assert!(json.contains("\"suggestions_found\":0"));
    }

    #[test]
    fn test_collect_history_texts_formats_json() {
        let entries = vec![
            crate::storage::HistoryEntry {
                id: 1,
                text: "Hello world".into(),
                timestamp: "2024-01-01".into(),
                language: None,
                duration: None,
            },
            crate::storage::HistoryEntry {
                id: 2,
                text: "Test text".into(),
                timestamp: "2024-01-02".into(),
                language: Some("en".into()),
                duration: Some(2.5),
            },
        ];

        let result = collect_history_texts(&entries);
        assert!(result.contains("Hello world"));
        assert!(result.contains("Test text"));
        // Should be valid JSON array
        let parsed: Vec<String> = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed.len(), 2);
    }

    #[test]
    fn test_collect_history_texts_empty() {
        let entries: Vec<crate::storage::HistoryEntry> = vec![];
        let result = collect_history_texts(&entries);
        assert_eq!(result, "[]");
    }

    #[test]
    fn test_collect_history_texts_single_entry() {
        let entries = vec![crate::storage::HistoryEntry {
            id: 1,
            text: "Single entry".into(),
            timestamp: "2024-01-01".into(),
            language: None,
            duration: None,
        }];

        let result = collect_history_texts(&entries);
        let parsed: Vec<String> = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0], "Single entry");
    }

    // -----------------------------------------------------------------------
    // build_batch_provider tests (replaces former build_batch_llm_config tests)
    // -----------------------------------------------------------------------

    #[test]
    fn test_build_batch_provider_returns_none_with_empty_key() {
        // Both llm.api_key AND top-level api_key blank → no provider.
        let config = crate::config::AppConfig {
            api_key: String::new(),
            llm: crate::config::LlmConfig {
                api_key: String::new(),
                ..crate::config::LlmConfig::default()
            },
            ..crate::config::AppConfig::default()
        };
        assert!(build_batch_provider(&config).is_none());
    }

    #[test]
    fn test_build_batch_provider_falls_back_to_transcription_key() {
        // llm.api_key empty but the top-level transcription key is set: batch
        // reprocessing should reuse it (same Groq account).
        let config = crate::config::AppConfig {
            api_key: "gsk_transcription_key".to_string(),
            llm: crate::config::LlmConfig {
                api_key: String::new(),
                ..crate::config::LlmConfig::default()
            },
            ..crate::config::AppConfig::default()
        };
        assert_eq!(
            batch_api_key(&config).as_deref(),
            Some("gsk_transcription_key")
        );
        assert!(build_batch_provider(&config).is_some());
    }

    #[test]
    fn test_build_batch_provider_prefers_dedicated_llm_key() {
        // When both are set, the dedicated llm.api_key wins.
        let config = crate::config::AppConfig {
            api_key: "gsk_transcription_key".to_string(),
            llm: crate::config::LlmConfig {
                api_key: "gsk_dedicated_llm_key".to_string(),
                ..crate::config::LlmConfig::default()
            },
            ..crate::config::AppConfig::default()
        };
        assert_eq!(
            batch_api_key(&config).as_deref(),
            Some("gsk_dedicated_llm_key")
        );
    }

    #[test]
    fn test_build_batch_provider_returns_none_with_whitespace_key() {
        // Whitespace-only in BOTH fields → no provider.
        let config = crate::config::AppConfig {
            api_key: "   ".to_string(),
            llm: crate::config::LlmConfig {
                api_key: "   \t  ".to_string(),
                ..crate::config::LlmConfig::default()
            },
            ..crate::config::AppConfig::default()
        };
        assert!(build_batch_provider(&config).is_none());
    }

    #[test]
    fn test_build_batch_provider_returns_some_with_key_even_if_disabled() {
        // Batch reprocessing ignores `llm.enabled` — it's an explicit user action.
        let config = crate::config::AppConfig {
            llm: crate::config::LlmConfig {
                enabled: false,
                api_key: "test-api-key-123".to_string(),
                ..crate::config::LlmConfig::default()
            },
            ..crate::config::AppConfig::default()
        };
        let provider = build_batch_provider(&config);
        assert!(provider.is_some());
        let provider = provider.unwrap();
        // Name carries provider id with `-batch` suffix for log clarity.
        assert!(provider.name().ends_with("-batch"));
        assert!(provider.is_available());
    }

    // -----------------------------------------------------------------------
    // process_batch_via_provider tests (mock LlmProvider)
    // -----------------------------------------------------------------------

    use async_trait::async_trait;
    use std::sync::{Arc, Mutex as StdMutex};

    type ProviderCalls = Arc<StdMutex<Vec<(String, String)>>>;

    /// Mock provider returning a canned response and recording calls.
    struct MockProvider {
        response: String,
        calls: ProviderCalls,
    }

    impl MockProvider {
        fn new(response: &str) -> (Self, ProviderCalls) {
            let calls: ProviderCalls = Arc::new(StdMutex::new(Vec::new()));
            (
                Self {
                    response: response.to_string(),
                    calls: Arc::clone(&calls),
                },
                calls,
            )
        }
    }

    #[async_trait]
    impl LlmProvider for MockProvider {
        fn name(&self) -> &str {
            "MockBatch"
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

    /// Provider that always errors.
    struct FailingProvider;

    #[async_trait]
    impl LlmProvider for FailingProvider {
        fn name(&self) -> &str {
            "FailingBatch"
        }
        fn is_available(&self) -> bool {
            true
        }
        async fn process(&self, _: &str, _: &str) -> Result<String, String> {
            Err("simulated network error".into())
        }
    }

    #[tokio::test]
    async fn test_process_batch_via_provider_parses_suggestions() {
        let (provider, calls) = MockProvider::new(
            r#"{"suggestions":[{"source":"solid","replacement":"SOLID"},{"source":"dry","replacement":"DRY"}]}"#,
        );

        let result = process_batch_via_provider(&provider, "batch prompt", "[\"text\"]")
            .await
            .expect("parser must succeed for well-formed JSON");

        assert_eq!(result.suggestions.len(), 2);
        assert_eq!(result.suggestions[0].source, "solid");
        assert_eq!(result.suggestions[0].replacement, "SOLID");
        assert_eq!(result.suggestions[1].source, "dry");

        // Provider received the batch prompt + input.
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "batch prompt");
        assert_eq!(calls[0].1, "[\"text\"]");
    }

    #[tokio::test]
    async fn test_process_batch_via_provider_propagates_provider_error() {
        let provider = FailingProvider;
        let err = process_batch_via_provider(&provider, "prompt", "[]")
            .await
            .expect_err("failing provider must return Err");
        assert!(err.contains("simulated network error"));
    }

    #[tokio::test]
    async fn test_process_batch_via_provider_handles_malformed_json() {
        // parser::parse_result is total — it returns a fallback for non-JSON,
        // so this is Ok with empty suggestions, not Err.
        let (provider, _) = MockProvider::new("not valid json at all");
        let result = process_batch_via_provider(&provider, "prompt", "original")
            .await
            .expect("parser is total and returns a fallback");
        assert!(result.suggestions.is_empty());
    }

    #[tokio::test]
    async fn test_process_batch_via_provider_empty_suggestions_ok() {
        let (provider, _) =
            MockProvider::new(r#"{"text":"","suggestions":[]}"#);
        let result = process_batch_via_provider(&provider, "prompt", "[\"a\"]")
            .await
            .unwrap();
        assert!(result.suggestions.is_empty());
    }

    #[test]
    fn test_pending_suggestion_from_tracked_preserves_timestamps() {
        let tracked = TrackedSuggestion {
            id: 5,
            source: "timestamp_test".into(),
            replacement: "TIMESTAMP_TEST".into(),
            count: 1,
            status: SuggestionStatus::Pending,
            first_seen: "2024-03-15T10:30:00".into(),
            last_seen: "2024-03-20T14:45:00".into(),
        };

        let pending: PendingSuggestion = tracked.into();
        assert_eq!(pending.first_seen, "2024-03-15T10:30:00");
        assert_eq!(pending.last_seen, "2024-03-20T14:45:00");
    }

    #[test]
    fn test_suggestion_action_enum_coverage() {
        // Test both variants exist and can be created
        let _approve = SuggestionAction::Approve;
        let _reject = SuggestionAction::Reject;
    }

    #[test]
    fn test_suggestion_target_enum_coverage() {
        // Test both variants exist and can be created
        let _by_id = SuggestionTarget::ById(123);
        let _by_source = SuggestionTarget::BySource("src".into(), "repl".into());
    }

    #[test]
    fn test_create_tracker_success() {
        use crate::storage::test_utils::create_temp_paths;

        let (_temp, paths) = create_temp_paths();
        let factory = StorageFactory::new(paths);

        // Should successfully create tracker with default config
        let tracker = create_tracker(&factory);
        assert!(tracker.is_ok());

        let tracker = tracker.unwrap();
        // Default learning mode should be parsed
        assert_eq!(tracker.threshold(), 3); // default threshold
    }

    #[test]
    fn test_create_tracker_disabled_mode() {
        use crate::config::AppConfig;
        use crate::storage::test_utils::create_temp_paths;

        let (_temp, paths) = create_temp_paths();
        let factory = StorageFactory::new(paths);

        // Set learning mode to disabled
        let mut config = AppConfig::default();
        config.dictionary.learning_mode = "disabled".to_string();
        factory.config().save(&config).unwrap();

        let tracker = create_tracker(&factory).unwrap();
        assert_eq!(tracker.mode(), LearningMode::Disabled);
    }

    #[test]
    fn test_execute_approve_by_id() {
        use crate::llm::DictionarySuggestion;
        use crate::storage::test_utils::create_temp_paths;

        let (_temp, paths) = create_temp_paths();
        let factory = StorageFactory::new(paths);

        // Create a suggestion first
        let tracker = create_tracker(&factory).unwrap();
        tracker
            .on_suggestion(&DictionarySuggestion {
                source: "test".into(),
                replacement: "TEST".into(),
            })
            .unwrap();

        // Get the pending ID
        let pending = factory.corrections().get_pending().unwrap();
        assert_eq!(pending.len(), 1);
        let id = pending[0].id;

        // Execute approve by ID
        let result = execute_suggestion_action(
            &factory,
            SuggestionAction::Approve,
            SuggestionTarget::ById(id),
        );
        assert!(result.is_ok());

        // Should be removed from pending
        let pending = factory.corrections().get_pending().unwrap();
        assert!(pending.is_empty());
    }

    #[test]
    fn test_execute_reject_by_id() {
        use crate::llm::DictionarySuggestion;
        use crate::storage::test_utils::create_temp_paths;

        let (_temp, paths) = create_temp_paths();
        let factory = StorageFactory::new(paths);

        // Create a suggestion first
        let tracker = create_tracker(&factory).unwrap();
        tracker
            .on_suggestion(&DictionarySuggestion {
                source: "reject_test".into(),
                replacement: "REJECT_TEST".into(),
            })
            .unwrap();

        let pending = factory.corrections().get_pending().unwrap();
        let id = pending[0].id;

        // Execute reject by ID
        let result = execute_suggestion_action(
            &factory,
            SuggestionAction::Reject,
            SuggestionTarget::ById(id),
        );
        assert!(result.is_ok());

        // Should be removed from pending
        let pending = factory.corrections().get_pending().unwrap();
        assert!(pending.is_empty());
    }

    #[test]
    fn test_execute_approve_by_source() {
        use crate::llm::DictionarySuggestion;
        use crate::storage::test_utils::create_temp_paths;

        let (_temp, paths) = create_temp_paths();
        let factory = StorageFactory::new(paths);

        // Create a suggestion
        let tracker = create_tracker(&factory).unwrap();
        tracker
            .on_suggestion(&DictionarySuggestion {
                source: "source_approve".into(),
                replacement: "SOURCE_APPROVE".into(),
            })
            .unwrap();

        // Execute approve by source
        let result = execute_suggestion_action(
            &factory,
            SuggestionAction::Approve,
            SuggestionTarget::BySource("source_approve".into(), "SOURCE_APPROVE".into()),
        );
        assert!(result.is_ok());

        // Should be added to dictionary
        let has_entry = factory.dictionary().contains("source_approve").unwrap();
        assert!(has_entry);
    }

    #[test]
    fn test_execute_reject_by_source() {
        use crate::llm::DictionarySuggestion;
        use crate::storage::test_utils::create_temp_paths;

        let (_temp, paths) = create_temp_paths();
        let factory = StorageFactory::new(paths);

        // Create a suggestion
        let tracker = create_tracker(&factory).unwrap();
        tracker
            .on_suggestion(&DictionarySuggestion {
                source: "source_reject".into(),
                replacement: "SOURCE_REJECT".into(),
            })
            .unwrap();

        assert_eq!(factory.corrections().pending_count().unwrap(), 1);

        // Execute reject by source
        let result = execute_suggestion_action(
            &factory,
            SuggestionAction::Reject,
            SuggestionTarget::BySource("source_reject".into(), "SOURCE_REJECT".into()),
        );
        assert!(result.is_ok());

        // Should be removed from pending
        assert_eq!(factory.corrections().pending_count().unwrap(), 0);
    }

    #[test]
    fn test_process_llm_suggestions_counts_all_successful() {
        use crate::llm::DictionarySuggestion;
        use crate::storage::test_utils::create_temp_paths;

        let (_temp, paths) = create_temp_paths();
        let factory = StorageFactory::new(paths);

        // Add an entry to dictionary first
        factory.dictionary().add("existing", "EXISTING").unwrap();

        let tracker = create_tracker(&factory).unwrap();

        let suggestions = vec![
            DictionarySuggestion {
                source: "existing".into(),
                replacement: "EXISTING".into(),
            },
            DictionarySuggestion {
                source: "new_word".into(),
                replacement: "NEW_WORD".into(),
            },
        ];

        // Process suggestions
        let count = process_llm_suggestions(&tracker, &suggestions);

        // Both return Ok (AlreadyInDictionary and Recorded), so count is 2
        assert_eq!(count, 2);

        // But only the new word should be pending
        let pending = factory.corrections().pending_count().unwrap();
        assert_eq!(pending, 1);
    }

    #[test]
    fn test_process_llm_suggestions_empty_input() {
        use crate::storage::test_utils::create_temp_paths;

        let (_temp, paths) = create_temp_paths();
        let factory = StorageFactory::new(paths);

        let tracker = create_tracker(&factory).unwrap();

        let suggestions: Vec<DictionarySuggestion> = vec![];

        // Process empty list
        let count = process_llm_suggestions(&tracker, &suggestions);

        // Should return 0
        assert_eq!(count, 0);
    }
}
