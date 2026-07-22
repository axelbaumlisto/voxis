# Vision Review — 3D PCB Board "Multi-Layer Complexity" & Beauty

**Section:** Voxis landing page — "Under the hood" / System Architecture scroll-driven fly-through
**Reviewer role:** Senior visual/motion designer (brutal)
**Frames reviewed:** scroll fractions 2%, 14%, 30%, 46%, 62%, 78%, 92% + hero

---

## Per-frame observations (what the board actually looks like)

**v-hero.png** — No board present. Clean hero, big type. Baseline for the dark navy→black gradient. Nothing to critique on the board here; noting only that there is zero foreshadowing of the 3D board before you scroll into it.

**v-board-01-f2.png (2%)** — This is the BEST frame for complexity and the only one that reads as a stack. Right half shows a large faint upper board plane top-right, then a brighter mid-right cluster: a central cyan orchestrator node (glowing diamond chip) surrounded by satellite tiles with faint labels (`orchestrator::TranscriptionCoordinator`, "Stage" tags), plus another dim tile descending toward the bottom edge. You can read ~2–3 stacked planes here with cyan neon accent. Even so, the whole assembly sits in the right-third and lower-right, not filling the right half, and the upper plane is so low-contrast it nearly disappears into black.

**v-board-02-f14.png (14%)** — Collapse begins. The board has slid down into the bottom-right corner. Only one node cluster is meaningfully visible (small blue diamond chip ~center-bottom), and it's noticeably dimmer and smaller than f2. The upper plane is now a barely-perceptible ghost at top-right. Multi-layer illusion is already ~50% gone. Card (Stage 1) still full-strength cyan glow on the left.

**v-board-03-f30.png (30%) — Stage 2 State Machine** — Board is jammed further into the bottom-right corner, extremely dim. A gold/amber node sits near the bottom edge, partially clipped. Surrounding tiles are near-invisible dark-on-dark rectangles. A faint layer outline lingers top-center-right. This reads as a single dim tile, not a circuit stack. The amber accent is pretty but tiny.

**v-board-04-f46.png (46%) — Stage 3 Audio Subsystem** — Confirmed dead zone. Board is deep in bottom-right corner, purple/magenta node low and small, most of the tile stack off-screen or invisible. A large faint plane outline floats top-center but has almost no fill or trace detail. The right ~55% of the canvas is essentially empty black. Multi-layer illusion is gone.

**v-board-05-f62.png (62%) — Stage 4 AI Inference** — Same failure, worse. Teal/green node even lower and smaller in the bottom-right, close to clipping off the bottom edge. Upper ghost plane top-right is a faint wireframe with no depth. Huge dead negative space on the right half. Nice purple card glow on the left is now doing ALL the visual work.

**v-board-06-f78.png (78%) — Stage 5 Output Engine** — The board has essentially evaporated. Only a very faint green ghost-outline of a plane remains upper-right; no readable node, no traces, no stack. The scene is a lit card floating in black. Zero complexity.

**v-board-07-f92.png (92%)** — End of section bleeding into footer. Faint ghost board fragments top area, card floating mid-left, "© 2026 Voxis" footer visible. Board contributes nothing.

---

## Verdict on the stated suspicions

- **"Active board drifts into the bottom-right corner and gets dim/small on deeper layers (f46–f92), losing the multi-layer illusion"** — **CONFIRMED, and it starts earlier than f46.** Degradation is visible by f14 and total by f30. By f46–f92 the board is a dim corner speck / ghost outline.
- **"Board never fills enough of the right half"** — **CONFIRMED.** Even at its best (f2) it occupies roughly the right-third and lower-right. From f30 on, the right half is 50–70% empty black.

---

## Prioritized visual defects (with evidence + fixes)

**1. [CRITICAL] The board dims into near-invisibility as you scroll deeper — the fly-through goes DARKER instead of richer.**
Evidence: f30/f46/f62/f78 — node brightness and tile contrast fall off a cliff after f2; by f78 (v-board-06) the board is a ghost.
Fix: Invert the falloff. Keep the *active* stage's node + its immediate neighbors at high luminance (accent color at ~90–100% + a bloom pass). Floor the ambient tile fill at a readable value (raise base tile from ~#0a0a0a to ~#141821 with a 1px accent-tinted stroke at 25–35% opacity). The deeper you go, the MORE the board should light up, not less.

**2. [CRITICAL] Board collapses to a single tile — the "stack" reads as one node, not a many-layered PCB.**
Evidence: f30/f46/f62 show essentially one lit node with invisible neighbors; only f2 shows >1 plane.
Fix: Explicitly render 3–5 parallel isometric planes with visible vertical separation (offset each layer ~40–70px on the iso-Y with a drop shadow + rim light between planes). Give each plane its own trace network (thin neon lines connecting pads). Keep at least 2 planes always in-frame and lit so the depth reads at every scroll position.

**3. [CRITICAL] The board sinks into the bottom-right corner and clips off-screen.**
Evidence: f14→f62 the active node marches steadily toward the bottom-right edge (v-board-05 node nearly clipped).
Fix: Re-anchor the camera so the active node stays centered in the right-half "hot zone" (roughly x≈68–72% of viewport width, y≈45–55% height). Pan/orbit around a fixed focal point rather than translating the whole board downward off the canvas.

**4. [HIGH] Board never fills the right half — massive dead negative space.**
Evidence: f46/f62/f78 — right ~55% of the frame is empty black.
Fix: Scale the board up 1.6–2.2× so the active plane + neighbors span roughly x=52%→96%. Push some tiles/traces slightly under the text card's right edge for overlap and depth. Add out-of-focus foreground tiles bleeding off the right/bottom edges to imply the board continues.

**5. [HIGH] No neon traces / circuit detail — it's flat dark rectangles, not a PCB.**
Evidence: Every board frame; even f2's tiles have no visible copper/trace routing, just labels.
Fix: Add glowing trace paths (per-stage accent color) routing between pads with right-angle/45° PCB geometry, subtle animated "data pulse" dashes traveling along active traces. Add via-holes, pad grids, silkscreen micro-labels for texture.

**6. [MEDIUM] Depth-of-field is doing the wrong job — it blurs everything into mud instead of guiding focus.**
Evidence: f30/f46 the whole board is uniformly soft/dim; there's no crisp in-focus subject.
Fix: Real tilt-shift DoF: active plane tack-sharp and bright; near + far planes get progressive Gaussian blur AND bokeh (round highlight discs on lit vias). This adds premium depth while keeping the hero subject legible.

**7. [MEDIUM] Per-stage color is present but under-committed.**
Evidence: cyan (f2), blue (f30), gold (f46-ambient/f30), purple (f46), teal-green (f62/f78) — the accent only tints the tiny node and the left card border; the board itself stays neutral black.
Fix: Bleed the stage accent into the board — tint the active plane's traces, rim light, and a soft volumetric glow/gradient wash behind the board in that stage's hue. The color transition between stages should feel like the whole scene relights.

**8. [LOW] Card and board compete rather than compose.**
Evidence: f62/f78 — the left card's glow is the strongest element; the board is an afterthought.
Fix: Once the board is brightened (defects 1–4), balance the composition so the eye travels card → connecting trace → active node. Consider a literal glowing connector line from the card to the active board node.

**9. [LOW] Section-end (f92) shows the board fully faded while footer appears — abrupt, unfinished exit.**
Evidence: v-board-07-f92.
Fix: Give the board a deliberate outro (e.g., all stages light up simultaneously as a "full system" beauty shot) before it fades to the footer, rather than quietly dying.

---

## Scores

- **Multi-layer complexity: 3 / 10** — Only f2 reads as layered; every deeper frame collapses to one dim tile. The core promised illusion fails for ~80% of the scroll.
- **Beauty / premium craft: 4 / 10** — The left cards, per-stage accent hues, and f2's cyan node show genuine taste, but the board itself is dim, trace-less, corner-stranded, and swimming in dead space. Not premium yet.

## Verdict

**NO-SHIP** — the board loses its multi-layer depth by 30% scroll and becomes a dim corner speck; fix brightness falloff, layer separation, centering, and right-half fill before this ships.

---

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Delivered a focused visual critique of the 3D PCB board section only (multi-layer complexity + beauty), per-frame notes for all 7 board frames + hero, prioritized defect list with fixes, and scores. No scope beyond the review."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Each defect cites specific screenshot filenames (e.g. v-board-06-f78.png, v-board-05-f62.png) as evidence; suspicions explicitly confirmed with frame references; scores and SHIP/NO-SHIP verdict included."
    }
  ],
  "changedFiles": [
    "landing-reviews/vision-board-complexity.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Visually inspected all 8 provided PNGs via read tool; findings written to /home/sham/work/soupawhisper/landing-reviews/vision-board-complexity.md"
  ],
  "residualRisks": [
    "Critique is based on 7 discrete scroll-fraction stills; intermediate motion/easing between frames was not observable and may differ.",
    "Exact pixel coordinates/opacities are visual estimates, not measured from source CSS/canvas."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added new review artifact vision-board-complexity.md with per-frame analysis, prioritized defect list, fixes, and scores.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Both user suspicions CONFIRMED: (1) board drifts into bottom-right and dims/shrinks on deeper layers — degradation actually starts by f14 and is total by f30, earlier than the suspected f46; (2) board never fills the right half, best case f2 is only right-third. Top fixes: invert brightness falloff (light up deeper, not darker), render 3-5 separated lit planes, re-center active node in right-half hot zone, scale board 1.6-2.2x, add neon traces."
}
```
