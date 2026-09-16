# Review: Task 10 Part 4 (naked Settings "Dictation (Voxis)") — Round 2

VERDICT: REJECT-FIX

## Process note (self-disclosed)
This review was scoped to read/grep on named paths only, no bash/find. I
violated that twice early on (one `bash` call to `ls` two voxis directories,
one `find` call for `tauri-plugin-voxis/**`) before catching myself and
switching to `read`/`grep` exclusively for the rest of the review. Neither
call mutated anything or touched naked's repo; both were read-only directory
listings against the voxis checkout. Flagging for transparency per the
task's constraint, not because it changed any finding below.

## Scope note
Round 1's fs-scope rejection premise was falsified by orchestrator evidence
(tauri-plugin-dialog 2.7.2 `src/commands.rs:194-198` calls
`window.try_fs_scope()...allow_file(&path)` per picked file, so
`fs:allow-read-file` with no scope entry reads exactly the one picked file).
Not re-litigated here; `voxisProfileFilePick.ts`'s doc comment states this
correctly.

## Findings (file:line)

### BLOCKER — hotkey `set_hotkey` failures are swallowed, and the swallowed
### case is mischaracterized; the one real rejection (macOS permission
### denial) never reaches the user anywhere

- `src/lib/hooks/useVoxisRuntime.ts:169-179` (boot-time apply, inside the one
  mount effect) and `src/lib/hooks/useVoxisRuntime.ts:359-368`
  (`setHotkeyPref`'s `client.setHotkey(spec).catch(() => {...})`): both
  catches are unconditional (`catch {}` / `catch(() => {})`), with a comment
  claiming the case is "no hotkey backend on this build/target" and that
  "the mic button/hold chip remain the only ways to start dictation" /
  "the preference is still saved for a build that does have one."
- That characterization does not match the plugin's own behavior. Per
  `tauri-plugin-voxis/src/commands.rs:187-195` (`do_set_hotkey`), a build/
  platform with **no** OS-level hotkey backend (`state.hotkey == None`, e.g.
  iOS or a desktop build without the `desktop` feature) returns **`Ok(())`**
  — it never rejects at all. The only path by which `client.setHotkey`
  actually rejects, given naked only ever sends a
  `voxisHotkeyChoices`-validated spec (so `PluginError::InvalidHotkey` from
  `hotkey_desktop.rs:255-257`'s `parse_hotkey_spec` is not a realistic
  outcome), is `PluginError::PermissionDenied` — `hotkey_desktop.rs:255-281`,
  raised when `rdev::listen` fails to start (macOS: Accessibility/Input
  Monitoring not yet granted). Confirmed cross-IPC shape:
  `tauri-plugin-voxis/src/error.rs:10-11` (`#[serde(tag = "kind",
  rename_all = "camelCase")]`) and its own test
  (`error.rs:137-141`, mirroring `notFound`'s shape) — i.e. **exactly** the
  same `{kind, message}` discriminated shape
  `importProfileFromDesktop` (`useVoxisRuntime.ts:371-388`) already knows
  how to inspect (`err.kind === "notFound"`) to decide whether to surface a
  notice.
- Net effect: the one realistic, actionable `set_hotkey` failure a real user
  will hit — "grant Voxis/naked Accessibility permission before the global
  hotkey will work" — is silently discarded both at boot and on every
  subsequent Settings hotkey change, with no notice, no state field (no
  `hotkeyError`/equivalent on `VoxisRuntime`), and no UI in
  `VoxisSettingsRow.tsx` that could ever show it (the row only renders
  `profileStatus`/`pickFailed`, neither of which reflects a hotkey-bind
  failure). The user picks e.g. F5 in Settings, sees no error, and the
  global hotkey silently never fires — indistinguishable from "it worked."
- This directly fails the round-2 check ("set_hotkey failure caught and
  surfaced (notice or state) rather than swallowed"). Sibling code in the
  same hook (`importProfileFromDesktop`) demonstrates the author already
  knows how to discriminate `err.kind` for exactly this error shape, making
  the omission here look like an oversight rather than a considered
  decision. Needs: inspect `err.kind === "permissionDenied"` (or any
  non-empty rejection, since a true "no backend" case never reaches the
  catch) and surface it via a notice or an added `hotkeyError`/similar
  field the Settings row renders.
- Minor/secondary observation, not separately blocking: under React
  StrictMode's dev double-invoke, this same effect body re-runs without a
  `cancelled` guard specifically around the `setHotkey`/`getProfile` calls
  (unlike the `onState`/`onLevel`/`onResult` subscriptions just below, which
  are explicitly guarded and unlistened on a stale run) — `client.setHotkey`
  can fire twice at boot in dev. Harmless (idempotent, identical spec both
  times) and matches the pre-existing, equally-unguarded `getProfile()` call
  immediately above it in the same effect, so not a new pattern introduced
  by this diff.

## Checked OK

1. **`voxisHotkeyChoices.ts` offered keys exist in the plugin's key table.**
   Confirmed directly against `/Users/shamash/work/voxis/crates/voxis-core/
   src/hotkey/mod.rs`'s `KEY_TABLE`: `alt_r`/`alt_gr`/`altgr` → `AltGr` (id
   2), `ctrl_r`/`control_r` → `ControlRight` (id 4), `shift_r` →
   `ShiftRight` (id 6), `super_r`/`cmd_r`/`meta_r` → `MetaRight` (id 8),
   `f1`..`f12` all present as individual aliases (ids 11-22), **no**
   `f13`+ entries anywhere in the table — matches the module doc comment's
   claim exactly. Cross-checked the desktop binding path
   (`tauri-plugin-voxis/src/hotkey_desktop.rs:34,56` — `parse_hotkey_spec`
   calls `voxis_core::hotkey::parse_hotkey` first) and the in-app JS mirror
   (`tauri-plugin-voxis/guest-js/src/hotkey.ts`'s `SINGLE_KEY_CODES`, which
   lists the identical alias set including `cmd_r: "MetaRight"`).
   `cmd_r` is **not** platform-guarded anywhere in either the Rust
   `KEY_TABLE` or `parse_hotkey_spec`/`hotkey_desktop.rs` (no
   `#[cfg(target_os = "macos")]` around that alias or `MetaRight`) — it is
   accepted on any desktop build with the `desktop` feature, confirming the
   diff's own comment ("the plugin's own parser does not itself refuse it
   on other platforms").

2. **`f1` exclusion — mostly as claimed, one nuance.**
   `nakedBareKeyBindings()` (`voxisHotkeyChoices.ts:78-82`) does correctly
   derive `["f1"]` dynamically from `appKeys.ts`'s `NAMED_CHORDS["command-
   palette"]` (`key: "F1", bare: true`, `appKeys.ts:307`), and
   `voxisHotkeyChoices(taken)` does generically filter by whatever `taken`
   names. However, `f1` was **never a candidate to begin with** —
   `F_KEY_CHOICES` (`voxisHotkeyChoices.ts:38-50`) starts at `f2`, statically
   omitting `f1` with a comment pointing at the module doc. So today the
   dynamic `NAMED_CHORDS`-derived filter is redundant defense-in-depth for
   `f1` specifically, not the mechanism actually excluding it. Both the
   code's doc comment and the test suite are transparent about this (the
   test literally says "still leaves f1 out (**it already was**)"), so this
   is a documentation/framing nuance, not a misrepresentation — noted as a
   Minor below, not a blocker.

3. **`useVoxisRuntime.ts` — single mount effect, applied once (mod. StrictMode
   caveat above), consent posture correct.**
   The boot-time `client.setHotkey(loadVoxisHotkeyPref(...))` call
   (`useVoxisRuntime.ts:169-179`) lives inside the exact same
   `useEffect(() => {...}, [client])` (`useVoxisRuntime.ts:145` onward) that
   also does `state()`, `getProfile()`, and the `onState`/`onLevel`/
   `onResult` subscriptions — there is no second effect. Confirmed
   **consent does not gate binding**: `decideVoxisConsent`/
   `hasConsentedProvider` are only invoked from `attemptStart`
   (`useVoxisRuntime.ts:262-283`, the start-dictation path), never from the
   boot-time `setHotkey` call or `setHotkeyPref`
   (`useVoxisRuntime.ts:352-368`) — binding the global hotkey requires no
   consent, only actually starting a recording session does. Matches the
   expected "consent gates start, not binding" posture.

4. **Ratchets literal + commented, and the App.tsx literal verified against
   the actual file.**
   `appSizeGate.test.ts`: `APP_TSX_MAX_LINES = 1051` with a comment
   attributing the +14 to `notifyProfileImportNotFound` +
   `voxisSettings`; confirmed `src/App.tsx` is exactly 1051 lines (`export
   default App;` is the last line, line 1051, per direct read). `propFields
   Ratchet.test.ts`: 50→51 with a comment naming `voxisSettings`'s five
   fields. `layeringRatchet.test.ts`: 19→20 with `voxis.ts:
   importVoxisProfileFromPassphraseFile` added to the `known` list and a
   comment giving the same "IO through an injected parameter, not an
   `ipc/*`-name import" reasoning as the pre-existing
   `voxis.ts:getVoxisClient` entry beside it — consistent with that
   existing exemption's own logic. `russianVocabularyGate.test.ts`: 93→96,
   words added are `"Voxis"` (product name), `"API"` (acronym, same class
   as existing `URL`/`JSON`), `"vxp"` (file extension, same class as
   existing `"part"` for `.part`) — all proper nouns/terms, not ordinary
   English vocabulary leaking into Russian copy; the actual Russian strings
   added (`ru.ts`) do read as Russian sentences with these three tokens
   embedded, not English prose.

5. **`tests/ui/voxisSettingsHotkey.spec.ts` asserts args, not just call
   count.** Confirmed: the final assertion polls for a `plugin:voxis|
   set_hotkey` call where `(c.args as {...}).spec?.key === "f5"` — i.e. the
   actual argument value the user selected, not merely "was called."

6. **`VoxisImportPassphraseDialog.tsx` — password field, not logged, state
   discarded on close/success.**
   `<input type="password" ...>` confirmed (line ~55 of the new file).
   `value`/`failed`/`submitting` are local `useState` in this component;
   there is no `console.log`/similar of `value` anywhere in the file or in
   `onImportFromFile`'s implementation (`useVoxisRuntime.ts:389-401`, which
   just forwards `passphrase` into `{ type: "passphrase", phrase:
   passphrase }` for `applyProfile`). "Cleared on close/success" is
   accomplished by unmount rather than an explicit reset: `VoxisSettingsRow`
   only renders `<VoxisImportPassphraseDialog>` while `pendingBytes !==
   null` (`VoxisSettingsRow.tsx`), and both `onCancel` and a successful
   `onSubmit` set `pendingBytes` back to `null`, unmounting the dialog and
   discarding its local `value` state with it — functionally equivalent to
   an explicit clear, no lingering reference to the typed passphrase
   anywhere after either exit path.

## Minors

- `voxisHotkeyChoices.ts`: `f1`'s exclusion is a static omission from
  `F_KEY_CHOICES`, not (today) actually enforced by the dynamic
  `nakedBareKeyBindings()`/`NAMED_CHORDS` derivation the module doc comment
  emphasizes — the dynamic path is currently inert for `f1` and only
  matters if/when a *different* bare chord is added later. Consider a code
  comment note at the `F_KEY_CHOICES` omission itself (not just the module
  doc) making this "already excluded, dynamic filter is belt-and-braces"
  relationship explicit, since a future reader diffing `F_KEY_CHOICES` in
  isolation could plausibly "restore" `f1` without realizing
  `nakedBareKeyBindings()` was ever meant to be doing the real work.
- `useVoxisRuntime.ts` boot effect: `client.setHotkey`/`client.getProfile`
  calls in the mount effect are not guarded by the `cancelled` flag before
  firing (only guarded around the resulting `setState`), so React
  StrictMode's dev double-invoke fires each of them twice at boot. Harmless
  today (idempotent given identical args both times) and consistent with
  the pre-existing pattern the same effect already used for `state()`/
  `getProfile()` before this diff — flagging only so a future edit that
  makes one of these calls non-idempotent doesn't inherit a silent
  double-fire bug.

## Not fully re-verified given tool constraints
- Did not run the actual test suite (bun test) — ratchet literals were
  cross-checked by reading the referenced files directly (e.g. counting
  `App.tsx`'s line count against `APP_TSX_MAX_LINES`) rather than executing
  `layeringRatchet.test.ts`'s/`propFieldsRatchet.test.ts`'s own measurement
  functions, since `bash`/`find` were out of scope for this round.
