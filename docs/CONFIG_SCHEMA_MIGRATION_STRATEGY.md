# Config & Data Store Schema-Migration Strategy

Status: documentation / convention note (no store code changed by this
document). This is a written playbook so the **next** breaking schema
change has a documented path instead of ad-hoc handling.

Every claim about current behavior below was verified against the actual
source in `src-tauri/src/storage/` (not assumed). Source references are
given inline. The canonical store list was taken from `CLAUDE.md`'s
"Storage Files" section and cross-checked against
`src-tauri/src/storage/paths.rs` (`AppPaths` accessors) — the two agree.

## Scope: what counts as a versioned store

`CLAUDE.md` lists these files under the config directory:

| File               | Type          | Purpose                                  |
|--------------------|---------------|------------------------------------------|
| `config.db`        | SQLite        | Key-value app settings                   |
| `history.db`       | SQLite        | Transcription history                    |
| `dictionary.txt`   | Plain text    | Word replacement mappings                |
| `corrections.db`   | SQLite        | Learning suggestions tracking            |
| `providers.db`     | SQLite        | Custom + builtin LLM provider defs       |
| `prompts.db`       | SQLite        | Multi-prompt LLM templates               |
| `failed_audio/`    | dir (WAV+JSON)| Up to 3 failed-transcription retries     |
| `debug/`           | dir           | Debug audio + JSONL (debug mode only)    |
| `logs/`            | dir           | Rotating app logs                        |

**In scope for schema versioning:** the six persistent structured stores
— `config.db`, `history.db`, `dictionary.txt`, `corrections.db`,
`providers.db`, `prompts.db`. These hold user data/state whose on-disk
shape can change across releases.

**Out of scope:** `failed_audio/`, `debug/`, `logs/` are ephemeral
operational artifacts (bounded, disposable, no long-lived schema
contract). Also out of scope but noted for completeness: `config.ini`,
`history.md`, and `corrections_stats.json` are **legacy** paths kept only
for one-time import (see `paths.rs` doc comments and `config_ini.rs`
header: *"Read-only legacy INI parser… Delete when migration support is
dropped."*). They are not written going forward.

All store file paths are centralized in
`src-tauri/src/storage/paths.rs` (`AppPaths::config_db()`,
`history_file()`, `dictionary_file()`, `corrections_db()`,
`providers_db()`, `prompts_db()`).

## Current state per store (verified)

### Shared SQLite mechanism

All five SQLite stores go through one shared abstraction:
`src-tauri/src/storage/sqlite_base.rs`.

- Trait `SqliteSchema` requires `path()` + `init_schema(&conn)`; its
  default `connect()` calls `open_with_schema(path, |c| init_schema(c))`.
- `init_schema` is **called once per connection** (its own doc says
  "Initialize / migrate the schema. Called once per connection.") — there
  is no separate one-shot "run migrations at startup" step; schema setup
  happens on every `connect()`.
- Helpers provided: `column_exists(conn, table, column)` (via
  `pragma_table_info`) and `create_index_if_not_exists(...)`.

**There is NO `PRAGMA user_version` and NO numbered/versioned migration
system anywhere in the codebase.** Verified: `grep -rin
"user_version\|PRAGMA" src-tauri/src` returns only the
`pragma_table_info` call inside `column_exists` (used for column
presence checks, not version tracking).

So the *de-facto* current convention for SQLite stores is:
**idempotent `CREATE TABLE IF NOT EXISTS` on every connect, plus
additive-only, guarded `ALTER TABLE … ADD COLUMN` migrations** using
`column_exists()`. This handles *additive* changes cleanly; it has **no
mechanism for destructive/transforming changes** (rename/drop column,
type change, data backfill, table restructure).

### `config.db`
- Source: `config_sqlite.rs`. Schema: single table
  `config(key TEXT PRIMARY KEY, value TEXT NOT NULL)` created with
  `CREATE TABLE IF NOT EXISTS` in `init_schema`.
- Versioning: **none** (no `user_version`). It is a schema-less
  key-value bag, so field additions/removals happen at the *value* layer,
  not the *table* layer: `load()` reads each key with a typed default
  (`get_str`/`get_bool`/`get_typed`/`get_json`), and unknown/absent keys
  fall back to `AppConfig::default()`. Corrupt JSON blobs are tolerated
  per-key (they fall back to default rather than failing the load).
- Legacy migration: one-time import from `config.ini` lives outside the
  store (`config_ini.rs` read-only parser, invoked from setup code), not
  in `init_schema`.
- Effective robustness: because it is key-value, most config evolution
  needs no table migration at all.

### `history.db`
- Source: `history_sqlite.rs`. Schema: table `history(id, text,
  language, timestamp)` via `CREATE TABLE IF NOT EXISTS`.
- Versioning: **none** (no `user_version`), but this is the **only store
  with an actual data-migration line**: `init_schema` guards
  `if !column_exists(conn, "history", "duration") { ALTER TABLE history
  ADD COLUMN duration REAL }` — an additive migration for the older
  Python-era schema. Also creates `idx_timestamp` via
  `create_index_if_not_exists`.
- This is the concrete precedent for the existing "guarded additive
  ALTER" convention.

### `dictionary.txt`
- Source: `dictionary.rs`. **Not a database** — a line-oriented plain
  text file.
- Versioning: **none**, and none is really applicable. Instead it is
  *format-tolerant on read*: `load()` accepts three line formats
  (`source = replacement`, pipe `source|replacement`, and bare
  `source=replacement`) and skips blanks/`#` comments. Format evolution
  is handled by additive parser branches, not a version header.

### `corrections.db`
- Source: `corrections_sqlite.rs`. Schema: table `corrections(id,
  source, replacement, count, status, first_seen, last_seen,
  UNIQUE(source, replacement))` via `CREATE TABLE IF NOT EXISTS`, plus
  `idx_status` index.
- Versioning: **none** (no `user_version`). No ALTER-based migrations
  present. (Legacy `corrections_stats.json` exists only as a legacy path
  in `paths.rs`, not written.)

### `providers.db`
- Source: `providers/storage.rs`. Schema: table `llm_providers(id, name,
  api_url, models, default_model, builtin)` via `CREATE TABLE IF NOT
  EXISTS`. On empty table it seeds builtin defaults
  (`insert_defaults`).
- Versioning: **none** (no `user_version`). No ALTER-based migrations
  present. Note the seed-on-empty behavior means a *content* refresh of
  builtins is not automatic once the table is non-empty — worth keeping
  in mind for any future builtin-provider changes (a content migration,
  not a schema one).

### `prompts.db`
- Source: `prompts_sqlite/mod.rs`. Schema: two tables — `llm_prompts(id,
  name, prompt, created_at, updated_at)` and `llm_prompts_state(key,
  value)` (used for the `active_id` pointer) — both via
  `CREATE TABLE IF NOT EXISTS`.
- Versioning: **none** (no `user_version`). No ALTER-based migrations
  present.

## Summary table

| Store            | Kind   | `user_version`? | Existing migration mechanism                                   |
|------------------|--------|-----------------|----------------------------------------------------------------|
| `config.db`      | SQLite | No              | Key-value + typed defaults; value-layer, no table migration    |
| `history.db`     | SQLite | No              | Guarded additive `ALTER … ADD COLUMN duration` (`column_exists`)|
| `dictionary.txt` | Text   | n/a             | Format-tolerant multi-format parser on read                    |
| `corrections.db` | SQLite | No              | `CREATE TABLE IF NOT EXISTS` only                              |
| `providers.db`   | SQLite | No              | `CREATE TABLE IF NOT EXISTS` + seed-on-empty                    |
| `prompts.db`     | SQLite | No              | `CREATE TABLE IF NOT EXISTS` only                             |

## Convention going forward

The codebase **already has a consistent, working convention** for
schema setup and *additive* change, and this note documents that pattern
rather than inventing a competing one:

> **Existing convention (keep using it for additive changes):** every
> SQLite store implements `SqliteSchema::init_schema`, which runs
> `CREATE TABLE IF NOT EXISTS` idempotently and applies additive column
> additions guarded by `column_exists()` (see `history.db` /
> `duration`). Indexes use `create_index_if_not_exists()`. Text stores
> (`dictionary.txt`) stay backward-compatible by making the reader
> tolerant of old formats. This handles the common case — adding a
> column, table, or index — with zero extra machinery, and it is the
> pattern any new additive change should follow.

**The one genuine gap** (not an invented one — verified absent): there
is **no version counter**, so *non-additive* changes (drop/rename column,
type change, data backfill/transform, table restructure) have no
documented, ordered, run-once playbook. `column_exists` guards can only
express "add if missing"; they cannot express "this DB is at v2, run the
v2→v3 transform exactly once."

Because that specific capability is genuinely absent, this note
recommends a **minimal augmentation layered on top of the existing
`SqliteSchema` hook** — to be adopted only **when the first
non-additive change is actually needed**, not retrofitted preemptively:

1. **Adopt `PRAGMA user_version` per SQLite store.** A brand-new DB
   reports `user_version = 0`. Treat the current on-disk shape of each
   store as its implicit **v1** baseline (do **not** bump existing
   stores now — that would be a code change and this task is docs-only).
2. **Gate breaking migrations inside the existing `init_schema`.** Keep
   the idempotent `CREATE TABLE IF NOT EXISTS` + `column_exists` additive
   steps first (they remain safe to run every connect). Then, for a
   breaking change, read `PRAGMA user_version`; if it is below the target,
   run the ordered transform(s) inside a transaction and bump
   `PRAGMA user_version` to the new number. Because `init_schema` runs on
   every connect, the version check makes each breaking migration
   **run-once and idempotent**.
3. **Keep migrations forward-only and additive-first.** Prefer additive
   changes (new nullable column with default) over destructive ones
   whenever possible — that is already the house style and needs no
   version bump. Reserve `user_version` bumps for genuinely breaking
   transforms.
4. **Wrap breaking migrations in a transaction** so a crash mid-migration
   leaves the DB at the old `user_version` (retried next connect) rather
   than half-migrated.
5. **Never reuse or lower a version number.** Version numbers are
   per-store and monotonically increasing.
6. **Text/format stores (`dictionary.txt`)** stay on the current
   "tolerant reader" convention: add new format-parsing branches rather
   than a version header. If a truly incompatible format is ever
   required, add an explicit first-line format marker and keep the old
   reader path.
7. **Content vs. schema migrations are different.** `providers.db` seeds
   builtins only when empty; refreshing builtin *content* on upgrade is a
   content migration and should be handled explicitly (e.g. upsert
   builtins by id on startup), independent of `PRAGMA user_version`.

### Worked example (illustrative — do not implement here)

```rust
// inside HistorySqliteStorage::init_schema, AFTER the existing
// CREATE TABLE IF NOT EXISTS + column_exists additive steps:
let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
if v < 2 {
    let tx = conn.unchecked_transaction()?;
    // ... ordered v1 -> v2 breaking transform (rename/drop/backfill) ...
    tx.execute_batch("PRAGMA user_version = 2;")?;
    tx.commit()?;
}
```

This is a documentation recommendation only. No store code, `CLAUDE.md`,
or migration was changed by this task; implementing actual migrations for
any store is explicitly out of scope here.
