//! Plain text storage for dictionary.
//!
//! Format (compatible with Python soupawhisper):
//! ```text
//! # Comments start with #
//! source = replacement
//! солид = SOLID
//! драй = DRY
//! ```
//!
//! Also supports legacy pipe format: `source|replacement`

use std::fs;
use std::path::PathBuf;

/// Storage for dictionary.txt file.
pub struct DictionaryStorage {
    path: PathBuf,
}

impl DictionaryStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Load all dictionary entries as (source, replacement) pairs.
    /// Supports both Python format (source = replacement) and pipe format (source|replacement)
    pub fn load(&self) -> Result<Vec<(String, String)>, Box<dyn std::error::Error>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&self.path)?;
        let mut entries = Vec::new();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            // Try Python format first: "source = replacement"
            if let Some((source, replacement)) = line.split_once(" = ") {
                entries.push((source.trim().to_string(), replacement.trim().to_string()));
            }
            // Fallback to pipe format: "source|replacement"
            else if let Some((source, replacement)) = line.split_once('|') {
                entries.push((source.trim().to_string(), replacement.trim().to_string()));
            }
            // Also try simple "=" without spaces
            else if let Some((source, replacement)) = line.split_once('=') {
                entries.push((source.trim().to_string(), replacement.trim().to_string()));
            }
        }

        Ok(entries)
    }

    /// Check if a line is a valid entry (not empty, not comment).
    /// DRY: Used by delete() and update() to filter entries.
    fn is_entry_line(line: &str) -> bool {
        let trimmed = line.trim();
        !trimmed.is_empty() && !trimmed.starts_with('#')
    }

    /// Get line indices of actual entries (excluding comments and empty lines).
    /// DRY: Extracts common filtering logic from delete() and update().
    fn entry_line_indices(lines: &[&str]) -> Vec<usize> {
        lines
            .iter()
            .enumerate()
            .filter(|(_, line)| Self::is_entry_line(line))
            .map(|(i, _)| i)
            .collect()
    }

    /// Add a new dictionary entry.
    /// Uses Python-compatible format: "source = replacement"
    pub fn add(&self, source: &str, replacement: &str) -> Result<(), Box<dyn std::error::Error>> {
        let entry = format!("{} = {}\n", source.trim(), replacement.trim());

        if self.path.exists() {
            let mut content = fs::read_to_string(&self.path)?;
            // Ensure newline at end
            if !content.ends_with('\n') && !content.is_empty() {
                content.push('\n');
            }
            content.push_str(&entry);
            fs::write(&self.path, content)?;
        } else {
            if let Some(parent) = self.path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&self.path, entry)?;
        }

        Ok(())
    }

    /// Delete a dictionary entry by index.
    /// DRY: Uses entry_line_indices() for filtering.
    pub fn delete(&self, index: usize) -> Result<(), Box<dyn std::error::Error>> {
        if !self.path.exists() {
            return Err("Dictionary file does not exist".into());
        }

        let content = fs::read_to_string(&self.path)?;
        let lines: Vec<&str> = content.lines().collect();
        let entry_indices = Self::entry_line_indices(&lines);

        if index >= entry_indices.len() {
            return Err(format!("Index {} out of bounds ({})", index, entry_indices.len()).into());
        }

        let line_to_remove = entry_indices[index];
        let new_content: String = lines
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != line_to_remove)
            .map(|(_, line)| *line)
            .collect::<Vec<_>>()
            .join("\n");

        fs::write(&self.path, new_content + "\n")?;
        Ok(())
    }

    /// Update a dictionary entry by index.
    /// DRY: Uses entry_line_indices() for filtering.
    pub fn update(
        &self,
        index: usize,
        source: &str,
        replacement: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if !self.path.exists() {
            return Err("Dictionary file does not exist".into());
        }

        let content = fs::read_to_string(&self.path)?;
        let mut lines: Vec<String> = content.lines().map(String::from).collect();
        let lines_ref: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
        let entry_indices = Self::entry_line_indices(&lines_ref);

        if index >= entry_indices.len() {
            return Err(format!("Index {} out of bounds ({})", index, entry_indices.len()).into());
        }

        let line_index = entry_indices[index];
        lines[line_index] = format!("{} = {}", source.trim(), replacement.trim());

        fs::write(&self.path, lines.join("\n") + "\n")?;
        Ok(())
    }

    /// Apply dictionary replacements to text.
    ///
    /// Performs case-insensitive word boundary matching.
    /// Returns the text with all dictionary replacements applied.
    pub fn apply(&self, text: &str) -> Result<String, Box<dyn std::error::Error>> {
        let entries = self.load()?;
        if entries.is_empty() {
            return Ok(text.to_string());
        }

        let mut result = text.to_string();

        for (source, replacement) in entries {
            // Build regex for case-insensitive word boundary match
            // Escape regex special characters in source
            let escaped = regex::escape(&source);
            // Use word boundaries for proper matching
            let pattern = format!(r"(?i)\b{}\b", escaped);

            if let Ok(re) = regex::Regex::new(&pattern) {
                result = re.replace_all(&result, replacement.as_str()).to_string();
            }
        }

        Ok(result)
    }

    /// Check if a source word already exists in dictionary (case-insensitive).
    pub fn contains(&self, source: &str) -> Result<bool, Box<dyn std::error::Error>> {
        let entries = self.load()?;
        let source_lower = source.to_lowercase();
        Ok(entries
            .iter()
            .any(|(s, _)| s.to_lowercase() == source_lower))
    }
}

// =============================================================================
// Trait implementation for DIP compliance
// =============================================================================

impl super::traits::DictionaryStorage for DictionaryStorage {
    fn load(&self) -> super::traits::StorageResult<Vec<(String, String)>> {
        self.load().map_err(super::traits::into_storage_error)
    }

    fn add(&self, source: &str, replacement: &str) -> super::traits::StorageResult<()> {
        self.add(source, replacement)
            .map_err(super::traits::into_storage_error)
    }

    fn delete(&self, index: usize) -> super::traits::StorageResult<()> {
        self.delete(index)
            .map_err(super::traits::into_storage_error)
    }

    fn update(
        &self,
        index: usize,
        source: &str,
        replacement: &str,
    ) -> super::traits::StorageResult<()> {
        self.update(index, source, replacement)
            .map_err(super::traits::into_storage_error)
    }

    fn apply(&self, text: &str) -> super::traits::StorageResult<String> {
        self.apply(text).map_err(super::traits::into_storage_error)
    }

    fn contains(&self, source: &str) -> super::traits::StorageResult<bool> {
        self.contains(source)
            .map_err(super::traits::into_storage_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn test_add_and_load() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("солид", "SOLID").unwrap();
        storage.add("драй", "DRY").unwrap();

        let entries = storage.load().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0], ("солид".to_string(), "SOLID".to_string()));
        assert_eq!(entries[1], ("драй".to_string(), "DRY".to_string()));
    }

    #[test]
    fn test_delete_entry() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("a", "A").unwrap();
        storage.add("b", "B").unwrap();
        storage.add("c", "C").unwrap();

        storage.delete(1).unwrap(); // Delete "b"

        let entries = storage.load().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].0, "a");
        assert_eq!(entries[1].0, "c");
    }

    #[test]
    fn test_update_entry() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("old", "OLD").unwrap();
        storage.update(0, "new", "NEW").unwrap();

        let entries = storage.load().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0], ("new".to_string(), "NEW".to_string()));
    }

    #[test]
    fn test_load_empty() {
        let storage = DictionaryStorage::new(PathBuf::from("/nonexistent/dict.txt"));
        let entries = storage.load().unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_load_python_format() {
        // Python soupawhisper uses "source = replacement" format
        let file = NamedTempFile::new().unwrap();
        std::fs::write(file.path(), "# Comment\nсолид = SOLID\nдрай = DRY\n").unwrap();

        let storage = DictionaryStorage::new(file.path().to_path_buf());
        let entries = storage.load().unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0], ("солид".to_string(), "SOLID".to_string()));
        assert_eq!(entries[1], ("драй".to_string(), "DRY".to_string()));
    }

    #[test]
    fn test_load_pipe_format() {
        // Legacy pipe format "source|replacement"
        let file = NamedTempFile::new().unwrap();
        std::fs::write(file.path(), "foo|FOO\nbar|BAR\n").unwrap();

        let storage = DictionaryStorage::new(file.path().to_path_buf());
        let entries = storage.load().unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0], ("foo".to_string(), "FOO".to_string()));
        assert_eq!(entries[1], ("bar".to_string(), "BAR".to_string()));
    }

    #[test]
    fn test_load_mixed_formats() {
        // Both formats in one file
        let file = NamedTempFile::new().unwrap();
        std::fs::write(
            file.path(),
            "# Mixed\npython = PYTHON\nlegacy|LEGACY\nsimple=SIMPLE\n",
        )
        .unwrap();

        let storage = DictionaryStorage::new(file.path().to_path_buf());
        let entries = storage.load().unwrap();

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].0, "python");
        assert_eq!(entries[1].0, "legacy");
        assert_eq!(entries[2].0, "simple");
    }

    #[test]
    fn test_load_real_python_dictionary() {
        // Test with actual Python soupawhisper dictionary content
        let file = NamedTempFile::new().unwrap();
        std::fs::write(
            file.path(),
            r#"# SoupaWhisper Dictionary
# Format: source = replacement

cli = CLI
докере = Docker
драй = DRY
chat gpt = ChatGPT
"#,
        )
        .unwrap();

        let storage = DictionaryStorage::new(file.path().to_path_buf());
        let entries = storage.load().unwrap();

        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0], ("cli".to_string(), "CLI".to_string()));
        assert_eq!(entries[1], ("докере".to_string(), "Docker".to_string()));
        assert_eq!(entries[2], ("драй".to_string(), "DRY".to_string()));
        assert_eq!(entries[3], ("chat gpt".to_string(), "ChatGPT".to_string()));
    }

    #[test]
    fn test_apply_single_replacement() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("солид", "SOLID").unwrap();

        let result = storage
            .apply("Это принцип солид в программировании")
            .unwrap();
        assert_eq!(result, "Это принцип SOLID в программировании");
    }

    #[test]
    fn test_apply_multiple_replacements() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("солид", "SOLID").unwrap();
        storage.add("драй", "DRY").unwrap();

        let result = storage.apply("Принципы солид и драй важны").unwrap();
        assert_eq!(result, "Принципы SOLID и DRY важны");
    }

    #[test]
    fn test_apply_case_insensitive() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("api", "API").unwrap();

        let result = storage.apply("The Api is ready and API works").unwrap();
        assert_eq!(result, "The API is ready and API works");
    }

    #[test]
    fn test_apply_word_boundaries() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("api", "API").unwrap();

        // Should NOT replace "api" inside "capital"
        let result = storage.apply("api works but capital is fine").unwrap();
        assert_eq!(result, "API works but capital is fine");
    }

    #[test]
    fn test_apply_empty_dictionary() {
        let storage = DictionaryStorage::new(PathBuf::from("/nonexistent/dict.txt"));

        let result = storage.apply("Text stays unchanged").unwrap();
        assert_eq!(result, "Text stays unchanged");
    }

    #[test]
    fn test_apply_multi_word_phrase() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("chat gpt", "ChatGPT").unwrap();

        let result = storage.apply("I use chat gpt every day").unwrap();
        assert_eq!(result, "I use ChatGPT every day");
    }

    #[test]
    fn test_contains_existing() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("солид", "SOLID").unwrap();

        assert!(storage.contains("солид").unwrap());
        assert!(storage.contains("СОЛИД").unwrap()); // case-insensitive
        assert!(!storage.contains("драй").unwrap());
    }

    #[test]
    fn test_contains_empty() {
        let storage = DictionaryStorage::new(PathBuf::from("/nonexistent/dict.txt"));
        assert!(!storage.contains("anything").unwrap());
    }

    #[test]
    fn test_delete_nonexistent_file() {
        let storage = DictionaryStorage::new(PathBuf::from("/nonexistent/dict.txt"));
        let result = storage.delete(0);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("does not exist"));
    }

    #[test]
    fn test_delete_out_of_bounds() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("a", "A").unwrap();

        let result = storage.delete(5);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("out of bounds"));
    }

    #[test]
    fn test_update_nonexistent_file() {
        let storage = DictionaryStorage::new(PathBuf::from("/nonexistent/dict.txt"));
        let result = storage.update(0, "new", "NEW");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("does not exist"));
    }

    #[test]
    fn test_update_out_of_bounds() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        storage.add("a", "A").unwrap();

        let result = storage.update(10, "new", "NEW");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("out of bounds"));
    }

    #[test]
    fn test_load_file_with_only_comments() {
        let file = NamedTempFile::new().unwrap();
        std::fs::write(file.path(), "# comment line 1\n# comment line 2\n\n").unwrap();

        let storage = DictionaryStorage::new(file.path().to_path_buf());
        let entries = storage.load().unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_load_file_with_malformed_lines() {
        let file = NamedTempFile::new().unwrap();
        // Lines without = or | separator should be ignored
        std::fs::write(
            file.path(),
            "valid = VALID\nno_separator_here\nalso valid = ALSO\n",
        )
        .unwrap();

        let storage = DictionaryStorage::new(file.path().to_path_buf());
        let entries = storage.load().unwrap();
        // "no_separator_here" has no = or |, so it should be skipped
        // Actually it won't be skipped because there's no filtering for that case.
        // Let me check: it won't match split_once(" = "), split_once('|'), or split_once('=')
        // since there's no separator. So it IS skipped.
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].0, "valid");
        assert_eq!(entries[1].0, "also valid");
    }

    #[test]
    fn test_add_to_readonly_path() {
        let storage = DictionaryStorage::new(PathBuf::from("/proc/nonexistent/dict.txt"));
        let result = storage.add("test", "TEST");
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_from_empty_file() {
        let file = NamedTempFile::new().unwrap();
        std::fs::write(file.path(), "").unwrap();

        let storage = DictionaryStorage::new(file.path().to_path_buf());
        let result = storage.delete(0);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("out of bounds"));
    }

    #[test]
    fn test_apply_with_regex_special_chars() {
        let file = NamedTempFile::new().unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        // Source contains regex special characters
        storage.add("c++", "CPP").unwrap();

        // Should not crash due to unescaped regex chars
        let result = storage.apply("I program in c++ every day");
        assert!(result.is_ok());
    }

    #[test]
    fn test_apply_fixture_dictionary() {
        let file = NamedTempFile::new().unwrap();
        std::fs::write(file.path(), "cli=CLI\nдокер=Docker\n").unwrap();
        let storage = DictionaryStorage::new(file.path().to_path_buf());

        let result = storage.apply("использую cli и докер").unwrap();

        assert!(result.contains("CLI"), "Expected CLI in: {}", result);
        assert!(result.contains("Docker"), "Expected Docker in: {}", result);
    }
}
