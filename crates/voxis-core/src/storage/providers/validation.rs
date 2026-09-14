use super::types::LlmModel;

/// Deserialize provider models from DB JSON.
///
/// Keeps backward-compatible behavior: invalid JSON is treated as empty models.
pub fn parse_models_json(models_json: &str) -> Vec<LlmModel> {
    serde_json::from_str(models_json).unwrap_or_default()
}

/// Prevent deleting builtin providers.
pub fn ensure_provider_removable(builtin: i32) -> Result<(), Box<dyn std::error::Error>> {
    if builtin != 0 {
        return Err("Cannot remove builtin provider".into());
    }
    Ok(())
}
