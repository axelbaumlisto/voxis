/**
 * Synthetic E2E: theme palette propagation.
 *
 * Loads `overlay.html?theme=<id>` in plain Chrome (no Tauri, no voice
 * process) and verifies that the rendered pill carries the colors from
 * the named theme's `handy_pill.palette` block. The ?theme= URL hook
 * (src/overlay.tsx) sets the themeId directly so the test does not
 * need to mock Tauri commands.
 *
 * Why synthetic (no screencapture):
 *  - runs in CI without GUI / X11 / macOS;
 *  - <10 s wall-clock;
 *  - the "does CSS-vars wiring work" question is answered identically
 *    in Chrome and WebKit2GTK/NSPanel webviews.
 *
 * Live (screencapture) tests live in `e2e/handy-themes-live-gallery.spec.ts`
 * and complement these by exercising the OS-level surface.
 */
import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

test.describe.configure({ mode: "serial" });

const SHOTS_DIR = "test-results/handy-theme-switch";
const PILL_W = 172;
const PILL_H = 36;

/**
 * Themes with their expected pill-icon color (from
 * src-tauri/themes/<id>/theme.json `handy_pill.palette.icon_color`).
 * Verified against the Rust resolver's `default` for `default` theme
 * where the file declares Material blue.
 */
/**
 * Themes split by family for assertion strategy:
 *  - organic_ring / handy: pixel-probe with palette.icon_color (the
 *    ring/icon is large enough at idle to test).
 *  - bars: structural check (assert ClassicBars rendered N bars at
 *    min height in idle) — synthetic chromium has no spectrum source,
 *    so bars draw at 2px height and the gradient is anti-aliased to
 *    mostly-white. Pixel match is unreliable. Live gallery covers
 *    bars with real spectrum injection.
 */
const ICON_THEMES = [
  { id: "drifting_contour", icon: { r: 0xd9, g: 0xa8, b: 0x65 } },
  { id: "living_reed", icon: { r: 0x7c, g: 0xc2, b: 0x87 } },
  { id: "quiet_reed", icon: { r: 0x7a, g: 0x9f, b: 0xbd } },
] as const;
const BAR_THEMES = [
  { id: "default", bars: 16 },
  { id: "dark", bars: 16 },
  { id: "monochrome", bars: 16 },
  { id: "neon", bars: 16 },
  { id: "winamp_classic", bars: 16 },
] as const;
const THEMES = ICON_THEMES;

/**
 * Count pixels in `png` whose RGB Euclidean distance to `(r, g, b)`
 * is <= `tolerance`. Euclidean is required (NOT per-channel) because
 * anti-aliased gradient bars at min height (2px) drift each channel
 * up to ±50 from the reference — e.g. neon top #ff00ff (255,0,255)
 * renders as ~(255, 75, 200) on screen. Default 80 matches the
 * live-gallery spec.
 */
async function countMatchingPixels(
  png: string,
  r: number,
  g: number,
  b: number,
  tolerance = 80,
): Promise<number> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const t2 = tolerance * tolerance;
  const py = `
from PIL import Image
img = Image.open(${JSON.stringify(png)}).convert("RGBA")
n = 0
for (R, G, B, A) in img.getdata():
    if A < 32: continue
    dr = R-${r}; dg = G-${g}; db = B-${b}
    if dr*dr + dg*dg + db*db <= ${t2}:
        n += 1
print(n)
`;
  const { stdout } = await exec("python3", ["-c", py]);
  return parseInt(stdout.trim(), 10);
}

test.beforeAll(async () => {
  await mkdir(SHOTS_DIR, { recursive: true });
});

for (const { id, icon } of THEMES) {
  test(`theme "${id}" \u2014 idle pill renders ${icon.r},${icon.g},${icon.b} (icon_color)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: PILL_W, height: PILL_H });
    await page.goto(`/overlay.html?theme=${id}`);
    await page.waitForSelector(".recording-overlay");
    // Wait for the async theme fetch (or its fallback) to settle + fade-in.
    await page.waitForTimeout(500);
    const out = `${SHOTS_DIR}/${id}-idle.png`;
    await page.screenshot({
      path: out,
      clip: { x: 0, y: 0, width: PILL_W, height: PILL_H },
    });
    const hits = await countMatchingPixels(out, icon.r, icon.g, icon.b);
    expect(
      hits,
      `theme '${id}' must render at least 20 pixels of its icon_color (${icon.r},${icon.g},${icon.b}); saw ${hits}\n  ${out}`,
    ).toBeGreaterThan(20);
  });
}

for (const { id, icon } of THEMES) {
  test(`theme "${id}" \u2014 recording pill (mic+bars) uses ${icon.r},${icon.g},${icon.b}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: PILL_W, height: PILL_H });
    await page.goto(`/overlay.html?theme=${id}&mode=recording`);
    await page.waitForSelector(".recording-overlay");
    await page.waitForTimeout(500);
    const out = `${SHOTS_DIR}/${id}-recording.png`;
    await page.screenshot({
      path: out,
      clip: { x: 0, y: 0, width: PILL_W, height: PILL_H },
    });
    // Recording mode adds bars + cancel-X; both rendered using
    // palette.icon_color (cancel) or palette.bar_color (bars) which is
    // a lighter variant. The icon_color search captures the mic icon
    // and the cancel-X.
    const hits = await countMatchingPixels(out, icon.r, icon.g, icon.b);
    expect(
      hits,
      `theme '${id}' recording pill must show icon_color; saw ${hits}\n  ${out}`,
    ).toBeGreaterThan(20);
  });
}

test("PNG gallery saved — organic_ring icon themes (3 × 2 modes)", async () => {
  for (const { id } of THEMES) {
    const idle = await readFile(`${SHOTS_DIR}/${id}-idle.png`);
    const rec = await readFile(`${SHOTS_DIR}/${id}-recording.png`);
    expect(idle.length).toBeGreaterThan(100);
    expect(rec.length).toBeGreaterThan(100);
  }
});

// Structural smoke for bars-family themes (5). Chromium synthetic env
// can't drive useful pixels (no audio source -> bars at 2px min height),
// so we assert the DOM contract instead and let the live-gallery spec
// do the real visual proof.
for (const { id, bars } of BAR_THEMES) {
  test(`theme "${id}" — bars family renders ${bars} ClassicBars elements`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: PILL_W, height: PILL_H });
    await page.goto(`/overlay.html?theme=${id}`);
    await page.waitForSelector(".recording-overlay");
    await expect(page.locator(".recording-overlay")).toHaveAttribute(
      "data-family",
      "bars",
    );
    await expect(page.locator(".classic-bar")).toHaveCount(bars);
    const out = `${SHOTS_DIR}/${id}-idle.png`;
    await page.screenshot({
      path: out,
      clip: { x: 0, y: 0, width: PILL_W, height: PILL_H },
    });
  });
}
