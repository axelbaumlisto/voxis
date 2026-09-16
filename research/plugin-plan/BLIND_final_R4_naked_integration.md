# BLIND review R4 — host-integration + security (naked `voxis-plugin`)

VERDICT: SHIP

Scope reviewed: `voxis_secrets.rs` + `lib.rs` plugin registration, `capabilities/default.json`,
`ipc/voxis.ts` (single seam), `useVoxisRuntime.ts`, `useVoxisOverlayMount.ts`, `useOverlayDrag.ts`,
`VoxisOverlayHost.tsx`, `VoxisSettingsRow.tsx`, `VoxisConsentDialog.tsx`, `VoxisImportPassphraseDialog.tsx`,
`rules/voxis*` (result routing, consent, hotkey pref/choices, theme pref, pill press, overlay placement,
keyboard clamp, profile file pick), `useMeasuredElementVar` usage, i18n en/ru. Ran the named test suite once.

## Blockers
None found. The security-critical seams (secret at rest, consent gate, sanitized paste, capability grants)
all hold up under direct reading of the code.

## Should-fix (non-blocking)

- **`VoxisOverlayHost.tsx:onLostPointerCapture` cancels the press but not the drag.**
  `onLostPointerCapture={() => pressRef.current?.cancel()}` fires `press.cancel()` but does NOT call
  `drag`'s reset. `useOverlayDrag` has no `lostpointercapture` path of its own (it only resets on
  `pointerup`/`pointercancel`). If capture is dropped mid-**armed-drag** without a preceding
  `pointercancel` (the exact iOS-Safari system-gesture case the press handler was added for), the drag hook
  can stay in `phase: "armed"` with `dragging === true` and a leftover `transform` — a pill stuck following
  nothing until the next `pointerdown`. The press side is correct; the drag side has the gap the code's own
  comment says it closed. Minimal fix: also call `drag.cancel()` from `onLostPointerCapture`.

- **`voxisHotkeyPref.ts:parse()` validates `mode` but accepts ANY string for `key`.**
  A persisted/edited `naked.voxis.hotkey.v1` value like `{"key":"space","mode":"hold"}` passes `parse()`
  (only `mode` is range-checked) and is applied verbatim at boot via `client.setHotkey`. `space` IS a
  valid plugin parser key (the choices doc explicitly names `space`/`enter`/etc. as parser-accepted but
  unsafe), so a bad stored value would bind an ordinary typed key as a global hold hotkey — the "landmine"
  `voxisHotkeyChoices.ts` deliberately avoids offering. In practice the only writer is the Settings
  `<select>` (which never offers those), so real-world risk is low, but the load path does not itself
  reject a key outside the safe candidate set. Minimal fix: validate `key` against
  `ALL_VOXIS_HOTKEY_CHOICES` (or the parser's safe subset) in `loadVoxisHotkeyPref`, falling back to
  `DEFAULT_VOXIS_HOTKEY` otherwise. (The brief's "hotkey pref only accepts parser-valid keys" is satisfied
  at the UI layer but not at the persistence-load layer.)

## Verified OK

- **Secret adapter — namespace + AAD role, no plaintext at rest, no Keychain.**
  `NakedVoxisSecretStore` is a pure delegate over `naked_core::SecretStore`; every name is prefixed
  `voxis:` (`namespaced()`), so a plugin secret can never collide with a host SSH secret sharing a bare
  name. `lib.rs:625-671` constructs a **fourth** `EncryptedFileSecretStore::new_with_role(..., "voxis-secrets")`
  on the shared `SECRET_STORE_FILE`, AAD-bound distinctly (envelope `payload_aad(role)`) from
  `host-secrets`/`ssh-keys`/`sync-secrets`, and registers the plugin with
  `init_desktop_with(voxis_secrets)` / `init_ios_with(Some(..))` — so the plugin's own unencrypted
  `FileSecretStore` fallback is overridden, never used. The `Some(app_data.join("voxis-plaintext.json"))`
  argument is the standard legacy-plaintext migration hook (`migration.rs` only reads it if the file
  exists); for a brand-new plugin that file never exists, so it is inert — no plaintext is written.
  The in-crate E2E test `apply_profile_bytes_never_writes_the_api_key_into_the_plugins_own_storage`
  drives the plugin's REAL `apply_profile_bytes` with this adapter over a real `EncryptedFileSecretStore`,
  walks every file under the tempdir grepping for the raw `sk-` key, asserts it appears NOWHERE except
  naked's own store file, and asserts that file holds it as AEAD ciphertext (not raw bytes). This is a
  real end-to-end proof, not a vacuous one. Keychain: `secrets.rs`'s old keychain code is explicitly
  no longer constructed (lib.rs comment) — DEK/KEK envelope only.

- **Capability grants minimal.** `capabilities/default.json` adds exactly `voxis:default` for the plugin,
  plus `dialog:allow-open`, `fs:allow-read-file`, `clipboard-manager:allow-read-text/write-text`,
  `notification:default` (all pre-existing host needs reused). `fs:allow-read-file` carries **no static
  scope entry** — `voxisProfileFilePick.ts` documents (and it matches tauri-plugin-dialog 2.7.2
  `try_fs_scope()` → `allow_file(&path)`) that the picker adds each user-picked `.vxp` path to the fs
  scope at runtime, so the webview can read only files the user just picked. That is the minimal,
  dialog-scoped grant the brief asks for. `.vxp` bytes crossing IPC is acceptable (AEAD-sealed blob),
  unlike raw private keys which the codebase keeps Rust-to-Rust.

- **Result → active pane goes through the SAME sanitizer as cmd+V, with clipboard fallback.**
  `routeVoxisResult` calls `deps.pasteToActivePane`, wired in `useVoxisRuntime` to the active pane's
  `pasteText` (= `sanitizePaste` + `term.paste`, the exact path `dictatedTextFromKeyEvent`/cmd+V uses).
  Empty text is dropped. No active pane → clipboard write + `notifyCopiedNoActivePane`. Active pane whose
  session has **closed** (a dead PTY that would silently swallow the paste) → clipboard write +
  a DISTINCT `notifyCopiedActivePaneClosed` notice. Two fallback notices are never conflated. No second
  ad-hoc PTY write path.

- **Consent gate before first network use.** `attemptStart` resolves the provider host from the profile
  (`resolveVoxisProvider`, per-host key, self-hosted URL named by host not generic id) and `decideVoxisConsent`
  shows the naked-owned `VoxisConsentDialog` before any `start()`. Declining never calls `start()`. The
  plugin independently enforces `ConsentRequired` server-side; this is the friendly front door, correctly
  described as non-authoritative. Provider switch re-asks (keyed by host).

- **Hotkey pref only offers parser-valid, safe keys (UI layer).** `voxisHotkeyChoices.ts` offers only
  right-side modifiers + `f2..f12` (`f1` excluded — naked's bare command-palette chord; `f13+` excluded —
  plugin parser only defines `f1..f12`), minus naked's own bare-key bindings derived live from
  `NAMED_CHORDS`. The current saved key is always rendered as an option so the select never shows the wrong
  value. (Load-path validation gap noted under Should-fix.)

- **Pill press machine — tap/hold/drag, drag never dictates.** `createVoxisPillPress`: release before
  `holdMs` → `onToggle`; still down at `holdMs` → `onHoldStart` (begins the session THEN); `dragArmed()`
  (fired off `useOverlayDrag`'s 450ms arm, > 300ms hold) → stops any in-flight hold and stands down so the
  eventual release does NOT toggle (drag never dictates). `cancel()` (pointercancel/lostpointercapture/blur)
  stops a `holding` press but a `pending` press does not toggle. `useOverlayDrag.onPointerDown` calls
  `setPointerCapture`. `VoxisOverlayHost` wires `pointerup`/`pointercancel`/`lostpointercapture`/window-`blur`
  all into press end — matching the brief's "setPointerCapture + lostpointercapture + blur end holds".

- **Placement / keyboard / keypanel clamps — pure rules, wired.** `voxisOverlayPlacement.ts`
  (`parseVoxisOverlayPlacement` per-field degrade, offsets clamped by `clampPaneCanvasMapOffset`) and
  `voxisOverlayKeyboardClamp.ts` (`voxisOverlayKeyboardClampOffsetY`, bottom-placement-only, keyboard-open
  gap detection, accessory-row/keypanel height) are pure functions with fake-clock/unit tests. Both are
  wired in `VoxisOverlayHost` (the keyboard clamp feeds `effectiveOffsetY` into `paneCanvasMapAnchor`;
  `useKeyPanelMeasureBump` re-anchors when `--keypanel-measured` changes without a window resize). Container
  box pinned to `COMPACT_SIZE` for all geometry (vendor constant, not a guessed number), avoiding the
  re-anchor-on-lifecycle-flip jump.

- **Theme resolution.** `resolveEffectiveVoxisTheme` = explicit pref (if in `known`) → profile theme
  (if in `known`) → `DEFAULT_THEME_ID`; `known` is the single `VOXIS_THEME_IDS` re-exported from the one
  seam. `""` pref = follow profile. Wired via memo → `useVoxisOverlayMount` deps.theme → remount, no restart.

- **StrictMode / zombie listeners.** `useVoxisRuntime`'s subscribe effect re-checks `cancelled` after each
  `await client.onX(...)` resolves and unlistens a listener whose cleanup already ran (the documented
  StrictMode double-invoke zombie); every event callback also guards on `cancelled` so a zombie can neither
  double-paste a result nor clear the surviving listener's session id. Subscribes once (`[client]` deps).

- **i18n en+ru present and balanced.** `en.ts` and `ru.ts` each contain 29 `voxis` catalog entries
  (matched count); `i18nCatalog.test.ts` exists to enforce key parity. All keys referenced by
  `VoxisSettingsRow`/`VoxisConsentDialog`/`VoxisImportPassphraseDialog` map to catalog keys.

- **Tests real, not vacuous.** `bun test lib/rules/voxis*.test.ts lib/hooks/useVoxis*.test.ts*
  components/Voxis*.test.tsx` → **165 pass, 0 fail, 308 expect() calls, 16 files.** The Rust secret E2E
  asserts actual bytes on actual disk. The passphrase dialog uses `type="password"` and keeps the dialog
  open with inline error on a failed import (no silent close discarding the typed passphrase).

## Not covered
- Ratchet ceilings ("raised with reasons") — not located within budget; no evidence checked either way.
- The vendored `@voxis/tauri-plugin-voxis` guest-js internals (out of scope per brief; only the naked seam
  reviewed).
- `tests/ui/voxis*.spec.ts` Playwright specs were not executed (budget/time); only the unit/component
  suite was run.
- Runtime confirmation that tauri-plugin-dialog actually grants the fs scope on this build (verified by
  code/citation, not by a live pick).
- iOS on-device behaviour (init_ios_with path) — read but not executed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only blind review per BRIEF.md; no files edited, no scope widening. Report written to the authoritative output path only."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Findings cite file:line and named tests; ran the prescribed suite (165 pass/0 fail); each verified item points to concrete code (adapter role/AAD, capability scope, sanitized-paste routing, consent gate, pill-press/drag wiring, clamps, StrictMode guards, i18n counts)."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "bun test lib/rules/voxis*.test.ts lib/hooks/useVoxis*.test.ts* components/Voxis*.test.tsx",
      "result": "passed",
      "summary": "165 pass, 0 fail, 308 expect() calls across 16 files"
    }
  ],
  "validationOutput": [
    "165 pass / 0 fail / 308 expect() calls / 16 files / ~1213ms",
    "i18n: en.ts 29 voxis entries, ru.ts 29 voxis entries (balanced)"
  ],
  "residualRisks": [
    "onLostPointerCapture cancels press but not drag in VoxisOverlayHost — possible stuck armed-drag on capture loss without pointercancel (should-fix, non-blocking).",
    "voxisHotkeyPref.parse() accepts any string key at load; only the Settings select constrains it, so a corrupt/edited localStorage value could bind an unsafe global key (should-fix, low real-world risk).",
    "Ratchet ceilings and Playwright voxis specs not verified within budget."
  ],
  "noStagedFiles": true,
  "diffSummary": "No code changes — blind security/integration review only.",
  "reviewFindings": [
    "no blockers",
    "should-fix: VoxisOverlayHost.tsx onLostPointerCapture does not reset useOverlayDrag — stuck-drag risk on capture loss",
    "should-fix: voxisHotkeyPref.ts parse() does not validate the key against the safe candidate set at load time"
  ],
  "manualNotes": "Verdict SHIP. Secret-at-rest (namespaced + AAD role + AEAD ciphertext, no Keychain), consent gate, sanitized-paste-with-clipboard-fallback, dialog-scoped fs grant, and drag-never-dictates press machine all verified against source. Two non-blocking should-fixes noted."
}
```
