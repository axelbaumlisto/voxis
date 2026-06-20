/**
 * Final A/B: full Paramecium organism (all v3.2-bis gates ON) vs baseline.
 * Biologist reviewer judges these PNGs (idle vs recording) — no user gate.
 * Output: e2e/screenshots/full-ab/{name}-{mode}-{i}.png
 */
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const OUT = "e2e/screenshots/full-ab";

const full = {
  enableSomaticCilia: true, enableCiliaOnContour: true, enableRigidMembrane: true,
  enableBodyProfile: true, bodyProfileType: "egg", bodyProfileTaper: 0.27, bodyAspect: 3,
  bodyVentralBend: 0.12, enableAffine: true, enableCiliaStructure: true,
  enableAxialSpin: true, axialSpinMax: 7, enableVacuoles: true, enableCyclosis: true,
  enableOrganelles: true, enableActivity: true,
};

// idle = pinned centre, full shape visible; recording = swimming/active.
const CASES = [
  { name: "full-idle",    mode: "idle",      level: 0.0, pin: true },
  { name: "full-rec",     mode: "recording", level: 0.9, pin: true },
  { name: "full-rec-swim",mode: "recording", level: 0.9, pin: false },
] as const;

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

for (const c of CASES) {
  test(`full-ab ${c.name}`, async ({ page }) => {
    const params = { ...full, ...(c.pin ? { driftActivationRate: 0 } : {}) };
    const p = encodeURIComponent(JSON.stringify(params));
    await page.goto(`/harness.html?theme=drifting_contour&mode=${c.mode}&level=${c.level}&w=160&h=160&scale=1&params=${p}`);
    const canvas = page.getByTestId("theme-host").locator("canvas");
    await expect(canvas).toHaveAttribute("width", "160");
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(900);
      await canvas.screenshot({ path: `${OUT}/${c.name}-${i}.png` });
    }
    const nonEmpty = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext("2d"); if (!ctx) return 0;
      const { data } = ctx.getImageData(0, 0, el.width, el.height);
      let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++;
      return n;
    });
    expect(nonEmpty).toBeGreaterThan(50);
  });
}
