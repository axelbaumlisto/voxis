use rusqlite::{params, Connection, Row};
use std::path::PathBuf;

use super::{
    builtin::default_providers,
    types::LlmProvider,
    validation::{ensure_provider_removable, parse_models_json},
};
use crate::storage::sqlite_base::SqliteSchema;

/// SQLite storage for LLM providers.
pub struct ProvidersStorage {
    path: PathBuf,
}

impl ProvidersStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Insert default providers.
    fn insert_defaults(&self, conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
        for provider in default_providers() {
            let models_json = serde_json::to_string(&provider.models)?;
            conn.execute(
                "INSERT OR IGNORE INTO llm_providers (id, name, api_url, models, default_model, builtin)
                 VALUES (?, ?, ?, ?, ?, ?)",
                params![
                    provider.id,
                    provider.name,
                    provider.api_url,
                    models_json,
                    provider.default_model,
                    provider.builtin as i32,
                ],
            )?;
        }
        Ok(())
    }

    fn row_to_provider(row: &Row<'_>) -> rusqlite::Result<LlmProvider> {
        let models_json: String = row.get(3)?;
        let builtin_int: i32 = row.get(5)?;
        Ok(LlmProvider {
            id: row.get(0)?,
            name: row.get(1)?,
            api_url: row.get(2)?,
            models: parse_models_json(&models_json),
            default_model: row.get(4)?,
            builtin: builtin_int != 0,
        })
    }

    /// Get all providers.
    pub fn get_all(&self) -> Result<Vec<LlmProvider>, Box<dyn std::error::Error>> {
        let conn = self.connect()?;

        let mut stmt = conn.prepare(
            "SELECT id, name, api_url, models, default_model, builtin
             FROM llm_providers
             ORDER BY builtin DESC, name ASC",
        )?;

        let providers = stmt.query_map([], Self::row_to_provider)?;

        let mut result = Vec::new();
        for provider in providers {
            result.push(provider?);
        }

        Ok(result)
    }

    /// Get a provider by ID.
    pub fn get(&self, id: &str) -> Result<Option<LlmProvider>, Box<dyn std::error::Error>> {
        let conn = self.connect()?;

        let result = conn.query_row(
            "SELECT id, name, api_url, models, default_model, builtin
             FROM llm_providers
             WHERE id = ?",
            [id],
            Self::row_to_provider,
        );

        match result {
            Ok(provider) => Ok(Some(provider)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Add a new provider.
    pub fn add(&self, provider: &LlmProvider) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let models_json = serde_json::to_string(&provider.models)?;

        conn.execute(
            "INSERT INTO llm_providers (id, name, api_url, models, default_model, builtin)
             VALUES (?, ?, ?, ?, ?, 0)",
            params![
                provider.id,
                provider.name,
                provider.api_url,
                models_json,
                provider.default_model,
            ],
        )?;

        Ok(())
    }

    /// Update an existing provider.
    pub fn update(&self, provider: &LlmProvider) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let models_json = serde_json::to_string(&provider.models)?;

        conn.execute(
            "UPDATE llm_providers
             SET name = ?, api_url = ?, models = ?, default_model = ?
             WHERE id = ?",
            params![
                provider.name,
                provider.api_url,
                models_json,
                provider.default_model,
                provider.id,
            ],
        )?;

        Ok(())
    }

    /// Remove a provider (only non-builtin).
    pub fn remove(&self, id: &str) -> Result<bool, Box<dyn std::error::Error>> {
        let conn = self.connect()?;

        // Check if builtin
        let builtin: i32 = conn
            .query_row(
                "SELECT builtin FROM llm_providers WHERE id = ?",
                [id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        ensure_provider_removable(builtin)?;

        let deleted = conn.execute(
            "DELETE FROM llm_providers WHERE id = ? AND builtin = 0",
            [id],
        )?;

        Ok(deleted > 0)
    }
}

// =============================================================================
// SqliteSchema trait — DRY connect() via sqlite_base
// =============================================================================

impl SqliteSchema for ProvidersStorage {
    fn path(&self) -> &std::path::Path {
        &self.path
    }

    fn init_schema(&self, conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS llm_providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                api_url TEXT NOT NULL,
                models TEXT NOT NULL,
                default_model TEXT NOT NULL,
                builtin INTEGER DEFAULT 0
            )",
            [],
        )?;

        // Check if table is empty, insert defaults
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM llm_providers", [], |row| row.get(0))?;

        if count == 0 {
            self.insert_defaults(conn)?;
        }

        Ok(())
    }
}
