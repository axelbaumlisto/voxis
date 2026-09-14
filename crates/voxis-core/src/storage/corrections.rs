//! JSON storage for LLM correction statistics.
//!
//! Tracks how often words are corrected by LLM for dictionary learning.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// Correction statistics storage.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CorrectionStats {
    /// Map of word -> correction count
    pub words: HashMap<String, u32>,
}

/// Storage for corrections_stats.json file.
pub struct CorrectionsStorage {
    path: PathBuf,
}

impl CorrectionsStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Load correction statistics.
    pub fn load(&self) -> Result<CorrectionStats, Box<dyn std::error::Error>> {
        if !self.path.exists() {
            return Ok(CorrectionStats::default());
        }

        let content = fs::read_to_string(&self.path)?;
        // Handle empty file case
        if content.trim().is_empty() {
            return Ok(CorrectionStats::default());
        }
        let stats: CorrectionStats = serde_json::from_str(&content)?;
        Ok(stats)
    }

    /// Save correction statistics.
    pub fn save(&self, stats: &CorrectionStats) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(stats)?;
        fs::write(&self.path, json)?;
        Ok(())
    }

    /// Increment correction count for a word.
    pub fn increment(&self, word: &str) -> Result<u32, Box<dyn std::error::Error>> {
        let mut stats = self.load()?;
        let count = stats.words.entry(word.to_string()).or_insert(0);
        *count += 1;
        let new_count = *count;
        self.save(&stats)?;
        Ok(new_count)
    }

    /// Clear all statistics.
    pub fn clear(&self) -> Result<(), Box<dyn std::error::Error>> {
        self.save(&CorrectionStats::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn test_increment_and_load() {
        let file = NamedTempFile::new().unwrap();
        let storage = CorrectionsStorage::new(file.path().to_path_buf());

        assert_eq!(storage.increment("test").unwrap(), 1);
        assert_eq!(storage.increment("test").unwrap(), 2);
        assert_eq!(storage.increment("test").unwrap(), 3);
        assert_eq!(storage.increment("other").unwrap(), 1);

        let stats = storage.load().unwrap();
        assert_eq!(stats.words.get("test"), Some(&3));
        assert_eq!(stats.words.get("other"), Some(&1));
    }

    #[test]
    fn test_clear() {
        let file = NamedTempFile::new().unwrap();
        let storage = CorrectionsStorage::new(file.path().to_path_buf());

        storage.increment("test").unwrap();
        storage.clear().unwrap();

        let stats = storage.load().unwrap();
        assert!(stats.words.is_empty());
    }
}
