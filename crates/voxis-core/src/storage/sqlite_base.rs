//! SQLite base utilities for DRY connection handling.
//!
//! Provides common connection and schema initialization logic
//! used by all SQLite storage implementations.

use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::time::Duration;

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

/// `open_read_only`'s error type.
///
/// `NotFound` is the deliberate reason this isn't a bare
/// `Box<dyn std::error::Error>` like `open_with_schema`: a read-only import
/// (Task 6 `profile_source.rs`) needs to tell "Voxis isn't installed here"
/// (missing `config.db`/`prompts.db`) apart from an actual SQLite error on
/// a file that does exist, and doing that by string-matching the message
/// of a generic error would be fragile.
#[derive(Debug, thiserror::Error)]
pub enum ReadOnlyOpenError {
    /// The database file does not exist. Checked explicitly *before*
    /// `Connection::open_with_flags` — `SQLITE_OPEN_READ_ONLY` never
    /// creates a missing file (unlike the default `Connection::open`/
    /// `open_with_schema`, which always does via the implicit
    /// `SQLITE_OPEN_CREATE`), but a nonexistent path still fails inside
    /// SQLite as a generic `SQLITE_CANTOPEN`; this variant gives callers
    /// something to `matches!`/`if let` on instead of string-sniffing.
    #[error("database file not found: {0}")]
    NotFound(PathBuf),
    /// Any other SQLite failure (corrupt file, permission error, etc.).
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Open a SQLite connection strictly read-only, for reading a database
/// that another live process may own (`[R1-Safety S7]`: importing a
/// profile from an installed Voxis desktop while it may be running and
/// writing to the same files).
///
/// Deliberately **not** [`SqliteSchema::connect`]/[`open_with_schema`]:
/// those always run `init_schema`, which for `ConfigSqliteStorage`/
/// `ProvidersStorage`/`LlmPromptsStorage` can execute `CREATE TABLE`/
/// `INSERT` statements (builtin-provider/default-prompt seeding on an
/// empty table) — under `SQLITE_OPEN_READ_ONLY` those writes fail with
/// `SQLITE_READONLY` even though the read the caller actually wants would
/// have succeeded. This function opens the file exactly as it stands, no
/// schema touched.
///
/// - `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`: never creates the
///   file; `NO_MUTEX` because each `read_only()`-constructed storage in
///   this crate opens its own single-threaded connection per call (same
///   assumption `Connection::open` already makes for the read-write
///   path).
/// - `busy_timeout(2s)`: the desktop install has no WAL mode of its own,
///   so a write transaction it briefly holds (e.g. saving config after a
///   settings change) locks the file. This call does NOT introduce
///   retrying where none existed before: `rusqlite` itself already calls
///   `sqlite3_busy_timeout(db, 5000)` on every `Connection::open`/
///   `open_with_flags` (`rusqlite`'s `inner_connection.rs`) — SQLite's OWN
///   default is `0` (fail instantly with `SQLITE_BUSY`), but every
///   connection this crate ever opens already retries for up to 5s
///   regardless of this function. The explicit `busy_timeout(2s)` here
///   SHORTENS that 5s default to a fixed 2s, deliberately independent of
///   whatever `rusqlite` happens to default to — so a profile import
///   against a writer stuck far longer than a normal settings-save can't
///   block for nearly twice as long as this function actually needs to
///   wait.
pub fn open_read_only(path: &Path) -> Result<Connection, ReadOnlyOpenError> {
    if !path.exists() {
        return Err(ReadOnlyOpenError::NotFound(path.to_path_buf()));
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(Duration::from_secs(2))?;
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

        fn init_schema(&self, conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
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
            .query_row("SELECT body FROM notes LIMIT 1", [], |row| row.get(0))
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

    // -- open_read_only ---------------------------------------------

    #[test]
    fn open_read_only_missing_file_is_not_found_and_creates_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.db");

        let result = open_read_only(&path);

        assert!(matches!(result, Err(ReadOnlyOpenError::NotFound(p)) if p == path));
        assert!(!path.exists(), "read-only open must NEVER create the file");
    }

    #[test]
    fn open_read_only_reads_existing_data_without_init_schema() {
        let file = NamedTempFile::new().unwrap();
        // Pre-populate with a schema/row that looks nothing like any real
        // storage's init_schema — proves open_read_only doesn't run any
        // CREATE TABLE of its own (it would collide/no-op either way, but
        // this also proves it doesn't require a specific schema to open).
        {
            let conn = Connection::open(file.path()).unwrap();
            conn.execute("CREATE TABLE t (v TEXT)", []).unwrap();
            conn.execute("INSERT INTO t VALUES ('hello')", []).unwrap();
        }

        let conn = open_read_only(file.path()).unwrap();
        let value: String = conn
            .query_row("SELECT v FROM t", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "hello");
    }

    #[test]
    fn open_read_only_rejects_writes() {
        let file = NamedTempFile::new().unwrap();
        {
            let conn = Connection::open(file.path()).unwrap();
            conn.execute("CREATE TABLE t (v TEXT)", []).unwrap();
        }

        let conn = open_read_only(file.path()).unwrap();
        let result = conn.execute("INSERT INTO t VALUES ('nope')", []);
        assert!(result.is_err(), "a read-only connection must refuse writes");
    }

    /// `[R1-Safety S7]` core regression: a concurrent writer holding a
    /// genuine EXCLUSIVE lock (`BEGIN EXCLUSIVE` — unlike a plain `BEGIN
    /// IMMEDIATE` + a small write, which only takes a RESERVED lock and
    /// still admits concurrent readers of the pre-transaction snapshot
    /// without ever hitting `SQLITE_BUSY` at all; verified empirically
    /// while writing this test — that shape let the previous version of
    /// this test pass even with `busy_timeout` deleted entirely, so it
    /// was not actually exercising the retry path) must not make
    /// `open_read_only` fail with `SQLITE_BUSY`: the reader must
    /// genuinely WAIT for the writer (asserted via elapsed time, not
    /// just "did it eventually succeed", which a lucky non-blocking race
    /// could also satisfy) and then succeed once the writer releases the
    /// lock, well within the 2s `busy_timeout`.
    #[test]
    fn open_read_only_waits_out_a_writers_exclusive_lock_within_the_busy_timeout() {
        let file = NamedTempFile::new().unwrap();
        {
            let conn = Connection::open(file.path()).unwrap();
            conn.execute("CREATE TABLE t (v TEXT)", []).unwrap();
            conn.execute("INSERT INTO t VALUES ('initial')", []).unwrap();
        }

        let path = file.path().to_path_buf();
        let writer = Connection::open(&path).unwrap();
        writer.execute("BEGIN EXCLUSIVE", []).unwrap();
        writer.execute("UPDATE t SET v = 'mid-write'", []).unwrap();

        const HOLD_MS: u64 = 200;
        let handle = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(HOLD_MS));
            writer.execute("COMMIT", []).unwrap();
        });

        let started = std::time::Instant::now();
        let conn = open_read_only(&path).unwrap();
        let value: String = conn
            .query_row("SELECT v FROM t", [], |row| row.get(0))
            .unwrap();
        let elapsed = started.elapsed();

        handle.join().unwrap();
        assert!(
            elapsed >= std::time::Duration::from_millis(150),
            "the read must have actually blocked on the writer's EXCLUSIVE lock (busy_timeout retrying), \
             not returned immediately — elapsed only {elapsed:?} against a {HOLD_MS}ms hold"
        );
        assert_eq!(value, "mid-write", "the read must observe the post-commit state");
    }

    /// Negative control for the test above: proves `open_read_only`'s own
    /// `busy_timeout(2s)` call is load-bearing, not decorative. A
    /// read-only connection opened the same way but with an explicit
    /// **zero** `busy_timeout` (rather than skipping the call entirely —
    /// empirically, this build's bundled SQLite retries on its own for
    /// several *seconds* with no `busy_timeout` call at all, which would
    /// make "skip the call" a slow, non-deterministic negative control;
    /// `Duration::ZERO` exercises the exact same "give up immediately"
    /// code path deterministically and fast) must fail immediately with
    /// `SQLITE_BUSY` against the identical `BEGIN EXCLUSIVE` writer.
    #[test]
    fn read_only_connection_with_zero_busy_timeout_fails_fast_under_the_same_contention() {
        let file = NamedTempFile::new().unwrap();
        {
            let conn = Connection::open(file.path()).unwrap();
            conn.execute("CREATE TABLE t (v TEXT)", []).unwrap();
            conn.execute("INSERT INTO t VALUES ('initial')", []).unwrap();
        }

        let path = file.path().to_path_buf();
        let writer = Connection::open(&path).unwrap();
        writer.execute("BEGIN EXCLUSIVE", []).unwrap();
        writer.execute("UPDATE t SET v = 'mid-write'", []).unwrap();

        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .unwrap();
        conn.busy_timeout(Duration::ZERO).unwrap();
        let result = conn.query_row("SELECT COUNT(*) FROM t", [], |row| row.get::<_, i64>(0));

        writer.execute("COMMIT", []).unwrap();
        drop(writer);

        match result {
            Err(rusqlite::Error::SqliteFailure(err, _)) => {
                assert_eq!(err.code, rusqlite::ErrorCode::DatabaseBusy, "expected SQLITE_BUSY, got {err:?}");
            }
            other => panic!("expected an immediate SQLITE_BUSY with a zero busy_timeout, got {other:?}"),
        }
    }
}
