//! SQLite storage for history.
//!
//! Compatible with Python soupawhisper history.db format.

use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::sqlite_base::{FromSqliteRow, SqliteSchema};

/// A single history entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub timestamp: String,
    pub text: String,
    pub language: Option<String>,
    pub duration: Option<f32>,
}

/// DRY: Implements FromSqliteRow trait for HistoryEntry.
impl FromSqliteRow for HistoryEntry {
    fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            text: row.get(1)?,
            language: row.get::<_, Option<String>>(2)?.filter(|s| !s.is_empty()),
            timestamp: row.get(3)?,
            duration: row.get(4)?,
        })
    }
}

/// SQLite storage for history.
pub struct HistorySqliteStorage {
    path: PathBuf,
}

impl HistorySqliteStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Load history entries, newest first.
    pub fn load(
        &self,
        limit: Option<usize>,
    ) -> Result<Vec<HistoryEntry>, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let limit = limit.unwrap_or(100);

        let mut stmt = conn.prepare(
            "SELECT id, text, language, timestamp, duration
             FROM history
             ORDER BY timestamp DESC
             LIMIT ?",
        )?;

        let entries = stmt.query_map([limit], HistoryEntry::from_row)?;
        entries.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Add a new history entry.
    pub fn add(
        &self,
        text: &str,
        language: Option<&str>,
        duration: Option<f32>,
    ) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        conn.execute(
            "INSERT INTO history (text, language, timestamp, duration) VALUES (?, ?, ?, ?)",
            params![text, language.unwrap_or(""), timestamp, duration],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Delete a history entry by ID.
    pub fn delete(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM history WHERE id = ?", [id])?;
        Ok(())
    }

    /// Clear all history.
    pub fn clear(&self) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM history", [])?;
        Ok(())
    }

    /// Apply the user-configured retention policy by deleting entries
    /// older than the computed cutoff. See `compute_retention_cutoff`
    /// for the policy matrix. Returns the number of deleted rows.
    pub fn cleanup_by_retention(
        &self,
        policy: &str,
        preserve_limit: usize,
    ) -> Result<usize, Box<dyn std::error::Error>> {
        match policy {
            "never" => Ok(0),
            "preserve_limit" => {
                let conn = self.connect()?;
                // Keep the N most recent ids; delete the rest.
                let deleted = conn.execute(
                    "DELETE FROM history WHERE id NOT IN (\
                       SELECT id FROM history ORDER BY timestamp DESC LIMIT ?1\
                     )",
                    [preserve_limit],
                )?;
                Ok(deleted)
            }
            "days_3" | "weeks_2" | "months_3" => {
                let cutoff_secs = compute_retention_cutoff(policy, chrono::Utc::now().timestamp());
                let conn = self.connect()?;
                // history.timestamp is a DATETIME string (Python compat);
                // use unixepoch() to compare apples to apples.
                let deleted = conn.execute(
                    "DELETE FROM history WHERE unixepoch(timestamp) < ?1",
                    [cutoff_secs],
                )?;
                Ok(deleted)
            }
            other => {
                tracing::warn!(
                    "cleanup_by_retention: unknown policy '{}'; doing nothing",
                    other
                );
                Ok(0)
            }
        }
    }

    /// Search history by text.
    pub fn search(
        &self,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<HistoryEntry>, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let limit = limit.unwrap_or(50);
        let pattern = format!("%{}%", query);

        let mut stmt = conn.prepare(
            "SELECT id, text, language, timestamp, duration
             FROM history
             WHERE text LIKE ?
             ORDER BY timestamp DESC
             LIMIT ?",
        )?;

        let entries = stmt.query_map(params![pattern, limit], HistoryEntry::from_row)?;
        entries.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Get history count.
    pub fn count(&self) -> Result<usize, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))?;
        Ok(count as usize)
    }
}

// =============================================================================
// SqliteSchema trait — DRY connect() via sqlite_base
// =============================================================================

impl SqliteSchema for HistorySqliteStorage {
    fn path(&self) -> &std::path::Path {
        &self.path
    }

    fn init_schema(&self, conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
        use super::sqlite_base::{column_exists, create_index_if_not_exists};

        // Create table if not exists (compatible with Python schema)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                language TEXT DEFAULT '',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Add duration column if not exists (migration for older Python schema)
        if !column_exists(conn, "history", "duration") {
            let _ = conn.execute("ALTER TABLE history ADD COLUMN duration REAL", []);
        }

        // Create index for fast timestamp queries
        create_index_if_not_exists(conn, "idx_timestamp", "history", "timestamp DESC")?;

        Ok(())
    }
}

// =============================================================================
// Trait implementation for DIP compliance
// =============================================================================

impl super::traits::HistoryStorage for HistorySqliteStorage {
    fn load(&self, limit: Option<usize>) -> super::traits::StorageResult<Vec<HistoryEntry>> {
        self.load(limit).map_err(super::traits::into_storage_error)
    }

    fn add(
        &self,
        text: &str,
        language: Option<&str>,
        duration: Option<f32>,
    ) -> super::traits::StorageResult<i64> {
        self.add(text, language, duration)
            .map_err(super::traits::into_storage_error)
    }

    fn clear(&self) -> super::traits::StorageResult<()> {
        self.clear().map_err(super::traits::into_storage_error)
    }

    fn delete(&self, id: i64) -> super::traits::StorageResult<()> {
        self.delete(id).map_err(super::traits::into_storage_error)
    }

    fn search(
        &self,
        query: &str,
        limit: Option<usize>,
    ) -> super::traits::StorageResult<Vec<HistoryEntry>> {
        self.search(query, limit)
            .map_err(super::traits::into_storage_error)
    }
}

/// Pure helper: given a retention policy string and the current unix
/// timestamp, return the cutoff (entries older than this should be
/// deleted). Lives outside the impl so it's testable without SQLite.
///
/// Unknown / non-time-based policies return `i64::MIN` so any
/// `unixepoch(timestamp) < cutoff` query becomes a no-op.
pub fn compute_retention_cutoff(policy: &str, now_secs: i64) -> i64 {
    const DAY: i64 = 86_400;
    match policy {
        "days_3" => now_secs - 3 * DAY,
        "weeks_2" => now_secs - 14 * DAY,
        "months_3" => now_secs - 90 * DAY,
        _ => i64::MIN,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn test_add_and_load() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistorySqliteStorage::new(file.path().to_path_buf());

        storage.add("Hello world", Some("en"), Some(2.5)).unwrap();
        storage.add("Привет мир", Some("ru"), None).unwrap();

        let entries = storage.load(None).unwrap();
        assert_eq!(entries.len(), 2);
        // Both entries exist, order may vary due to same timestamp
        let texts: Vec<&str> = entries.iter().map(|e| e.text.as_str()).collect();
        assert!(texts.contains(&"Hello world"));
        assert!(texts.contains(&"Привет мир"));
    }

    #[test]
    fn test_search() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistorySqliteStorage::new(file.path().to_path_buf());

        storage.add("Hello world", None, None).unwrap();
        storage.add("Hello there", None, None).unwrap();
        storage.add("Goodbye", None, None).unwrap();

        let results = storage.search("Hello", None).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_delete() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistorySqliteStorage::new(file.path().to_path_buf());

        let id = storage.add("Test", None, None).unwrap();
        assert_eq!(storage.count().unwrap(), 1);

        storage.delete(id).unwrap();
        assert_eq!(storage.count().unwrap(), 0);
    }

    #[test]
    fn test_clear() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistorySqliteStorage::new(file.path().to_path_buf());

        storage.add("One", None, None).unwrap();
        storage.add("Two", None, None).unwrap();
        assert_eq!(storage.count().unwrap(), 2);

        storage.clear().unwrap();
        assert_eq!(storage.count().unwrap(), 0);
    }

    #[test]
    fn test_load_corrupted_history_db() {
        use std::io::Write;
        let file = NamedTempFile::new().unwrap();

        // Write garbage data
        let mut f = std::fs::File::create(file.path()).unwrap();
        f.write_all(b"NOT_A_SQLITE_DATABASE").unwrap();

        let storage = HistorySqliteStorage::new(file.path().to_path_buf());
        let result = storage.load(None);
        assert!(result.is_err());
    }

    #[test]
    fn test_add_to_corrupted_history_db() {
        use std::io::Write;
        let file = NamedTempFile::new().unwrap();

        let mut f = std::fs::File::create(file.path()).unwrap();
        f.write_all(b"CORRUPT").unwrap();

        let storage = HistorySqliteStorage::new(file.path().to_path_buf());
        let result = storage.add("test", None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_nonexistent_id() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistorySqliteStorage::new(file.path().to_path_buf());

        storage.add("Test", None, None).unwrap();

        // Deleting a non-existent ID should not error (SQLite DELETE is no-op)
        let result = storage.delete(999999);
        assert!(result.is_ok());
        // Original entry should still exist
        assert_eq!(storage.count().unwrap(), 1);
    }

    #[test]
    fn test_search_empty_query() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistorySqliteStorage::new(file.path().to_path_buf());

        storage.add("Hello", None, None).unwrap();
        storage.add("World", None, None).unwrap();

        // Empty search matches everything (LIKE '%%')
        let results = storage.search("", None).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_search_no_matches() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistorySqliteStorage::new(file.path().to_path_buf());

        storage.add("Hello", None, None).unwrap();

        let results = storage.search("zzz_nonexistent", None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_count_empty_db() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistorySqliteStorage::new(file.path().to_path_buf());
        assert_eq!(storage.count().unwrap(), 0);
    }

    #[test]
    fn test_clear_empty_db() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistorySqliteStorage::new(file.path().to_path_buf());

        // Clear on empty should not error
        let result = storage.clear();
        assert!(result.is_ok());
        assert_eq!(storage.count().unwrap(), 0);
    }

    #[test]
    fn test_add_with_special_characters() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistorySqliteStorage::new(file.path().to_path_buf());

        // Test SQL injection-like text
        let result = storage.add("'; DROP TABLE history; --", Some("en"), None);
        assert!(result.is_ok());

        let entries = storage.load(None).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].text, "'; DROP TABLE history; --");
    }

    // ---- T-C5 retention ---------------------------------------------
    #[test]
    fn retention_cutoff_never_returns_i64_min() {
        // 'never' policy means «don't delete anything» — the cutoff
        // must be such that NO row can satisfy timestamp < cutoff.
        assert_eq!(compute_retention_cutoff("never", 1_000_000), i64::MIN);
    }

    #[test]
    fn retention_cutoff_days_3_subtracts_three_days() {
        let now = 1_000_000_000;
        let cutoff = compute_retention_cutoff("days_3", now);
        assert_eq!(cutoff, now - 3 * 86_400);
    }

    #[test]
    fn retention_cutoff_weeks_2_subtracts_fourteen_days() {
        let now = 1_000_000_000;
        let cutoff = compute_retention_cutoff("weeks_2", now);
        assert_eq!(cutoff, now - 14 * 86_400);
    }

    #[test]
    fn retention_cutoff_months_3_subtracts_ninety_days() {
        let now = 1_000_000_000;
        let cutoff = compute_retention_cutoff("months_3", now);
        assert_eq!(cutoff, now - 90 * 86_400);
    }

    #[test]
    fn retention_cutoff_preserve_limit_treated_as_unknown() {
        // preserve_limit isn't a time-based cutoff; the cleanup code
        // takes the LIMIT-based code path instead.
        assert_eq!(
            compute_retention_cutoff("preserve_limit", 1_000_000),
            i64::MIN
        );
    }

    #[test]
    fn retention_never_keeps_everything() {
        let temp = tempfile::tempdir().unwrap();
        let storage = HistorySqliteStorage::new(temp.path().join("h.db"));
        for i in 0..5 {
            storage.add(&format!("entry {}", i), None, None).unwrap();
        }
        let deleted = storage.cleanup_by_retention("never", 100).unwrap();
        assert_eq!(deleted, 0);
        assert_eq!(storage.count().unwrap(), 5);
    }

    #[test]
    fn retention_preserve_limit_keeps_only_n_recent() {
        let temp = tempfile::tempdir().unwrap();
        let storage = HistorySqliteStorage::new(temp.path().join("h.db"));
        for i in 0..7 {
            storage.add(&format!("entry {}", i), None, None).unwrap();
            // Small spacing so timestamps differ even at second
            // resolution; the test still works without this but it
            // makes the ordering deterministic on fast machines.
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let deleted = storage.cleanup_by_retention("preserve_limit", 3).unwrap();
        assert_eq!(deleted, 4);
        assert_eq!(storage.count().unwrap(), 3);
    }

    #[test]
    fn test_save_to_readonly_path() {
        let storage = HistorySqliteStorage::new(PathBuf::from("/proc/nonexistent/history.db"));
        let result = storage.add("test", None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_real_db() {
        // Test loading from actual soupawhisper history.db
        let real_db = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default())
            .join(".config/soupawhisper/history.db");

        if real_db.exists() {
            let storage = HistorySqliteStorage::new(real_db);
            let count = storage.count().unwrap();
            println!("Real history.db has {} entries", count);

            let entries = storage.load(Some(5)).unwrap();
            println!("Loaded {} entries:", entries.len());
            for e in &entries {
                println!(
                    "  [{}] {} - {}",
                    e.id,
                    e.timestamp,
                    e.text.chars().take(50).collect::<String>()
                );
            }

            assert!(count > 0, "Real history.db should have entries");
            assert!(
                !entries.is_empty(),
                "Should load entries from real history.db"
            );
        } else {
            println!("Skipping: ~/.config/soupawhisper/history.db not found");
        }
    }
}
