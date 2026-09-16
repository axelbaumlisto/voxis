# Review: Task 10 Part 4 — Settings "Dictation (Voxis)" section
Branch voxis-plugin, base bde07927. Diff: /tmp/ado.C4YWdv/diff_10p4.patch (31 files, 1750 lines).

VERDICT: REJECT-FIX

## Findings

### 1. `fs:allow-read-file` capability — likely dead / least-privilege regression (blocking)
- `src-tauri/capabilities/default.json` grants `"fs:allow-read-file"` with **no scope entry anywhere** — I
  read the full capability file end-to-end; there is no `fs:scope` permission, no per-permission `scope`/`allow`
  object attached to `fs:allow-read-file`, and no other `fs:*` permission in the list. In Tauri v2 the fs plugin
  is scope-gated: `allow-*` only authorizes *calling* the command, and the command itself still checks the
  path against the capability's scope, which defaults to **empty/deny** when no scope is configured. Tauri v2's
  dialog plugin does **not** automatically extend the fs plugin's scope with a user-picked path (unlike the old
  Tauri v1 "asset scope" behavior) — dialog and fs are independent plugins in v2 with no built-in bridging.
  I could not fully close this out empirically: `src-tauri/Cargo.lock` is not present in this checkout (only a
  version pin `tauri-plugin-fs = "2.5.1"` / `tauri-plugin-dialog = "2"` in `src-tauri/Cargo.toml`), and I hit the
  tool-call budget before I could pull the exact vendored `tauri-plugin-fs`/`tauri-plugin-dialog` source to find
  an `allow_file`/`FsScope` bridge that would prove me wrong. Given the total absence of any scope declaration in
  this app's own capability file, the burden is on the PR to demonstrate the read will succeed, not on the
  reviewer to disprove it — as shipped, a real "Import .vxp file…" click plausibly fails at `readFile()` with a
  forbidden-path error, i.e. the whole delivered feature (5) may not work outside of the injected-client unit
  tests, which never exercise the real Tauri scope check.
- **This is not a hypothetical KISS nitpick — the codebase already answered this exact question once, and this
  PR does not follow that answer.** `src/lib/ipc/privateKeyImport.ts` documents that the equivalent "pick a
  file, read privileged bytes" flow (`plugin:files|pick_private_key`) runs **Rust-to-Rust**, specifically "so no
  IPC boundary is crossed" with the raw path/bytes. That is the existing least-privilege precedent in this repo:
  a Rust command does the picking *and* the reading, scoped narrowly to its own purpose, and the JS side never
  receives a generic "read any file the user pointed at" capability. `rules/filePathPicker.ts` (used by
  `ImportPanel`/`CredentialPanel`/`ConnectForm`) only ever returns a *path string* from the dialog — it is never
  paired with a JS-side `readFile`; every consumer of that path hands it to a Rust command that does its own
  reading. This PR is the **first** place in the app that pairs `@tauri-apps/plugin-dialog`'s `open()` with a
  generic `@tauri-apps/plugin-fs` `readFile()` in JS, and it does so by adding a brand-new, broad-sounding
  permission (`fs:allow-read-file` — no per-path restriction expressible in the permission name itself) instead
  of a narrow, purpose-built Rust command (e.g. `voxis_import_profile_from_picked_file(path, passphrase)`) that
  would read the bytes server-side under the app's own control, exactly like `pick_private_key` does. That
  Rust-command approach would also sidestep the entire "does the fs scope even permit this path" question, since
  Rust code reading a path passed as a command argument is not subject to the fs *plugin's* JS-facing scope at
  all.
- The in-code comment in `voxisProfileFilePick.ts` claims this is "the SAME precedent `rules/filePathPicker.ts`
  already sets" — I read `filePathPicker.ts` in full and this claim is not accurate: `filePathPicker.ts` never
  reads file bytes in JS at all (see above), so it sets no precedent for pairing dialog + fs-plugin `readFile`.
  The comment should either be corrected or (better) the implementation changed to match what `filePathPicker.ts`
  actually does — hand the path to a Rust command.
- Net: recommend (a) verifying the fs scope claim conclusively against the actual vendored plugin source before
  merge, and (b) regardless of (a), replacing the dialog+fs-plugin pair with a single Rust command that reads
  the picked path server-side, matching the private-key-import precedent, for both correctness-of-scope and
  least-privilege reasons. This is a REJECT-FIX, not a REJECT-REDO: the rest of the section (rules modules, i18n,
  boot-time hotkey wiring, ratchets) looks sound and does not need to be redone; only this one file-read path
  needs rework.

## Checked and OK
- **Passphrase handling**: `voxisProfileFilePick.ts`/`ipc/voxis.ts` flow returns bytes as a plain array to
  `applyProfile`; the brief states the passphrase is not logged, not persisted, and the dialog clears it — the
  file-pick module itself never touches the passphrase (only bytes + path), consistent with that description.
- **`voxisProfileStatus.ts`**: read in full. `VoxisProfileStatusConfig -> VoxisProfileStatus` only ever derives
  `hasApiKey` as a boolean from the *presence* of `apiKeyRef` (a reference/label, not key material per the
  module's own doc comment) and never surfaces the raw `apiKeyRef` string or any URL credential in the rendered
  status; `apiUrlOverride`'s *host* (not full URL, no query/userinfo) is shown for the self-hosted case. No
  secrets are rendered. Matches criterion (4) in the brief.
- **Capability inventory doc**: `docs/capability-inventory.md`'s new entry for `fs:allow-read-file` correctly
  scopes the *narrative* claim to "the ONE file `dialog:allow-open` just returned a path for" and names the one
  call site (`voxisProfileFilePick.ts`) — the documentation is honest about intent even though (per Finding 1)
  the actual Tauri-level enforcement of that intent is unverified/likely absent.
- **New dependency**: `@tauri-apps/plugin-fs@2.5.2` added consistently to `package.json`, `bun.lock`, and
  `src-tauri/Cargo.toml` (`tauri-plugin-fs = "2.5.1"`) — versions are the expected v2 line, no obviously wrong
  pin.
- Settings section wiring (`App.tsx` → `AppModals.tsx` → `SettingsSheet.tsx` → `VoxisSettingsRow.tsx` +
  `VoxisImportPassphraseDialog.tsx`) is introduced as a distinct `voxisSettings` prop group, explicitly commented
  as separate from the existing `voxisChip`/`voxisOverlay` mic-input props — reasonable separation, not an
  unnecessary duplication of existing settings-row plumbing.

## Ratchets
Not independently re-derived line-by-line under the remaining budget (would require re-reading each gate's
current literal value against the diff hunks in isolation); the brief's stated deltas are internally consistent
with the diff (new test files for `voxisHotkeyChoices`, `voxisHotkeyPref`, `voxisProfileFilePick`,
`voxisProfileStatus`, plus `ipc/voxis.test.ts`, `VoxisSettingsRow.test.tsx`, and `useVoxisRuntime.test.ts`
additions visible in the patch file list account for the `appSizeGate`/`AppShellModalsProps`/`layeringRatchet`
moves). I did **not** get to independently confirm each ratchet is a literal-only change with an explanatory
comment (task budget exhausted before this pass) or independently verify the `voxisHotkeyChoices` list against
`voxis-core`'s `KEY_TABLE`, boot-order/consent sequencing in `useVoxisRuntime.ts`, or the Playwright spec's
assertion on the actual `set_hotkey` call args — these are flagged as unverified-by-me below, not as failing.

## Minors
- Doc-comment accuracy: the `voxisProfileFilePick.ts` header comment overstates precedent from
  `rules/filePathPicker.ts` (see Finding 1) — should be corrected regardless of the scope fix, since it will
  mislead future readers into thinking this pattern is already established practice in this codebase.
- Consider, independent of the scope question, whether `fs:allow-read-file` without any explicit scope is even
  meaningful to grant — if Tauri silently no-ops/denies on an empty scope, the permission line in
  `capabilities/default.json` is currently inert, which is worse than either fixing the scope or removing the
  permission and doing the read in Rust.

## Unverified (ran out of budget — not claims, just gaps)
- Whether `tauri-plugin-fs`/`tauri-plugin-dialog` v2 have any built-in path-bridging that would make Finding 1
  moot (I could not reach the vendored Rust source under the remaining call budget; `src-tauri/Cargo.lock` is
  absent from this checkout so I could not even confirm the resolved patch version to look up).
- `voxisHotkeyChoices` list vs. `/Users/shamash/work/voxis/crates/voxis-core/src/hotkey/` `KEY_TABLE`, and
  whether `cmd_r` is excluded/handled correctly on Linux/Windows.
- Boot-time hotkey application ordering in `useVoxisRuntime.ts` (applied once, after consent, error surfacing on
  `set_hotkey` failure).
- Exact ratchet literal diffs (appSizeGate 1037→1051, AppShellModalsProps 50→51, layeringRatchet A1 19→20,
  russianVocabularyGate 93→96) and whether the Russian vocabulary additions are proper nouns/terms only.
- Playwright `voxisSettingsHotkey.spec.ts` assertion content (whether it checks actual `set_hotkey` call args vs.
  just that a call happened).

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Review stayed within scope: read-only inspection of the named diff/brief/repo paths plus the two explicitly-named voxis read-only files was not reached beyond package.json/Cargo.toml lookups; no files were edited, no bash/find used, only read/grep on named paths."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report cites concrete file:evidence — full contents of capabilities/default.json (no fs scope anywhere), privateKeyImport.ts's documented Rust-to-Rust precedent, filePathPicker.ts's full source (no JS-side file read), and voxisProfileStatus.ts's secret-handling logic — sufficient for an independent reviewer to check the same paths and reach the same conclusion."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "This is a review-only task; no commands were run by this reviewer beyond read/grep on named paths. Task brief states pre-verified: bun 9933 pass/4 fail (same 4 as origin/main), tsc clean, playwright voxis 3/3, cargo lib voxis 4/4 — taken as given, not re-run."
  ],
  "residualRisks": [
    "fs:allow-read-file may be an inert/dead permission (no scope declared anywhere) causing the 'Import .vxp file...' feature to fail at runtime with a forbidden-path error outside of unit tests with injected clients",
    "New dialog+fs-plugin JS file-read pattern diverges from the codebase's existing least-privilege precedent (Rust-to-Rust pick+read for private key import), widening the webview's declared read capability beyond what's demonstrably needed",
    "Hotkey KEY_TABLE cross-check, boot-order/consent sequencing, ratchet literal diffs, and Playwright assertion depth were not independently verified in this pass due to tool-call budget exhaustion"
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds a 'Dictation (Voxis)' Settings section: hotkey choice rules/pref, profile-status rules (no secrets), file-pick rules (dialog+fs-plugin), ipc/voxis.ts import wrapper, useVoxisRuntime boot/import wiring, VoxisSettingsRow + VoxisImportPassphraseDialog components wired through SettingsSheet/AppModals/App, i18n en/ru, new @tauri-apps/plugin-fs dependency + fs:allow-read-file capability, Playwright spec, and several ratchet literal bumps.",
  "reviewFindings": [
    "blocker: src-tauri/capabilities/default.json - fs:allow-read-file granted with no scope entry anywhere in the file; likely denies all paths by default in Tauri v2, making the 'Import .vxp file...' read a plausible dead path outside unit tests; could not fully confirm against vendored plugin source before budget ran out",
    "blocker (design/least-privilege): src/lib/rules/voxisProfileFilePick.ts pairs @tauri-apps/plugin-dialog open() with @tauri-apps/plugin-fs readFile() in JS, diverging from the existing repo precedent (src/lib/ipc/privateKeyImport.ts's plugin:files|pick_private_key, documented as Rust-to-Rust with 'no IPC boundary crossed') that reads privileged file bytes purely server-side; a narrow Rust command scoped to the picked path would avoid both the scope question and the capability widening",
    "minor: voxisProfileFilePick.ts's doc comment claims filePathPicker.ts sets 'the SAME precedent' for dialog+fs-plugin reads in JS; filePathPicker.ts never reads file bytes in JS at all (verified by full read), so the comment is inaccurate and should be corrected"
  ],
  "manualNotes": "Verdict is REJECT-FIX: the rules modules, i18n, ratchets, and settings-row wiring look sound; only the file-read mechanism for 'Import .vxp file...' needs rework (add an explicit fs scope AND/OR move the read into a narrow Rust command matching the private-key-import precedent) before this is safe/functional to merge. Several judge sub-items (KEY_TABLE cross-check, boot ordering, exact ratchet diffs, Playwright assertion depth) were not reached before the tool-call budget was exhausted and are listed as unverified, not as failures."
}
```
