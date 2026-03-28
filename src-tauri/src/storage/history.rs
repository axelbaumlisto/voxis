//! Markdown file storage for history.
//!
//! Format (compatible with Python soupawhisper):
//! ```markdown
//! ## 2024-01-15 10:30:00
//!
//! Hello world transcription text.
//!
//! ---
//! ```

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// A single history entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub timestamp: String,
    pub text: String,
    pub language: Option<String>,
    pub duration: Option<f32>,
}

/// Storage for history.md file.
pub struct HistoryStorage {
    path: PathBuf,
}

impl HistoryStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Load all history entries from markdown file.
    pub fn load(&self) -> Result<Vec<HistoryEntry>, Box<dyn std::error::Error>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&self.path)?;
        let mut entries = Vec::new();

        // Split by "---" separator
        for block in content.split("\n---\n") {
            let block = block.trim();
            if block.is_empty() {
                continue;
            }

            // Parse header: ## YYYY-MM-DD HH:MM:SS [lang] [duration]
            let lines: Vec<&str> = block.lines().collect();
            if lines.is_empty() {
                continue;
            }

            let header = lines[0];
            if !header.starts_with("## ") {
                continue;
            }

            let header = &header[3..];
            let parts: Vec<&str> = header.split_whitespace().collect();

            let timestamp = if parts.len() >= 2 {
                format!("{} {}", parts[0], parts[1])
            } else if parts.len() == 1 {
                parts[0].to_string()
            } else {
                continue;
            };

            // Extract language and duration from header if present
            let mut language = None;
            let mut duration = None;

            for part in parts.iter().skip(2) {
                if let Ok(d) = part.trim_end_matches('s').parse::<f32>() {
                    duration = Some(d);
                } else if part.len() == 2 {
                    language = Some(part.to_string());
                }
            }

            // Text is everything after header line
            let text = lines[1..]
                .iter()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n");

            if !text.is_empty() {
                entries.push(HistoryEntry {
                    timestamp,
                    text,
                    language,
                    duration,
                });
            }
        }

        // Return in reverse chronological order (newest first)
        entries.reverse();
        Ok(entries)
    }

    /// Add a new history entry.
    pub fn add(
        &self,
        text: &str,
        language: Option<&str>,
        duration: Option<f32>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let mut header = format!("## {}", timestamp);
        if let Some(lang) = language {
            header.push_str(&format!(" {}", lang));
        }
        if let Some(dur) = duration {
            header.push_str(&format!(" {:.1}s", dur));
        }

        let entry = format!("{}\n\n{}\n\n---\n", header, text);

        // Append to file
        if self.path.exists() {
            let mut content = fs::read_to_string(&self.path)?;
            content.push_str(&entry);
            fs::write(&self.path, content)?;
        } else {
            // Create parent directory if needed
            if let Some(parent) = self.path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&self.path, entry)?;
        }

        Ok(())
    }

    /// Clear all history.
    pub fn clear(&self) -> Result<(), Box<dyn std::error::Error>> {
        if self.path.exists() {
            fs::write(&self.path, "")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn test_add_and_load_entry() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistoryStorage::new(file.path().to_path_buf());

        storage.add("Hello world", Some("en"), Some(2.5)).unwrap();
        storage.add("Привет мир", Some("ru"), Some(1.8)).unwrap();

        let entries = storage.load().unwrap();
        assert_eq!(entries.len(), 2);
        // Newest first
        assert_eq!(entries[0].text, "Привет мир");
        assert_eq!(entries[1].text, "Hello world");
    }

    #[test]
    fn test_load_empty_file() {
        let storage = HistoryStorage::new(PathBuf::from("/nonexistent/history.md"));
        let entries = storage.load().unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_clear_history() {
        let file = NamedTempFile::new().unwrap();
        let storage = HistoryStorage::new(file.path().to_path_buf());

        storage.add("Test entry", None, None).unwrap();
        assert_eq!(storage.load().unwrap().len(), 1);

        storage.clear().unwrap();
        assert!(storage.load().unwrap().is_empty());
    }
}
