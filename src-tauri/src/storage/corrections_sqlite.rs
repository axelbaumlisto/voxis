//! SQLite storage for correction suggestions tracking.
//!
//! Tracks LLM suggestions for dictionary learning:
//! - Counts how many times each suggestion is seen
//! - Tracks whether suggestion is approved/rejected/pending
//! - Used by CorrectionTracker for auto-learning

use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::sqlite_base::FromSqliteRow;

/// Status of a correction suggestion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SuggestionStatus {
    /// Waiting for user approval or auto-promotion
    #[default]
    Pending,
    /// User approved, added to dictionary
    Approved,
    /// User rejected, will not be added
    Rejected,
}

impl std::fmt::Display for SuggestionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Approved => write!(f, "approved"),
            Self::Rejected => write!(f, "rejected"),
        }
    }
}

impl std::str::FromStr for SuggestionStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "pending" => Ok(Self::Pending),
            "approved" => Ok(Self::Approved),
            "rejected" => Ok(Self::Rejected),
            _ => Err(format!("Unknown status: {}", s)),
        }
    }
}

/// A tracked correction suggestion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackedSuggestion {
    pub id: i64,
    /// Original word/phrase
    pub source: String,
    /// Suggested replacement
    pub replacement: String,
    /// Number of times this suggestion was seen
    pub count: u32,
    /// Current status
    pub status: SuggestionStatus,
    /// First seen timestamp
    pub first_seen: String,
    /// Last seen timestamp
    pub last_seen: String,
}

/// DRY: Implements FromSqliteRow trait for TrackedSuggestion.
impl FromSqliteRow for TrackedSuggestion {
    fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Self> {
        let status_str: String = row.get(4)?;
        Ok(Self {
            id: row.get(0)?,
            source: row.get(1)?,
            replacement: row.get(2)?,
            count: row.get(3)?,
            status: status_str.parse().unwrap_or(SuggestionStatus::Pending),
            first_seen: row.get(5)?,
            last_seen: row.get(6)?,
        })
    }
}

/// SQLite storage for correction suggestions.
pub struct CorrectionsSqliteStorage {
    path: PathBuf,
}

impl CorrectionsSqliteStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Open connection and ensure schema exists.
    /// DRY: Uses sqlite_base helpers for common operations.
    fn connect(&self) -> Result<Connection, Box<dyn std::error::Error>> {
        use super::sqlite_base::{create_index_if_not_exists, open_with_schema};

        open_with_schema(&self.path, |conn| {
            conn.execute(
                "CREATE TABLE IF NOT EXISTS corrections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL,
                    replacement TEXT NOT NULL,
                    count INTEGER DEFAULT 1,
                    status TEXT DEFAULT 'pending',
                    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(source, replacement)
                )",
                [],
            )?;

            // Create index for fast pending lookup
            create_index_if_not_exists(conn, "idx_status", "corrections", "status")?;

            Ok(())
        })
    }

    /// Record a suggestion (insert or increment count).
    ///
    /// Returns the new count for this suggestion.
    pub fn record(
        &self,
        source: &str,
        replacement: &str,
    ) -> Result<u32, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        // Try to update existing
        let updated = conn.execute(
            "UPDATE corrections
             SET count = count + 1, last_seen = ?
             WHERE source = ? AND replacement = ? AND status = 'pending'",
            params![now, source, replacement],
        )?;

        if updated > 0 {
            // Get the new count
            let count: u32 = conn.query_row(
                "SELECT count FROM corrections WHERE source = ? AND replacement = ?",
                params![source, replacement],
                |row| row.get(0),
            )?;
            return Ok(count);
        }

        // Check if exists but not pending (approved/rejected)
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM corrections WHERE source = ? AND replacement = ?",
                params![source, replacement],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if exists {
            // Already processed, don't re-add
            return Ok(0);
        }

        // Insert new
        conn.execute(
            "INSERT INTO corrections (source, replacement, first_seen, last_seen)
             VALUES (?, ?, ?, ?)",
            params![source, replacement, now, now],
        )?;

        Ok(1)
    }

    /// Get all pending suggestions.
    pub fn get_pending(&self) -> Result<Vec<TrackedSuggestion>, Box<dyn std::error::Error>> {
        let conn = self.connect()?;

        let mut stmt = conn.prepare(
            "SELECT id, source, replacement, count, status, first_seen, last_seen
             FROM corrections
             WHERE status = 'pending'
             ORDER BY count DESC, last_seen DESC",
        )?;

        let suggestions = stmt.query_map([], TrackedSuggestion::from_row)?;
        suggestions
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// Get pending suggestions that have reached the threshold.
    pub fn get_ready_for_promotion(
        &self,
        threshold: u32,
    ) -> Result<Vec<TrackedSuggestion>, Box<dyn std::error::Error>> {
        let conn = self.connect()?;

        let mut stmt = conn.prepare(
            "SELECT id, source, replacement, count, status, first_seen, last_seen
             FROM corrections
             WHERE status = 'pending' AND count >= ?
             ORDER BY count DESC",
        )?;

        let suggestions = stmt.query_map([threshold], TrackedSuggestion::from_row)?;
        suggestions
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// Mark a suggestion as approved.
    pub fn approve(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE corrections SET status = 'approved' WHERE id = ?",
            [id],
        )?;
        Ok(())
    }

    /// Mark a suggestion as approved by source/replacement.
    pub fn approve_by_source(
        &self,
        source: &str,
        replacement: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE corrections SET status = 'approved' WHERE source = ? AND replacement = ?",
            params![source, replacement],
        )?;
        Ok(())
    }

    /// Mark a suggestion as rejected.
    pub fn reject(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE corrections SET status = 'rejected' WHERE id = ?",
            [id],
        )?;
        Ok(())
    }

    /// Mark a suggestion as rejected by source/replacement.
    pub fn reject_by_source(
        &self,
        source: &str,
        replacement: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE corrections SET status = 'rejected' WHERE source = ? AND replacement = ?",
            params![source, replacement],
        )?;
        Ok(())
    }

    /// Get a suggestion by source (for checking if already exists).
    pub fn get_by_source(
        &self,
        source: &str,
    ) -> Result<Option<TrackedSuggestion>, Box<dyn std::error::Error>> {
        let conn = self.connect()?;

        let result = conn.query_row(
            "SELECT id, source, replacement, count, status, first_seen, last_seen
             FROM corrections
             WHERE source = ?
             LIMIT 1",
            [source],
            TrackedSuggestion::from_row,
        );

        match result {
            Ok(suggestion) => Ok(Some(suggestion)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Clear all suggestions.
    pub fn clear(&self) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM corrections", [])?;
        Ok(())
    }

    /// Get total count of pending suggestions.
    pub fn pending_count(&self) -> Result<usize, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM corrections WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }
}

// =============================================================================
// Trait implementation for DIP compliance
// =============================================================================

impl super::traits::CorrectionsStorage for CorrectionsSqliteStorage {
    fn record(&self, source: &str, replacement: &str) -> super::traits::StorageResult<u32> {
        self.record(source, replacement)
            .map_err(super::traits::into_storage_error)
    }

    fn get_pending(&self) -> super::traits::StorageResult<Vec<TrackedSuggestion>> {
        self.get_pending()
            .map_err(super::traits::into_storage_error)
    }

    fn get_pending_count(&self) -> super::traits::StorageResult<usize> {
        self.pending_count()
            .map_err(super::traits::into_storage_error)
    }

    fn approve(&self, id: i64) -> super::traits::StorageResult<()> {
        self.approve(id).map_err(super::traits::into_storage_error)
    }

    fn approve_by_source(
        &self,
        source: &str,
        replacement: &str,
    ) -> super::traits::StorageResult<usize> {
        self.approve_by_source(source, replacement)
            .map_err(super::traits::into_storage_error)?;
        Ok(1)
    }

    fn reject(&self, id: i64) -> super::traits::StorageResult<()> {
        self.reject(id).map_err(super::traits::into_storage_error)
    }

    fn reject_by_source(
        &self,
        source: &str,
        replacement: &str,
    ) -> super::traits::StorageResult<usize> {
        self.reject_by_source(source, replacement)
            .map_err(super::traits::into_storage_error)?;
        Ok(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    fn create_storage() -> CorrectionsSqliteStorage {
        let file = NamedTempFile::new().unwrap();
        CorrectionsSqliteStorage::new(file.path().to_path_buf())
    }

    #[test]
    fn test_record_new_suggestion() {
        let storage = create_storage();

        let count = storage.record("solid", "SOLID").unwrap();
        assert_eq!(count, 1);

        let pending = storage.get_pending().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].source, "solid");
        assert_eq!(pending[0].replacement, "SOLID");
        assert_eq!(pending[0].count, 1);
    }

    #[test]
    fn test_record_increments_count() {
        let storage = create_storage();

        assert_eq!(storage.record("solid", "SOLID").unwrap(), 1);
        assert_eq!(storage.record("solid", "SOLID").unwrap(), 2);
        assert_eq!(storage.record("solid", "SOLID").unwrap(), 3);

        let pending = storage.get_pending().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].count, 3);
    }

    #[test]
    fn test_get_pending_excludes_approved() {
        let storage = create_storage();

        storage.record("solid", "SOLID").unwrap();
        storage.record("dry", "DRY").unwrap();

        let pending = storage.get_pending().unwrap();
        assert_eq!(pending.len(), 2);

        // Approve one
        storage.approve_by_source("solid", "SOLID").unwrap();

        let pending = storage.get_pending().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].source, "dry");
    }

    #[test]
    fn test_get_ready_for_promotion() {
        let storage = create_storage();

        // Add solid 3 times
        storage.record("solid", "SOLID").unwrap();
        storage.record("solid", "SOLID").unwrap();
        storage.record("solid", "SOLID").unwrap();

        // Add dry 1 time
        storage.record("dry", "DRY").unwrap();

        // Threshold 3
        let ready = storage.get_ready_for_promotion(3).unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].source, "solid");
    }

    #[test]
    fn test_approve_rejects_re_record() {
        let storage = create_storage();

        storage.record("solid", "SOLID").unwrap();
        storage.approve_by_source("solid", "SOLID").unwrap();

        // Try to record again - should return 0 (already processed)
        let count = storage.record("solid", "SOLID").unwrap();
        assert_eq!(count, 0);

        // Should not be in pending
        let pending = storage.get_pending().unwrap();
        assert!(pending.is_empty());
    }

    #[test]
    fn test_reject() {
        let storage = create_storage();

        storage.record("solid", "SOLID").unwrap();
        let pending = storage.get_pending().unwrap();
        let id = pending[0].id;

        storage.reject(id).unwrap();

        let pending = storage.get_pending().unwrap();
        assert!(pending.is_empty());
    }

    #[test]
    fn test_pending_count() {
        let storage = create_storage();

        assert_eq!(storage.pending_count().unwrap(), 0);

        storage.record("solid", "SOLID").unwrap();
        storage.record("dry", "DRY").unwrap();

        assert_eq!(storage.pending_count().unwrap(), 2);
    }

    #[test]
    fn test_get_by_source() {
        let storage = create_storage();

        storage.record("solid", "SOLID").unwrap();

        let result = storage.get_by_source("solid").unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().replacement, "SOLID");

        let result = storage.get_by_source("unknown").unwrap();
        assert!(result.is_none());
    }

    /// Hermetic workflow test with seeded data covering pending/approved/rejected
    /// filtering, record+verify, status transitions, and pending_count.
    /// Replaces the former test_real_corrections_db which read the live user DB.
    #[test]
    fn test_corrections_workflow_hermetic() {
        let storage = create_storage();

        // Seed: insert entries to build a realistic multi-status dataset
        storage.record("solid", "SOLID").unwrap();
        storage.record("solid", "SOLID").unwrap(); // count=2
        storage.record("dry", "DRY").unwrap(); // count=1
        storage.record("kiss", "KISS").unwrap(); // count=1

        // Approve one — must disappear from pending
        storage.approve_by_source("solid", "SOLID").unwrap();

        // Reject one — must disappear from pending
        let pending = storage.get_pending().unwrap();
        let kiss_id = pending.iter().find(|s| s.source == "kiss").unwrap().id;
        storage.reject(kiss_id).unwrap();

        // Only "dry" should remain pending
        let pending = storage.get_pending().unwrap();
        assert_eq!(pending.len(), 1, "only 'dry' should be pending");
        assert_eq!(pending[0].source, "dry");
        assert_eq!(pending[0].replacement, "DRY");
        assert_eq!(pending[0].count, 1);
        assert_eq!(pending[0].status, SuggestionStatus::Pending);

        // Record a new entry and verify it appears in pending
        let count = storage.record("yagni", "YAGNI").unwrap();
        assert_eq!(count, 1);

        let pending = storage.get_pending().unwrap();
        assert!(
            pending.iter().any(|s| s.source == "yagni"),
            "new entry 'yagni' must be in pending"
        );

        // Approve the new entry — must disappear from pending
        storage.approve_by_source("yagni", "YAGNI").unwrap();
        let pending = storage.get_pending().unwrap();
        assert!(
            !pending.iter().any(|s| s.source == "yagni"),
            "approved entry must not be in pending"
        );

        // pending_count should be 1 (only "dry")
        assert_eq!(storage.pending_count().unwrap(), 1);
    }
}
