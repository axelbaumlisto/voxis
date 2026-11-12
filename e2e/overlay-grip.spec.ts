import { expect, test } from "@playwright/test";

/**
 * Overlay control handles: the move grip (top-left) and the resize grip
 * (bottom-right).
 *
 * Contract: both handles are HIDDEN at rest and revealed only while the pointer
 * is over the overlay zone (CSS body:hover); they hide again when the pointer
 * leaves.
 *
 * Runs in a 72×72 viewport (the orb overlay footprint) with a real WebGL orb.
 */
test.use({
  viewport: { width: 72, height: 72 },
  launchOptions: {
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  },
});

const MOVE = "[data-testid='overlay-drag-grip']";
const RESIZE = "[data-testid='overlay-resize-grip']";

function opacity(page: import("@playwright/test").Page, sel: string) {
  return page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement | null;
    return el ? Number(getComputedStyle(el).opacity) : -1;
  }, sel);
}

test.describe("overlay control handles", () => {
  test("hidden at rest, shown on hover, hidden again on leave", async ({ page }) => {
    await page.goto("/overlay.html?theme=orb_ion");
    await page.waitForSelector("[data-testid='theme-host']", { timeout: 5000 });
    await page.waitForSelector(MOVE, { state: "attached", timeout: 5000 });
    await page.waitForSelector(RESIZE, { state: "attached", timeout: 5000 });

    // Pointer parked off the overlay: both handles hidden.
    await page.mouse.move(300, 300);
    await expect.poll(() => opacity(page, MOVE), { timeout: 1000 }).toBeLessThan(0.1);
    await expect.poll(() => opacity(page, RESIZE), { timeout: 1000 }).toBeLessThan(0.1);

    // Pointer over the overlay: both revealed.
    await page.mouse.move(36, 36);
    await expect.poll(() => opacity(page, MOVE), { timeout: 1000 }).toBeGreaterThan(0.9);
    await expect.poll(() => opacity(page, RESIZE), { timeout: 1000 }).toBeGreaterThan(0.9);
    await page.screenshot({ path: test.info().outputPath("handles-hover.png") });

    // Pointer leaves: both hidden again.
    await page.mouse.move(300, 300);
    await expect.poll(() => opacity(page, MOVE), { timeout: 1000 }).toBeLessThan(0.1);
    await expect.poll(() => opacity(page, RESIZE), { timeout: 1000 }).toBeLessThan(0.1);
  });

  test("move grip top-left, resize grip bottom-right", async ({ page }) => {
    await page.goto("/overlay.html?theme=orb_ion");
    await page.waitForSelector(MOVE, { state: "attached", timeout: 5000 });
    await page.mouse.move(36, 36); // reveal
    const move = await page.locator(MOVE).boundingBox();
    const resize = await page.locator(RESIZE).boundingBox();
    if (move) {
      expect(move.x).toBeLessThanOrEqual(2);
      expect(move.y).toBeLessThanOrEqual(2);
    }
    if (resize) {
      expect(resize.x + resize.width).toBeGreaterThanOrEqual(70);
      expect(resize.y + resize.height).toBeGreaterThanOrEqual(70);
    }
  });
});
