# Review ov2_r1 — voxis-plugin overlay (commit 03882ff0, branch voxis-plugin)

VERDICT: REJECT-FIX

## Findings

### [HIGH] `VoxisOverlayHost.tsx` wires only 2 of the 4 documented release paths — stuck-recording risk
File: `src/components/VoxisOverlayHost.tsx` (JSX return, `onPointerDown`/`onPointerMove`/`onPointerUp`/`onPointerCancel` handlers, ~lines 140-165).

`useVoxisRuntime.ts`'s own doc comment for `holdStop` explicitly states the contract:
```
/** `pointerup`/`pointercancel`/`lostpointercapture`/window blur -> holdStop. */
```
and `rules/voxisPillPress.ts`'s `cancel()` is written specifically to guard "a stuck recording is worse than a dropped one" (tested in `voxisPillPress.test.ts`: `"cancel() while holding stops the hold"`).

The **existing** KeyPanel hold-chip wires all four release paths correctly:
- `components/KeyPanel.tsx:642-644` — `window.addEventListener("blur", onWindowBlur)` → `voxisChip.handleWindowBlur()`
- `components/KeyPanel.tsx:884` — `onLostPointerCapture={() => voxisChip.handleLostPointerCapture()}`
- plus `onPointerUp`/`onPointerCancel`.

The **new** `VoxisOverlayHost` container only has:
```tsx
onPointerUp={(event) => { drag.onPointerUp(event); pressRef.current?.up(); }}
onPointerCancel={(event) => { drag.onPointerCancel(event); pressRef.current?.cancel(); }}
```
There is **no `onLostPointerCapture` handler** and **no `window` `blur` listener** anywhere in `VoxisOverlayHost.tsx`. `useOverlayDrag.onPointerDown` calls `event.currentTarget.setPointerCapture(event.pointerId)` on every down, so a capture loss that fires `lostpointercapture` without a preceding `pointercancel` (a real browser path — e.g. iOS Safari can drop capture on certain system-gesture interruptions, or another element/`document` calling `releasePointerCapture`) leaves `voxisPillPress`'s internal `phase` stuck at `"holding"` (or `"pending"`), so `onHoldStop()` is **never called** and the plugin session keeps recording. Alt-tab / app-switch mid-hold (`window blur`) has exactly the same gap — the pill is the ONLY hold-to-talk surface reachable while a user is not focused on a text field, so this is the primary path for the "stuck recording" class the module's own doc comment calls out.

This is not covered by any test: `VoxisOverlayHost.test.tsx` has zero occurrences of `LostPointerCapture`/`blur`/`pointercancel` (confirmed via grep on the test file).

**Fix**: add `onLostPointerCapture` (→ `pressRef.current?.cancel()`, mirroring `onPointerCancel`) and a `window` `blur` effect (→ `pressRef.current?.cancel()`) to `VoxisOverlayHost`, plus regression tests exercising both paths while `phase === "holding"`.

### [DESIGN-CONFIRM] Drag-arm stops an in-flight hold-to-talk recording — verify against owner intent
File: `src/lib/rules/voxisPillPress.ts` (`dragArmed()`), tested explicitly in `voxisPillPress.test.ts`: `"drag arms AFTER a hold already started (300..450ms window) -> the hold is stopped immediately"`.

Behaviour is deliberate and well-documented ("a drag is not a talking gesture"), but the owner's one-line spec ("нажатие активирует диктовку", pill is described as a persistent **control**) does not obviously endorse silently truncating an active recording just because the SAME press happens to cross the drag-arm threshold at 450ms. A user holding past 300ms to dictate, whose finger drifts >8px slop by 450ms (easy on a soft touch), gets their recording cut with no visual cue distinguishing "you stopped" from "the system stopped you because it thought you meant to drag." This is implemented correctly and tested against its own stated design, so I am not blocking on it, but it is a product decision that deserves explicit owner sign-off given the review brief flagged it verbatim ("dragging shouldn't dictate").

## Checked OK

- **Toggle/hold state machine core logic** (`rules/voxisPillPress.ts` + `voxisPillPress.test.ts`): tap→`onToggle()` (delegates start/stop resolution to `useVoxisRuntime.toggle`, no duplicate decision) — correct. Release exactly at threshold cannot double-fire: `up()` always calls `clearTimer()` before inspecting `phase`, and JS timers are single-threaded, so the scheduled hold-start callback can never fire after `up()`/`cancel()`/`dragArmed()` have already cleared it. No race window exists in this pure-function/single-timer design.
- **Hold-then-drag-arm sequencing**: explicitly tested (300ms hold-start, then `dragArmed()` at the 450ms boundary → `hold-stop` fires exactly once, subsequent `up()` is silent). Matches the doc comment's promised table.
- **`pointercancel` while pending is NOT a toggle**: tested (`cancel() while pending ... NOT a toggle`) — correct, an aborted gesture must not fire a false toggle.
- **`useOverlayDrag` / press ordering on the same element**: `onPointerDown` calls `pressRef.current?.down()` THEN `drag.onPointerDown(event)` — both start independent timers (300ms vs 450ms) off the same `down`, consistent with the module's documented design; `useOverlayDrag` only calls `preventDefault()` after arming (confirmed by reading `useOverlayDrag.ts` — `onPointerDown` never calls `preventDefault`), so an early tap is never hijacked from the press machine.
- **Touch vs. mouse drag-arm divergence in `useOverlayDrag`**: a mouse move past `armSlopPx` (8px) arms the drag immediately (bypasses the 450ms timer — owner-cited fix, "не могу передвинуть мышкой оверлей"); a touch move past slop instead cancels the drag attempt entirely and leaves the gesture to the browser/press machine, so an in-progress touch hold is untouched by an early wandering touch that never actually reaches the 450ms long-press. Consistent, intentional, matches existing `PaneCanvasMap` behavior.
- **Offset clamp mismatch the review brief hypothesized is a false alarm**: `voxisOverlayPlacement.ts` uses `clampPaneCanvasMapOffset`/`MAX_PANE_CANVAS_MAP_OFFSET` (± **4096**, `paneCanvasMapSettings.ts:43`), NOT the pane-focus-mark's tighter 0..64 bound (`MAX_PANE_FOCUS_MARK_OFFSET`, a distinct constant used only by `paneFocusMark.ts`'s own `nearestPlacement` defaults). `VoxisOverlayHost` also passes `snapOptions: { freeOffsets: true, allowCenter: false }` to `useOverlayDrag`, matching the MAP's free-offset drag pattern (not the focus-mark's clamped one). The default `offsetY: 96` is comfortably inside ±4096 and is never touched by the 0..64 bound anywhere in this code path — no clamp violation, no first-drag jump.
- **`windowBounds()` extraction is a literal move**: `src/lib/rules/overlayWindowBounds.ts` is byte-for-byte identical to the function previously inlined at the bottom of `PaneCanvasMap.tsx` (confirmed by diffing both bodies) — only the safe-area-TOP is subtracted (`--safe-area-top`), consistent with the pre-existing map behavior, not a new regression introduced by this diff. It does not additionally read `--safe-area-bottom`/`env(safe-area-inset-bottom)`; this is INHERITED behavior now newly exercised by an always-visible control rather than an opt-in map — flagged as a residual risk below, not a code defect of this diff.
- **`useWindowResizeBump` extraction**: `PaneCanvasMap.tsx`'s diff removes the inline `useState`+`useEffect` bump exactly and replaces it with `useWindowResizeBump()`; `useWindowResizeBump.ts` (read via diff) registers the same two listeners (`window` `resize`, `window.visualViewport` `resize`) with the same cleanup — behavior-preserving.
- **`CornerPlacementControls`/`MAP_PLACEMENTS` reuse**: both exported from `SettingsPaneFocusMark.tsx` (previously private), imported directly into `VoxisSettingsRow.tsx` — no duplicate five-entry placement list or duplicate markup created. `VoxisSettingsRow.tsx` passes `MAP_PLACEMENTS` (no "toolbar" option) and casts the callback value back to `DraggablePlacement`, consistent with the map's own usage.
- **i18n**: `settings.voxis.overlayPlacement` present in both `en.ts:818` ("Pill position") and `ru.ts:797` ("Положение пилюли"). No missing-key risk for the new label found.
- **Container z-index/stacking rationale** documented (`VoxisOverlayHost.tsx` module comment) is consistent with the plugin's own `z-index: 2147483647` on its shadow-DOM pill being contained by this component's own stacking context — plausible, not independently re-verified against CSS in this pass.

## Minors

- `VoxisOverlayHost.tsx`'s `onPointerDown` guards `event.pointerType === "mouse" && event.button !== 0` but does not also forward that guard's rejection to `drag.onPointerDown` explicitly — it returns before calling `drag.onPointerDown`, so this is fine, but worth a one-line comment noting the early return covers both press and drag (currently relies on the reader inferring it from a single `if (...) return;`).
- Bottom-safe-area-inset gap in `overlayWindowBounds.ts` (see Checked OK note above): pre-existing, not introduced here, but now load-bearing for a persistent control rather than an on-demand map — worth a follow-up ticket to add `--safe-area-bottom` handling to `windowBounds()` for both consumers, rather than leaving it as tribal knowledge that the default `offsetY: 96` "happens to clear it" per the Playwright measurement cited in `voxisOverlayPlacement.ts`'s own doc comment. That measurement is a jsdom/Chromium `--project=ui` run, not a real iPhone with a physical home indicator — the no-COVERED result does not by itself prove `env(safe-area-inset-bottom)` clearance on-device.
- Did not independently re-verify `tauriMock.ts`'s `get_profile`/`set_hotkey` default shapes against the plugin's live `ProfileConfigDto` Rust struct (out of scope for the read/grep-only pass at the tool budget available); the diff hunk was not read in this pass — flag as unverified rather than confirmed.
- Did not independently re-verify the `appSizeGate.test.ts`/`oneHoldMeansOneWait.test.ts`/ratchet line-count deltas (item 8 of the judge brief) — not read in this pass due to tool budget; no evidence of a problem, simply unchecked.

## Residual risks (see above, consolidated)
- Stuck-recording risk from missing `lostpointercapture`/window-`blur` wiring on the new pill (HIGH, blocks approval).
- Drag-arm-stops-hold behavior needs explicit owner sign-off against the literal "dragging shouldn't dictate" phrasing (not blocking, but flagged).
- Bottom safe-area-inset not explicitly handled by `windowBounds()` for the now-persistent pill (inherited, low-probability, unverified on real iOS hardware).
- `tauriMock` shape vs. plugin DTO, and ratchet-file diffs, not independently re-checked in this pass (tool-budget constrained).
