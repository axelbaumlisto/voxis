//! SQLite base utilities for DRY connection handling.
//!
//! Provides common connection and schema initialization logic
//! used by all SQLite storage implementations.

use rusqlite::Connection;
use std::path::Path;

/// Trait for types that can be parsed from SQLite rows.
/// DRY: Eliminates duplicated parse_row functions across storage modules.
pub trait FromSqliteRow: Sized {
    /// Parse a row into Self.
    fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Self>;
}

/// Trait for SQLite-backed storages with a schema.
///
/// DRY: Eliminates duplicated `fn connect()` boilerplate across all
/// SQLite storage modules. Implementors define `path()` and
/// `init_schema()`; the default `connect()` delegates to
/// [`open_with_schema`].
pub trait SqliteSchema {
    /// Path to the SQLite database file.
    fn path(&self) -> &Path;

    /// Initialize / migrate the schema. Called once per connection.
    fn init_schema(&self, conn: &Connection) -> Result<(), Box<dyn std::error::Error>>;

    /// Open a connection and ensure schema exists.
    fn connect(&self) -> Result<Connection, Box<dyn std::error::Error>> {
        open_with_schema(self.path(), |conn| self.init_schema(conn))
    }
}

/// Open a SQLite connection and initialize schema.
///
/// This is the DRY helper for all SQLite storage implementations.
/// It handles:
/// - Opening the connection
/// - Running schema initialization function
/// - Consistent error handling
///
/// # Arguments
/// * `path` - Path to the SQLite database file
/// * `init_schema` - Function to initialize/migrate the schema
///
/// # Example
/// ```ignore
/// let conn = open_with_schema(&self.path, |conn| {
///     conn.execute("CREATE TABLE IF NOT EXISTS ...", [])?;
///     Ok(())
/// })?;
/// ```
pub fn open_with_schema<F>(
    path: &Path,
    init_schema: F,
) -> Result<Connection, Box<dyn std::error::Error>>
where
    F: FnOnce(&Connection) -> Result<(), Box<dyn std::error::Error>>,
{
    let conn = Connection::open(path)?;
    init_schema(&conn)?;
    Ok(conn)
}

/// Check if a column exists in a table.
/// Useful for schema migrations.
pub fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        &format!(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('{}') WHERE name = ?",
            table
        ),
        [column],
        |row| row.get(0),
    )
    .unwrap_or(false)
}

/// Create an index if it doesn't exist.
/// Returns Ok(()) even if index already exists.
pub fn create_index_if_not_exists(
    conn: &Connection,
    index_name: &str,
    table: &str,
    columns: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        &format!(
            "CREATE INDEX IF NOT EXISTS {} ON {}({})",
            index_name, table, columns
        ),
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn test_open_with_schema() {
        let file = NamedTempFile::new().unwrap();
        let conn = open_with_schema(file.path(), |conn| {
            conn.execute(
                "CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, value TEXT)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        // Verify table was created
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM test", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_open_with_schema_error_handling() {
        let file = NamedTempFile::new().unwrap();
        let result = open_with_schema(file.path(), |_conn| {
            Err("Schema initialization failed".into())
        });
        assert!(result.is_err());
    }

    #[test]
    fn test_column_exists() {
        let file = NamedTempFile::new().unwrap();
        let conn = open_with_schema(file.path(), |conn| {
            conn.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)", [])?;
            Ok(())
        })
        .unwrap();

        assert!(column_exists(&conn, "test", "id"));
        assert!(column_exists(&conn, "test", "name"));
        assert!(!column_exists(&conn, "test", "nonexistent"));
    }

    #[test]
    fn test_create_index_if_not_exists() {
        let file = NamedTempFile::new().unwrap();
        let conn = open_with_schema(file.path(), |conn| {
            conn.execute(
                "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, created_at TEXT)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        // Create index
        create_index_if_not_exists(&conn, "idx_name", "test", "name").unwrap();

        // Creating again should not error
        create_index_if_not_exists(&conn, "idx_name", "test", "name").unwrap();

        // Create composite index
        create_index_if_not_exists(&conn, "idx_multi", "test", "name, created_at").unwrap();
    }

    #[test]
    fn test_multiple_tables() {
        let file = NamedTempFile::new().unwrap();
        let conn = open_with_schema(file.path(), |conn| {
            conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)", [])?;
            conn.execute(
                "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        // Both tables should exist
        let user_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
            .unwrap();
        let post_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM posts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(user_count, 0);
        assert_eq!(post_count, 0);
    }

    /// Test struct for FromSqliteRow trait.
    #[derive(Debug, PartialEq)]
    struct TestRow {
        id: i64,
        name: String,
    }

    impl FromSqliteRow for TestRow {
        fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Self> {
            Ok(Self {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        }
    }

    #[test]
    fn test_from_sqlite_row_trait() {
        let file = NamedTempFile::new().unwrap();
        let conn = open_with_schema(file.path(), |conn| {
            conn.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)", [])?;
            conn.execute("INSERT INTO test (name) VALUES ('Alice'), ('Bob')", [])?;
            Ok(())
        })
        .unwrap();

        let mut stmt = conn
            .prepare("SELECT id, name FROM test ORDER BY id")
            .unwrap();
        let rows: Vec<TestRow> = stmt
            .query_map([], TestRow::from_row)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "Alice");
        assert_eq!(rows[1].name, "Bob");
    }

    // -- SqliteSchema trait tests ---------------------------------

    struct DummyStorage {
        db_path: std::path::PathBuf,
    }

    impl SqliteSchema for DummyStorage {
        fn path(&self) -> &Path {
            &self.db_path
        }

        fn init_schema(
            &self,
            conn: &Connection,
        ) -> Result<(), Box<dyn std::error::Error>> {
            conn.execute(
                "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)",
                [],
            )?;
            Ok(())
        }
    }

    #[test]
    fn test_sqlite_schema_trait_connect_creates_table() {
        let file = NamedTempFile::new().unwrap();
        let storage = DummyStorage {
            db_path: file.path().to_path_buf(),
        };

        let conn = storage.connect().unwrap();

        // Table should exist
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);

        // Insert and read back
        conn.execute("INSERT INTO notes (body) VALUES ('hello')", [])
            .unwrap();
        let body: String = conn
            .query_row("SELECT body FROM notes LIMIT 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(body, "hello");
    }

    #[test]
    fn test_sqlite_schema_trait_connect_idempotent() {
        let file = NamedTempFile::new().unwrap();
        let storage = DummyStorage {
            db_path: file.path().to_path_buf(),
        };

        let _c1 = storage.connect().unwrap();
        let _c2 = storage.connect().unwrap();
        let _c3 = storage.connect().unwrap();

        // Should still work
        let conn = storage.connect().unwrap();
        conn.execute("INSERT INTO notes (body) VALUES ('still works')", [])
            .unwrap();
    }
}
