# Review 1a — Round 2 (fresh, independent reviewer; read-only)

VERDICT: REJECT-FIX

One real, mechanical defect in the r2 delta blocks approval (a fixture file the new test
`include_str!`s is git-ignored and therefore not in the patch/commit → fresh clone fails to
compile the voxis-core test target). Everything else from round 1 is genuinely fixed; the fix
for the blocker is a one-line `.gitignore` negation + `git add`. No redo needed.

## Round-1 checklist

### F1 — data-gate was a same-code round-trip → **FIXED (with one blocking packaging defect + one coverage minor)**
- Fixture is genuinely static text, not produced by post-move code at test time:
  `crates/voxis-core/src/storage/data_gate_tests.rs:47-70` (`load_pre_t1_fixture_into`) uses only
  `include_str!("fixtures/pre_t1/*.sql")` + `rusqlite::Connection::open(...).execute_batch(sql)` and
  `std::fs::write` for the dictionary. No `voxis_core::storage` writer is invoked before the reader.
- Fixture files are literal `sqlite3 .dump` output: `fixtures/pre_t1/config_db.sql` (57 lines,
  `CREATE TABLE config(key,value)` + 49 `INSERT`s), `history_db.sql` (schema incl. the
  `duration REAL` ALTER-added column, `idx_timestamp`, 2 rows with fixed distinct timestamps),
  `providers_db.sql` (3 builtin + `data-gate-provider`), `prompts_db.sql` (`llm_prompts` +
  `llm_prompts_state` with `active_id = data_gate_prompt`), `dictionary.txt` (2 lines).
- Golden compare: `data_gate_tests.rs:121-131` — `serde_json::to_string_pretty(snapshot)` vs
  `include_str!("data_gate_golden.json")`, with a message pointing at README before regenerating.
- History order asserted without sort: `data_gate_tests.rs:83-95` collects `factory.history().load(None)`
  in returned order; only `prompt_ids` are sorted (`:109`), which is fine (set semantics).
- Round-trip test kept for default drift: `data_gate_default_config_round_trips` `:139-157`.
- Column-rename detection: YES — renaming a column in `history`/`llm_providers`/`llm_prompts` reader
  SQL would error against the frozen schema and fail the test (`unwrap()`s at `:82,:89,:97,:107`).
- Golden JSON secrets scan: `grep -nE 'sk-|gsk_|@'` over `fixtures/pre_t1/*` and
  `data_gate_golden.json` → only two README prose hits (`"pre-Task-1a"`, `ddfb30d`); `api_key`
  is `data-gate-known-api-key`, `llm_api_key` is empty, provider URL is `example.invalid`. Clean.
- README warns against regeneration: `fixtures/pre_t1/README.md:16-22` ("**DO NOT regenerate these
  files with current code when a format change is intended** … defeat the entire point of this gate").
  Generator is `#[ignore]`d (`data_gate_tests.rs:173-175`) with the same warning at `:166-168`.
- **Caveat on the specific question "would it FAIL if `hotkey_hold_ms` were renamed in both save+load":
  NO** — see Minors §1. The fixture stores `hotkey_hold_ms = 300`, and `DEFAULT_HOTKEY_HOLD_MS = 300`
  (`crates/voxis-core/src/config/consts.rs:127`); the loader is `get_typed(&conn, "hotkey_hold_ms",
  config.hotkey_hold_ms)` (`config_sqlite.rs:121`) so a renamed key silently falls back to the same
  value. Same for `typing_delay=12` (consts.rs:211), `overlay_margin=30` (consts.rs:238),
  `silence_timeout_ms=60000` (consts.rs:139), `max_recording_ms=600000` (consts.rs:146),
  `retention_limit=100` (mod.rs:505). Keys with non-default fixture values (`api_key`,
  `audio_feedback_volume=0.42`, `shortcut_bindings`, `auto_submit_key`, active prompt, custom
  provider, dictionary) ARE protected. The design is correct; the fixture just needs non-default
  scalars to give full per-key coverage. Not a round-1 regression → Minor, not a blocker.

### M2 — `tempfile` normal dep of core → **FIXED**
- `crates/voxis-core/Cargo.toml:34` `tempfile = { version = "3", optional = true }`;
  `:44` `test-utils = ["dep:tempfile"]`; `:50` unconditional `[dev-dependencies] tempfile = "3"`
  for core's own tests.
- `crates/voxis-core/src/storage/mod.rs:65-66` `#[cfg(any(test, feature = "test-utils"))] pub mod test_utils`.
- All other `tempfile::` references in core (`paths.rs`, `factory.rs`, `config_sqlite.rs`,
  `history_sqlite.rs`, `corrections*.rs`, `dictionary.rs`, `history.rs`, `sqlite_base.rs`,
  `providers/tests_*.rs`, `data_gate_tests.rs`) are inside `#[cfg(test)] mod tests` blocks
  (spot-checked paths.rs:259, factory.rs:101, config_sqlite.rs:433, history_sqlite.rs:256) or in
  test-only modules. No non-test code path references tempfile — consistent with the pre-verified
  `cargo tree -e normal | grep tempfile` being empty and the iOS no-features build passing.
- voice_lib declaration is correct Cargo usage: `src-tauri/Cargo.toml:49`
  `voxis-core = { path = "../crates/voxis-core", features = ["tauri-support"] }` in `[dependencies]`
  and `:148` `voxis-core = { path = "../crates/voxis-core", features = ["test-utils"] }` in
  `[dev-dependencies]`. Same path dep in both sections with additive features is permitted; the
  dev-dep features unify with the normal-dep features only for test/example/bench targets. No conflict.

### M3 — leftover empty dirs → **FIXED** (no empty dirs referenced in the patch; nothing found under
`crates/voxis-core/src/**` or `src-tauri/src/**` that is dir-only in the listed diff; agree with orchestrator's scope guard).

### NEW — `[profile.release]` silently ignored after workspace-root move → **FIXED**
- Root `/Cargo.toml` is a virtual workspace (`[workspace] resolver="2" members=["src-tauri","crates/voxis-core"]`)
  and now carries `[profile.release] panic="abort" codegen-units=1 lto=true opt-level="s" strip="debuginfo"`
  (verbatim, with the original crash-diagnostics comment block preserved).
- `src-tauri/Cargo.toml` has no `[profile.` table (grep) and no `[workspace]` table (grep exit=1),
  so the walk-up in the guard cannot stop at `src-tauri/`.
- Guard test `src-tauri/tests/release_profile_guard.rs`:
  - Root discovery `find_workspace_root` (`:103-123`) starts from `env!("CARGO_MANIFEST_DIR")` — for an
    integration test in package `voice` this is always `<repo>/src-tauri` regardless of whether cargo is
    invoked from the repo root or from `src-tauri/`, so both invocations resolve to `<repo>/Cargo.toml`. ✔
  - Assertions are real table-scoped parses, not `contains()`: `release_profile_value` (`:136-165`) tracks
    `in_release_profile` only between `[profile.release]` and the next `[...]` header, skips comments,
    strips inline comments (`strip_inline_comment` `:167-184`). Asserts `strip ∈ {"debuginfo","none"}`
    with explicit panics for `true`/`"symbols"` (`:36-49`), `panic == "abort"` (`:55-63`), `lto == "true"` (`:69-77`),
    and `!has_any_profile_table(src-tauri/Cargo.toml)` (`:83-96`, matches `[profile.` / `[profile]` at line start after trim). ✔
  - Minor robustness note: `find_workspace_root` matches the exact line `[workspace]`; a
    `[workspace.dependencies]`-only root wouldn't match, but any real root must have `[workspace]` itself, so fine.

## New findings

### BLOCKER — `fixtures/pre_t1/dictionary.txt` is git-ignored and absent from the patch
- **Where:** `.gitignore:33` (`dictionary.txt`, a bare pattern that matches at any depth) ignores
  `crates/voxis-core/src/storage/fixtures/pre_t1/dictionary.txt`.
  Evidence: `git check-ignore -v` → `.gitignore:33:dictionary.txt crates/.../pre_t1/dictionary.txt`;
  `git ls-files --others --exclude-standard fixtures/` lists README + 4 `.sql` but NOT dictionary.txt;
  `git ls-files --others --ignored` lists exactly dictionary.txt;
  `/tmp/ado.C4YWdv/diff_1a_r2.patch` contains `+++ b/.../pre_t1/README.md` and the four `.sql`
  files but has **no** `diff --git` entry for `dictionary.txt` (only mentions of it inside `.rs` text).
- **Why it matters:** `data_gate_tests.rs:52` `include_str!("fixtures/pre_t1/dictionary.txt")` is a
  compile-time include. On a fresh clone / CI / the parent applying this patch, the file does not
  exist → `voxis-core` **test target fails to compile** → `cargo test --workspace` fails for the whole
  workspace, and the data gate never runs. The orchestrator's 1051-pass result only holds on this
  working tree where the ignored file happens to exist on disk.
- **Fix (one of):**
  1. Append to `.gitignore`: `!crates/voxis-core/src/storage/fixtures/pre_t1/dictionary.txt`
     (or scope line 33 to the runtime location, e.g. `/dictionary.txt` / a config-dir pattern), then
     `git add crates/voxis-core/src/storage/fixtures/pre_t1/dictionary.txt`; or
  2. rename the fixture to `dictionary.fixture.txt` and update `include_str!` at `data_gate_tests.rs:52`
     and the README/generator (`:175ff`).
  Verify with `git check-ignore -v <path>` returning nothing and `git status --short` showing the file.
- Also worth a quick check that the `.db`/`config.ini` ignore patterns don't bite any *future* fixture
  (currently all DB fixtures are `.sql`, so they're fine).

### r2 delta scope (question 4)
Files in the patch outside the expected r2 set (fixtures dir, `data_gate_tests.rs`, `data_gate_golden.json`,
both `Cargo.toml`, root `Cargo.toml`, `Cargo.lock`, `release_profile_guard.rs`, `.gitignore`):
`.pi/plans/tauri-plugin-voxis.md`, `scripts/check-ios-build.sh`, `src/bindings.ts`, and the
`crates/voxis-core/src/**` + `src-tauri/src/**` move/shim files. I cannot diff against the r1 tree, but
these are all part of the r1-approved move (bindings.ts changes are specta doc-comment reflow
`\u2014 → —` and `voice_lib::` path prefixes only; plan amendment and iOS script are Task-1a
deliverables). Nothing in the patch looks like a new front opened in r2. `.gitignore` diff is
`+/target/` only (root-workspace target dir) — correct, and also the file where the blocker fix goes.

## Pre-verified facts
- **Agree** with all: 1051 passed / clippy clean / no non-root-profile warning / iOS script OK /
  `cargo tree` tempfile-free / no staged files (`git diff --cached --name-only | wc -l` → 0) /
  fmt-dirty pre-existing. One qualification: the 1051-pass is **not reproducible from the committed
  set** because of the ignored `dictionary.txt` (see Blocker) — it passes here only because the
  ignored file exists in the working tree.

## Minors (non-blocking; fix alongside the blocker if cheap)
1. **Fixture coverage gap for default-valued kv keys** (`fixtures/pre_t1/config_db.sql`): change the
   scalar values that currently equal the compiled defaults to distinct non-default values so a
   both-sides key rename is detected for every key, e.g. `hotkey_hold_ms=350`, `typing_delay=17`,
   `overlay_margin=33`, `silence_timeout_ms=61000`, `max_recording_ms=610000`, `retention_limit=101`,
   `history_days=31`, `vad_threshold=0.55`, and likewise for `model`/`language`/`hotkey`/`llm_model`
   if they equal defaults; then regenerate ONLY `data_gate_golden.json` (editing the SQL fixture by
   hand is exactly what the README permits — it is the writer-regeneration that is forbidden).
   The README (`:19-20`) explicitly cites "a renamed kv key" as the motivating case, so this closes the
   gap between the stated and actual guarantee.
2. `data_gate_tests.rs` still `use`s `super::prompts_sqlite::LlmPromptsStorage` directly rather than via
   `StorageFactory`; fine, but note the factory has no `prompts()` accessor so the fixture covers it via
   the concrete type — no action needed.
3. `find_workspace_root` in the guard reads the manifest as text; acceptable for a guard, and the
   parse is deliberately dependency-free (no `toml` dev-dep added) — no action.

## Summary for the parent
Round-1 items F1/M2/M3 and the profile.release regression are all fixed with real, table-scoped /
static-fixture implementations. The single blocker is packaging, not design: `.gitignore:33` swallows
the new `dictionary.txt` fixture that the test `include_str!`s, so the committed change would not
compile on a clean checkout. Un-ignore + `git add` (or rename), optionally bump the default-equal
fixture scalars, and this is APPROVE.
