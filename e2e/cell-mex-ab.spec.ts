/**
 * A/B checkpoint for Commit 22 (somatic "mex").
 * Captures drifting_contour side-by-side: the current 18-hair CROWN (gates OFF)
 * vs the dense short somatic MEX (enableSomaticCilia + enableCiliaOnContour ON),
 * at idle / recording@0.5 / recording@0.9. Pure harness, no Tauri.
 *
 * Output: e2e/screenshots/cilia-ab/{crown,mex}-{mode}-{level}-{i}.png
 * These are for USER A/B approval before flipping any default look.
 */
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const OUT = "e2e/screenshots/cilia-ab";

// Roam a little so the prolate body + contour-anchored fringe are visible.
const CROWN = encodeURIComponent(JSON.stringify({ driftMargin: 30 }));
const MEX = encodeURIComponent(
  JSON.stringify({
    driftMargin: 30,
    enableSomaticCilia: true,
    enableCiliaOnContour: true,
  }),
);

const CASES = [
  { mode: "recording", level: 0.9 },
  { mode: "recording", level: 0.5 },
  { mode: "idle", level: 0.0 },
] as const;

const VARIANTS = [
  { name: "crown", params: CROWN },
  { name: "mex", params: MEX },
] as const;

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

for (const v of VARIANTS) {
  for (const c of CASES) {
    test(`cilia-ab: ${v.name} ${c.mode}@${c.level}`, async ({ page }) => {
      const url = `/harness.html?theme=drifting_contour&mode=${c.mode}&level=${c.level}&w=160&h=160&scale=2&params=${v.params}`;
      await page.goto(url);

      const host = page.getByTestId("theme-host");
      await expect(host).toBeVisible();
      const canvas = host.locator("canvas");
      await expect(canvas).toHaveAttribute("width", "160");

      // Capture a few frames so the beat/metachrony is visible.
      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(700);
        await canvas.screenshot({
          path: `${OUT}/${v.name}-${c.mode}-${c.level}-${i}.png`,
        });
      }

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
}
