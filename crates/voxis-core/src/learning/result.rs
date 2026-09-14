//! Suggestion result types.

/// Result of processing a suggestion.
#[derive(Debug, Clone)]
pub enum SuggestionResult {
    /// Suggestion was ignored (disabled mode or invalid)
    Ignored,
    /// Suggestion was recorded (pending or auto mode)
    Recorded { count: u32 },
    /// Suggestion was automatically promoted to dictionary
    Promoted { source: String, replacement: String },
    /// Suggestion already exists in dictionary
    AlreadyInDictionary,
    /// Suggestion was previously rejected
    PreviouslyRejected,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_suggestion_result_ignored() {
        let result = SuggestionResult::Ignored;
        assert!(matches!(result, SuggestionResult::Ignored));
    }

    #[test]
    fn test_suggestion_result_recorded() {
        let result = SuggestionResult::Recorded { count: 5 };
        if let SuggestionResult::Recorded { count } = result {
            assert_eq!(count, 5);
        } else {
            panic!("Expected Recorded variant");
        }
    }

    #[test]
    fn test_suggestion_result_promoted() {
        let result = SuggestionResult::Promoted {
            source: "solid".to_string(),
            replacement: "SOLID".to_string(),
        };
        if let SuggestionResult::Promoted {
            source,
            replacement,
        } = result
        {
            assert_eq!(source, "solid");
            assert_eq!(replacement, "SOLID");
        } else {
            panic!("Expected Promoted variant");
        }
    }

    #[test]
    fn test_suggestion_result_clone() {
        let result = SuggestionResult::Recorded { count: 3 };
        let cloned = result.clone();
        if let SuggestionResult::Recorded { count } = cloned {
            assert_eq!(count, 3);
        } else {
            panic!("Clone failed");
        }
    }

    #[test]
    fn test_suggestion_result_already_in_dictionary() {
        let result = SuggestionResult::AlreadyInDictionary;
        assert!(matches!(result, SuggestionResult::AlreadyInDictionary));
    }

    #[test]
    fn test_suggestion_result_previously_rejected() {
        let result = SuggestionResult::PreviouslyRejected;
        assert!(matches!(result, SuggestionResult::PreviouslyRejected));
    }
}
