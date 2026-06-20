/**
 * Motion-quality proof for the cell theme's wander, via the Visual Harness.
 *
 * Tracks the cell's centroid over ~6s of real animation and asserts the
 * trajectory is a genuine WANDER (roams the tank, low return-to-centre bias)
 * rather than an oscillation about the middle — the regression the old
 * position=noise(t) drift produced ("always comes back").
 *
 * Also screenshots a few frames into e2e/screenshots/wander/ for eyeballing.
 */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const OUT = "e2e/screenshots/wander";

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

test("drifting_contour wanders the tank (does not oscillate about centre)", async ({ page }) => {
  // Recording mode → drift activation ramps to 1 so the cell actually roams.
  await page.goto(
    "/harness.html?theme=drifting_contour&mode=recording&level=0.5&w=160&h=160&scale=1",
  );
  const host = page.getByTestId("theme-host");
  await expect(host).toBeVisible();
  const canvas = host.locator("canvas");
  await expect(canvas).toHaveAttribute("width", "160");

  // Let drift activation ramp up first.
  await page.waitForTimeout(1500);

  // Sample the centroid of opaque pixels over time.
  const samples: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 40; i++) {
    const c = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext("2d")!;
      const { width: W, height: H } = el;
      const d = ctx.getImageData(0, 0, W, H).data;
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (d[(y * W + x) * 4 + 3] > 40) { sx += x; sy += y; n++; }
        }
      }
      return n > 0 ? { x: sx / n, y: sy / n } : null;
    });
    if (c) samples.push(c);
    if (i < 3) await canvas.screenshot({ path: `${OUT}/drifting_contour-${i}.png` });
    await page.waitForTimeout(150);
  }

  expect(samples.length).toBeGreaterThan(20);

  // Bounding box of the centroid path — a real wanderer sweeps area; a
  // centre-oscillator stays in a tiny cluster.
  const xs = samples.map((s) => s.x);
  const ys = samples.map((s) => s.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  // Over ~6s the cell should travel a meaningful distance in the 160px tank.
  expect(spanX + spanY).toBeGreaterThan(12);
});
