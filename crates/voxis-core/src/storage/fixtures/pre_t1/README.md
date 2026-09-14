# pre_t1 data-gate fixture

Static `sqlite3 .dump` output (plus `dictionary.fixture.txt`) for a synthetic
"pre-Task-1a" install, committed so `storage::data_gate_tests` pins the
**on-disk format** independently of whatever the current writer code happens
to do. No real user data or API keys — every value is a fixture constant made
up for this test (`data-gate-known-api-key`, `data gate known transcription
one/two`, etc.).

Named `dictionary.fixture.txt`, not the real on-disk `dictionary.txt`: the
repo's root `.gitignore` has a bare `dictionary.txt` pattern (matches at any
depth) for the real per-user file, which would otherwise silently git-ignore
this fixture and break a clean-clone build.

Generated once (2026-09-15) from `ddfb30d`-equivalent post-Task-1a code (the
move was verified byte-identical to the `ddfb30d` baseline writers) via the
`#[ignore]`d `generate_pre_t1_fixture_scratch` test in `../data_gate_tests.rs`,
then `sqlite3 <db> .dump` on each resulting file (and the generator's
`dictionary.txt` output copied in as `dictionary.fixture.txt`).
`history_db.sql`'s two timestamps were hand-fixed to `2026-01-01 10:00:00` /
`:05` (distinct, so `ORDER BY timestamp DESC` is deterministic);
`prompts_db.sql`'s `created_at`/`updated_at` were normalized to a fixed epoch
(`1700000000`); several `config_db.sql` scalar kv values were hand-edited
away from the compiled defaults (see git history / the values themselves)
so a both-sides key rename can't silently fall back to a matching default
and pass undetected.

**DO NOT regenerate these files with current code when a format change is
intended** — that would make the writer and the reader agree with each other
again and defeat the entire point of this gate (it exists specifically to
catch a writer/reader drift, e.g. a renamed kv key, that a same-code
round-trip test cannot catch). Regenerating is only correct when a change is
a deliberate, reviewed, backward-compatible-migration-free format bump.
