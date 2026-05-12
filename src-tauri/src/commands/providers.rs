//! LLM provider-related Tauri commands.

use crate::error::BoxedIntoCommandError;
use crate::storage::{AppPaths, LlmProvider};
use tauri::State;

use super::get_factory;

/// Get all LLM providers.
#[tauri::command]
#[specta::specta]
pub fn get_llm_providers(paths: State<AppPaths>) -> Result<Vec<LlmProvider>, String> {
    get_factory(&paths).providers().get_all().cmd_err()
}

/// Add a new LLM provider.
#[tauri::command]
#[specta::specta]
pub fn add_llm_provider(provider: LlmProvider, paths: State<AppPaths>) -> Result<(), String> {
    get_factory(&paths).providers().add(&provider).cmd_err()
}

/// Remove an LLM provider (only non-builtin).
#[tauri::command]
#[specta::specta]
pub fn remove_llm_provider(id: String, paths: State<AppPaths>) -> Result<(), String> {
    get_factory(&paths).providers().remove(&id).cmd_err()?;
    Ok(())
}

/// Update an existing LLM provider.
#[tauri::command]
#[specta::specta]
pub fn update_llm_provider(provider: LlmProvider, paths: State<AppPaths>) -> Result<(), String> {
    get_factory(&paths).providers().update(&provider).cmd_err()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{test_utils::create_temp_paths, LlmModel};

    #[test]
    fn test_get_providers_returns_builtins() {
        let (_temp_dir, paths) = create_temp_paths();
        let factory = crate::storage::StorageFactory::new(paths);
        let providers = factory.providers().get_all().unwrap();
        // Should have built-in providers (groq, openai)
        assert!(!providers.is_empty());
    }

    #[test]
    fn test_add_custom_provider() {
        let (_temp_dir, paths) = create_temp_paths();
        let factory = crate::storage::StorageFactory::new(paths);

        let provider = LlmProvider {
            id: "custom_test".to_string(),
            name: "Custom Test Provider".to_string(),
            api_url: "https://api.test.com".to_string(),
            models: vec![LlmModel {
                id: "model-1".to_string(),
                name: "Model 1".to_string(),
            }],
            default_model: "model-1".to_string(),
            builtin: false,
        };

        factory.providers().add(&provider).unwrap();
        let all = factory.providers().get_all().unwrap();
        assert!(all.iter().any(|p| p.id == "custom_test"));
    }

    #[test]
    fn test_remove_custom_provider() {
        let (_temp_dir, paths) = create_temp_paths();
        let factory = crate::storage::StorageFactory::new(paths);

        let provider = LlmProvider {
            id: "to_remove".to_string(),
            name: "To Remove".to_string(),
            api_url: "https://api.test.com".to_string(),
            models: vec![],
            default_model: String::new(),
            builtin: false,
        };

        factory.providers().add(&provider).unwrap();
        factory.providers().remove("to_remove").unwrap();
        let all = factory.providers().get_all().unwrap();
        assert!(!all.iter().any(|p| p.id == "to_remove"));
    }

    #[test]
    fn test_llm_provider_struct() {
        let provider = LlmProvider {
            id: "test".to_string(),
            name: "Test".to_string(),
            api_url: "https://api.example.com".to_string(),
            models: vec![
                LlmModel {
                    id: "gpt-4".to_string(),
                    name: "GPT-4".to_string(),
                },
                LlmModel {
                    id: "gpt-3.5".to_string(),
                    name: "GPT-3.5".to_string(),
                },
            ],
            default_model: "gpt-4".to_string(),
            builtin: false,
        };

        assert_eq!(provider.id, "test");
        assert_eq!(provider.models.len(), 2);
        assert!(!provider.builtin);
    }
}
