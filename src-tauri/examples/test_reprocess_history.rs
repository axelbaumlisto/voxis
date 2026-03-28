//! E2E test for batch processing history through LLM.
//! Tests the BATCH_SUGGESTIONS_PROMPT which analyzes all history at once.
//!
//! Run with real history: cargo run --example test_reprocess_history -- --real
//! Run with test data:    cargo run --example test_reprocess_history

use std::env;
use std::path::PathBuf;
use voice_lib::storage::history_sqlite::HistoryEntry;

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt().with_env_filter("warn").init();

    let args: Vec<String> = env::args().collect();
    let use_real_history = args.iter().any(|a| a == "--real");

    if use_real_history {
        test_with_real_history().await;
    } else {
        test_with_mock_history().await;
    }
}

async fn test_with_real_history() {
    println!("=== Testing with REAL history ===\n");

    let config_dir = PathBuf::from(env::var("HOME").unwrap()).join(".config/soupawhisper");

    let history_path = config_dir.join("history.db");
    let config_path = config_dir.join("config.db");

    // Load config
    let config_storage = voice_lib::storage::ConfigSqliteStorage::new(config_path);
    let config = config_storage.load().expect("Failed to load config");

    if config.llm.api_key.is_empty() {
        println!("ERROR: LLM API key not configured in settings");
        return;
    }
    println!(
        "API key: {}...",
        &config.llm.api_key[..15.min(config.llm.api_key.len())]
    );
    // Force 70b model for better results
    let mut config = config;
    config.llm.model = "llama-3.3-70b-versatile".to_string();
    println!("Model: {} (forced for batch analysis)", config.llm.model);

    // Load ALL history
    let history_storage = voice_lib::storage::HistorySqliteStorage::new(history_path);
    let entries = history_storage
        .load(Some(10000))
        .expect("Failed to load history");

    println!("Loaded {} history entries\n", entries.len());
    if entries.is_empty() {
        println!("No history entries found");
        return;
    }

    // Show some entries
    println!("Sample entries:");
    for (i, entry) in entries.iter().take(5).enumerate() {
        let text: String = entry.text.chars().take(60).collect();
        let suffix = if entry.text.chars().count() > 60 {
            "..."
        } else {
            ""
        };
        println!("  {}: {}{}", i + 1, text, suffix);
    }

    // Process
    process_entries(&entries, &config).await;
}

async fn test_with_mock_history() {
    println!("=== Testing with MOCK history ===\n");

    // Setup temp files
    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let history_path = temp_dir.path().join("history.db");

    // Create mock history
    let history_storage = voice_lib::storage::HistorySqliteStorage::new(history_path);
    history_storage
        .add(
            "Нужно использовать принципы солид и драй",
            Some("ru"),
            Some(2.0),
        )
        .expect("Failed to add entry");
    history_storage
        .add("Напиши тесты используя ТДД подход", Some("ru"), Some(1.5))
        .expect("Failed to add entry");
    history_storage
        .add("Принцип кисс очень важен для докера", Some("ru"), Some(1.0))
        .expect("Failed to add entry");

    println!("Created 3 mock history entries\n");

    let entries = history_storage.load(None).expect("Failed to load");

    // Get API key
    let api_key = match env::var("GROQ_API_KEY") {
        Ok(key) => key,
        Err(_) => {
            // Try to load from config
            let config_dir = PathBuf::from(env::var("HOME").unwrap()).join(".config/soupawhisper");
            let config_storage =
                voice_lib::storage::ConfigSqliteStorage::new(config_dir.join("config.db"));
            match config_storage.load() {
                Ok(c) if !c.llm.api_key.is_empty() => c.llm.api_key,
                _ => {
                    println!("ERROR: No API key found");
                    println!("Set GROQ_API_KEY or configure in app settings");
                    return;
                }
            }
        }
    };

    let config = voice_lib::config::AppConfig {
        llm: voice_lib::config::LlmConfig {
            api_key,
            model: "llama-3.3-70b-versatile".to_string(),
            ..Default::default()
        },
        ..Default::default()
    };

    process_entries(&entries, &config).await;
}

async fn process_entries(entries: &[HistoryEntry], config: &voice_lib::config::AppConfig) {
    // Collect texts
    let texts: Vec<&str> = entries.iter().map(|e| e.text.as_str()).collect();
    let batch_input = serde_json::to_string(&texts).expect("Failed to serialize");

    println!("\n=== Calling LLM ({} entries) ===\n", entries.len());

    // Create LLM processor with BATCH prompt
    let llm = voice_lib::llm::LlmProcessor::new(voice_lib::llm::LlmConfig {
        api_url: voice_lib::config::GROQ_CHAT_URL.to_string(),
        api_key: config.llm.api_key.clone(),
        model: config.llm.model.clone(),
        prompt: voice_lib::config::BATCH_SUGGESTIONS_PROMPT.to_string(),
    });

    let result = match llm.process(&batch_input).await {
        Ok(r) => r,
        Err(e) => {
            println!("ERROR: LLM call failed: {}", e);
            return;
        }
    };

    println!(
        "=== LLM found {} suggestions ===\n",
        result.suggestions.len()
    );

    if result.suggestions.is_empty() {
        println!("No tech terms found in history.");
        println!("Try adding transcriptions with terms like:");
        println!("  - солид, драй, кисс (SOLID, DRY, KISS)");
        println!("  - докер, кубер (Docker, Kubernetes)");
        println!("  - реакт, вью (React, Vue)");
        return;
    }

    for s in &result.suggestions {
        println!("  {} → {}", s.source, s.replacement);
    }

    // Save to corrections DB
    let config_dir = PathBuf::from(env::var("HOME").unwrap()).join(".config/soupawhisper");
    let corrections_path = config_dir.join("corrections.db");
    let dictionary_path = config_dir.join("dictionary.txt");

    let corrections_storage = voice_lib::storage::CorrectionsSqliteStorage::new(corrections_path);
    let dictionary_storage = voice_lib::storage::DictionaryStorage::new(dictionary_path);
    let tracker = voice_lib::learning::CorrectionTracker::new(
        voice_lib::learning::LearningMode::Pending,
        config.dictionary.learning_threshold,
        Box::new(corrections_storage),
        Box::new(dictionary_storage),
    );

    println!("\n=== Saving to pending suggestions ===\n");
    let mut saved = 0;
    for s in &result.suggestions {
        match tracker.on_suggestion(s) {
            Ok(r) => {
                println!("  {} → {}: {:?}", s.source, s.replacement, r);
                saved += 1;
            }
            Err(e) => println!("  {} → {}: ERROR {}", s.source, s.replacement, e),
        }
    }

    println!("\n=== Done! Saved {} suggestions ===", saved);
}
