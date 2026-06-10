//! SQLite storage for `LlmPrompt` (multi-prompt LLM templates).
//!
//! Closes the storage layer of #1 from
//! `.pi/plans/handy-recommendations-cloud-only.md`. The schema is small
//! (one table, six columns) but DRY-shared with `ConfigSqliteStorage`
//! through `sqlite_base::open_with_schema`.
//!
//! On first open (empty table) the storage seeds the 4 default
//! templates from `llm::prompts::default_prompts()` so a fresh install
//! has a working UI immediately.
//!
//! SOLID:
//!  - SRP: this module owns the on-disk representation of prompts +
//!    the active-prompt-id pointer. NO LLM call, no Tauri command (that
//!    lives in `commands::prompts`).
//!  - DIP: callers depend on the `Vec<LlmPrompt>` slice and `Option<String>`
//!    types — not on rusqlite primitives.

use crate::llm::prompts::{default_prompts, LlmPrompt};
use rusqlite::{params, Connection};
use std::path::PathBuf;

use super::sqlite_base::SqliteSchema;

pub struct LlmPromptsStorage {
    path: PathBuf,
}

impl LlmPromptsStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// First-run seed: if the table is empty, insert the canonical defaults.
    /// Idempotent — calling this on a populated table is a no-op.
    pub fn seed_defaults_if_empty(&self) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM llm_prompts", [], |r| r.get(0))?;
        if count == 0 {
            for p in default_prompts() {
                conn.execute(
                    "INSERT INTO llm_prompts (id, name, prompt) VALUES (?1, ?2, ?3)",
                    params![p.id, p.name, p.prompt],
                )?;
            }
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<LlmPrompt>, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let mut stmt = conn
            .prepare("SELECT id, name, prompt FROM llm_prompts ORDER BY created_at ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(LlmPrompt {
                id: row.get(0)?,
                name: row.get(1)?,
                prompt: row.get(2)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get(&self, id: &str) -> Result<Option<LlmPrompt>, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let row = conn
            .query_row(
                "SELECT id, name, prompt FROM llm_prompts WHERE id = ?1",
                params![id],
                |row| {
                    Ok(LlmPrompt {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        prompt: row.get(2)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    /// Insert a new prompt with a caller-supplied id. Returns the
    /// stored entity. Returns an error if the id collides with an
    /// existing row.
    pub fn create(
        &self,
        id: &str,
        name: &str,
        prompt: &str,
    ) -> Result<LlmPrompt, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO llm_prompts (id, name, prompt) VALUES (?1, ?2, ?3)",
            params![id, name, prompt],
        )?;
        Ok(LlmPrompt {
            id: id.to_string(),
            name: name.to_string(),
            prompt: prompt.to_string(),
        })
    }

    /// Replace the name + prompt of an existing entry. Returns an
    /// error if the id is unknown.
    pub fn update(
        &self,
        id: &str,
        name: &str,
        prompt: &str,
    ) -> Result<LlmPrompt, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let n = conn.execute(
            "UPDATE llm_prompts \
                SET name = ?2, prompt = ?3, updated_at = strftime('%s','now') \
              WHERE id = ?1",
            params![id, name, prompt],
        )?;
        if n == 0 {
            return Err(format!("prompt id '{}' not found", id).into());
        }
        Ok(LlmPrompt {
            id: id.to_string(),
            name: name.to_string(),
            prompt: prompt.to_string(),
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM llm_prompts WHERE id = ?1", params![id])?;
        // If the deleted prompt was the active one, clear the pointer
        // so we never end up pointing to a ghost id.
        conn.execute(
            "DELETE FROM llm_prompts_state WHERE key = 'active_id' AND value = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn get_active_id(&self) -> Result<Option<String>, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let id: Option<String> = conn
            .query_row(
                "SELECT value FROM llm_prompts_state WHERE key = 'active_id'",
                [],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        Ok(id)
    }

    pub fn set_active_id(
        &self,
        id: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        match id {
            Some(v) => {
                conn.execute(
                    "INSERT INTO llm_prompts_state (key, value) VALUES ('active_id', ?1) \
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![v],
                )?;
            }
            None => {
                conn.execute(
                    "DELETE FROM llm_prompts_state WHERE key = 'active_id'",
                    [],
                )?;
            }
        }
        Ok(())
    }
}

// =============================================================================
// SqliteSchema trait — DRY connect() via sqlite_base
// =============================================================================

impl SqliteSchema for LlmPromptsStorage {
    fn path(&self) -> &std::path::Path {
        &self.path
    }

    fn init_schema(&self, conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS llm_prompts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            )",
            [],
        )?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS llm_prompts_state (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
            [],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
