//! Storage interface traits for DIP compliance.
//!
//! These traits define the storage interfaces used by StorageFactory,
//! following the Dependency Inversion Principle (DIP).

use crate::config::AppConfig;
use std::error::Error;

/// Result type for storage operations.
pub type StorageResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

/// Convert a boxed error to a Send + Sync error.
pub fn into_storage_error(e: Box<dyn Error>) -> Box<dyn Error + Send + Sync> {
    Box::new(std::io::Error::other(e.to_string()))
}

// =============================================================================
// Config Storage
// =============================================================================

/// Config storage interface.
pub trait ConfigStorage: Send + Sync {
    /// Load the application configuration.
    fn load(&self) -> StorageResult<AppConfig>;

    /// Save the application configuration.
    fn save(&self, config: &AppConfig) -> StorageResult<()>;

    /// Check if the config storage is empty.
    fn is_empty(&self) -> StorageResult<bool>;
}

// =============================================================================
// History Storage
// =============================================================================

/// History storage interface.
pub trait HistoryStorage: Send + Sync {
    /// Load history entries, newest first.
    fn load(&self, limit: Option<usize>) -> StorageResult<Vec<super::HistoryEntry>>;

    /// Add a new history entry. Returns the new entry ID.
    fn add(&self, text: &str, language: Option<&str>, duration: Option<f32>) -> StorageResult<i64>;

    /// Clear all history.
    fn clear(&self) -> StorageResult<()>;

    /// Delete a history entry by ID.
    fn delete(&self, id: i64) -> StorageResult<()>;

    /// Search history by text.
    fn search(&self, query: &str, limit: Option<usize>) -> StorageResult<Vec<super::HistoryEntry>>;
}

// =============================================================================
// Dictionary Storage
// =============================================================================

/// Dictionary storage interface.
pub trait DictionaryStorage: Send + Sync {
    /// Load all dictionary entries as (source, replacement) pairs.
    fn load(&self) -> StorageResult<Vec<(String, String)>>;

    /// Add a new dictionary entry.
    fn add(&self, source: &str, replacement: &str) -> StorageResult<()>;

    /// Delete a dictionary entry by index.
    fn delete(&self, index: usize) -> StorageResult<()>;

    /// Update a dictionary entry by index.
    fn update(&self, index: usize, source: &str, replacement: &str) -> StorageResult<()>;

    /// Apply dictionary replacements to text.
    fn apply(&self, text: &str) -> StorageResult<String>;

    /// Check if a source word already exists in dictionary (case-insensitive).
    fn contains(&self, source: &str) -> StorageResult<bool>;
}

// =============================================================================
// Corrections Storage
// =============================================================================

/// Corrections storage interface.
pub trait CorrectionsStorage: Send + Sync {
    /// Record a suggestion (insert or increment count). Returns the new count.
    fn record(&self, source: &str, replacement: &str) -> StorageResult<u32>;

    /// Get all pending suggestions.
    fn get_pending(&self) -> StorageResult<Vec<super::TrackedSuggestion>>;

    /// Get total count of pending suggestions.
    fn get_pending_count(&self) -> StorageResult<usize>;

    /// Mark a suggestion as approved by ID.
    fn approve(&self, id: i64) -> StorageResult<()>;

    /// Mark a suggestion as approved by source/replacement.
    fn approve_by_source(&self, source: &str, replacement: &str) -> StorageResult<usize>;

    /// Mark a suggestion as rejected by ID.
    fn reject(&self, id: i64) -> StorageResult<()>;

    /// Mark a suggestion as rejected by source/replacement.
    fn reject_by_source(&self, source: &str, replacement: &str) -> StorageResult<usize>;
}

// =============================================================================
// Providers Storage
// =============================================================================

/// Providers storage interface.
pub trait ProvidersStorage: Send + Sync {
    /// Get all LLM providers.
    fn get_all(&self) -> StorageResult<Vec<super::LlmProvider>>;

    /// Add a new provider.
    fn add(&self, provider: &super::LlmProvider) -> StorageResult<()>;

    /// Remove a provider by ID.
    fn remove(&self, id: &str) -> StorageResult<()>;

    /// Update an existing provider.
    fn update(&self, provider: &super::LlmProvider) -> StorageResult<()>;
}
