use super::*;
use tempfile::NamedTempFile;

fn create_storage() -> ProvidersStorage {
    let file = NamedTempFile::new().unwrap();
    ProvidersStorage::new(file.path().to_path_buf())
}

#[test]
fn test_connect_creates_schema() {
    let file = NamedTempFile::new().unwrap();
    let storage = ProvidersStorage::new(file.path().to_path_buf());

    let providers = storage.get_all().unwrap();
    assert!(!providers.is_empty());

    let providers2 = storage.get_all().unwrap();
    assert_eq!(providers.len(), providers2.len());
}

#[test]
fn test_llm_model_struct() {
    let model = LlmModel {
        id: "test-model-id".into(),
        name: "Test Model Name".into(),
    };

    assert_eq!(model.id, "test-model-id");
    assert_eq!(model.name, "Test Model Name");

    let json = serde_json::to_string(&model).unwrap();
    assert!(json.contains("test-model-id"));
    assert!(json.contains("Test Model Name"));
}

#[test]
fn test_provider_empty_models() {
    let storage = create_storage();

    let custom = LlmProvider {
        id: "empty-models".into(),
        name: "Empty Models".into(),
        api_url: "https://example.com".into(),
        models: vec![],
        default_model: "".into(),
        builtin: false,
    };

    storage.add(&custom).unwrap();
    let retrieved = storage.get("empty-models").unwrap().unwrap();

    assert!(retrieved.models.is_empty());
    assert_eq!(retrieved.default_model, "");
}

#[test]
fn test_default_providers_have_models() {
    let storage = create_storage();

    let groq = storage.get("groq").unwrap().unwrap();
    assert!(!groq.models.is_empty());
    assert!(!groq.default_model.is_empty());

    let openai = storage.get("openai").unwrap().unwrap();
    assert!(!openai.models.is_empty());
    assert!(!openai.default_model.is_empty());
}

#[test]
fn test_add_duplicate_provider_id() {
    let storage = create_storage();

    let custom = LlmProvider {
        id: "duplicate".into(),
        name: "First".into(),
        api_url: "https://first.api".into(),
        models: vec![],
        default_model: "".into(),
        builtin: false,
    };
    storage.add(&custom).unwrap();

    let duplicate = LlmProvider {
        id: "duplicate".into(),
        name: "Second".into(),
        api_url: "https://second.api".into(),
        models: vec![],
        default_model: "".into(),
        builtin: false,
    };
    let result = storage.add(&duplicate);

    assert!(result.is_err());
}

#[test]
fn test_update_nonexistent_provider() {
    let storage = create_storage();

    let provider = LlmProvider {
        id: "does_not_exist".into(),
        name: "Nonexistent".into(),
        api_url: "https://fake.api".into(),
        models: vec![],
        default_model: "".into(),
        builtin: false,
    };

    let result = storage.update(&provider);
    assert!(result.is_ok());

    let retrieved = storage.get("does_not_exist").unwrap();
    assert!(retrieved.is_none());
}

#[test]
fn test_remove_builtin_provider_fails() {
    let storage = create_storage();

    for id in &["groq", "openai", "openrouter"] {
        let result = storage.remove(id);
        assert!(
            result.is_err(),
            "Should fail to remove builtin provider {}",
            id
        );

        let provider = storage.get(id).unwrap();
        assert!(
            provider.is_some(),
            "Builtin provider {} should still exist",
            id
        );
    }
}

#[test]
fn test_provider_with_empty_models() {
    let storage = create_storage();

    let empty = LlmProvider {
        id: "empty-models-test".into(),
        name: "Empty Models Provider".into(),
        api_url: "https://empty.api".into(),
        models: vec![],
        default_model: "".into(),
        builtin: false,
    };

    storage.add(&empty).unwrap();
    let retrieved = storage.get("empty-models-test").unwrap().unwrap();

    assert!(retrieved.models.is_empty());
    assert!(retrieved.default_model.is_empty());
}

#[test]
fn test_provider_invalid_default_model() {
    let storage = create_storage();

    let provider = LlmProvider {
        id: "invalid-default".into(),
        name: "Invalid Default".into(),
        api_url: "https://test.api".into(),
        models: vec![LlmModel {
            id: "model-a".into(),
            name: "Model A".into(),
        }],
        default_model: "nonexistent-model".into(),
        builtin: false,
    };

    // Should still save (validation is frontend concern)
    storage.add(&provider).unwrap();
    let retrieved = storage.get("invalid-default").unwrap().unwrap();

    assert_eq!(retrieved.default_model, "nonexistent-model");
    assert_eq!(retrieved.models.len(), 1);
}

#[test]
fn test_list_providers_sorted() {
    let storage = create_storage();

    let custom1 = LlmProvider {
        id: "zzz-last".into(),
        name: "ZZZ Last".into(),
        api_url: "https://z.api".into(),
        models: vec![],
        default_model: "".into(),
        builtin: false,
    };
    let custom2 = LlmProvider {
        id: "aaa-first".into(),
        name: "AAA First".into(),
        api_url: "https://a.api".into(),
        models: vec![],
        default_model: "".into(),
        builtin: false,
    };

    storage.add(&custom1).unwrap();
    storage.add(&custom2).unwrap();

    let providers = storage.get_all().unwrap();

    let builtin_count = providers.iter().filter(|p| p.builtin).count();
    for (i, provider) in providers.iter().enumerate() {
        if i < builtin_count {
            assert!(
                provider.builtin,
                "First {} should be builtin",
                builtin_count
            );
        } else {
            assert!(!provider.builtin, "Non-builtin should come after builtin");
        }
    }

    let custom_names: Vec<_> = providers
        .iter()
        .filter(|p| !p.builtin)
        .map(|p| p.name.as_str())
        .collect();
    let mut sorted_names = custom_names.clone();
    sorted_names.sort();
    assert_eq!(custom_names, sorted_names);
}
