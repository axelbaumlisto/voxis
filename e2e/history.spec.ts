import { test, expect } from "@playwright/test";

const mockHistoryEntries = [
  {
    id: 1,
    timestamp: "2024-01-15 10:30:00",
    text: "Hello, this is a test transcription.",
    language: "en",
    duration: 2.5,
  },
  {
    id: 2,
    timestamp: "2024-01-15 11:00:00",
    text: "Another transcription entry here.",
    language: "ru",
    duration: 3.1,
  },
  {
    id: 3,
    timestamp: "2024-01-15 11:30:00",
    text: "Third entry for testing search.",
    language: "de",
    duration: 1.8,
  },
];

test.describe("History Page", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Tauri API
    await page.addInitScript(
      ([entries]) => {
        (window as any).__TAURI_INTERNALS__ = {
          invoke: async (cmd: string) => {
            switch (cmd) {
              case "get_history":
                return entries;
              case "clear_history":
                entries.length = 0;
                return undefined;
              case "is_first_run":
                return false;
              default:
                return undefined;
            }
          },
        };
      },
      [mockHistoryEntries]
    );

    await page.goto("/history");
  });

  test("shows transcription entries", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Should show entries
    await expect(
      page.locator("text=Hello, this is a test transcription.")
    ).toBeVisible();
    await expect(
      page.locator("text=Another transcription entry here.")
    ).toBeVisible();
  });

  test("shows entry count", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Should show count in description
    await expect(page.locator("text=3 entries")).toBeVisible();
  });

  test("filters by search query", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Search for "test"
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill("test");

    // Should show matching entries
    await expect(
      page.locator("text=Hello, this is a test transcription.")
    ).toBeVisible();
    await expect(page.locator("text=Third entry for testing search.")).toBeVisible();
  });

  test("shows empty state when search has no results", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill("xyz123nonexistent");

    await expect(page.locator("text=No transcriptions yet.")).toBeVisible();
  });

  test("has copy button for each entry", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Each entry should have a copy button
    const copyButtons = page.locator('button:has-text("Copy")');
    await expect(copyButtons).toHaveCount(3);
  });

  test("has clear and refresh buttons", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    await expect(page.locator('button:has-text("Refresh")')).toBeVisible();
    await expect(page.locator('button:has-text("Clear")')).toBeVisible();
  });
});

test.describe("History Page - Empty State", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Tauri API with empty history
    await page.addInitScript(() => {
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string) => {
          switch (cmd) {
            case "get_history":
              return [];
            case "is_first_run":
              return false;
            default:
              return undefined;
          }
        },
      };
    });

    await page.goto("/history");
  });

  test("shows empty state when no history", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    await expect(page.locator("text=No transcriptions yet.")).toBeVisible();
    await expect(
      page.locator("text=Start recording to see your transcriptions here.")
    ).toBeVisible();
  });

  test("clear button is disabled when empty", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    const clearButton = page.locator('button:has-text("Clear")');
    await expect(clearButton).toBeDisabled();
  });
});
