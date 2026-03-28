use crate::config::AppConfig;

/// Validate API key configuration.
pub fn validate_config(config: &AppConfig) -> Result<(), &'static str> {
    if config.api_key.is_empty() {
        return Err("API key not configured");
    }
    Ok(())
}
