//! Config validation (from Python soupawhisper/config.py).
//!
//! DRY: Uses helper functions for common validation patterns.

use super::{
    AppConfig, COMBO_KEYS, VALID_BACKENDS, VALID_LANGUAGES, VALID_LEARNING_MODES, VALID_MODIFIERS,
    VALID_OVERLAY_POSITIONS, VALID_OVERLAY_SIZES, VALID_SINGLE_HOTKEYS,
};

// =============================================================================
// DRY Validation Helpers
// =============================================================================

/// Validate that a value is within a valid choices list.
/// Returns Some(ValidationError) if invalid, None if valid.
fn validate_choice(field: &str, value: &str, choices: &[&str]) -> Option<ValidationError> {
    (!choices.contains(&value)).then(|| ValidationError {
        field: field.into(),
        message: format!("Invalid {} '{}'", field, value),
    })
}

/// Validate that a value is within a range (min..=max).
/// Returns Some(ValidationError) if invalid, None if valid.
fn validate_range(field: &str, value: u32, min: u32, max: u32) -> Option<ValidationError> {
    (value < min || value > max).then(|| ValidationError {
        field: field.into(),
        message: format!("{} must be {}-{}, got {}", field, min, max, value),
    })
}

/// Validate that a value does not exceed a maximum.
/// Returns Some(ValidationError) if invalid, None if valid.
fn validate_max(field: &str, value: u32, max: u32) -> Option<ValidationError> {
    (value > max).then(|| ValidationError {
        field: field.into(),
        message: format!("{} must be 0-{}, got {}", field, max, value),
    })
}

/// Validate that a value is either `0` (a sentinel meaning "disabled") or
/// within a range (min..=max). DRY: `validate_range` has no "0 = exempt"
/// shape, and the recording-guard fields (`silence_timeout_ms`,
/// `max_recording_ms`) both need it — one helper instead of duplicating
/// the exemption check at each call site.
/// Returns Some(ValidationError) if invalid, None if valid.
fn validate_zero_or_range(field: &str, value: u32, min: u32, max: u32) -> Option<ValidationError> {
    (value != 0 && (value < min || value > max)).then(|| ValidationError {
        field: field.into(),
        message: format!(
            "{} must be 0 (disabled) or {}-{}, got {}",
            field, min, max, value
        ),
    })
}

/// Check if hotkey string is valid.
///
/// Supports:
/// - Single keys: "ctrl_r", "f12", "space"
/// - Combo keys: "ctrl+a", "alt+1", "shift+f1"
pub fn is_valid_hotkey(hotkey: &str) -> bool {
    // Check if it's a valid single hotkey
    if VALID_SINGLE_HOTKEYS.contains(&hotkey) {
        return true;
    }

    // Check for combo hotkey (modifier+key)
    if let Some((modifier, key)) = hotkey.split_once('+') {
        if !VALID_MODIFIERS.contains(&modifier) {
            return false;
        }
        // Key can be a single char or a valid single hotkey
        if key.len() == 1 && COMBO_KEYS.contains(key) {
            return true;
        }
        if VALID_SINGLE_HOTKEYS.contains(&key) {
            return true;
        }
    }

    false
}

/// Validation error for config.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.field, self.message)
    }
}

/// Validate configuration values.
///
/// Returns list of validation errors (empty if valid).
/// DRY: Uses validate_choice, validate_range, validate_max helpers.
pub fn validate_config(config: &AppConfig) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    // Choice validations
    errors.extend(validate_choice(
        "language",
        &config.language,
        VALID_LANGUAGES,
    ));
    errors.extend(validate_choice("backend", &config.backend, VALID_BACKENDS));
    errors.extend(validate_choice(
        "dictionary.learning_mode",
        &config.dictionary.learning_mode,
        VALID_LEARNING_MODES,
    ));
    errors.extend(validate_choice(
        "overlay.position",
        &config.overlay.position,
        VALID_OVERLAY_POSITIONS,
    ));
    errors.extend(validate_choice(
        "overlay.size",
        &config.overlay.size,
        VALID_OVERLAY_SIZES,
    ));

    // Range validations
    errors.extend(validate_max("typing_delay", config.typing_delay, 1000));
    errors.extend(validate_range("history_days", config.history_days, 1, 365));
    errors.extend(validate_range(
        "dictionary.learning_threshold",
        config.dictionary.learning_threshold,
        1,
        100,
    ));

    // Recording guard (Layer 5): 0 = disabled, else must be in range.
    errors.extend(validate_zero_or_range(
        "silence_timeout_ms",
        config.silence_timeout_ms,
        5_000,
        300_000,
    ));
    errors.extend(validate_zero_or_range(
        "max_recording_ms",
        config.max_recording_ms,
        10_000,
        super::MAX_RECORDING_MS_CEILING,
    ));

    // Hotkey validation (custom logic)
    if !is_valid_hotkey(&config.hotkey) {
        errors.push(ValidationError {
            field: "hotkey".into(),
            message: format!("Invalid hotkey '{}'", config.hotkey),
        });
    }

    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // Hotkey validation tests
    // =========================================================================

    #[test]
    fn test_valid_single_hotkeys() {
        assert!(is_valid_hotkey("ctrl_r"));
        assert!(is_valid_hotkey("ctrl_l"));
        assert!(is_valid_hotkey("alt_r"));
        assert!(is_valid_hotkey("f12"));
        assert!(is_valid_hotkey("f1"));
        assert!(is_valid_hotkey("space"));
        assert!(is_valid_hotkey("escape"));
    }

    #[test]
    fn test_valid_combo_hotkeys() {
        assert!(is_valid_hotkey("ctrl+a"));
        assert!(is_valid_hotkey("alt+1"));
        assert!(is_valid_hotkey("shift+z"));
        assert!(is_valid_hotkey("super+q"));
        assert!(is_valid_hotkey("ctrl+f1"));
        assert!(is_valid_hotkey("alt+space"));
    }

    #[test]
    fn test_invalid_hotkeys() {
        assert!(!is_valid_hotkey(""));
        assert!(!is_valid_hotkey("invalid"));
        assert!(!is_valid_hotkey("ctrl+")); // missing key
        assert!(!is_valid_hotkey("+a")); // missing modifier
        assert!(!is_valid_hotkey("win+a")); // invalid modifier
        assert!(!is_valid_hotkey("ctrl+!")); // invalid combo key
    }

    // =========================================================================
    // Config validation tests
    // =========================================================================

    #[test]
    fn test_valid_config() {
        let config = AppConfig::default();
        let errors = validate_config(&config);
        assert!(
            errors.is_empty(),
            "Default config should be valid: {:?}",
            errors
        );
    }

    /// DRY helper: build a config with one invalid field via a mutator,
    /// validate, and assert exactly one error on the expected field.
    fn assert_single_error<F: FnOnce(&mut AppConfig)>(mutator: F, expected_field: &str) {
        let mut config = AppConfig::default();
        mutator(&mut config);
        let errors = validate_config(&config);
        assert_eq!(errors.len(), 1, "expected 1 error, got {:?}", errors);
        assert_eq!(errors[0].field, expected_field);
    }

    #[test]
    fn test_invalid_language() {
        assert_single_error(|c| c.language = "invalid".into(), "language");
    }

    #[test]
    fn test_invalid_backend() {
        assert_single_error(|c| c.backend = "invalid".into(), "backend");
    }

    #[test]
    fn test_invalid_hotkey_config() {
        assert_single_error(|c| c.hotkey = "invalid_key".into(), "hotkey");
    }

    #[test]
    fn test_invalid_typing_delay() {
        assert_single_error(|c| c.typing_delay = 2000, "typing_delay");
    }

    #[test]
    fn test_invalid_history_days_zero() {
        assert_single_error(|c| c.history_days = 0, "history_days");
    }

    #[test]
    fn test_invalid_history_days_too_large() {
        assert_single_error(|c| c.history_days = 500, "history_days");
    }

    #[test]
    fn test_invalid_overlay_position() {
        assert_single_error(
            |c| c.overlay.position = "invalid".into(),
            "overlay.position",
        );
    }

    #[test]
    fn test_invalid_overlay_size() {
        assert_single_error(|c| c.overlay.size = "huge".into(), "overlay.size");
    }

    #[test]
    fn test_multiple_errors() {
        let config = AppConfig {
            language: "invalid".into(),
            backend: "invalid".into(),
            hotkey: "invalid".into(),
            ..AppConfig::default()
        };
        let errors = validate_config(&config);
        assert_eq!(errors.len(), 3);
    }

    // =========================================================================
    // DRY Helper tests
    // =========================================================================

    #[test]
    fn test_validate_choice_valid() {
        let result = validate_choice("field", "valid", &["valid", "other"]);
        assert!(result.is_none());
    }

    #[test]
    fn test_validate_choice_invalid() {
        let result = validate_choice("field", "invalid", &["valid", "other"]);
        assert!(result.is_some());
        let err = result.unwrap();
        assert_eq!(err.field, "field");
        assert!(err.message.contains("invalid"));
    }

    #[test]
    fn test_validate_range_valid() {
        assert!(validate_range("field", 5, 1, 10).is_none());
        assert!(validate_range("field", 1, 1, 10).is_none()); // min edge
        assert!(validate_range("field", 10, 1, 10).is_none()); // max edge
    }

    #[test]
    fn test_validate_range_invalid() {
        let below = validate_range("field", 0, 1, 10);
        assert!(below.is_some());

        let above = validate_range("field", 11, 1, 10);
        assert!(above.is_some());
    }

    #[test]
    fn test_validate_max_valid() {
        assert!(validate_max("field", 0, 100).is_none());
        assert!(validate_max("field", 50, 100).is_none());
        assert!(validate_max("field", 100, 100).is_none()); // edge
    }

    #[test]
    fn test_validate_max_invalid() {
        let result = validate_max("field", 101, 100);
        assert!(result.is_some());
        let err = result.unwrap();
        assert_eq!(err.field, "field");
        assert!(err.message.contains("101"));
    }

    #[test]
    fn test_validate_zero_or_range_zero_is_exempt() {
        assert!(validate_zero_or_range("field", 0, 5_000, 300_000).is_none());
    }

    #[test]
    fn test_validate_zero_or_range_in_range_valid() {
        assert!(validate_zero_or_range("field", 5_000, 5_000, 300_000).is_none()); // min edge
        assert!(validate_zero_or_range("field", 300_000, 5_000, 300_000).is_none()); // max edge
        assert!(validate_zero_or_range("field", 60_000, 5_000, 300_000).is_none());
    }

    #[test]
    fn test_validate_zero_or_range_out_of_range_invalid() {
        assert!(validate_zero_or_range("field", 4_999, 5_000, 300_000).is_some());
        assert!(validate_zero_or_range("field", 300_001, 5_000, 300_000).is_some());
    }

    // =========================================================================
    // Layer 5 test 24: recording-guard config validation
    // =========================================================================

    #[test]
    fn test_silence_timeout_ms_zero_disabled_is_valid() {
        let config = AppConfig {
            silence_timeout_ms: 0,
            ..AppConfig::default()
        };
        assert!(validate_config(&config).is_empty());
    }

    #[test]
    fn test_silence_timeout_ms_below_min_rejected() {
        assert_single_error(|c| c.silence_timeout_ms = 4_999, "silence_timeout_ms");
    }

    #[test]
    fn test_silence_timeout_ms_above_max_rejected() {
        assert_single_error(|c| c.silence_timeout_ms = 300_001, "silence_timeout_ms");
    }

    #[test]
    fn test_silence_timeout_ms_in_range_valid() {
        let config = AppConfig {
            silence_timeout_ms: 60_000,
            ..AppConfig::default()
        };
        assert!(validate_config(&config).is_empty());
    }

    #[test]
    fn test_max_recording_ms_zero_disabled_is_valid() {
        let config = AppConfig {
            max_recording_ms: 0,
            ..AppConfig::default()
        };
        assert!(validate_config(&config).is_empty());
    }

    #[test]
    fn test_max_recording_ms_below_min_rejected() {
        assert_single_error(|c| c.max_recording_ms = 9_999, "max_recording_ms");
    }

    #[test]
    fn test_max_recording_ms_above_ceiling_rejected() {
        assert_single_error(|c| c.max_recording_ms = 780_001, "max_recording_ms");
    }

    #[test]
    fn test_max_recording_ms_in_range_valid() {
        let config = AppConfig {
            max_recording_ms: 600_000,
            ..AppConfig::default()
        };
        assert!(validate_config(&config).is_empty());
    }

    #[test]
    fn test_validation_error_display() {
        let err = ValidationError {
            field: "test_field".into(),
            message: "test message".into(),
        };
        let display = format!("{}", err);
        assert!(display.contains("test_field"));
        assert!(display.contains("test message"));
    }
}
