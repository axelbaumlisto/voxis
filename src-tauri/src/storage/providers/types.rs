use serde::{Deserialize, Serialize};

/// A model available for an LLM provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmModel {
    pub id: String,
    pub name: String,
}

/// An LLM provider configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub api_url: String,
    pub models: Vec<LlmModel>,
    pub default_model: String,
    #[serde(default)]
    pub builtin: bool,
}
