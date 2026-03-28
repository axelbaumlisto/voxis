use super::*;
use tempfile::NamedTempFile;

fn create_storage() -> ProvidersStorage {
    let file = NamedTempFile::new().unwrap();
    ProvidersStorage::new(file.path().to_path_buf())
}

#[test]
fn test_default_providers_loaded() {
    let storage = create_storage();
    let providers = storage.get_all().unwrap();

    assert!(providers.len() >= 3);
    assert!(providers.iter().any(|p| p.id == "groq"));
    assert!(providers.iter().any(|p| p.id == "openai"));
    assert!(providers.iter().any(|p| p.id == "openrouter"));
}

#[test]
fn test_get_provider() {
    let storage = create_storage();

    let groq = storage.get("groq").unwrap();
    assert!(groq.is_some());
    let groq = groq.unwrap();
    assert_eq!(groq.name, "Groq");
    assert!(groq.builtin);
    assert!(!groq.models.is_empty());
}

#[test]
fn test_add_custom_provider() {
    let storage = create_storage();

    let custom = LlmProvider {
        id: "custom".into(),
        name: "Custom Provider".into(),
        api_url: "https://custom.api/v1/chat".into(),
        models: vec![LlmModel {
            id: "custom-model".into(),
            name: "Custom Model".into(),
        }],
        default_model: "custom-model".into(),
        builtin: false,
    };

    storage.add(&custom).unwrap();

    let providers = storage.get_all().unwrap();
    assert!(providers.iter().any(|p| p.id == "custom"));

    let retrieved = storage.get("custom").unwrap().unwrap();
    assert!(!retrieved.builtin);
    assert_eq!(retrieved.name, "Custom Provider");
}

#[test]
fn test_remove_custom_provider() {
    let storage = create_storage();

    let custom = LlmProvider {
        id: "to_remove".into(),
        name: "To Remove".into(),
        api_url: "https://example.com".into(),
        models: vec![],
        default_model: "".into(),
        builtin: false,
    };

    storage.add(&custom).unwrap();
    assert!(storage.get("to_remove").unwrap().is_some());

    let removed = storage.remove("to_remove").unwrap();
    assert!(removed);

    assert!(storage.get("to_remove").unwrap().is_none());
}

#[test]
fn test_cannot_remove_builtin() {
    let storage = create_storage();

    let result = storage.remove("groq");
    assert!(result.is_err());
}

#[test]
fn test_provider_serialize_deserialize() {
    let provider = LlmProvider {
        id: "test-provider".into(),
        name: "Test Provider".into(),
        api_url: "https://test.api/v1".into(),
        models: vec![LlmModel {
            id: "model-a".into(),
            name: "Model A".into(),
        }],
        default_model: "model-a".into(),
        builtin: false,
    };

    let json = serde_json::to_string(&provider).unwrap();
    let deserialized: LlmProvider = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.id, "test-provider");
    assert_eq!(deserialized.name, "Test Provider");
    assert_eq!(deserialized.models.len(), 1);
}

#[test]
fn test_provider_with_multiple_models() {
    let storage = create_storage();

    let custom = LlmProvider {
        id: "multi-model".into(),
        name: "Multi Model Provider".into(),
        api_url: "https://multi.api".into(),
        models: vec![
            LlmModel {
                id: "m1".into(),
                name: "Model 1".into(),
            },
            LlmModel {
                id: "m2".into(),
                name: "Model 2".into(),
            },
            LlmModel {
                id: "m3".into(),
                name: "Model 3".into(),
            },
        ],
        default_model: "m2".into(),
        builtin: false,
    };

    storage.add(&custom).unwrap();
    let retrieved = storage.get("multi-model").unwrap().unwrap();

    assert_eq!(retrieved.models.len(), 3);
    assert_eq!(retrieved.default_model, "m2");
}

#[test]
fn test_update_existing_provider() {
    let storage = create_storage();

    let custom = LlmProvider {
        id: "updatable".into(),
        name: "Original Name".into(),
        api_url: "https://original.api".into(),
        models: vec![],
        default_model: "".into(),
        builtin: false,
    };
    storage.add(&custom).unwrap();

    let updated = LlmProvider {
        id: "updatable".into(),
        name: "Updated Name".into(),
        api_url: "https://updated.api".into(),
        models: vec![LlmModel {
            id: "new-model".into(),
            name: "New Model".into(),
        }],
        default_model: "new-model".into(),
        builtin: false,
    };
    storage.update(&updated).unwrap();

    let retrieved = storage.get("updatable").unwrap().unwrap();
    assert_eq!(retrieved.name, "Updated Name");
    assert_eq!(retrieved.api_url, "https://updated.api");
    assert_eq!(retrieved.models.len(), 1);
}

#[test]
fn test_get_nonexistent_provider() {
    let storage = create_storage();
    let result = storage.get("nonexistent").unwrap();
    assert!(result.is_none());
}

#[test]
fn test_remove_nonexistent_provider() {
    let storage = create_storage();
    let result = storage.remove("nonexistent").unwrap();
    assert!(!result);
}

#[test]
fn test_builtin_providers_are_marked() {
    let storage = create_storage();
    let providers = storage.get_all().unwrap();

    for provider in &providers {
        if ["groq", "openai", "openrouter"].contains(&provider.id.as_str()) {
            assert!(
                provider.builtin,
                "Provider {} should be builtin",
                provider.id
            );
        }
    }
}
