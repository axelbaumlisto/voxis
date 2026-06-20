/**
 * A/B checkpoint for Commit 31 (authentic body profile).
 * Captures drifting_contour with the rigid smooth membrane + mex, comparing the
 * body SHAPE: the current symmetric ellipse (squeeze only) vs the three slipper
 * profiles (taperedEllipse / egg / piriform). User picks the authentic shape.
 *
 * Output: e2e/screenshots/profile-ab/{variant}-{mode}-{level}-{i}.png
 */
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const OUT = "e2e/screenshots/profile-ab";

// Common base: rigid smooth membrane + short somatic mex on the contour.
// Pin the cell centred (driftActivationRate 0) so the SHAPE is fully visible.
const base = {
  driftActivationRate: 0,
  enableSomaticCilia: true,
  enableCiliaOnContour: true,
  enableRigidMembrane: true,
  enableAffine: true,
};

const VARIANTS = [
  // current rejected look: symmetric ellipse via resting prolate, no profile
  { name: "ellipse", params: { ...base, enableRestingProlate: true, prolateRestAspect: 1.732 } },
  { name: "taperedEllipse", params: { ...base, enableBodyProfile: true, bodyProfileType: "taperedEllipse", bodyProfileTaper: 0.3, bodyAspect: 3 } },
  { name: "egg", params: { ...base, enableBodyProfile: true, bodyProfileType: "egg", bodyProfileTaper: 0.3, bodyAspect: 3 } },
  { name: "piriform", params: { ...base, enableBodyProfile: true, bodyProfileType: "piriform", bodyProfileTaper: 0.3, bodyAspect: 3 } },
] as const;

const CASES = [
  { mode: "recording", level: 0.9 },
  { mode: "idle", level: 0.0 },
] as const;

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

for (const v of VARIANTS) {
  for (const c of CASES) {
    test(`profile-ab: ${v.name} ${c.mode}@${c.level}`, async ({ page }) => {
      const p = encodeURIComponent(JSON.stringify(v.params));
      const url = `/harness.html?theme=drifting_contour&mode=${c.mode}&level=${c.level}&w=160&h=160&scale=1&params=${p}`;
      await page.goto(url);

      const host = page.getByTestId("theme-host");
      await expect(host).toBeVisible();
      const canvas = host.locator("canvas");
      await expect(canvas).toHaveAttribute("width", "160");

      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(700);
        await canvas.screenshot({ path: `${OUT}/${v.name}-${c.mode}-${c.level}-${i}.png` });
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
