import { test, expect } from "@playwright/test";

const mockDictionaryEntries = [
  { id: 1, source: "солид", replacement: "SOLID" },
  { id: 2, source: "кисс", replacement: "KISS" },
  { id: 3, source: "драй", replacement: "DRY" },
];

test.describe("Dictionary Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([entries]) => {
        let currentEntries = [...entries];
        let nextId = 4;

        // Mock Tauri plugin-os for platform detection
        (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
          platform: "macos",
          eol: "\n",
          version: "15.0.0",
        };

        // Track callbacks for event listeners
        let callbackId = 0;
        const callbacks: Record<number, Function> = {};

        (window as any).__TAURI_INTERNALS__ = {
          transformCallback: (callback: Function) => {
            const id = callbackId++;
            callbacks[id] = callback;
            return id;
          },
          invoke: async (cmd: string, args?: any) => {
            switch (cmd) {
              case "get_dictionary":
                return currentEntries;
              case "add_dictionary_entry":
                currentEntries.push({
                  id: nextId++,
                  source: args.source,
                  replacement: args.replacement,
                });
                return undefined;
              case "delete_dictionary_entry":
                currentEntries = currentEntries.filter(
                  (e: any) => e.id !== args.id
                );
                return undefined;
              case "update_dictionary_entry":
                const entry = currentEntries.find((e: any) => e.id === args.id);
                if (entry) {
                  entry.source = args.source;
                  entry.replacement = args.replacement;
                }
                return undefined;
              // Permission commands - return empty/granted for tests
              case "check_permissions":
                return [];
              case "request_microphone_permission":
              case "request_accessibility_permission":
                return true;
              // Config command
              case "get_config":
                return {
                  api_key: "test-key",
                  model: "whisper-large-v3",
                  language: "auto",
                  hotkey: "ctrl_r",
                  auto_type: true,
                  auto_enter: false,
                  typing_delay: 12,
                  notifications: true,
                  backend: "auto",
                  debug: false,
                  audio_device: "default",
                  history_enabled: true,
                  history_days: 30,
                  active_provider: "cloud",
                  cloud_provider: "groq",
                  local_backend: "faster-whisper",
                  text_processing: true,
                  vad: { enabled: false, threshold: 0.5 },
                  overlay: { enabled: true, position: "bottom_right", size: "medium", margin: 30 },
                  llm: { enabled: false, provider: "groq", api_url: "", api_key: "", model: "", prompt: "" },
                  dictionary: { path: "", learning_mode: "disabled", learning_threshold: 3 },
                };
              // Pending suggestions - used by DictionaryPage
              case "get_pending_suggestions":
                return [];
              case "get_pending_count":
                return 0;
              case "is_first_run":
                return false;
              default:
                return undefined;
            }
          },
        };
      },
      [mockDictionaryEntries]
    );

    await page.goto("/dictionary");
  });

  test("shows existing entries", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    await expect(page.locator("text=солид")).toBeVisible();
    await expect(page.locator("text=SOLID")).toBeVisible();
    await expect(page.locator("text=кисс")).toBeVisible();
    await expect(page.locator("text=KISS")).toBeVisible();
  });

  test("shows entry count", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    await expect(page.locator("text=3 entries")).toBeVisible();
  });

  test("shows add entry form", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    await expect(page.locator("text=Add New Entry")).toBeVisible();
    await expect(page.locator('input[placeholder*="Source"]')).toBeVisible();
    await expect(page.locator('input[placeholder*="Replacement"]')).toBeVisible();
  });

  test("adds new entry", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Fill in the form
    await page.locator('input[placeholder*="Source"]').fill("тдд");
    await page.locator('input[placeholder*="Replacement"]').fill("TDD");

    // Click add button
    await page.click('button:has-text("Add")');

    // Wait for the new entry to appear
    await expect(page.locator("text=тдд")).toBeVisible();
    await expect(page.locator("text=TDD")).toBeVisible();

    // Entry count should update
    await expect(page.locator("text=4 entries")).toBeVisible();
  });

  test("edits entry", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Click edit on first entry
    const firstEntry = page.locator(".dictionary-entry").first();
    await firstEntry.locator('button:has-text("Edit")').click();

    // Should show input fields
    const sourceInput = firstEntry.locator('input[placeholder*="Source"]');
    await expect(sourceInput).toBeVisible();

    // Modify the source
    await sourceInput.fill("солидный");

    // Save
    await firstEntry.locator('button:has-text("Save")').click();

    // Should show updated value
    await expect(page.locator("text=солидный")).toBeVisible();
  });

  test("deletes entry", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Get initial count
    await expect(page.locator("text=3 entries")).toBeVisible();

    // Accept the confirm dialog
    page.on("dialog", (dialog) => dialog.accept());

    // Click delete on first entry
    const firstEntry = page.locator(".dictionary-entry").first();
    await firstEntry.locator('button:has-text("Delete")').click();

    // Entry count should decrease
    await expect(page.locator("text=2 entries")).toBeVisible();
  });

  test("cancels edit mode", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Click edit on first entry
    const firstEntry = page.locator(".dictionary-entry").first();
    await firstEntry.locator('button:has-text("Edit")').click();

    // Modify the source
    const sourceInput = firstEntry.locator('input[placeholder*="Source"]');
    await sourceInput.fill("changed");

    // Cancel
    await firstEntry.locator('button:has-text("Cancel")').click();

    // Should show original value
    await expect(page.locator("text=солид")).toBeVisible();
    await expect(page.locator("text=changed")).toBeHidden();
  });

  test("add button disabled with empty fields", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Add button should be disabled initially
    const addButton = page.locator('.add-entry-form button:has-text("Add")');
    await expect(addButton).toBeDisabled();

    // Fill only source
    await page.locator('input[placeholder*="Source"]').fill("test");
    await expect(addButton).toBeDisabled();

    // Fill replacement too
    await page.locator('input[placeholder*="Replacement"]').fill("TEST");
    await expect(addButton).toBeEnabled();
  });
});

test.describe("Dictionary Page - Empty State", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Mock Tauri plugin-os for platform detection
      (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
        platform: "macos",
        eol: "\n",
        version: "15.0.0",
      };

      // Track callbacks for event listeners
      let callbackId = 0;
      const callbacks: Record<number, Function> = {};

      (window as any).__TAURI_INTERNALS__ = {
        transformCallback: (callback: Function) => {
          const id = callbackId++;
          callbacks[id] = callback;
          return id;
        },
        invoke: async (cmd: string) => {
          switch (cmd) {
            case "get_dictionary":
              return [];
            case "check_permissions":
              return [];
            case "request_microphone_permission":
            case "request_accessibility_permission":
              return true;
            case "get_config":
              return {
                api_key: "",
                model: "whisper-large-v3",
                language: "auto",
                hotkey: "ctrl_r",
                auto_type: true,
                auto_enter: false,
                typing_delay: 12,
                notifications: true,
                backend: "auto",
                debug: false,
                audio_device: "default",
                history_enabled: true,
                history_days: 30,
                active_provider: "cloud",
                cloud_provider: "groq",
                local_backend: "faster-whisper",
                text_processing: true,
                vad: { enabled: false, threshold: 0.5 },
                overlay: { enabled: true, position: "bottom_right", size: "medium", margin: 30 },
                llm: { enabled: false, provider: "groq", api_url: "", api_key: "", model: "", prompt: "" },
                dictionary: { path: "", learning_mode: "disabled", learning_threshold: 3 },
              };
            case "get_pending_suggestions":
              return [];
            case "get_pending_count":
              return 0;
            case "is_first_run":
              return false;
            default:
              return undefined;
          }
        },
      };
    });

    await page.goto("/dictionary");
  });

  test("shows empty state when no entries", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    await expect(page.locator("text=No dictionary entries yet.")).toBeVisible();
    await expect(
      page.locator(
        "text=Add word replacements to automatically correct transcriptions."
      )
    ).toBeVisible();
  });
});
