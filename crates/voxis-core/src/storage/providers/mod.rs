//! SQLite storage for LLM providers.
//!
//! Stores LLM provider configurations with their models.
//! Default providers are inserted on first run.

mod builtin;
mod storage;
mod types;
mod validation;

pub use storage::ProvidersStorage;
pub use types::{LlmModel, LlmProvider};

// =============================================================================
// Trait implementation for DIP compliance
// =============================================================================

impl super::traits::ProvidersStorage for ProvidersStorage {
    fn get_all(&self) -> super::traits::StorageResult<Vec<LlmProvider>> {
        self.get_all().map_err(super::traits::into_storage_error)
    }

    fn add(&self, provider: &LlmProvider) -> super::traits::StorageResult<()> {
        self.add(provider)
            .map_err(super::traits::into_storage_error)
    }

    fn remove(&self, id: &str) -> super::traits::StorageResult<()> {
        self.remove(id).map_err(super::traits::into_storage_error)?;
        Ok(())
    }

    fn update(&self, provider: &LlmProvider) -> super::traits::StorageResult<()> {
        self.update(provider)
            .map_err(super::traits::into_storage_error)
    }
}

#[cfg(test)]
mod tests_core;

#[cfg(test)]
mod tests_edge_cases;
