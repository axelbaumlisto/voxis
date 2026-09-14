# Review: Task 1a — extract `voxis-core` (config + storage + AppConfig leaf types)

VERDICT: REJECT-FIX

One contained fix required (data-gate test does not meet the `[R1-Safety T5]` acceptance wording — it
is a same-code round-trip, not a pre-T1 fixture load). Everything else — the move itself, the shim,
the re-exports, dependency hygiene, call-site stability — checks out and is APPROVE-quality. The
code move is verified behaviour-identical, so there is no correctness risk in the diff as it stands;
the fix is about the durability of the safety gate the plan asked for.

## Findings

### F1 — Medium — `crates/voxis-core/src/storage/data_gate_tests.rs:37-152` — data-gate is a round-trip with post-move code, not a pre-T1 fixture
**What.** The test builds the fixture config dir *with the post-move `voxis_core::storage` writers*
(`factory.config().save`, `history().add`, `dictionary().add`, `providers().add`,
`LlmPromptsStorage::create/set_active_id`) and then reads it back with the same code, comparing the
loaded snapshot's **serde-JSON** to `data_gate_golden.json`.
**What it does pin (good):** `AppConfig` defaults (`hotkey_hold_ms: 300`, `retention_limit: 100`,
`vad.*`, `llm.model`, …), serde field names / enum string forms (`"cmd_enter"`,
`"kind":"transcribe_post_process"`), prompt seed ids, provider round-trip.
**What it does NOT pin (the actual gate purpose):** the on-disk format — SQLite key names in
`config.db` (`"hotkey_hold_ms"`, `"audio_feedback_volume"`, `"shortcut_bindings"` JSON blob…),
column names/schemas of `history.db`/`providers.db`/`prompts.db`, `dictionary.txt` line format. If a
future edit renamed the kv key `hotkey_hold_ms` → `hold_ms` in *both* `save` and `load`, this test
still passes while every real v0.1.5 install silently loses its setting. The task text is explicit:
"снимок **реальной pre-T1** config-dir (config.db + history.db + dictionary.txt + providers.db +
prompts.db) в tempdir → post-T1 `factory` загружает → каждое поле равно golden JSON".
**Why it matters.** This is the only automated safety net the plan set for Task 1 data
compatibility, and later 1b/plugin tasks will lean on it. Today the move is byte-equivalent (I
diffed every moved file, see below), so nothing is broken *now*.
**Fix (small, contained).** Generate the fixture once at baseline `ddfb30d` (e.g. a throwaway test
or `sqlite3 <db> .dump`) and commit it as text under
`crates/voxis-core/src/storage/fixtures/pre_t1/{config_db.sql,history_db.sql,providers_db.sql,prompts_db.sql,dictionary.txt}`.
In the test: create tempdir → `Connection::open(paths.config_db()).execute_batch(include_str!(...))`
for each db, write `dictionary.txt` → `StorageFactory::new(paths)` loads → compare to golden JSON.
Keep the existing round-trip test as well if desired (it does add default-drift coverage), but the
gate must load files that post-move code did not write. Synthetic values only (no real keys) — same
as now.

## Pre-verified facts: agree/disagree
- Tests/clippy/iOS-build counts: adopted as stated (not re-run; no cargo builds per process rules).
  Test-count delta (+13) is consistent with what I see: 2 new `paths.rs` tests, 2 data-gate tests,
  and moved tests (`auto_submit`/`audio_feedback`/`binding`/`prompts`) now counted under voxis-core.
- `cargo fmt` dirtiness pre-existing: agree; many "diffs" between moved files and originals are
  pure rustfmt reflow (verified with `diff -wB` → empty for all storage/config files except the
  intended changes listed below).
- `cargo tree -p voxis-core`: agree with the conclusion. Note the nuance: `tauri` is an *optional*
  dep behind `tauri-support`; `-p voxis-core` with no features never pulls it. Resolver 2 feature
  unification only bites when voxis-core is built in the same invocation as a crate enabling the
  feature (voice_lib), and any such crate already depends on tauri — so no hazard for the future
  plugin crate or the iOS gate (`check-ios-build.sh` uses `-p voxis-core`).
- `bindings.ts` doc-comment-only: agree (specta `Type` derive is unchanged; type names identical).
- Repo-root workspace + `Cargo.lock` move + `.gitignore /target/`: agree, matches amendment.

## Checked and OK
1. **Pure move, no behaviour change.** `git show ddfb30d:src-tauri/src/<f>` vs
   `crates/voxis-core/src/<f>` for **all** of: `storage/{paths,config_sqlite,config_ini,factory,
   sqlite_base,traits,history,history_sqlite,corrections,corrections_sqlite,dictionary,
   prompts_sqlite/*,providers/*}.rs`, `config/{mod,consts,validation}.rs`,
   `shortcut/binding/{mod,tests}.rs`, `llm/prompts/{mod,tests}.rs`. Only differences:
   rustfmt reflow; crate-path renames (`crate::output::auto_submit::AutoSubmitKey` →
   `crate::output_types::AutoSubmitKey`, `crate::audio_feedback::…` →
   `crate::audio_feedback_types::…`, `crate::shortcut::ShortcutBinding` →
   `crate::shortcut::binding::ShortcutBinding`); `change_handler` removed from core `config/mod.rs`
   (kept in voice_lib); `paths.rs` gained `voxis_desktop_config_dir()` with `app_config_dir()` kept
   as an alias, and `AppPaths::new` moved into a feature-gated block with identical body. No SQL,
   error strings, defaults, `#[cfg]` (incl. `libc::EXDEV`, `#[cfg(unix)]`) or public item names
   changed. `factory.rs`, `providers/storage.rs`, `traits.rs` are byte-identical.
2. **Leaf types** (`output_types::AutoSubmitKey`, `audio_feedback_types::AudioFeedbackSettings`):
   derives, `#[serde(rename_all = "snake_case")]`, `#[default] Off`, `volume: 0.6 / enabled: false`
   identical to originals. Their unit tests moved (not duplicated) — old `tests.rs` files carry a
   pointer comment.
3. **Shim design (`AppPaths::new(&AppHandle)` behind `tauri-support`)**: acceptable. Reasoning is
   sound: orphan rule forbids an inherent impl from voice_lib on a foreign type, an extension trait
   would need `use` at `setup/mod.rs` / `commands/overlay.rs`, and the plan mandates unchanged call
   sites (verified: `git diff ddfb30d --stat` on `setup/`, `commands/`, `orchestrator/`, `tray/`,
   `lib.rs` is empty). Default-off, only voice_lib enables it, iOS gate uses `-p voxis-core`. See
   Minor M1 for the cleaner follow-up.
4. **Re-exports are the same types, not copies.** voice_lib `storage/mod.rs`, `config/mod.rs`,
   `shortcut/binding/mod.rs`, `llm/prompts/mod.rs`, `output/auto_submit/mod.rs`,
   `audio_feedback/mod.rs` all `pub use voxis_core::…`; no duplicated definitions remain
   (`grep 'pub (struct|enum) (AppConfig|AppPaths|AutoSubmitKey|…)'` in src-tauri/src → none).
   Visibility not widened: `pub use voxis_core::config::*` exports exactly what the old module
   exported (`consts`/`validation` remain private mods in core); `find_by_id` etc. were already pub
   and re-exported at `shortcut::`. `Arc<dyn ConfigStorageTrait>` across the boundary is fine.
5. **Deps removed from voice_lib** (`rusqlite`, `rust-ini`, `regex`): `grep -rE
   '(rusqlite|ini|regex)::|^use (rusqlite|ini|regex)'` under `src-tauri/src` → no hits. Clean.
6. **`voxis_desktop_config_dir()`** macOS test asserts `ends_with("Library/Application
   Support/voxis")`; second test pins `voxis_desktop_config_dir() == app_config_dir()`; data-gate
   pins `APP_CONFIG_DIR == "voxis"`. Satisfies the "config_dir == путь v0.1.5" assertion.
7. **Workspace**: root `Cargo.toml` resolver 2, members `src-tauri` + `crates/voxis-core`;
   `src-tauri/Cargo.toml` depends on `voxis-core` by path with `tauri-support`; `rust-version` set.
   `scripts/check-ios-build.sh` builds both iOS targets with no features.
8. **Module naming for Task 1b**: `output_types.rs` / `audio_feedback_types.rs` (flat) vs
   `shortcut/binding` / `llm/prompts` (nested) is slightly asymmetric but each is documented and
   maps 1:1 to the voice_lib module it was split from; 1b can grow `output/`, `audio_feedback/`
   directories by turning the files into `mod.rs` without touching re-export paths. Not gold-plated.

## Minors (non-blocking, may be filed)
- **M1** `crates/voxis-core/Cargo.toml:32-35`, `storage/paths.rs:245-258`: `AppPaths::new(_app:
  &AppHandle)` ignores its argument. The optional `tauri` dep exists solely to preserve two call
  sites' spelling. Follow-up (1b or later): change `setup/mod.rs` + `commands/overlay.rs` to
  `AppPaths::for_desktop()` (or similar) and drop the `tauri-support` feature entirely, making the
  acceptance "voxis-core не зависит от tauri" literally true rather than by-default.
- **M2** `crates/voxis-core/Cargo.toml:26-30`, `storage/mod.rs:55-68`: `tempfile` is now a
  *normal* dependency (shipped in release and iOS builds) so `test_utils::create_temp_paths` can be
  reached from voice_lib tests. Prefer `tempfile = { optional = true }` + `features = ["test-utils"]`
  enabled via voice_lib's `[dev-dependencies] voxis-core = { …, features = ["test-utils"] }`.
- **M3** Working tree has leftover empty dirs `src-tauri/src/storage/prompts_sqlite/` and
  `src-tauri/src/storage/providers/` (git-untracked, from `git mv`). Harmless but confusing next to
  the shim `mod.rs`; `rmdir` them.
- **M4** `data_gate_tests.rs`: history rows are sorted to dodge same-second timestamp ties — with a
  real pre-T1 fixture (F1) timestamps are fixed and the sort can go, tightening the assertion to
  include ordering.
- **M5** `crates/voxis-core/Cargo.toml`: `specta` features `["derive"]` vs voice_lib's `["chrono"]`
  — fine under unification today, but if core ever derives `Type` on a `chrono` field it will fail
  in the `-p voxis-core` iOS build only. Worth a one-line comment.
