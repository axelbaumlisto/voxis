import { expect, test } from "@playwright/test";

/**
 * Overlay control handles: the move grip (top-left) and the resize grip
 * (bottom-right).
 *
 * Contract: both handles are HIDDEN at rest and revealed only while the OS
 * pointer is over the overlay zone. Reveal is driven by the Rust-side
 * CursorEntered/CursorLeft events, which toggle `body.pointer-inside` (the Dock
 * webview doesn't deliver DOM pointerleave / keep :hover in sync). In the
 * browser there is no Tauri event, so the test toggles that class directly to
 * verify the CSS wiring.
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
    await page.goto("/overlay.html?theme=orb_falls");
    await page.waitForSelector("[data-testid='theme-host']", { timeout: 5000 });
    await page.waitForSelector(MOVE, { state: "attached", timeout: 5000 });
    await page.waitForSelector(RESIZE, { state: "attached", timeout: 5000 });

    // At rest (pointer not inside): both handles hidden.
    await expect.poll(() => opacity(page, MOVE), { timeout: 1000 }).toBeLessThan(0.1);
    await expect.poll(() => opacity(page, RESIZE), { timeout: 1000 }).toBeLessThan(0.1);

    // Pointer enters the overlay zone → both revealed.
    await page.evaluate(() => document.body.classList.add("pointer-inside"));
    await expect.poll(() => opacity(page, MOVE), { timeout: 1000 }).toBeGreaterThan(0.9);
    await expect.poll(() => opacity(page, RESIZE), { timeout: 1000 }).toBeGreaterThan(0.9);
    await page.screenshot({ path: test.info().outputPath("handles-hover.png") });

    // Pointer leaves → both hidden again.
    await page.evaluate(() => document.body.classList.remove("pointer-inside"));
    await expect.poll(() => opacity(page, MOVE), { timeout: 1000 }).toBeLessThan(0.1);
    await expect.poll(() => opacity(page, RESIZE), { timeout: 1000 }).toBeLessThan(0.1);
  });

  test("move grip top-left, resize grip bottom-right", async ({ page }) => {
    await page.goto("/overlay.html?theme=orb_falls");
    await page.waitForSelector(MOVE, { state: "attached", timeout: 5000 });
    await page.evaluate(() => document.body.classList.add("pointer-inside")); // reveal
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
