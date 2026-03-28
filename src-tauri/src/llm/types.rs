//! LLM result types and dictionary suggestions.

use serde::{Deserialize, Serialize};

/// A dictionary suggestion from LLM.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DictionarySuggestion {
    /// Original word/phrase from transcription (e.g., "солид")
    #[serde(alias = "from")]
    pub source: String,
    /// Suggested replacement (e.g., "SOLID")
    #[serde(alias = "to")]
    pub replacement: String,
}

/// Result from LLM processing.
/// KISS: Uses serde aliases to handle different LLM response formats in one struct.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResult {
    /// Corrected text with grammar/punctuation fixes
    #[serde(alias = "corrected_text", alias = "output")]
    pub text: String,
    /// Dictionary suggestions for tech terms
    #[serde(default)]
    pub suggestions: Vec<DictionarySuggestion>,
}

/// Suggestions-only result format (for batch prompts).
/// KISS/OCP: Extracted to module level for reusability and testability.
#[derive(Debug, Clone, Deserialize)]
pub struct SuggestionsOnlyResult {
    pub suggestions: Vec<DictionarySuggestion>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_suggestion_deserialize_aliases() {
        // Test that both "source"/"replacement" and "from"/"to" work
        let json = r#"{"from": "solid", "to": "SOLID"}"#;
        let suggestion: DictionarySuggestion = serde_json::from_str(json).unwrap();
        assert_eq!(suggestion.source, "solid");
        assert_eq!(suggestion.replacement, "SOLID");
    }

    #[test]
    fn test_llm_result_clone() {
        let result = LlmResult {
            text: "Hello".to_string(),
            suggestions: vec![DictionarySuggestion {
                source: "api".to_string(),
                replacement: "API".to_string(),
            }],
        };
        let cloned = result.clone();
        assert_eq!(cloned.text, result.text);
        assert_eq!(cloned.suggestions, result.suggestions);
    }

    #[test]
    fn test_suggestions_only_result_deserialize() {
        let json = r#"{"suggestions": [{"source": "dry", "replacement": "DRY"}, {"source": "kiss", "replacement": "KISS"}]}"#;
        let result: SuggestionsOnlyResult = serde_json::from_str(json).unwrap();

        assert_eq!(result.suggestions.len(), 2);
        assert_eq!(result.suggestions[0].source, "dry");
        assert_eq!(result.suggestions[1].replacement, "KISS");
    }

    #[test]
    fn test_suggestions_only_result_empty() {
        let json = r#"{"suggestions": []}"#;
        let result: SuggestionsOnlyResult = serde_json::from_str(json).unwrap();
        assert!(result.suggestions.is_empty());
    }
}
