# BLIND design review — guest-js (`@voxis/tauri-plugin-voxis`) + naked host TS

VERDICT: REFACTOR-FIRST

Nothing here is broken or unshippable, but three real maintenance costs stand out:
a ~900-line god element whose session/drag half is dead in the only real host's mode,
a write-once position/theme abstraction that forces WebGL remounts, and four parallel
"start-on-press / stop-on-any-release" machines that must be kept in lockstep by hand.

## Top findings (ranked by maintenance cost removed)

### 1. SRP — `VoxisOverlayElement` is a god class; ~half of it is dead in `driver:"host"`
`overlay.ts` (877 lines). One class owns five separable jobs: custom-element/DOM
lifecycle, **session control** (`startActive`/`stopActive`/`lease`/`stopRequested`/
`clearActiveSession`), **compact↔expanded geometry** (`growToExpanded`/`shrinkToCompact`/
`anchorGrow`/`compactPosition`/`expandedDragOccurred`), **theme mount/unmount**, and
**two-driver branching**. In `driver:"host"` — the mode naked (the only host) actually
uses — the entire session-control + drag + lease block is inert (`startActive`/`stopActive`
early-return on `driver === "host"`, `wireDrag` is skipped via `draggable:false`). So for
the shipping host, a large fraction of this class exists but never runs, and every future
edit to the overlay must reason about a client-mode path no host exercises.
- overlay.ts:230–360 (session/lease) and 470–560 (grow/shrink)
- Change: extract session control into a tiny `OverlaySessionController` (start/stop/lease/
  clearActive) that only the client driver instantiates, and move the pure geometry
  (`anchorGrow`/grow/shrink math) out of the element. The element keeps DOM + indicator +
  applyState/Level/Result. Size L.

### 2. KISS / dead path — host-mode press dispatch is emitted but structurally unhearable
`wirePointerHandlingHostDriven` dispatches `"voxis-overlay-press"` on pointerdown/up. But
`useVoxisOverlayMount.ts`'s own doc comment explains at length that naked *cannot* listen
to it: `useOverlayDrag`'s `setPointerCapture` on a light-DOM ancestor retargets the pointer
away from the shadow-DOM `.pill`, so the vendor's `pointerup` never fires. naked therefore
drives press from its own container handlers and ignores the event entirely. Result: the
only host cannot consume this API, and the vendor still ships/maintains the listeners +
CustomEvent contract for it.
- overlay.ts:`wirePointerHandlingHostDriven`; useVoxisOverlayMount.ts module doc
- Change: drop the press dispatch from host mode (host mode = pure visual/indicator), or
  mark it explicitly speculative/untested API. Removes a documented-dead code path. Size S.

### 3. Leaky abstraction — write-once `initialPosition`/`theme` forces a full remount
The element exposes live `applyState`/`applyLevel`/`applyResult`, but position and theme are
read once in `connectedCallback`. So naked must tear down and rebuild the whole custom
element (shadow DOM + `mountThemeInstance`, potentially a WebGL render loop) on **every
placement drag-commit and every theme change** — `useVoxisOverlayMount`'s mount effect keys
on `position.x`/`position.y`/`deps.theme`. The element already recomputes size/clamp
internally on resize; it just lacks a live seam for the two things a host changes most.
- overlay.ts:`connectedCallback` (position/theme read once); useVoxisOverlayMount.ts effect deps
- Change: add `setPosition(p: Point)` and `setTheme(id)` methods (reposition via existing
  `clampToViewport`; setTheme re-resolves + remounts only the theme container) so a drag
  commit doesn't rebuild the element/WebGL context. Size M.

### 4. DRY — four "start on press, stop on ANY release path" machines to keep in sync
The identical safety rule ("pointerup/cancel/lostpointercapture/window-blur all stop; never
a stuck recording") is implemented four times across the two repos:
`overlay.ts` `wirePointerHandling`/`handleWindowBlur` (vendor), `hotkey.ts` `HotkeyMachine`
(keydown/up/blur/visibility + lost-keyup timer), naked `voxisHoldChip.ts` `createVoxisHoldChip`,
and naked `voxisPillPress.ts` `createVoxisPillPress`. `voxisHoldChip` and `voxisPillPress`
overlap heavily (both funnel every release to one stop; pillPress adds toggle + dragArmed).
A change to "which release paths end a hold" must be mirrored in all four or they drift into
inconsistent hold gestures in the same app — exactly what `voxisHoldChip`'s own doc warns of.
- voxisHoldChip.ts / voxisPillPress.ts / overlay.ts wirePointerHandling / hotkey.ts
- Change: have `voxisPillPress` compose `voxisHoldChip` for its hold sub-state (or share a
  `releaseFunnel` helper). Also verify `voxisHoldChip` is still wired anywhere — `VoxisOverlayHost`
  uses `voxisPillPress`, so the chip may now be dead. «TODO verify voxisHoldChip still used». Size M.

### 5. SRP — `useVoxisRuntime` (614 lines) mixes six concerns behind one hook
Consent flow, hotkey pref+apply+error, theme pref, profile status + imports (desktop/file),
session start/stop with its own iOS `pendingStart`/`stopRequested` race, and the ONE
subscription lifecycle all live in one hook returning a 25-field object. The subscription-
lifecycle StrictMode handling is genuinely subtle and correct, but it's buried among unrelated
pref/import state. Note also that the `pendingStart`/`stopRequested` "stop arrived while start()
awaits the mic prompt" race is implemented **here and again** in `overlay.ts` (`stopRequested`/
`startActive`) — two copies (naked's is live, the vendor's is dead in host mode).
- useVoxisRuntime.ts (whole); duplicate race at overlay.ts `startActive`/`stopActive`
- Change: split into `useVoxisSession` (start/stop/toggle/hold + subscription) and
  `useVoxisSettings` (hotkey/theme/profile/import). Consent can be its own small hook. Size L.

## Fine as is (checked)
- **Stored-pref DRY is NOT triplicated.** `voxisHotkeyPref` and `voxisThemePref` both go
  through the shared `storedPref.ts` (`readStoredPref`/`writeStoredPref`), which itself
  documents the eight-copy history it consolidated. `voxisConsentStore` is a *deliberately*
  different shape (injectable storage + JSON-array cache with add/remove semantics, needed
  for its tests and for `forgetProviderConsent`), not a fourth copy of the same skeleton.
  The brief's "three copies" concern doesn't hold.
- **`theme-bridge.ts` / `themes/registry.ts`** are clean single-responsibility modules; the
  static-import CSP rationale in `registry.ts` is sound and the `flatSpectrum` approximation
  is honestly documented as a deliberate degrade, not a bug.
- **TDD honesty is good.** `overlay.test.ts` uses a real fake client that stores/emits
  handlers and asserts behavior (start called with `"hold"`, stop with the session id) — not
  a mock asserting itself. Its doc comment openly states the jsdom CSP meta-tag test does *not*
  enforce CSP and points to `csp-bundle.test.ts` (greps built `dist/` for `Blob:`/`data:`) as
  the real gate. `hotkey.test.ts` keeps an independent `RUST_KEY_TABLE_FIXTURE` transcription
  so either side drifting fails the test. `lease.ts`/`client.dictate` error/idle-grace paths
  are the kind of thing tests usually skip and are covered.
- **`clampToViewport`/`snapToNearestEdge`** are pure and unit-testable; keeping safe-area
  reading out of them is the right seam.

## Not covered
- Did not read every `__tests__` file end-to-end (read `overlay.test.ts` head only; `client.ts`,
  `drag.ts`, `hotkey.ts`, `lease.ts`, `theme-bridge.ts` tests inspected only via names/sizes).
  No vacuous-assert pattern spotted in what was read, but a full pass on `overlay.test.ts`
  (869 lines) and the naked `*.test.ts` files was not done.
- Did not confirm at a call site whether `voxisHoldChip`/`createVoxisHoldChip` is still wired
  (KeyPanel) or now dead after `VoxisOverlayHost` moved to `voxisPillPress` — flagged in #4.
- `voxisOverlayPlacement.ts`, `paneCanvasMap`/`paneFocusMark` anchor math, and
  `src/lib/ipc/voxis.ts` (`VOXIS_THEME_IDS` vs the vendor `ThemeRegistry` — a potential
  parallel-constant that must match) were not opened; the theme-id list appears in both
  repos and is a plausible drift point worth a follow-up. «TODO verify VOXIS_THEME_IDS vs ThemeRegistry».
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Wrote a ranked SOLID/DRY/KISS/TDD review to /tmp/ado.C4YWdv/blind/SDK_ts.md with VERDICT, 5 top findings (file:line + concrete change + size), Fine-as-is, and Not-covered sections; residual risks captured below."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "wc -l on guest-js + naked voxis TS files",
      "result": "passed",
      "summary": "overlay.ts 877 lines, useVoxisRuntime.ts 614 lines confirmed for god-class findings"
    }
  ],
  "validationOutput": [
    "Review only; no build/test run. Judged current source directly per brief."
  ],
  "residualRisks": [
    "Did not read overlay.test.ts fully (869 lines) nor most naked *.test.ts; a vacuous-assert could exist in the unread portion, though sampled tests were behavioral.",
    "Could not confirm whether voxisHoldChip is still wired (possible dead code) — flagged as TODO verify.",
    "Did not open voxisOverlayPlacement.ts / ipc/voxis.ts; VOXIS_THEME_IDS vs vendor ThemeRegistry is an unverified parallel-constant drift risk (TODO verify)."
  ],
  "noStagedFiles": true,
  "diffSummary": "No source changes — review artifact only, written to the mandated output path.",
  "reviewFindings": [
    "refactor: overlay.ts:1-877 - VoxisOverlayElement god class; session/drag half dead in driver:host (the shipping host's mode).",
    "kiss: overlay.ts wirePointerHandlingHostDriven - voxis-overlay-press dispatched but structurally unhearable by naked (documented in useVoxisOverlayMount).",
    "abstraction: overlay.ts connectedCallback - write-once initialPosition/theme forces full element+WebGL remount on every drag-commit/theme change.",
    "dry: voxisPillPress.ts/voxisHoldChip.ts/overlay.ts/hotkey.ts - four parallel start-on-press/stop-on-any-release machines must stay in sync.",
    "srp: useVoxisRuntime.ts:1-614 - six concerns in one hook; pendingStart/stopRequested race duplicated with overlay.ts.",
    "no blockers - nothing broken; all findings are maintenance-cost reductions."
  ],
  "manualNotes": "Confirmed the brief's 'three copies of stored-pref' concern is largely false: hotkey+theme share storedPref.ts; consent store is a deliberately different injectable array-cache. TDD honesty is notably good (independent Rust key-table fixture; honest CSP-test caveat pointing to csp-bundle.test.ts)."
}
```
