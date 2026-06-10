import { test, expect } from "@playwright/test";

/**
 * Smoke test for overlay.html — webview entry for NSPanel backend.
 *
 * Phase 5 switched the overlay from HandyPill/ClassicBars to ThemeHost.
 * The overlay now renders a thin React host that loads theme modules at
 * runtime; all visual logic lives in theme code, not the shell.
 */
test.describe("Overlay webview entry", () => {
  test("overlay.html serves and mounts React (ThemeHost)", async ({ page }) => {
    const response = await page.goto("/overlay.html");
    expect(response?.ok()).toBe(true);

    // ThemeHost renders a div with data-testid='theme-host'.
    await page.waitForSelector("[data-testid='theme-host']", { timeout: 5000 });
    const host = page.locator("[data-testid='theme-host']");
    await expect(host).toBeVisible();
  });

  test("overlay.html has transparent background", async ({ page }) => {
    await page.goto("/overlay.html");
    await page.waitForSelector("[data-testid='theme-host']");

    // Body background should be transparent (matches overlay.html inline style).
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    expect(bgColor).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
  });
});
