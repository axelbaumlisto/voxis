//! Storage factory for centralized storage creation.
//!
//! Provides a single point for creating all storage instances,
//! following the Dependency Inversion Principle (DIP).

use super::traits;
use super::{
    AppPaths, ConfigSqliteStorage, CorrectionsSqliteStorage, DictionaryStorage,
    HistorySqliteStorage, ProvidersStorage,
};

/// Factory for creating storage instances.
///
/// This centralizes storage creation and makes it easier to:
/// - Add caching/pooling in the future
/// - Switch storage implementations
/// - Add logging/metrics
///
/// # Example
///
/// ```ignore
/// let factory = StorageFactory::new(paths);
/// let config = factory.config().load()?;
/// let history = factory.history();
/// ```
#[derive(Debug, Clone)]
pub struct StorageFactory {
    paths: AppPaths,
}

impl StorageFactory {
    /// Create a new storage factory with the given paths.
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    // =========================================================================
    // Concrete type methods (for backward compatibility)
    // =========================================================================

    /// Create a config storage instance (concrete type).
    pub fn config(&self) -> ConfigSqliteStorage {
        ConfigSqliteStorage::new(self.paths.config_db())
    }

    /// Create a history storage instance (concrete type).
    pub fn history(&self) -> HistorySqliteStorage {
        HistorySqliteStorage::new(self.paths.history_file())
    }

    /// Create a dictionary storage instance (concrete type).
    pub fn dictionary(&self) -> DictionaryStorage {
        DictionaryStorage::new(self.paths.dictionary_file())
    }

    /// Create a corrections storage instance (concrete type).
    pub fn corrections(&self) -> CorrectionsSqliteStorage {
        CorrectionsSqliteStorage::new(self.paths.corrections_db())
    }

    /// Create a providers storage instance (concrete type).
    pub fn providers(&self) -> ProvidersStorage {
        ProvidersStorage::new(self.paths.providers_db())
    }

    // =========================================================================
    // Trait-based methods (DIP compliance)
    // =========================================================================

    /// Create a config storage as trait object (DIP).
    pub fn config_dyn(&self) -> Box<dyn traits::ConfigStorage> {
        Box::new(ConfigSqliteStorage::new(self.paths.config_db()))
    }

    /// Create a history storage as trait object (DIP).
    pub fn history_dyn(&self) -> Box<dyn traits::HistoryStorage> {
        Box::new(HistorySqliteStorage::new(self.paths.history_file()))
    }

    /// Create a dictionary storage as trait object (DIP).
    pub fn dictionary_dyn(&self) -> Box<dyn traits::DictionaryStorage> {
        Box::new(DictionaryStorage::new(self.paths.dictionary_file()))
    }

    /// Create a corrections storage as trait object (DIP).
    pub fn corrections_dyn(&self) -> Box<dyn traits::CorrectionsStorage> {
        Box::new(CorrectionsSqliteStorage::new(self.paths.corrections_db()))
    }

    /// Create a providers storage as trait object (DIP).
    pub fn providers_dyn(&self) -> Box<dyn traits::ProvidersStorage> {
        Box::new(ProvidersStorage::new(self.paths.providers_db()))
    }

    /// Get reference to paths.
    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_factory_creates_storages() {
        // Create a mock paths
        let paths = AppPaths::from_config_dir(PathBuf::from("/tmp/test"));
        let factory = StorageFactory::new(paths);

        // Just verify that methods return storage instances
        // (actual functionality is tested in individual storage modules)
        let _ = factory.config();
        let _ = factory.history();
        let _ = factory.dictionary();
        let _ = factory.corrections();
        let _ = factory.providers();
    }

    #[test]
    fn test_factory_clone() {
        let paths = AppPaths::from_config_dir(PathBuf::from("/tmp/test"));
        let factory = StorageFactory::new(paths);
        let factory2 = factory.clone();
        assert_eq!(factory.paths().config_dir(), factory2.paths().config_dir());
    }

    #[test]
    fn test_factory_paths_accessor() {
        let paths = AppPaths::from_config_dir(PathBuf::from("/tmp/test"));
        let factory = StorageFactory::new(paths);
        assert_eq!(factory.paths().config_dir(), &PathBuf::from("/tmp/test"));
    }

    #[test]
    fn test_factory_creates_all_storage_types() {
        let temp = tempfile::tempdir().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let factory = StorageFactory::new(paths);

        // Verify each storage type can be created
        let _ = factory.config();
        let _ = factory.history();
        let _ = factory.dictionary();
        let _ = factory.corrections();
        let _ = factory.providers();
    }

    #[test]
    fn test_factory_debug() {
        let paths = AppPaths::from_config_dir(PathBuf::from("/tmp/test"));
        let factory = StorageFactory::new(paths);
        let debug_str = format!("{:?}", factory);
        assert!(debug_str.contains("StorageFactory"));
    }

    #[test]
    fn test_factory_config_storage_roundtrip() {
        let temp = tempfile::tempdir().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let factory = StorageFactory::new(paths);

        // Test config storage works through factory
        let config = crate::config::AppConfig {
            api_key: "test-factory-key".to_string(),
            hotkey: "f10".to_string(),
            ..crate::config::AppConfig::default()
        };

        factory.config().save(&config).unwrap();
        let loaded = factory.config().load().unwrap();

        assert_eq!(loaded.api_key, "test-factory-key");
        assert_eq!(loaded.hotkey, "f10");
    }

    #[test]
    fn test_factory_history_storage_roundtrip() {
        let temp = tempfile::tempdir().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let factory = StorageFactory::new(paths);

        // Test history storage works through factory
        factory
            .history()
            .add("Test history entry", Some("en"), Some(1.5))
            .unwrap();
        let entries = factory.history().load(Some(10)).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].text, "Test history entry");
    }

    #[test]
    fn test_factory_corrections_storage_roundtrip() {
        let temp = tempfile::tempdir().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let factory = StorageFactory::new(paths);

        // Test corrections storage works through factory
        factory.corrections().record("test", "Test").unwrap();
        let pending = factory.corrections().get_pending().unwrap();

        assert!(pending
            .iter()
            .any(|s| s.source == "test" && s.replacement == "Test"));
    }

    #[test]
    fn test_factory_providers_storage_has_defaults() {
        let temp = tempfile::tempdir().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let factory = StorageFactory::new(paths);

        // Test providers storage has built-in providers
        let providers = factory.providers().get_all().unwrap();

        assert!(providers.iter().any(|p| p.id == "groq"));
        assert!(providers.iter().any(|p| p.id == "openai"));
    }

    #[test]
    fn test_factory_storage_isolation() {
        let temp = tempfile::tempdir().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let factory = StorageFactory::new(paths);

        // Get two instances of history storage
        let history1 = factory.history();
        let history2 = factory.history();

        // Add via first instance
        history1.add("Entry from instance 1", None, None).unwrap();

        // Should be visible via second instance
        let entries = history2.load(Some(10)).unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn test_factory_with_nonexistent_path() {
        // Factory creation should work even with non-existent paths
        // (storage modules create directories/files as needed)
        let paths = AppPaths::from_config_dir(PathBuf::from("/nonexistent/path/that/doesnt/exist"));
        let factory = StorageFactory::new(paths);

        // Factory can be created, but storage operations would fail
        // This is expected - factory doesn't validate paths on creation
        assert!(factory.paths().config_dir().starts_with("/nonexistent"));
    }
}
