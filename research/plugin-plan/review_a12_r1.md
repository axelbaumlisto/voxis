# Review: a12 (voxis-plugin, commit 8ebd9e98) — round 1

VERDICT: APPROVE

## Scope reviewed
- `src/lib/rules/voxisResultRouting.ts` / `.test.ts` (A2)
- `src/lib/hooks/useVoxisRuntime.ts` / `.test.ts` (A2 wiring)
- `src/App.tsx` (A2 dep wiring)
- `src/lib/i18n/en.ts`, `src/lib/i18n/ru.ts` (A2 notice strings)
- `src/lib/rules/voxisOverlayPlacement.ts` / `.test.ts` (A1)
- `src/styles/terminal.css`, `src/styles/mobile.css` (A1 geometry claims)
- `src/lib/appSizeGate.test.ts` (ratchet)
- Supporting reads: `src/lib/hooks/usePaneResolvers.ts`, `src/lib/rules/terminalClipboard.ts`,
  `src/lib/ipc/createTerminalRuntime.ts`, `src/lib/rules/terminalReadiness.ts` (pane status /
  paste-into-dead-pane mechanics, `rules/rooms.ts` (`PaneStatus` enum)

## Findings

None are blockers. Two items worth the team's attention (see Minors).

## Checked OK

**(1) A2 correctness — `status === "closed"` as the diversion gate.**
`PaneStatus`/equivalents across the codebase (`rules/rooms.ts`, `paneStatus.ts`,
`connAnnounce.ts`, etc.) are uniformly `"connecting" | "up" | "reconnecting" | "closed"`.
Tracing the actual dead-pane risk:
- `hasActivePane()` (`terminals.activeLivePaneId() !== undefined`) gates on `entry.everUp`
  (`usePaneResolvers.ts`), which is **false** for a pane that has never been up
  ("connecting", first attach). So a never-up pane already routes through the EXISTING
  no-active-pane branch (clipboard + `notifyCopiedNoActivePane`) — untouched by this diff,
  and correct (no dead-PTY paste risk there; that pane was never in `hasActivePane()`).
- For a pane that reached "up" at least once (`everUp` stays true forever after), and is
  now "reconnecting": `hasActivePane()` is true, `isActivePaneClosed()` is false (status is
  `"reconnecting"`, not `"closed"`) → the diff still routes to `pasteToActivePane`.
  Traced `pasteText` → `sanitizePaste` → `term.paste` → `term.onData` → `sendInput` →
  `inputGate.feed()` (`terminalReadiness.ts`). The `InputGate`'s own doc comment explicitly
  describes this exact scenario: "for an in-place Reconnect... the Terminal RE-ARMS on
  that event (`reset()` re-closes + clears, then the readiness openers re-open it), so
  keystrokes typed right after Reconnect are BUFFERED and flushed in order." So a paste
  while "reconnecting" is very likely **queued, not lost** — it will land once the pane
  comes back up, which is arguably the *better* UX than diverting it to the clipboard.
  This makes `status === "closed"` a defensible, not-obviously-incomplete choice: "closed"
  is the one status where the PTY will never come back, so anything buffered in the gate
  rots forever with no error — exactly the silent-loss bug this task set out to fix.
  (See Minors for the one residual gap in this chain of reasoning.)
- `isActivePaneClosed` reads `terminals.activeFocusedEntry()?.status` **at call time**
  (`App.tsx`), same shape as the pre-existing `hasActivePane` dep, and is backed by
  ref-reading callbacks (`usePaneResolvers.ts`'s `activeFocusedEntry` reads `.current` on
  refs) — no closure-staleness risk even across renders.
- Notice wiring: `notifyCopiedActivePaneClosed: () => noticeQueue.addNotice("", "info",
  { textKey: { key: "voxis.copiedActivePaneClosed" } })` is byte-for-byte the same shape
  as the existing `notifyCopiedNoActivePane` wiring — consistent pattern, no new plumbing.
- i18n: both `en.ts` and `ru.ts` add the key. English: "Dictated text copied — the active
  pane's session is closed" (parallel wording to the sibling key). Russian: "Надиктованный
  текст скопирован — сессия активной панели закрыта" — no English tokens, same
  em-dash/clause structure as the sibling `voxis.copiedNoActivePane` Russian string. The
  full bun suite (pre-verified 10134/5, the 5 pre-existing/flaky) includes the vocabulary
  gates, so this was exercised, not just eyeballed here.

**(2) A1 — overlay default and geometry.**
`.terminal-scroll-position` in `terminal.css` is confirmed `position: absolute; right:
12px; bottom: 10px;` — matches the new doc comment's citation exactly. The doc's claim
that bottom-right, `offsetY: 96`, stays clear of that pill holds by a wide margin under
either the new comment's own "~22px tall" figure or the larger figure documented
elsewhere in the codebase (see Minors). The iPad bottom-left/sidebar-foot-strip collision
story added to the doc comment is specific (names the exact sidebar affordance it
collided with) and reads as a genuine field observation, not a fabricated rationalization;
I have no way to independently re-observe a real iPad from this environment, but nothing
in the styles contradicts it, and the change is consistent with the pre-verified
Playwright `ui` run (465/11, none newly COVERED by the overlay) cited in the task.

**(3) Rule tests.**
`voxisResultRouting.test.ts` table now covers all four cases the task asked for:
open pane → paste only; closed pane → clipboard + `notifyCopiedActivePaneClosed` (and
NOT `notifyCopiedNoActivePane`); no pane → clipboard + `notifyCopiedNoActivePane` (and
NOT the closed notice); empty text → no-op for all three dep shapes (active, inactive,
closed), each asserting no clipboard/notice call. `useVoxisRuntime.test.ts` adds a
matching hook-level test ("active-but-CLOSED pane") asserting `pasteToActivePane` is
never called, `writeClipboardText` is called with the text, the closed notice fires
exactly once, and the no-pane notice does not fire — a solid negative-control shape
matching the file's existing test style.

**(4) Ratchet.** `APP_TSX_MAX_LINES` 1093 → 1098 (+5) with a comment naming exactly the
added lines (`isActivePaneClosed`/`notifyCopiedActivePaneClosed` dep lines). Counting the
actual `App.tsx` diff hunk: 3 new lines for `isActivePaneClosed` (2 comment + 1 code) + 2
new lines for `notifyCopiedActivePaneClosed` (arrow + body) = 5. The ratchet bump is
literally correct, not just plausible-sounding.

## Minors (non-blocking)

1. **A1 doc-comment number.** The new `voxisOverlayPlacement.ts` comment states
   `.terminal-scroll-position` is "~22px tall." `mobile.css` (~line 840-847) already has
   an existing comment about what is very likely the same element ("the indicator pinned
   `right: 12px`" at `bottom: 10px`) measuring it as "~30px tall including its padding."
   These two numbers for the same pill disagree. It doesn't change the practical
   conclusion (offsetY 96 clears either 22px or 30px with a large margin), but the new
   comment's specific figure isn't corroborated by — and mildly contradicts — the
   codebase's own prior measurement of the same element. Worth a one-line fix or a citation
   of where 22px came from.

2. **A2 "closed" vs. "reconnecting" — reasoning not made explicit in the diff itself.**
   The recommendation above (that excluding "reconnecting" from the clipboard diversion is
   intentional and correct, because `InputGate` buffers and later flushes paste-while-
   reconnecting bytes) is inferred from `terminalReadiness.ts`'s doc comments describing
   the "in-place Reconnect" flow, not from a test or comment inside this diff's own files.
   I could not fully rule out some OTHER reconnect path where the pane stays "reconnecting"
   with the gate already open (not reset), in which case a paste would go to a genuinely
   dead connection and be lost the same way "closed" is. Recommend the team add a one-line
   comment (or better, a test) in `voxisResultRouting.ts`/`useVoxisRuntime.test.ts`
   explicitly stating "reconnecting is deliberately excluded — see `InputGate`'s buffer/
   flush contract" so a future reader doesn't mistake `status === "closed"` for an
   incomplete state-enum check.

## Not independently re-verified (pre-verified by the task, taken as given)
- Full bun suite pass rate (10134/5), tsc clean, Playwright `ui` 465/11 (none COVERED by
  overlay), phone spec 1/1 — accepted per task framing, not re-run in this review (no bash
  tool available to this reviewer).
- Whether `--touch-pane-toolbar-measured`'s actual runtime height at the 390px baseline is
  cleared by `offsetY: 96` in every device/keyboard state — this is a dynamically measured
  CSS custom property, not a fixed constant, so it can't be confirmed by reading the CSS
  alone; taken on the strength of the cited Playwright `ui` run's "no COVERED" result.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Review performed read/grep-only on the named diff paths (voxisResultRouting.ts/.test.ts, useVoxisRuntime.ts/.test.ts, App.tsx, i18n en/ru, voxisOverlayPlacement.ts/.test.ts, terminal.css, mobile.css, appSizeGate.test.ts) plus supporting reads (usePaneResolvers.ts, terminalClipboard.ts, createTerminalRuntime.ts, terminalReadiness.ts) to judge correctness; no code was changed, no scope was widened."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report gives verdict, per-item findings with concrete evidence (line-level CSS values, InputGate buffering trace, ratchet line-count arithmetic, notice-wiring parity), and explicit minors with recommended follow-ups."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "No commands run by this reviewer (read/grep-only role); relied on pre-verified bun/tsc/Playwright results stated in the task."
  ],
  "residualRisks": [
    "voxisOverlayPlacement.ts doc comment's '~22px tall' figure for .terminal-scroll-position conflicts with mobile.css's own prior '~30px tall including its padding' note for what is very likely the same element (does not change the no-overlap conclusion at offsetY:96, but should be reconciled)",
    "The exclusion of 'reconnecting' from the isActivePaneClosed clipboard-diversion path is inferred (via InputGate's documented buffer/flush contract) to be correct rather than an oversight, but this reasoning is not stated anywhere in the diff itself; recommend adding an explicit comment or test to that effect"
  ],
  "noStagedFiles": true,
  "diffSummary": "Read-only review of diff_a12.patch (A1 overlay default bottom-right/16/96 + geometry doc; A2 isActivePaneClosed dep + clipboard fallback + new closed-pane notice wired through App.tsx/useVoxisRuntime/voxisResultRouting with matching tests; appSizeGate ratchet 1093->1098). No files changed by this review.",
  "reviewFindings": [
    "no blockers",
    "minor: voxisOverlayPlacement.ts's '~22px tall' claim for .terminal-scroll-position conflicts with mobile.css's own '~30px tall including its padding' note for the same pinned bottom-right indicator",
    "minor: the deliberate exclusion of 'reconnecting' status from isActivePaneClosed's clipboard diversion is correct per InputGate's buffer/flush contract (terminalReadiness.ts), but this reasoning isn't documented anywhere in the diff itself"
  ],
  "manualNotes": "isActivePaneClosed reads terminals.activeFocusedEntry()?.status at call time via the same ref-backed pattern as the existing hasActivePane dep — no staleness risk. Notice wiring, i18n (both languages), rule-table tests, and hook-level tests all match the task's required shape. Ratchet bump (1093->1098, +5) is arithmetically exact against the App.tsx diff hunk."
}
```
