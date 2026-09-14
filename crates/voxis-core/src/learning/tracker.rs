//! Correction tracker for dictionary learning.
//!
//! Coordinates the learning process based on mode:
//! - disabled: Ignore all suggestions
//! - pending: Store suggestions for manual approval
//! - auto: Automatically add to dictionary when threshold reached

use crate::llm::DictionarySuggestion;
use crate::storage::{
    CorrectionsStorageTrait, DictionaryStorageTrait, StorageResult, TrackedSuggestion,
};

use super::mode::LearningMode;
use super::normalizer::SuggestionNormalizer;
use super::result::SuggestionResult;

/// Error type alias for tracker operations.
type TrackerResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// Correction tracker for dictionary learning.
///
/// DIP: Uses trait objects for storage dependencies, enabling:
/// - Easy mocking in tests
/// - Swappable storage implementations
/// - Loose coupling between tracker and storage
pub struct CorrectionTracker {
    mode: LearningMode,
    threshold: u32,
    corrections_storage: Box<dyn CorrectionsStorageTrait>,
    dictionary_storage: Box<dyn DictionaryStorageTrait>,
}

impl CorrectionTracker {
    /// Create a new correction tracker.
    ///
    /// DIP: Accepts trait objects for storage dependencies.
    pub fn new(
        mode: LearningMode,
        threshold: u32,
        corrections_storage: Box<dyn CorrectionsStorageTrait>,
        dictionary_storage: Box<dyn DictionaryStorageTrait>,
    ) -> Self {
        Self {
            mode,
            threshold,
            corrections_storage,
            dictionary_storage,
        }
    }

    /// Get the current learning mode.
    pub fn mode(&self) -> LearningMode {
        self.mode
    }

    /// Get the threshold for auto-promotion.
    pub fn threshold(&self) -> u32 {
        self.threshold
    }

    /// Process a suggestion from LLM.
    ///
    /// Returns the result of processing.
    /// KISS: Uses early returns and extracted helpers for clarity.
    pub fn on_suggestion(
        &self,
        suggestion: &DictionarySuggestion,
    ) -> TrackerResult<SuggestionResult> {
        // Validate and normalize (early exit if invalid)
        let normalized = match self.validate_and_normalize(suggestion)? {
            Some(n) => n,
            None => return Ok(SuggestionResult::Ignored),
        };

        // Check if already processed
        if let Some(result) = self.check_existing(&normalized)? {
            return Ok(result);
        }

        // Record and possibly auto-promote
        self.record_suggestion(&normalized)
    }

    /// Validate suggestion and normalize if valid.
    /// Returns None if disabled or invalid.
    fn validate_and_normalize(
        &self,
        suggestion: &DictionarySuggestion,
    ) -> TrackerResult<Option<DictionarySuggestion>> {
        if self.mode == LearningMode::Disabled {
            return Ok(None);
        }
        if !SuggestionNormalizer::is_valid(suggestion) {
            return Ok(None);
        }
        Ok(Some(SuggestionNormalizer::normalize(suggestion)))
    }

    /// Check if suggestion already exists in dictionary or was processed.
    fn check_existing(
        &self,
        normalized: &DictionarySuggestion,
    ) -> TrackerResult<Option<SuggestionResult>> {
        if self.dictionary_storage.contains(&normalized.source)? {
            return Ok(Some(SuggestionResult::AlreadyInDictionary));
        }
        Ok(None)
    }

    /// Record suggestion and handle auto-promotion if threshold reached.
    fn record_suggestion(
        &self,
        normalized: &DictionarySuggestion,
    ) -> TrackerResult<SuggestionResult> {
        let count = self
            .corrections_storage
            .record(&normalized.source, &normalized.replacement)?;

        // Count 0 means already processed (approved/rejected)
        if count == 0 {
            return Ok(SuggestionResult::PreviouslyRejected);
        }

        // Check for auto-promotion
        if self.should_auto_promote(count) {
            return self.promote_to_dictionary(normalized, count);
        }

        Ok(SuggestionResult::Recorded { count })
    }

    /// Check if suggestion should be auto-promoted.
    fn should_auto_promote(&self, count: u32) -> bool {
        self.mode == LearningMode::Auto && count >= self.threshold
    }

    /// Promote suggestion to dictionary.
    fn promote_to_dictionary(
        &self,
        normalized: &DictionarySuggestion,
        count: u32,
    ) -> TrackerResult<SuggestionResult> {
        self.dictionary_storage
            .add(&normalized.source, &normalized.replacement)?;
        self.corrections_storage
            .approve_by_source(&normalized.source, &normalized.replacement)?;

        tracing::info!(
            "Auto-promoted: \"{}\" -> \"{}\" (count: {})",
            normalized.source,
            normalized.replacement,
            count
        );

        Ok(SuggestionResult::Promoted {
            source: normalized.source.clone(),
            replacement: normalized.replacement.clone(),
        })
    }

    /// Process multiple suggestions.
    pub fn on_suggestions(&self, suggestions: &[DictionarySuggestion]) -> Vec<SuggestionResult> {
        suggestions
            .iter()
            .map(|s| self.on_suggestion(s).unwrap_or(SuggestionResult::Ignored))
            .collect()
    }

    /// Get all pending suggestions.
    pub fn get_pending(&self) -> StorageResult<Vec<TrackedSuggestion>> {
        self.corrections_storage.get_pending()
    }

    /// Get count of pending suggestions.
    pub fn pending_count(&self) -> StorageResult<usize> {
        self.corrections_storage.get_pending_count()
    }

    /// Approve a pending suggestion and add to dictionary.
    pub fn approve(&self, id: i64) -> TrackerResult<()> {
        // Get the suggestion first
        let pending = self.corrections_storage.get_pending()?;
        let suggestion = pending.iter().find(|s| s.id == id);

        if let Some(s) = suggestion {
            // Add to dictionary
            self.dictionary_storage.add(&s.source, &s.replacement)?;

            // Mark as approved
            self.corrections_storage.approve(id)?;

            tracing::info!("User approved: \"{}\" -> \"{}\"", s.source, s.replacement);
        }

        Ok(())
    }

    /// Approve a suggestion by source/replacement.
    pub fn approve_by_source(&self, source: &str, replacement: &str) -> TrackerResult<()> {
        // Add to dictionary
        self.dictionary_storage.add(source, replacement)?;

        // Mark as approved
        self.corrections_storage
            .approve_by_source(source, replacement)?;

        tracing::info!("User approved: \"{}\" -> \"{}\"", source, replacement);

        Ok(())
    }

    /// Reject a pending suggestion.
    pub fn reject(&self, id: i64) -> TrackerResult<()> {
        self.corrections_storage.reject(id)?;
        Ok(())
    }

    /// Reject a suggestion by source/replacement.
    pub fn reject_by_source(&self, source: &str, replacement: &str) -> TrackerResult<()> {
        self.corrections_storage
            .reject_by_source(source, replacement)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{CorrectionsSqliteStorage, DictionaryStorage};
    use tempfile::NamedTempFile;

    fn create_tracker(mode: LearningMode, threshold: u32) -> CorrectionTracker {
        let corrections_file = NamedTempFile::new().unwrap();
        let dictionary_file = NamedTempFile::new().unwrap();

        CorrectionTracker::new(
            mode,
            threshold,
            Box::new(CorrectionsSqliteStorage::new(
                corrections_file.path().to_path_buf(),
            )),
            Box::new(DictionaryStorage::new(dictionary_file.path().to_path_buf())),
        )
    }

    #[test]
    fn test_mode_disabled_ignores() {
        let tracker = create_tracker(LearningMode::Disabled, 3);
        let suggestion = DictionarySuggestion {
            source: "solid".to_string(),
            replacement: "SOLID".to_string(),
        };

        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::Ignored));

        // Nothing should be pending
        assert_eq!(tracker.pending_count().unwrap(), 0);
    }

    #[test]
    fn test_mode_pending_records() {
        let tracker = create_tracker(LearningMode::Pending, 3);
        let suggestion = DictionarySuggestion {
            source: "solid".to_string(),
            replacement: "SOLID".to_string(),
        };

        // Record 3 times - should NOT auto-promote in pending mode
        for _ in 0..3 {
            let result = tracker.on_suggestion(&suggestion).unwrap();
            assert!(matches!(result, SuggestionResult::Recorded { .. }));
        }

        // Should have 1 pending with count 3
        let pending = tracker.get_pending().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].count, 3);
    }

    #[test]
    fn test_mode_auto_promotes_at_threshold() {
        let tracker = create_tracker(LearningMode::Auto, 3);
        let suggestion = DictionarySuggestion {
            source: "solid".to_string(),
            replacement: "SOLID".to_string(),
        };

        // First two - recorded
        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::Recorded { count: 1 }));

        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::Recorded { count: 2 }));

        // Third - should promote
        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::Promoted { .. }));

        // No pending (was promoted)
        assert_eq!(tracker.pending_count().unwrap(), 0);
    }

    #[test]
    fn test_already_in_dictionary() {
        let corrections_file = NamedTempFile::new().unwrap();
        let dictionary_file = NamedTempFile::new().unwrap();

        let dictionary = DictionaryStorage::new(dictionary_file.path().to_path_buf());
        dictionary.add("solid", "SOLID").unwrap();

        let tracker = CorrectionTracker::new(
            LearningMode::Auto,
            3,
            Box::new(CorrectionsSqliteStorage::new(
                corrections_file.path().to_path_buf(),
            )),
            Box::new(dictionary),
        );

        let suggestion = DictionarySuggestion {
            source: "solid".to_string(),
            replacement: "SOLID".to_string(),
        };

        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::AlreadyInDictionary));
    }

    #[test]
    fn test_approve_manual() {
        let tracker = create_tracker(LearningMode::Pending, 99);
        let suggestion = DictionarySuggestion {
            source: "solid".to_string(),
            replacement: "SOLID".to_string(),
        };

        tracker.on_suggestion(&suggestion).unwrap();

        let pending = tracker.get_pending().unwrap();
        assert_eq!(pending.len(), 1);

        tracker.approve(pending[0].id).unwrap();

        // Should be empty now
        assert_eq!(tracker.pending_count().unwrap(), 0);
    }

    #[test]
    fn test_reject() {
        let tracker = create_tracker(LearningMode::Pending, 99);
        let suggestion = DictionarySuggestion {
            source: "solid".to_string(),
            replacement: "SOLID".to_string(),
        };

        tracker.on_suggestion(&suggestion).unwrap();
        let pending = tracker.get_pending().unwrap();

        tracker.reject(pending[0].id).unwrap();

        // Should be empty
        assert_eq!(tracker.pending_count().unwrap(), 0);

        // Recording again should return PreviouslyRejected
        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::PreviouslyRejected));
    }

    #[test]
    fn test_normalizes_suggestions() {
        let tracker = create_tracker(LearningMode::Auto, 1);

        // Use Russian phonetic spelling
        let suggestion = DictionarySuggestion {
            source: "солид".to_string(),
            replacement: "what".to_string(), // Wrong replacement
        };

        let result = tracker.on_suggestion(&suggestion).unwrap();

        // Should normalize to SOLID and promote immediately (threshold 1)
        assert!(matches!(result, SuggestionResult::Promoted { .. }));

        if let SuggestionResult::Promoted { replacement, .. } = result {
            assert_eq!(replacement, "SOLID"); // Normalized from TERM_MAPPINGS
        }
    }

    #[test]
    fn test_empty_suggestion_ignored() {
        let tracker = create_tracker(LearningMode::Auto, 1);

        // Empty source
        let suggestion = DictionarySuggestion {
            source: "".to_string(),
            replacement: "Test".to_string(),
        };
        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::Ignored));

        // Empty replacement
        let suggestion = DictionarySuggestion {
            source: "test".to_string(),
            replacement: "".to_string(),
        };
        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::Ignored));
    }

    #[test]
    fn test_whitespace_only_suggestion_ignored() {
        let tracker = create_tracker(LearningMode::Auto, 1);

        let suggestion = DictionarySuggestion {
            source: "   ".to_string(),
            replacement: "Test".to_string(),
        };
        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::Ignored));
    }

    #[test]
    fn test_mode_and_threshold_accessors() {
        let tracker = create_tracker(LearningMode::Pending, 5);
        assert_eq!(tracker.mode(), LearningMode::Pending);
        assert_eq!(tracker.threshold(), 5);
    }

    #[test]
    fn test_approve_by_source() {
        let tracker = create_tracker(LearningMode::Pending, 99);
        let suggestion = DictionarySuggestion {
            source: "test".to_string(),
            replacement: "TEST".to_string(),
        };

        tracker.on_suggestion(&suggestion).unwrap();
        assert_eq!(tracker.pending_count().unwrap(), 1);

        tracker.approve_by_source("test", "TEST").unwrap();
        assert_eq!(tracker.pending_count().unwrap(), 0);
    }

    #[test]
    fn test_reject_by_source() {
        let tracker = create_tracker(LearningMode::Pending, 99);
        let suggestion = DictionarySuggestion {
            source: "test".to_string(),
            replacement: "TEST".to_string(),
        };

        tracker.on_suggestion(&suggestion).unwrap();
        assert_eq!(tracker.pending_count().unwrap(), 1);

        tracker.reject_by_source("test", "TEST").unwrap();
        assert_eq!(tracker.pending_count().unwrap(), 0);
    }

    #[test]
    fn test_on_suggestions_batch() {
        let tracker = create_tracker(LearningMode::Auto, 2);
        let suggestions = vec![
            DictionarySuggestion {
                source: "test1".to_string(),
                replacement: "TEST1".to_string(),
            },
            DictionarySuggestion {
                source: "test2".to_string(),
                replacement: "TEST2".to_string(),
            },
        ];

        let results = tracker.on_suggestions(&suggestions);
        assert_eq!(results.len(), 2);
        assert!(matches!(
            results[0],
            SuggestionResult::Recorded { count: 1 }
        ));
        assert!(matches!(
            results[1],
            SuggestionResult::Recorded { count: 1 }
        ));
    }

    #[test]
    fn test_promoted_suggestion_then_ignored() {
        let tracker = create_tracker(LearningMode::Auto, 1);
        let suggestion = DictionarySuggestion {
            source: "unique".to_string(),
            replacement: "UNIQUE".to_string(),
        };

        // First time - should promote (threshold 1)
        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::Promoted { .. }));

        // Second time - already in dictionary
        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::AlreadyInDictionary));
    }

    #[test]
    fn test_approve_nonexistent_id() {
        let tracker = create_tracker(LearningMode::Pending, 99);

        // Should not panic, just return Ok
        let result = tracker.approve(999);
        assert!(result.is_ok());
    }

    #[test]
    fn test_multiple_suggestions_same_source_different_replacement() {
        let tracker = create_tracker(LearningMode::Auto, 3);

        // Same source, different replacements should be tracked separately
        let suggestion1 = DictionarySuggestion {
            source: "test".to_string(),
            replacement: "TEST".to_string(),
        };
        let suggestion2 = DictionarySuggestion {
            source: "test".to_string(),
            replacement: "Test".to_string(),
        };

        tracker.on_suggestion(&suggestion1).unwrap();
        tracker.on_suggestion(&suggestion2).unwrap();

        let pending = tracker.get_pending().unwrap();
        assert_eq!(pending.len(), 2);
    }

    #[test]
    fn test_threshold_boundary() {
        let tracker = create_tracker(LearningMode::Auto, 2);
        let suggestion = DictionarySuggestion {
            source: "boundary".to_string(),
            replacement: "BOUNDARY".to_string(),
        };

        // Count 1: below threshold
        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::Recorded { count: 1 }));

        // Count 2: at threshold, should promote
        let result = tracker.on_suggestion(&suggestion).unwrap();
        assert!(matches!(result, SuggestionResult::Promoted { .. }));
    }
}
