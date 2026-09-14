//! Data-gate test (Task 1a Acceptance #7 / plan "Гейты консистентности" #6,
//! `[R1-Safety T5]`).
//!
//! Loads a STATIC, committed pre-Task-1a fixture (`fixtures/pre_t1/*.sql` +
//! `dictionary.fixture.txt` — real `sqlite3 .dump` output, synthetic values, no real
//! user data) with the post-move `voxis_core::storage` reader code, then
//! asserts every loaded value equals a golden JSON committed next to this
//! file (`data_gate_golden.json`).
//!
//! Why a static fixture and not a same-code round-trip: a round-trip test
//! (post-move writer writes, post-move reader reads back) passes even if a
//! kv key gets silently renamed in BOTH the writer and the reader by the
//! same refactor — it can never detect a writer/reader format drift because
//! both sides moved together. Loading a fixture that was captured once and
//! frozen means the reader must still speak the exact on-disk dialect a
//! real v0.1.5-era install has on disk today, independent of whatever the
//! current writer does. See `fixtures/pre_t1/README.md` for provenance and
//! the do-not-casually-regenerate warning.
//!
//! `data_gate_default_config_round_trips` (below) is kept alongside this as
//! a *different*, complementary check: it still exercises the live
//! writer+reader path so default-value/serialization drift introduced by
//! future edits (not just the Task 1a move) keeps getting caught too.

use super::factory::StorageFactory;
use super::paths::AppPaths;
use super::prompts_sqlite::LlmPromptsStorage;
use super::providers::LlmProvider;
use crate::config::AppConfig;
use rusqlite::Connection;
use serde::Serialize;

#[derive(Serialize)]
struct DataGateSnapshot {
    config: AppConfig,
    history_texts: Vec<String>,
    dictionary: Vec<(String, String)>,
    custom_provider: LlmProvider,
    prompt_ids: Vec<String>,
    active_prompt_id: Option<String>,
}

/// Load the static `fixtures/pre_t1/*.sql` dumps + `dictionary.fixture.txt` into a
/// fresh tempdir, in the exact file layout `AppPaths` expects, WITHOUT going
/// through any `voxis_core::storage` writer — only `rusqlite::Connection`
/// executing the frozen SQL text and a plain `fs::write`.
fn load_pre_t1_fixture_into(paths: &AppPaths) {
    let config_sql = include_str!("fixtures/pre_t1/config_db.sql");
    let history_sql = include_str!("fixtures/pre_t1/history_db.sql");
    let providers_sql = include_str!("fixtures/pre_t1/providers_db.sql");
    let prompts_sql = include_str!("fixtures/pre_t1/prompts_db.sql");
    // Named `dictionary.fixture.txt`, not `dictionary.txt`: a bare
    // `dictionary.txt` pattern in the repo's root .gitignore matches at any
    // depth, which would silently git-ignore this fixture and break a
    // clean-clone build (`include_str!` below would fail to compile).
    let dictionary_txt = include_str!("fixtures/pre_t1/dictionary.fixture.txt");

    Connection::open(paths.config_db())
        .unwrap()
        .execute_batch(config_sql)
        .unwrap();
    Connection::open(paths.history_file())
        .unwrap()
        .execute_batch(history_sql)
        .unwrap();
    Connection::open(paths.providers_db())
        .unwrap()
        .execute_batch(providers_sql)
        .unwrap();
    Connection::open(paths.prompts_db())
        .unwrap()
        .execute_batch(prompts_sql)
        .unwrap();
    std::fs::write(paths.dictionary_file(), dictionary_txt).unwrap();
}

#[test]
fn data_gate_pre_t1_fixture_matches_golden_snapshot() {
    let temp = tempfile::tempdir().unwrap();
    let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
    load_pre_t1_fixture_into(&paths);

    let factory = StorageFactory::new(paths.clone());

    let loaded_config = factory.config().load().unwrap();

    // The fixture's two rows have fixed, distinct timestamps
    // (2026-01-01 10:00:00 / :05) baked into history_db.sql, so
    // `ORDER BY timestamp DESC` is deterministic — assert the order
    // directly instead of sorting it away (M4: sorting would hide a
    // regression in that ORDER BY).
    let loaded_history: Vec<String> = factory
        .history()
        .load(None)
        .unwrap()
        .into_iter()
        .map(|e| e.text)
        .collect();

    let loaded_dictionary = factory.dictionary().load().unwrap();

    let loaded_custom_provider = factory
        .providers()
        .get_all()
        .unwrap()
        .into_iter()
        .find(|p| p.id == "data-gate-provider")
        .expect("custom provider loads from the fixture");

    let prompts = LlmPromptsStorage::new(paths.prompts_db());
    let mut loaded_prompt_ids: Vec<String> =
        prompts.list().unwrap().into_iter().map(|p| p.id).collect();
    loaded_prompt_ids.sort();
    let loaded_active_prompt_id = prompts.get_active_id().unwrap();

    let snapshot = DataGateSnapshot {
        config: loaded_config,
        history_texts: loaded_history,
        dictionary: loaded_dictionary,
        custom_provider: loaded_custom_provider,
        prompt_ids: loaded_prompt_ids,
        active_prompt_id: loaded_active_prompt_id,
    };

    let golden = include_str!("data_gate_golden.json");
    let actual = serde_json::to_string_pretty(&snapshot).unwrap();
    assert_eq!(
        actual.trim(),
        golden.trim(),
        "data-gate snapshot drifted from crates/voxis-core/src/storage/data_gate_golden.json \
         — the post-move reader no longer agrees with the frozen pre-T1 on-disk fixture in \
         fixtures/pre_t1/. This means a real v0.1.5 install would lose or corrupt settings on \
         upgrade. If this is an intentional, migration-covered format change, update the golden \
         file (see fixtures/pre_t1/README.md before touching the fixture itself)."
    );
}

/// Complementary to the fixture-based gate above: exercises the live
/// writer+reader path with `AppConfig::default()` so a serialization or
/// default-value regression introduced by ANY future edit (not just Task
/// 1a's move) still gets caught, even though it cannot catch a writer+reader
/// drift by construction (see module docs).
#[test]
fn data_gate_default_config_round_trips() {
    let temp = tempfile::tempdir().unwrap();
    let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
    let factory = StorageFactory::new(paths);

    let config = AppConfig::default();
    factory.config().save(&config).unwrap();
    let loaded = factory.config().load().unwrap();

    assert_eq!(
        serde_json::to_string_pretty(&config).unwrap(),
        serde_json::to_string_pretty(&loaded).unwrap(),
        "AppConfig::default() must round-trip through config.db byte-for-byte"
    );
}

/// Locks the config dir the loader used above actually resolves to, for a
/// real (non-tempdir) desktop install: the log line the plan's Acceptance
/// requires (`config_dir == <путь v0.1.5>`) is `voxis_desktop_config_dir()`
/// itself, asserted against the v0.1.5 path in `storage::paths::tests`.
#[test]
fn data_gate_uses_the_same_app_config_dir_const_as_v0_1_5() {
    assert_eq!(super::paths::APP_CONFIG_DIR, "voxis");
}

/// Regenerates `fixtures/pre_t1/*.sql` + `dictionary.fixture.txt` from the CURRENT
/// writer code. NOT run automatically (`#[ignore]`) and must NOT be used to
/// "fix" a failing `data_gate_pre_t1_fixture_matches_golden_snapshot` after a
/// format change — see `fixtures/pre_t1/README.md`: regenerating collapses
/// the writer and the reader back onto the same code and defeats the gate.
/// Kept only as documentation of how the committed fixture was produced.
/// Writes plain sqlite files to `/tmp/voxis_pre_t1_gen`; dump each with
/// `sqlite3 <db> .dump` by hand if you ever need to intentionally redo this.
#[test]
#[ignore]
fn generate_pre_t1_fixture_scratch() {
    use super::providers::LlmModel;
    use crate::audio_feedback_types::AudioFeedbackSettings;
    use crate::output_types::AutoSubmitKey;
    use crate::shortcut::binding::{ShortcutAction, ShortcutBinding};

    let dir = std::path::PathBuf::from("/tmp/voxis_pre_t1_gen");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let paths = AppPaths::from_config_dir(dir.clone());
    let factory = StorageFactory::new(paths.clone());

    let mut config = AppConfig {
        api_key: "data-gate-known-api-key".to_string(),
        model: "whisper-large-v3".to_string(),
        hotkey: "ctrl_r".to_string(),
        auto_submit_key: AutoSubmitKey::CmdEnter,
        ..AppConfig::default()
    };
    config.audio_feedback = AudioFeedbackSettings {
        enabled: true,
        volume: 0.42,
    };
    config.shortcut_bindings = vec![ShortcutBinding {
        id: "data_gate_binding".to_string(),
        name: "Data gate binding".to_string(),
        description: "Fixture binding for the data-gate test".to_string(),
        default_binding: "alt_r".to_string(),
        current_binding: "ctrl+alt_r".to_string(),
        action: ShortcutAction::TranscribePostProcess {
            prompt_id: Some("fix_grammar".to_string()),
        },
    }];
    factory.config().save(&config).unwrap();

    factory
        .history()
        .add("data gate known transcription one", Some("en"), Some(1.5))
        .unwrap();
    factory
        .history()
        .add("data gate known transcription two", Some("ru"), Some(2.25))
        .unwrap();
    // Force deterministic, distinct timestamps (both `.add()` calls can land
    // in the same wall-clock second) so the committed dump's `ORDER BY
    // timestamp DESC` result is fixed forever.
    {
        let conn = Connection::open(paths.history_file()).unwrap();
        conn.execute(
            "UPDATE history SET timestamp = '2026-01-01 10:00:00' WHERE text = ?1",
            [&"data gate known transcription one"],
        )
        .unwrap();
        conn.execute(
            "UPDATE history SET timestamp = '2026-01-01 10:00:05' WHERE text = ?1",
            [&"data gate known transcription two"],
        )
        .unwrap();
    }

    factory
        .dictionary()
        .add("kubernetes", "Kubernetes")
        .unwrap();
    factory.dictionary().add("solid", "SOLID").unwrap();

    let custom_provider = LlmProvider {
        id: "data-gate-provider".to_string(),
        name: "Data Gate Provider".to_string(),
        api_url: "https://example.invalid/v1/audio/transcriptions".to_string(),
        models: vec![LlmModel {
            id: "dg-model".to_string(),
            name: "DG Model".to_string(),
        }],
        default_model: "dg-model".to_string(),
        builtin: false,
    };
    factory.providers().add(&custom_provider).unwrap();

    let prompts = LlmPromptsStorage::new(paths.prompts_db());
    prompts.seed_defaults_if_empty().unwrap();
    prompts
        .create(
            "data_gate_prompt",
            "Data Gate Prompt",
            "Fixture prompt body",
        )
        .unwrap();
    prompts.set_active_id(Some("data_gate_prompt")).unwrap();

    eprintln!("fixture written to {:?}", dir);
}
