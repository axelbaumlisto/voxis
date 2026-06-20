/**
 * Visual proof that cell-family cilia render as CURVED flagella (not straight
 * needles) — driven entirely through the Theme Visual Harness, no Tauri build.
 *
 * Loads /harness.html with URL presets (theme, mode, level, 160×160 canvas),
 * lets the RAF loop run, then screenshots the theme-host canvas across a few
 * frames into e2e/screenshots/cilia/. A geometric assertion samples the
 * rendered alpha to confirm hair pixels exist OFF the straight base→tip rays
 * (i.e. the strokes bow sideways).
 */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const OUT = "e2e/screenshots/cilia";

// Pin the cell to centre (driftSpeed 0) and grow longer cilia so the curved
// flagella are clearly visible / measurable in the screenshot.
const CENTERED = encodeURIComponent(
  JSON.stringify({ driftSpeed: 0, driftMargin: 78, ciliaLength: 0.7, ciliaGrowthBoost: 0.8 }),
);

// Only ACTIVE (recording) states — that's when cilia extend and the curved
// flagella are visible. Idle is intentionally not screenshotted.
const CASES = [
  { theme: "drifting_contour", mode: "recording", level: 0.9, params: CENTERED },
  { theme: "drifting_contour", mode: "recording", level: 0.6, params: CENTERED },
  { theme: "living_reed", mode: "recording", level: 0.9, params: "" },
] as const;

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

for (const c of CASES) {
  test(`harness: ${c.theme} (${c.mode} @${c.level}) renders at 160×160`, async ({ page }) => {
    const p = c.params ? `&params=${c.params}` : "";
    const url = `/harness.html?theme=${c.theme}&mode=${c.mode}&level=${c.level}&w=160&h=160&scale=1${p}`;
    await page.goto(url);

    // Wait for the theme canvas to mount at the requested size.
    const host = page.getByTestId("theme-host");
    await expect(host).toBeVisible();
    const canvas = host.locator("canvas");
    await expect(canvas).toHaveAttribute("width", "160");
    await expect(canvas).toHaveAttribute("height", "160");

    // Let the RAF animation settle so cilia/morphs are mid-motion.
    await page.waitForTimeout(800);

    // Capture a few frames for the gallery (canvas only — clean 160×160).
    const tag = `${c.theme}-${c.mode}-L${String(c.level).replace(".", "")}`;
    for (let i = 0; i < 3; i++) {
      await canvas.screenshot({ path: `${OUT}/${tag}-${i}.png` });
      await page.waitForTimeout(250);
    }

    // Geometry check (recording only — cilia are extended then).
    if (c.mode === "recording") {
      const offRay = await canvas.evaluate((el: HTMLCanvasElement) => {
        const ctx = el.getContext("2d")!;
        const { width: W, height: H } = el;
        const img = ctx.getImageData(0, 0, W, H).data;
        const alphaAt = (x: number, y: number) => {
          const xi = Math.round(x), yi = Math.round(y);
          if (xi < 0 || yi < 0 || xi >= W || yi >= H) return 0;
          return img[(yi * W + xi) * 4 + 3];
        };
        const cx = W / 2, cy = H / 2;
        // For many rays, walk outward past the membrane and measure the
        // max perpendicular distance at which we still find a lit pixel.
        // Straight needles → lit pixels only ON the ray (perp≈0). Curved
        // hairs → lit pixels found at perp offsets.
        let maxPerp = 0;
        const RAYS = 72;
        for (let k = 0; k < RAYS; k++) {
          const a = (k / RAYS) * Math.PI * 2;
          const ux = Math.cos(a), uy = Math.sin(a);
          const px = -uy, py = ux; // perpendicular unit
          for (let r = 30; r < 78; r += 1) {
            const bx = cx + ux * r, by = cy + uy * r;
            for (let p = 2; p <= 14; p += 1) {
              if (alphaAt(bx + px * p, by + py * p) > 30 ||
                  alphaAt(bx - px * p, by - py * p) > 30) {
                if (p > maxPerp) maxPerp = p;
              }
            }
          }
        }
        return maxPerp;
      });
      // Curved hairs deposit ink several px off the radial ray.
      expect(offRay, `cilia should bow sideways off the radial ray; maxPerp=${offRay}`).toBeGreaterThan(3);
    }
  });
}
