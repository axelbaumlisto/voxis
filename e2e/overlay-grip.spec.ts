import { expect, test } from "@playwright/test";

/**
 * Drag-grip behaviour on the overlay (the little handle that lets the user
 * drag the overlay window around).
 *
 * Contract:
 *  - hidden at rest (opacity 0),
 *  - appears on pointer ACTIVITY over the overlay,
 *  - hides again after an idle timeout (does NOT depend on pointerout/leave,
 *    which the real Dock webview doesn't reliably deliver),
 *  - sits in the very top-left corner, small, so it barely touches the orb.
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

const GRIP = "[data-testid='overlay-drag-grip']";

async function opacity(page: import("@playwright/test").Page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    return el ? Number(getComputedStyle(el).opacity) : -1;
  }, GRIP);
}

test.describe("overlay drag grip", () => {
  test("hidden at rest, shows on hover, hides when pointer leaves", async ({ page }) => {
    await page.goto("/overlay.html?theme=orb_ion");
    await page.waitForSelector("[data-testid='theme-host']", { timeout: 5000 });
    await page.waitForSelector(GRIP, { state: "attached", timeout: 5000 });

    // At rest (pointer not over the overlay) the grip is transparent.
    await page.mouse.move(300, 300);
    await expect.poll(() => opacity(page), { timeout: 1000 }).toBeLessThan(0.1);

    // Hovering the overlay reveals it (CSS body:hover).
    await page.mouse.move(36, 36);
    await expect.poll(() => opacity(page), { timeout: 1000 }).toBeGreaterThan(0.9);

    // Moving the pointer off the overlay hides it again — no blink, no stick.
    await page.mouse.move(300, 300);
    await expect.poll(() => opacity(page), { timeout: 1000 }).toBeLessThan(0.1);
  });

  test("sits in the top-left corner and is small", async ({ page }) => {
    await page.goto("/overlay.html?theme=orb_ion");
    await page.waitForSelector(GRIP, { state: "attached", timeout: 5000 });
    await page.mouse.move(10, 10); // reveal

    const box = await page.locator(GRIP).boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeLessThanOrEqual(2);
      expect(box.y).toBeLessThanOrEqual(2);
      expect(box.width).toBeLessThanOrEqual(16);
      expect(box.height).toBeLessThanOrEqual(16);
    }
  });
});
