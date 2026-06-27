import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("shows history page by default", async ({ page }) => {
    await page.goto("/");
    // History IS the home page — `/` renders History directly (no redirect).
    await expect(page).toHaveURL("/");
    await expect(page.locator("h1")).toContainText("History");
  });

  test("navigates to settings page", async ({ page }) => {
    await page.goto("/");

    // Click settings link in sidebar
    await page.click('a[href="/settings"]');

    await expect(page).toHaveURL("/settings");
    await expect(page.locator("h1")).toContainText("Settings");
  });

  test("navigates to history page", async ({ page }) => {
    await page.goto("/");

    await page.click('a[href="/history"]');

    await expect(page).toHaveURL("/history");
    await expect(page.locator("h1")).toContainText("History");
  });

  test("navigates to dictionary page", async ({ page }) => {
    await page.goto("/");

    await page.click('a[href="/dictionary"]');

    await expect(page).toHaveURL("/dictionary");
    await expect(page.locator("h1")).toContainText("Dictionary");
  });

  test("shows active page indicator in sidebar", async ({ page }) => {
    await page.goto("/settings");

    // The active link should have an active class or aria-current
    const settingsLink = page.locator('a[href="/settings"]');
    await expect(settingsLink).toHaveClass(/active/);
  });

  test("navigates back to history from settings", async ({ page }) => {
    await page.goto("/settings");

    // Click history link (History is also the home page in this app)
    await page.click('a[href="/history"]');

    await expect(page).toHaveURL("/history");
  });
});
