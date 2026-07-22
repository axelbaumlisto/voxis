# Voxis Landing Page — Holistic Beauty & Art-Direction Review

**Reviewer:** Vision / Art Director pass
**Scope:** Hero + "Under the hood" architecture board (5 screenshots)
**Verdict up top:** Strong bones, genuinely premium hero, but a **hard text-collision bug** in the code pill on longer type names makes the flagship section look broken. This is a NO-SHIP until the pill bug is fixed. Score below.

---

## Screenshots reviewed
- `v-hero.png` — hero
- `v-board-01-f2.png` — Stage 1 "OS Boundary" (cyan)
- `v-board-03-f30.png` — Stage 2 "State Machine" (blue)
- `v-board-05-f62.png` — Stage 4 "AI Inference" (purple)
- `v-board-07-f92.png` — Stage 5 "Output Engine" (green)

---

## PRIORITIZED DEFECTS

### P0 — BLOCKER: Code-pill file path collides with the type name (confirmed)
**Evidence:** `v-board-03-f30.png` and `v-board-05-f62.png`.

The info-card footer pill packs two elements on one row: a colored monospace **type name** (`orchestrator::TranscriptionCoordinator`, `transcription::TranscriptionClient`) and a muted **file path** (`src-tauri/src/orchestrator...`). On short type names this works cleanly:
- `v-board-01` (`hotkey::HotkeyListener` + `src-tauri/src/hotkey/mod.rs`) — clean, gap between the two, path fully visible.
- `v-board-07` (`output::OutputHandler` + `src-tauri/src/output/mod.rs`) — clean.

But on the **long** type names the layout breaks badly:
- `v-board-03`: `orchestrator::TranscriptionCoordinator` runs right up to the path with **zero gap**; the path is forced to wrap to two cramped lines (`src-` / `tauri/src/orchestrato…`) and is **clipped at the pill's right edge**. The wrapped muted text also collides vertically with the baseline of the type name — it reads as a rendering glitch, not a design.
- `v-board-05`: identical failure — `transcription::TranscriptionClient` touches `src-` and the path wraps + clips (`tauri/src/transcription/mo…`).

This is the single worst thing on the page because it happens in the hero's twin — the "Under the hood" section that is meant to signal engineering rigor. A broken code label undercuts exactly the credibility the section is selling.

**Fix (pick one, in order of preference):**
1. **Stack, don't inline.** Put the type name on line 1 and the file path on line 2 (smaller, muted), left-aligned. Bulletproof for any length. This is what Linear/Vercel do for path metadata.
2. If you must keep one row: give the path `flex-shrink:0` is wrong — instead let the **type name** truncate with ellipsis and pin the path right, OR truncate the path from the left (`direction:rtl` / `text-overflow:ellipsis` with head clipping so the filename stays visible). Never allow the muted path to wrap inside a fixed-height pill.
3. Enforce a minimum gap (`gap: 16px`) and `white-space: nowrap` on both, then widen the pill or reduce type-name font-size so both fit. Add `overflow:hidden` handling that clips gracefully rather than overlapping.

Whatever the fix, add a max-length test case using the longest known path (`orchestrator`) so this can't regress.

---

### P1 — Board cards float lonely on the left; the isometric diagram is nearly invisible
**Evidence:** `v-board-03`, `v-board-05`, `v-board-07`.

The left-anchored glass card is nice, but the right ~55% of the frame is near-black with a barely-perceptible isometric node graphic (`v-board-03` bottom-right, `v-board-05` bottom-right). On `v-board-01` the diagram reads (cyan glow, `TranscriptionCoordinator` chip visible); on the mid-scroll frames it's so dim it looks like empty dead space rather than intentional composition. The result is a lopsided layout with a large void.

**Fix:** Lift the diagram's baseline opacity/glow by ~20–30% so it always reads as deliberate scaffolding, and/or tie the active node's glow to the current card's accent color so the eye connects card ↔ node. Consider a subtle connecting line/beam from the card to its node to justify the whitespace.

---

### P2 — Stage numbering jumps (1 → 2 → 4 → 5) with no visible Stage 3
**Evidence:** `v-board-01` (STAGE 1), `v-board-03` (STAGE 2), `v-board-05` (STAGE 4), `v-board-07` (STAGE 5).

If Stage 3 exists between frames that's fine, but from a captured set this reads as a missing step. For a section titled "Under the hood" that promises completeness, a gap in the sequence looks like a bug.

**Fix:** Confirm Stage 3 renders in the scroll sequence; if it was intentionally cut, renumber to be contiguous (1–4) so there's no perceived omission.

---

### P3 — Hero H1 has a slightly awkward line-break rhythm
**Evidence:** `v-hero.png`.

"Speak your / code. Write at / lightspeed." — the type is beautiful (heavy grotesk, tight tracking, top-tier), but the wrap puts "code." alone-ish and splits "Write at / lightspeed." across the sentence boundary. The two sentences visually interleave, so the reading rhythm is muddier than it should be for such a large statement. The gradient fade to grey on "lightspeed." is a great touch and should stay.

**Fix:** Force semantic line breaks: line 1 "Speak your code." / line 2 "Write at lightspeed." (two clean sentences). Use `<br>` or `text-wrap: balance` with explicit breakpoints. This makes the parallel structure land.

---

### P4 — Subhead & CTA feel slightly small/light relative to the enormous H1
**Evidence:** `v-hero.png`.

The H1 is ~140px+; the subhead ("A completely private, blazing fast desktop dictation engine.") is a modest grey and the two CTAs sit well below. There's a big vertical gap and a scale cliff — the eye leaps from monumental to quiet. It's not broken, just under-tuned.

**Fix:** Bump subhead a notch and/or tighten the H1→subhead→CTA spacing so the group reads as one confident block. The primary "Download Latest" button could carry the green brand accent (from the logo/badge) instead of plain white to reinforce color identity — right now the only brand color in the hero is the tiny logo and badge dot.

---

### P5 — Footer copyright sits alone in a large empty band
**Evidence:** `v-board-07-f92.png`.

After the last card there's a very tall empty region before the centered `© 2026 Voxis...` line. It reads as accidental dead space rather than intentional breathing room, and the section title above ("Under the hood") is half-clipped at the top of this frame (expected mid-scroll, noting for completeness).

**Fix:** Reduce the trailing whitespace, or add a slim footer nav / repeat-CTA to anchor the bottom. Otherwise pull the copyright up closer to the last card.

---

## WHAT'S WORKING (keep it)
- **Typography system is genuinely premium.** The heavy display grotesk, the monospace eyebrows (`// SYSTEM ARCHITECTURE`, `STAGE 1 // INPUT`), and the section title gradient are Linear/Raycast-tier. Strong, disciplined type voice.
- **Per-stage accent theming** (cyan → blue → purple → green) is a smart, restrained color system — each card's icon tile, eyebrow, glow border, and code type-name all share one accent. This is exactly the kind of color discipline top-tier tools use.
- **Glassmorphism + glow borders** on the cards are tasteful — soft outer glow in the accent color, subtle inner fill, rounded radius. Not overdone.
- **Hero gradient wash** (deep navy → black, radial) is clean and expensive-looking. The badge pill "Tauri v2 + Rust Core" with the green status dot is a nice credibility signal.
- **Consistent card internal layout** (icon → eyebrow → title → body → code pill) gives a reliable reading pattern across stages.

---

## OVERALL

The design language is **legitimately top-tier** — typography, color discipline, and glass/glow are all Linear/Vercel/Raycast adjacent. This is not amateur work. But the **P0 code-pill collision lands squarely in the flagship "engineering rigor" section**, and a clipped/overlapping code label is the exact kind of defect that makes a discerning developer audience distrust the product. You cannot ship a page that sells engineering precision with a broken monospace label.

**Beauty score: 7.5 / 10** — would be a 9 with the pill fixed and the diagram/whitespace balanced.

**Recommendation: NO-SHIP** until P0 (code-pill collision) is fixed. P1–P2 strongly recommended before launch; P3–P5 are polish.

---

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Delivered a holistic aesthetic critique plus the specifically requested code-pill text-defect check, without expanding scope beyond the 5 provided screenshots."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Each defect cites the exact screenshot filename as evidence (e.g. P0 confirmed on v-board-03-f30.png and v-board-05-f62.png, contrasted against clean v-board-01/v-board-07) and gives a concrete, implementable fix. Ends with score and ship decision."
    }
  ],
  "changedFiles": [
    "landing-reviews/vision-holistic-beauty.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Confirmed P0: file path (src-tauri/src/...) collides with type name and wraps+clips inside the code pill on long type names (orchestrator::TranscriptionCoordinator in v-board-03, transcription::TranscriptionClient in v-board-05). Short type names (hotkey::HotkeyListener v-board-01, output::OutputHandler v-board-07) render cleanly with proper gap.",
    "Additional findings: lopsided layout with near-invisible isometric diagram (P1), non-contiguous stage numbering 1/2/4/5 (P2), hero line-break rhythm (P3), subhead/CTA scale cliff (P4), trailing footer whitespace (P5)."
  ],
  "residualRisks": [
    "Review is limited to 5 static frames; the Stage 3 gap (P2) may be an artifact of the captured frame selection rather than a real omission — needs confirmation against the live scroll sequence.",
    "Diagram dimness (P1) judged from stills; motion/scroll animation may reveal it more than a frozen frame."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added one new review markdown file with prioritized aesthetic defects, confirmed code-pill text collision bug, beauty score 7.5/10, and NO-SHIP recommendation.",
  "reviewFindings": [
    "blocker: v-board-03-f30.png / v-board-05-f62.png - code-pill file path collides with and clips against the type name on long Rust type names; must fix before ship"
  ],
  "manualNotes": "Design language is genuinely premium (Linear/Raycast tier on typography and per-stage accent color discipline). The single ship-blocker is the code-pill collision landing in the engineering-credibility section. Recommend stacking type-name over file-path in the pill as the robust fix."
}
```
