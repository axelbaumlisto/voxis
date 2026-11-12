import { expect, test } from "@playwright/test";

/**
 * Overlay control handles: the move grip (top-left) and the resize grip
 * (bottom-right).
 *
 * Contract: both handles are ALWAYS visible (subtle at rest, brighter on
 * hover). Hover-reveal was dropped because the overlay's borderless Dock
 * webview on X11/Wayland does not reliably deliver pointer enter/leave or
 * maintain :hover, so a reveal-on-hover handle would flake and vanish.
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
  test("both handles are always visible at rest", async ({ page }) => {
    await page.goto("/overlay.html?theme=orb_ion");
    await page.waitForSelector("[data-testid='theme-host']", { timeout: 5000 });
    await page.waitForSelector(MOVE, { state: "attached", timeout: 5000 });
    await page.waitForSelector(RESIZE, { state: "attached", timeout: 5000 });

    // Pointer parked far away: handles must still be visible (subtle).
    await page.mouse.move(300, 300);
    await expect.poll(() => opacity(page, MOVE), { timeout: 1000 }).toBeGreaterThan(0.3);
    await expect.poll(() => opacity(page, RESIZE), { timeout: 1000 }).toBeGreaterThan(0.3);
  });

  test("move grip sits top-left, resize grip bottom-right", async ({ page }) => {
    await page.goto("/overlay.html?theme=orb_ion");
    await page.waitForSelector(MOVE, { state: "attached", timeout: 5000 });
    await page.waitForSelector(RESIZE, { state: "attached", timeout: 5000 });

    const move = await page.locator(MOVE).boundingBox();
    const resize = await page.locator(RESIZE).boundingBox();
    expect(move).not.toBeNull();
    expect(resize).not.toBeNull();
    if (move) {
      expect(move.x).toBeLessThanOrEqual(2);
      expect(move.y).toBeLessThanOrEqual(2);
      expect(move.width).toBeLessThanOrEqual(16);
    }
    if (resize) {
      // bottom-right corner of a 72×72 overlay
      expect(resize.x + resize.width).toBeGreaterThanOrEqual(72 - 2);
      expect(resize.y + resize.height).toBeGreaterThanOrEqual(72 - 2);
      expect(resize.width).toBeLessThanOrEqual(16);
    }

    await page.screenshot({ path: test.info().outputPath("overlay-handles.png") });
  });
});
