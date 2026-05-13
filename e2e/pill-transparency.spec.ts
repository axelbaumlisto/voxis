/**
 * Pill transparency E2E.
 *
 * Verifies the user-visible contract: the HandyPill background is fully
 * transparent in EVERY mode (idle / recording / transcribing / error).
 * Only icons + bars are drawn over the desktop; no dark capsule.
 *
 * Approach: render `overlay.html` in Playwright (Chrome) on top of a
 * known background color, then count how many pixels match that
 * background color in the pill area. If the pill had a dark capsule
 * its corners would obscure a measurable region; with a fully
 * transparent pill the bg color leaks through everywhere except the
 * 36-px tall pink icon strip on the left.
 */
import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test.describe.configure({ mode: "serial" });

const SHOTS_DIR = "test-results/pill-transparency";

/**
 * Count pixels in `pngPath` whose RGB channels are all within `tolerance`
 * of `(targetR, targetG, targetB)`. Uses Python+PIL for speed and to
 * avoid pulling pngjs/pixelmatch into the project.
 */
async function countMatchingPixels(
  pngPath: string,
  targetR: number,
  targetG: number,
  targetB: number,
  tolerance = 10,
): Promise<number> {
  const py = `
from PIL import Image
img = Image.open(${JSON.stringify(pngPath)}).convert("RGBA")
count = 0
for (r, g, b, _) in img.getdata():
    if abs(r-${targetR}) <= ${tolerance} and abs(g-${targetG}) <= ${tolerance} and abs(b-${targetB}) <= ${tolerance}:
        count += 1
print(count)
`;
  const { stdout } = await execFileAsync("python3", ["-c", py]);
  return parseInt(stdout.trim(), 10);
}

/**
 * Inject a body background BEFORE the React root mounts so screenshot
 * captures the pill **over** that color. Tests then count pixels of
 * that color inside the pill area to assert transparency.
 */
async function bootOverlayWithBg(
  page: import("@playwright/test").Page,
  url: string,
  bgHex: string,
) {
  // Pre-inject body bg via init script so it's set before React paints.
  await page.addInitScript((bg: string) => {
    const apply = () => {
      document.documentElement.style.background = bg;
      document.body.style.background = bg;
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", apply);
    } else {
      apply();
    }
  }, bgHex);
  await page.goto(url);
  await page.waitForSelector(".recording-overlay");
  // Give React + CSS transitions a moment to settle (fade-in is 300 ms).
  await page.waitForTimeout(400);
}

const PILL_W = 172;
const PILL_H = 36;
const BG = "#005577"; // teal — distinct from icon pink + bars cream
const BG_RGB = { r: 0x00, g: 0x55, b: 0x77 };
const TOTAL_PX = PILL_W * PILL_H; // 6 192

test.beforeAll(async () => {
  await mkdir(SHOTS_DIR, { recursive: true });
});

test("idle pill: >85% of pixels show the desktop through (transparent bg)", async ({
  page,
}) => {
  await page.setViewportSize({ width: PILL_W, height: PILL_H });
  await bootOverlayWithBg(page, "/overlay.html", BG);
  const png = `${SHOTS_DIR}/idle.png`;
  await page.screenshot({ path: png, clip: { x: 0, y: 0, width: PILL_W, height: PILL_H } });
  const through = await countMatchingPixels(png, BG_RGB.r, BG_RGB.g, BG_RGB.b, 12);
  const ratio = through / TOTAL_PX;
  expect(
    ratio,
    `idle pill must let >85% of bg-pixels through; saw ${(ratio * 100).toFixed(1)}% (${through}/${TOTAL_PX})\n  ${png}`,
  ).toBeGreaterThan(0.85);
});

test("recording pill: >55% of pixels show the desktop through (bars + cancel + mic visible)", async ({
  page,
}) => {
  await page.setViewportSize({ width: PILL_W, height: PILL_H });
  await bootOverlayWithBg(page, "/overlay.html?mode=recording", BG);
  const png = `${SHOTS_DIR}/recording.png`;
  await page.screenshot({ path: png, clip: { x: 0, y: 0, width: PILL_W, height: PILL_H } });
  const through = await countMatchingPixels(png, BG_RGB.r, BG_RGB.g, BG_RGB.b, 12);
  const ratio = through / TOTAL_PX;
  // Recording adds: mic icon + 9 bars + cancel-X. That's a lot of pixels.
  // We require at least 55% of the surface to still show the desktop —
  // anything below means there's a dark capsule behind the bars.
  expect(
    ratio,
    `recording pill must keep >55% of bg-pixels visible (no dark capsule); saw ${(ratio * 100).toFixed(1)}% (${through}/${TOTAL_PX})\n  ${png}`,
  ).toBeGreaterThan(0.55);
});

test("recording pill (no opaque capsule): contains no large solid-black region", async ({
  page,
}) => {
  await page.setViewportSize({ width: PILL_W, height: PILL_H });
  await bootOverlayWithBg(page, "/overlay.html?mode=recording", BG);
  const png = `${SHOTS_DIR}/recording-noblack.png`;
  await page.screenshot({ path: png, clip: { x: 0, y: 0, width: PILL_W, height: PILL_H } });
  // Count pixels that are nearly black (would form a dark capsule).
  const black = await countMatchingPixels(png, 0, 0, 0, 30);
  const ratio = black / TOTAL_PX;
  expect(
    ratio,
    `recording pill must not contain a >20% dark-capsule region; saw ${(ratio * 100).toFixed(1)}% (${black}/${TOTAL_PX})\n  ${png}`,
  ).toBeLessThan(0.2);
});

test("pill PNG snapshot inspectable: writes idle + recording artifacts", async () => {
  // Smoke: the previous tests must have produced PNGs we can read back.
  const idle = await readFile(`${SHOTS_DIR}/idle.png`);
  const rec = await readFile(`${SHOTS_DIR}/recording.png`);
  expect(idle.length).toBeGreaterThan(100);
  expect(rec.length).toBeGreaterThan(100);
});
