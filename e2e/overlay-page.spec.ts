import { test, expect } from "@playwright/test";

/**
 * Smoke test for overlay.html — webview entry for NSPanel backend.
 *
 * This is a minimal regression test: the page must serve from Vite dev and
 * React must mount without crashing, even without Tauri runtime.
 */
test.describe("Overlay webview entry", () => {
  test("overlay.html serves and mounts React", async ({ page }) => {
    const response = await page.goto("/overlay.html");
    expect(response?.ok()).toBe(true);

    // React mounts into #root; the overlay div appears once OverlayApp renders.
    await page.waitForSelector(".overlay", { timeout: 5000 });

    const overlay = page.locator(".overlay");
    await expect(overlay).toBeVisible();

    // Defaults to idle mode.
    await expect(overlay).toHaveClass(/overlay-idle/);
  });

  test("overlay.html has transparent background", async ({ page }) => {
    await page.goto("/overlay.html");
    await page.waitForSelector(".overlay");

    // Body background should be transparent (matches the inline style).
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    expect(bgColor).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
  });
});
