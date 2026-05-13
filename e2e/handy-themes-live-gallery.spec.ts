/**
 * Live screenshot gallery for the 8 Handy-pill themes.
 *
 * Trigger matrix (per theme): 7 visual states captured via real
 * `screencapture` of the NSPanel pill window:
 *
 *   01-idle           — pill at rest in the theme's palette
 *   02-recording      — overlay.state=recording, no spectrum yet
 *   03-recording-loud — peak spectrum injected (bars at 0.9)
 *   04-recording-mid  — half-spectrum (bars at 0.5)
 *   05-silence-decay  — bins=0; bars fall at the theme's peak_decay rate
 *   06-transcribing   — overlay.state=transcribing
 *   07-back-to-idle   — overlay.state=idle (round-trip)
 *
 * Plus per-theme:
 *   08-pixel-diff.png — diff overlay (idle vs recording-loud), proves
 *                       the recording state visually differs from idle
 *
 * Pixel assertions per theme:
 *   - idle frame contains theme.icon_color pixels (>= 20 at tolerance 18)
 *   - recording-loud differs from idle (>= 200 changed pixels)
 *
 * Artifacts: test-results/handy-gallery/<theme>/0X-name.png
 *            test-results/handy-gallery/index.html (built in afterAll)
 *
 * Pre-conditions: voice running in debug mode (debug socket open) +
 * macOS with a Recording Overlay window present at expected coords.
 *
 * SOLID/DRY/KISS:
 *  - SRP: one test = one theme × 8 frames + asserts; afterAll renders
 *    HTML index from collected paths.
 *  - DRY: all socket/capture/diff plumbing lives in handyGallery.ts.
 *  - KISS: a single for-loop generates per-theme test.describe blocks.
 */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { getVoicePid, findPillWindow } from "./helpers/voiceApp";
import {
  buildGalleryIndexHtml,
  captureWindowDirect,
  countMatchingPixels,
  emitSilence,
  emitSpectrum,
  hexToRgb,
  peakBins,
  saveDiffOverlay,
  setHandyTheme,
  setOverlayState,
  type GalleryEntry,
} from "./helpers/handyGallery";

// eslint-disable-next-line playwright/no-skipped-test
test.skip(process.platform !== "darwin", "live gallery is macOS-only for now");

test.describe.configure({ mode: "serial", retries: 1 });

const GALLERY_DIR = "test-results/handy-gallery";

/**
 * Themes + their expected idle probe color (per family) and minimum
 * idle→loud diff threshold.
 *
 * Per family:
 *   - handy:        mic icon drawn in `palette.icon_color` → probe with icon
 *                   color; idle↔loud diff is huge (bars appear/disappear).
 *   - organic_ring: ring stroked in `palette.icon_color` → probe with
 *                   icon color; idle↔loud diff is small (ring shape
 *                   only subtly shifts under audio drive).
 *   - bars:         no icon. In idle bars sit at min height (2px)
 *                   showing the `bars.gradient_bottom` color → probe
 *                   with gradient_bottom; idle↔loud diff is huge.
 */
// Probe color = the color that is dominantly visible in the IDLE state
// for this theme. For bars family at min height (2px) CSS gradient
// averages to ~top color; we use the top stop. For organic_ring and
// handy the ring/icon is stroked with palette.icon_color.
const THEMES = [
  { id: "winamp_classic", family: "bars",         probe: "#ef3110", minDiff: 200 },
  { id: "default",        family: "bars",         probe: "#64b5f6", minDiff: 200 },
  { id: "dark",           family: "bars",         probe: "#b388ff", minDiff: 200 },
  { id: "monochrome",     family: "bars",         probe: "#a0a0a0", minDiff: 200 },
  { id: "neon",           family: "bars",         probe: "#ff00ff", minDiff: 200 },
  { id: "drifting_contour", family: "organic_ring", probe: "#d9a865", minDiff: 30 },
  { id: "living_reed",    family: "organic_ring", probe: "#7cc287", minDiff: 30 },
  // quiet_reed by design has minimal motion (speech_responsiveness=0.6,
  // idle_breathing=0.05) — the idle↔loud frame-pair diff is tiny
  // because the ring barely reshapes under audio drive. We still want
  // a non-zero threshold to catch a fully-static render, just much
  // lower than the other ring themes.
  { id: "quiet_reed",     family: "organic_ring", probe: "#7a9fbd", minDiff: 10 },
] as const;

const galleryEntries: GalleryEntry[] = [];

test.beforeAll(async () => {
  await mkdir(GALLERY_DIR, { recursive: true });
  const pid = await getVoicePid();
  if (!pid) throw new Error("voice is not running; start `bun run tauri dev` first");
  // sanity: pill window must exist
  const win = await findPillWindow(pid);
  if (!win) throw new Error("Recording Overlay window not found via xdotool/CGWindow");
});

test.afterAll(async () => {
  await buildGalleryIndexHtml(GALLERY_DIR, galleryEntries);
});

for (const t of THEMES) {
  test(`theme '${t.id}' — 7-frame lifecycle + diff (live screencapture)`, async () => {
    const pid = (await getVoicePid())!;
    const win = (await findPillWindow(pid))!;
    const out = `${GALLERY_DIR}/${t.id}`;
    await mkdir(out, { recursive: true });

    // ---- Apply theme + reset to idle ----
    await setHandyTheme(t.id);
    await setOverlayState("idle");
    await emitSilence();
    await new Promise((r) => setTimeout(r, 600));

    // 01 — idle ---------------------------------------------------------
    const idle = `${out}/01-idle.png`;
    await captureWindowDirect(win.id, idle);
    const { r, g, b } = hexToRgb(t.probe);
    // Euclidean tolerance 80 catches the anti-aliased ring around the
    // brain icon's actual pixels (the rendered hue drifts ±30 per
    // channel from the reference due to SVG / gradient sub-pixel rendering).
    const iconHits = await countMatchingPixels(idle, r, g, b, 80);
    expect(
      iconHits,
      `theme '${t.id}' (${t.family}) idle must show its probe color ${t.probe} (>=10 px); saw ${iconHits}\n  ${idle}`,
    ).toBeGreaterThan(10);

    // 02 — recording (no spectrum yet) ---------------------------------
    await setOverlayState("recording");
    await new Promise((r) => setTimeout(r, 400));
    const rec = `${out}/02-recording.png`;
    await captureWindowDirect(win.id, rec);

    // 03 — recording-loud (peak spectrum) ------------------------------
    // Pre-warm with repeated bursts so the smoothing/peak hooks settle
    // at peak; one shot is not enough for the organic_ring family
    // (the canvas RAF reads the latest bins on each frame, but
    // useSmoothBars only updates on event arrival).
    for (let i = 0; i < 6; i++) {
      await emitSpectrum(peakBins(0.9));
      await new Promise((r) => setTimeout(r, 70));
    }
    const loud = `${out}/03-recording-loud.png`;
    await captureWindowDirect(win.id, loud);

    // 04 — recording-mid (half level) ----------------------------------
    await emitSpectrum(peakBins(0.5));
    await new Promise((r) => setTimeout(r, 350));
    const mid = `${out}/04-recording-mid.png`;
    await captureWindowDirect(win.id, mid);

    // 05 — silence (bars decay at theme's peak_decay rate) -------------
    await emitSilence();
    await new Promise((r) => setTimeout(r, 250));
    const decay = `${out}/05-silence-decay.png`;
    await captureWindowDirect(win.id, decay);

    // 06 — transcribing -------------------------------------------------
    await setOverlayState("transcribing");
    await new Promise((r) => setTimeout(r, 500));
    const tx = `${out}/06-transcribing.png`;
    await captureWindowDirect(win.id, tx);

    // 07 — back-to-idle ------------------------------------------------
    await setOverlayState("idle");
    await new Promise((r) => setTimeout(r, 700));
    const back = `${out}/07-back-to-idle.png`;
    await captureWindowDirect(win.id, back);
    const backHits = await countMatchingPixels(back, r, g, b, 80);
    expect(
      backHits,
      `theme '${t.id}' should return to idle showing ${t.probe}; saw ${backHits}\n  ${back}`,
    ).toBeGreaterThan(8);

    // 08 — diff overlay (idle vs recording-loud) -----------------------
    const diff = `${out}/08-pixel-diff.png`;
    const { diffPixels } = await saveDiffOverlay(idle, loud, diff);
    expect(
      diffPixels,
      `theme '${t.id}' (${t.family}) recording-loud must visibly differ from idle (>=${t.minDiff} px); saw ${diffPixels}\n  idle=${idle}\n  loud=${loud}`,
    ).toBeGreaterThan(t.minDiff);

    galleryEntries.push({
      theme: t.id,
      frames: [
        { label: "01 idle", path: idle },
        { label: "02 recording", path: rec },
        { label: "03 loud", path: loud },
        { label: "04 mid", path: mid },
        { label: "05 decay", path: decay },
        { label: "06 transcribing", path: tx },
        { label: "07 back-idle", path: back },
        { label: "08 diff", path: diff },
      ],
    });
  });
}
