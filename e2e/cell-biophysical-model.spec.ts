/**
 * Visual verification of the cumulative biophysical model (Commits 1-9):
 * activity-driven swimming, prolate body, cilia drag-lean, area conservation.
 * Captures drifting_contour at DEFAULT params (gates ON) in recording mode so
 * the new coupling is exercised exactly as it ships. Pure harness, no Tauri.
 */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const OUT = "e2e/screenshots/biophysical";

// Let the cell roam a little so the prolate + drag-lean show (don't pin centre).
const ROAM = encodeURIComponent(JSON.stringify({ driftMargin: 30 }));

const CASES = [
  { theme: "drifting_contour", mode: "recording", level: 0.9 },
  { theme: "drifting_contour", mode: "recording", level: 0.5 },
  { theme: "drifting_contour", mode: "idle", level: 0.0 },
] as const;

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

for (const c of CASES) {
  test(`biophysical: ${c.theme} ${c.mode}@${c.level} renders + animates`, async ({ page }) => {
    const url = `/harness.html?theme=${c.theme}&mode=${c.mode}&level=${c.level}&w=160&h=160&scale=2&params=${ROAM}`;
    await page.goto(url);

    const host = page.getByTestId("theme-host");
    await expect(host).toBeVisible();
    const canvas = host.locator("canvas");
    await expect(canvas).toHaveAttribute("width", "160");

    // Capture across several seconds so motion/prolate/beat are visible.
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(700);
      await canvas.screenshot({ path: `${OUT}/${c.theme}-${c.mode}-${c.level}-${i}.png` });
    }

    // Sanity: the canvas draws non-empty content (some non-transparent pixels).
    const nonEmpty = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext("2d");
      if (!ctx) return 0;
      const { data } = ctx.getImageData(0, 0, el.width, el.height);
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++;
      return n;
    });
    expect(nonEmpty).toBeGreaterThan(50);
  });
}
