import { test, expect } from "@playwright/test";

/**
 * Smoke test for overlay.html — webview entry for NSPanel backend.
 *
 * The overlay renders the Handy-style pill (172×36, .recording-overlay)
 * even without a Tauri runtime; this confirms Vite serves overlay.html and
 * React mounts.
 */
test.describe("Overlay webview entry", () => {
  test("overlay.html serves and mounts React", async ({ page }) => {
    const response = await page.goto("/overlay.html");
    expect(response?.ok()).toBe(true);

    // HandyPill root carries `.recording-overlay` (Handy parity); module-CSS
    // also tags it with a hashed class. Either selector should match.
    await page.waitForSelector(".recording-overlay", { timeout: 5000 });

    const pill = page.locator(".recording-overlay");
    await expect(pill).toBeVisible();

    // Default mode is idle (no fade-in class), bars hidden.
    await expect(pill).toHaveAttribute("data-mode", "idle");
  });

  test("overlay.html has transparent background", async ({ page }) => {
    await page.goto("/overlay.html");
    await page.waitForSelector(".recording-overlay");

    // Body background should be transparent (matches overlay.html inline style).
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    expect(bgColor).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
  });
});
