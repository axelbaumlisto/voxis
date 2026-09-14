//! LLM response parsing utilities.

use super::types::{LlmResult, SuggestionsOnlyResult};

#[cfg(test)]
use super::types::DictionarySuggestion;

/// Parse LLM response JSON into LlmResult.
/// KISS/OCP: Uses helper functions for each parsing strategy.
pub fn parse_response(
    content: &str,
    original_text: &str,
) -> Result<LlmResult, Box<dyn std::error::Error + Send + Sync>> {
    let json_str = extract_json(content);

    // Try each parsing strategy in order
    if let Some(result) = try_parse_full_result(&json_str, original_text) {
        return Ok(result);
    }

    if let Some(result) = try_parse_suggestions_only(&json_str, original_text) {
        return Ok(result);
    }

    // Fallback: return original text with no suggestions
    Ok(fallback_result(content, original_text))
}

/// Parse assistant message content into typed LLM result.
pub fn parse_result(
    content: &str,
    original_text: &str,
) -> Result<LlmResult, Box<dyn std::error::Error + Send + Sync>> {
    parse_response(content, original_text)
}

/// Try parsing as full LlmResult (handles text, corrected_text, output via aliases).
/// KISS/OCP: Isolated parsing strategy for full result format.
pub fn try_parse_full_result(json_str: &str, original_text: &str) -> Option<LlmResult> {
    serde_json::from_str::<LlmResult>(json_str)
        .ok()
        .map(|result| validate_result(result, original_text))
}

/// Try parsing as suggestions-only result (for batch prompts).
/// KISS/OCP: Isolated parsing strategy for suggestions-only format.
pub fn try_parse_suggestions_only(json_str: &str, original_text: &str) -> Option<LlmResult> {
    serde_json::from_str::<SuggestionsOnlyResult>(json_str)
        .ok()
        .map(|result| LlmResult {
            text: original_text.to_string(),
            suggestions: result.suggestions,
        })
}

/// Create fallback result when parsing fails.
/// KISS/OCP: Isolated fallback strategy.
pub fn fallback_result(content: &str, original_text: &str) -> LlmResult {
    tracing::warn!("Failed to parse LLM response as JSON: {}", content);
    LlmResult {
        text: original_text.to_string(),
        suggestions: Vec::new(),
    }
}

/// Extract JSON from response (handles markdown code blocks).
pub fn extract_json(content: &str) -> String {
    let content = content.trim();

    // Check for markdown code block
    if content.starts_with("```") {
        // Find the end of code block
        if let Some(start) = content.find('\n') {
            let after_first_line = &content[start + 1..];
            if let Some(end) = after_first_line.rfind("```") {
                return after_first_line[..end].trim().to_string();
            }
        }
    }

    // Try to find JSON object
    if let Some(start) = content.find('{') {
        if let Some(end) = content.rfind('}') {
            return content[start..=end].to_string();
        }
    }

    content.to_string()
}

/// Validate and clean up LLM result.
pub fn validate_result(mut result: LlmResult, original_text: &str) -> LlmResult {
    // Filter out invalid suggestions
    result.suggestions.retain(|s| {
        // Skip empty suggestions
        if s.source.trim().is_empty() || s.replacement.trim().is_empty() {
            return false;
        }

        // Skip if source equals replacement exactly (no change)
        if s.source.trim() == s.replacement.trim() {
            return false;
        }

        // Skip if source is not in original text (case-insensitive)
        if !original_text
            .to_lowercase()
            .contains(&s.source.to_lowercase())
        {
            return false;
        }

        true
    });

    // Ensure text is not empty
    if result.text.trim().is_empty() {
        result.text = original_text.to_string();
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_result_delegates_to_parser() {
        let content = r#"{"text": "Hello, world!", "suggestions": []}"#;
        let result = parse_result(content, "hello world").unwrap();
        assert_eq!(result.text, "Hello, world!");
        assert!(result.suggestions.is_empty());
    }

    #[test]
    fn test_parse_valid_response() {
        let json = r#"{"text": "Hello, SOLID!", "suggestions": [{"source": "solid", "replacement": "SOLID"}]}"#;

        let result = parse_response(json, "hello solid").unwrap();
        assert_eq!(result.text, "Hello, SOLID!");
        assert_eq!(result.suggestions.len(), 1);
        assert_eq!(result.suggestions[0].source, "solid");
        assert_eq!(result.suggestions[0].replacement, "SOLID");
    }

    #[test]
    fn test_parse_from_to_format() {
        let json =
            r#"{"text": "Use DRY principle", "suggestions": [{"from": "dry", "to": "DRY"}]}"#;

        let result = parse_response(json, "use dry principle").unwrap();
        assert_eq!(result.text, "Use DRY principle");
        assert_eq!(result.suggestions.len(), 1);
        assert_eq!(result.suggestions[0].source, "dry");
        assert_eq!(result.suggestions[0].replacement, "DRY");
    }

    #[test]
    fn test_parse_response_no_suggestions() {
        let json = r#"{"text": "Hello, world!", "suggestions": []}"#;

        let result = parse_response(json, "hello world").unwrap();
        assert_eq!(result.text, "Hello, world!");
        assert!(result.suggestions.is_empty());
    }

    #[test]
    fn test_parse_response_with_code_block() {
        let content = r#"```json
{"text": "Hello!", "suggestions": []}
```"#;

        let result = parse_response(content, "hello").unwrap();
        assert_eq!(result.text, "Hello!");
    }

    #[test]
    fn test_parse_response_invalid_json() {
        let result = parse_response("not json at all", "original text").unwrap();

        // Should return original text on parse failure
        assert_eq!(result.text, "original text");
        assert!(result.suggestions.is_empty());
    }

    #[test]
    fn test_validate_filters_empty_suggestions() {
        let result = LlmResult {
            text: "Hello".to_string(),
            suggestions: vec![
                DictionarySuggestion {
                    source: "".to_string(),
                    replacement: "SOLID".to_string(),
                },
                DictionarySuggestion {
                    source: "solid".to_string(),
                    replacement: "SOLID".to_string(),
                },
            ],
        };

        let validated = validate_result(result, "hello solid");
        assert_eq!(validated.suggestions.len(), 1);
    }

    #[test]
    fn test_validate_filters_same_source_replacement() {
        let result = LlmResult {
            text: "Hello".to_string(),
            suggestions: vec![DictionarySuggestion {
                source: "SOLID".to_string(),
                replacement: "SOLID".to_string(),
            }],
        };

        let validated = validate_result(result, "hello SOLID");
        assert!(validated.suggestions.is_empty());
    }

    #[test]
    fn test_validate_keeps_case_changes() {
        let result = LlmResult {
            text: "Hello".to_string(),
            suggestions: vec![DictionarySuggestion {
                source: "solid".to_string(),
                replacement: "SOLID".to_string(),
            }],
        };

        let validated = validate_result(result, "hello solid");
        assert_eq!(validated.suggestions.len(), 1);
    }

    #[test]
    fn test_validate_filters_not_in_original() {
        let result = LlmResult {
            text: "Hello".to_string(),
            suggestions: vec![DictionarySuggestion {
                source: "nonexistent".to_string(),
                replacement: "NONEXISTENT".to_string(),
            }],
        };

        let validated = validate_result(result, "hello world");
        assert!(validated.suggestions.is_empty());
    }

    #[test]
    fn test_extract_json_from_code_block() {
        let content = "```json\n{\"text\": \"test\"}\n```";
        assert_eq!(extract_json(content), "{\"text\": \"test\"}");

        let content = "```\n{\"text\": \"test\"}\n```";
        assert_eq!(extract_json(content), "{\"text\": \"test\"}");
    }

    #[test]
    fn test_extract_json_raw() {
        let content = "{\"text\": \"test\"}";
        assert_eq!(extract_json(content), "{\"text\": \"test\"}");

        let content = "Some text {\"text\": \"test\"} more text";
        assert_eq!(extract_json(content), "{\"text\": \"test\"}");
    }

    #[test]
    fn test_parse_suggestions_only_format() {
        let json = r#"{"suggestions": [{"source": "solid", "replacement": "SOLID"}]}"#;
        let result = parse_response(json, "use solid principles").unwrap();
        assert_eq!(result.text, "use solid principles");
        assert_eq!(result.suggestions.len(), 1);
    }

    #[test]
    fn test_parse_alternative_field_names() {
        let json = r#"{"corrected_text": "Hello, World!", "suggestions": []}"#;
        let result = parse_response(json, "hello world").unwrap();
        assert_eq!(result.text, "Hello, World!");
    }

    #[test]
    fn test_parse_output_field_name() {
        let json = r#"{"output": "Hello, World!", "suggestions": []}"#;
        let result = parse_response(json, "hello world").unwrap();
        assert_eq!(result.text, "Hello, World!");
    }

    #[test]
    fn test_extract_json_from_nested_text() {
        let content = "Here is the result: {\"text\": \"Hello\"} and more text";
        assert_eq!(extract_json(content), "{\"text\": \"Hello\"}");
    }

    #[test]
    fn test_extract_json_no_braces() {
        let content = "just plain text";
        assert_eq!(extract_json(content), "just plain text");
    }

    #[test]
    fn test_validate_empty_text_uses_original() {
        let result = LlmResult {
            text: "   ".to_string(),
            suggestions: vec![],
        };
        let validated = validate_result(result, "original text");
        assert_eq!(validated.text, "original text");
    }

    #[test]
    fn test_validate_filters_whitespace_suggestions() {
        let result = LlmResult {
            text: "Hello".to_string(),
            suggestions: vec![
                DictionarySuggestion {
                    source: "   ".to_string(),
                    replacement: "SOLID".to_string(),
                },
                DictionarySuggestion {
                    source: "solid".to_string(),
                    replacement: "   ".to_string(),
                },
            ],
        };
        let validated = validate_result(result, "hello solid");
        assert!(validated.suggestions.is_empty());
    }

    #[test]
    fn test_try_parse_full_result_valid() {
        let json = r#"{"text": "Hello, SOLID!", "suggestions": [{"source": "solid", "replacement": "SOLID"}]}"#;
        let result = try_parse_full_result(json, "hello solid");

        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.text, "Hello, SOLID!");
        assert_eq!(result.suggestions.len(), 1);
    }

    #[test]
    fn test_try_parse_full_result_invalid() {
        let result = try_parse_full_result("not json", "original");
        assert!(result.is_none());
    }

    #[test]
    fn test_try_parse_suggestions_only_valid() {
        let json = r#"{"suggestions": [{"source": "api", "replacement": "API"}]}"#;
        let result = try_parse_suggestions_only(json, "use api");

        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.text, "use api");
        assert_eq!(result.suggestions.len(), 1);
    }

    #[test]
    fn test_try_parse_suggestions_only_invalid() {
        let result = try_parse_suggestions_only("not json", "original");
        assert!(result.is_none());
    }

    #[test]
    fn test_fallback_result_returns_original() {
        let result = fallback_result("garbage", "original text");

        assert_eq!(result.text, "original text");
        assert!(result.suggestions.is_empty());
    }

    // ==========================================================================
    // Edge case tests for extract_json
    // ==========================================================================

    #[test]
    fn test_extract_json_nested_braces() {
        // JSON with nested objects
        let content = r#"{"text": "Hello", "nested": {"key": "value"}}"#;
        let extracted = extract_json(content);
        assert!(extracted.contains("nested"));
        assert!(extracted.contains("key"));
    }

    #[test]
    fn test_extract_json_malformed_code_block_no_closing() {
        // Code block without closing ```
        let content = "```json\n{\"text\": \"test\"}";
        let extracted = extract_json(content);
        // Should still try to extract the JSON
        assert!(extracted.contains("text") || extracted.contains("test"));
    }

    #[test]
    fn test_extract_json_empty_code_block() {
        let content = "```\n\n```";
        let extracted = extract_json(content);
        assert!(extracted.is_empty() || extracted == "```\n\n```");
    }

    #[test]
    fn test_extract_json_code_block_with_language_tag() {
        let content = "```javascript\n{\"text\": \"test\"}\n```";
        let extracted = extract_json(content);
        assert_eq!(extracted, "{\"text\": \"test\"}");
    }

    #[test]
    fn test_extract_json_multiple_code_blocks() {
        // Should extract from first code block
        let content =
            "```json\n{\"first\": true}\n```\nSome text\n```json\n{\"second\": true}\n```";
        let extracted = extract_json(content);
        assert!(extracted.contains("first"));
    }

    #[test]
    fn test_extract_json_brace_in_string() {
        // JSON with braces inside string values
        let content = r#"{"text": "Hello {world}", "suggestions": []}"#;
        let extracted = extract_json(content);
        // Should extract the entire JSON
        assert!(extracted.starts_with("{"));
        assert!(extracted.ends_with("}"));
    }

    #[test]
    fn test_extract_json_only_opening_brace() {
        let content = "Some text { but no closing brace";
        let extracted = extract_json(content);
        // Should return original since no valid JSON
        assert_eq!(extracted, "Some text { but no closing brace");
    }

    #[test]
    fn test_extract_json_only_closing_brace() {
        let content = "Some text } but no opening brace";
        let extracted = extract_json(content);
        assert_eq!(extracted, "Some text } but no opening brace");
    }

    #[test]
    fn test_extract_json_whitespace_around_code_block() {
        let content = "   \n```json\n{\"text\": \"test\"}\n```\n   ";
        let extracted = extract_json(content);
        assert_eq!(extracted, "{\"text\": \"test\"}");
    }

    // ==========================================================================
    // Edge case tests for parse_response
    // ==========================================================================

    #[test]
    fn test_parse_response_unicode_content() {
        let json = r#"{"text": "Привет, мир! 你好世界", "suggestions": []}"#;
        let result = parse_response(json, "привет мир").unwrap();
        assert!(result.text.contains("Привет"));
        assert!(result.text.contains("你好"));
    }

    #[test]
    fn test_parse_response_emoji_content() {
        let json = r#"{"text": "Hello 👋 World 🌍", "suggestions": []}"#;
        let result = parse_response(json, "hello world").unwrap();
        assert!(result.text.contains("👋"));
    }

    #[test]
    fn test_parse_response_very_long_text() {
        let long_text = "a".repeat(10000);
        let json = format!(r#"{{"text": "{}", "suggestions": []}}"#, long_text);
        let result = parse_response(&json, &long_text).unwrap();
        assert_eq!(result.text.len(), 10000);
    }

    #[test]
    fn test_parse_response_many_suggestions() {
        let suggestions: Vec<String> = (0..100)
            .map(|i| format!(r#"{{"source": "word{}", "replacement": "WORD{}"}}"#, i, i))
            .collect();
        let json = format!(
            r#"{{"text": "test", "suggestions": [{}]}}"#,
            suggestions.join(",")
        );
        let original = (0..100)
            .map(|i| format!("word{}", i))
            .collect::<Vec<_>>()
            .join(" ");

        let result = parse_response(&json, &original).unwrap();
        assert_eq!(result.suggestions.len(), 100);
    }

    #[test]
    fn test_parse_response_special_characters_in_text() {
        let json = r#"{"text": "Hello \"quoted\" text with \n newlines", "suggestions": []}"#;
        let result = parse_response(json, "hello quoted text").unwrap();
        assert!(result.text.contains("quoted"));
    }

    #[test]
    fn test_validate_case_insensitive_match() {
        let result = LlmResult {
            text: "Hello".to_string(),
            suggestions: vec![DictionarySuggestion {
                source: "HELLO".to_string(),
                replacement: "Hello".to_string(),
            }],
        };
        let validated = validate_result(result, "hello world");
        assert_eq!(validated.suggestions.len(), 1);
    }
}
