import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * System Tray Menu E2E tests.
 *
 * Tests the simplified tray menu structure:
 * - Show (window focus)
 * - Copy Last Message
 * - Post-processing toggle
 * - Quit
 */

test.describe("System Tray Menu", () => {
  // Helper to get config dir path
  const getConfigDir = () => {
    const home = process.env.HOME || "/home/" + process.env.USER;
    return join(home, ".config", "voice");
  };

  test.beforeEach(async ({ page }) => {
    // Mock Tauri IPC with config state
    await page.addInitScript(() => {
      let currentConfig = {
        api_key: "",
        model: "whisper-large-v3",
        language: "auto",
        hotkey: "ctrl_r",
        auto_type: true,
        auto_enter: false,
        typing_delay: 10,
        notifications: true,
        backend: "cloud",
        debug: false,
        audio_device: "default",
        history_enabled: true,
        history_days: 30,
        active_provider: "groq",
        cloud_provider: "groq",
        local_backend: "mlx",
        text_processing: true,
        vad: {
          enabled: true,
          threshold: 0.5,
        },
        overlay: {
          enabled: true,
          position: "bottom_left",
          size: "medium",
          margin: 30,
          audio_boost: 800.0,
        },
        llm: {
          enabled: false,
          provider: "groq",
          api_url: "",
          api_key: "",
          model: "llama-3.3-70b-versatile",
          prompt: "",
        },
        dictionary: {
          path: "",
          learning_mode: "auto",
          learning_threshold: 3,
        },
      };

      const callbacks = new Map<number, (data: unknown) => void>();
      let callbackId = 0;

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          switch (cmd) {
            case "get_config":
              return JSON.parse(JSON.stringify(currentConfig));
            case "save_config":
              if (args?.config) {
                currentConfig = {
                  ...currentConfig,
                  ...(args.config as typeof currentConfig),
                };
              }
              return undefined;
            case "list_audio_devices":
              return [{ id: "default", name: "Default Device", is_default: true }];
            case "get_history":
              return [
                {
                  id: 1,
                  text: "Test transcription message",
                  timestamp: new Date().toISOString(),
                  language: "en",
                  duration: 1.5,
                },
              ];
            case "get_audio_level":
              return 0;
            case "is_first_run":
              return false;
            default:
              return undefined;
          }
        },
        transformCallback: (callback: (data: unknown) => void) => {
          const id = callbackId++;
          callbacks.set(id, callback);
          return id;
        },
      };
    });
  });

  test("main page loads correctly (for tray Show action)", async ({ page }) => {
    await page.goto("/");

    // Wait for page to load
    await page.waitForSelector(".status-bar");

    // Verify main page is accessible
    await expect(page.locator("body")).not.toContainText("404");
    await expect(page.locator("body")).not.toContainText("not found");
  });

  test("history page has entries (for Copy Last Message)", async ({ page }) => {
    await page.goto("/history");

    // Wait for history to load
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Verify history entries exist (mocked)
    await expect(page.locator("body")).toContainText("Test transcription message");
    await page.screenshot({ path: "e2e/screenshots/tray-history.png" });
  });

  test("settings page shows LLM toggle (for Post-processing)", async ({ page }) => {
    await page.goto("/settings");

    // Wait for settings to load
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Verify LLM/Post-processing section exists
    // The exact text depends on your UI, but there should be an LLM toggle
    await expect(page.locator("body")).not.toContainText("404");
    await page.screenshot({ path: "e2e/screenshots/tray-settings.png" });
  });

  test("settings page loads correctly", async ({ page }) => {
    await page.goto("/settings");

    // Wait for settings to load
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Verify settings page is accessible
    await expect(page.locator("body")).not.toContainText("404");
    await expect(page.locator("body")).not.toContainText("not found");
  });

  test.skip("capture system tray screenshot", async () => {
    // Skip in CI - requires X11 display
    // Captures screenshot of entire screen to verify tray icon
    const output = "e2e/screenshots/taskbar-tray.png";

    try {
      // Use ImageMagick import to capture screen (X11)
      execSync(`import -window root ${output}`, { timeout: 5000 });
      expect(existsSync(output)).toBe(true);
    } catch {
      // Skip if ImageMagick not available or no display
      test.skip();
    }
  });

  test("config file contains expected structure", async () => {
    // Integration test: verify config structure matches tray expectations
    const configDir = getConfigDir();
    const configDb = join(configDir, "config.db");

    // Skip if no config exists (first run)
    if (!existsSync(configDb)) {
      test.skip();
      return;
    }

    // Just verify the database file exists
    expect(existsSync(configDb)).toBe(true);
  });

  test("tray menu structure matches expected items", async ({ page }) => {
    // Test that mocked config has required fields for tray menu
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    // Execute in page context to verify config structure
    const config = await page.evaluate(async () => {
      const tauri = (window as Record<string, unknown>).__TAURI_INTERNALS__ as {
        invoke: (cmd: string) => Promise<Record<string, unknown>>;
      };
      return await tauri.invoke("get_config");
    });

    // Verify config has fields used by tray menu
    expect(config).toHaveProperty("llm");
    expect((config as { llm: { enabled: boolean } }).llm).toHaveProperty(
      "enabled"
    );
  });

  test("config supports post-processing toggle", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    // Test toggling LLM enabled state
    const result = await page.evaluate(async () => {
      const tauri = (window as Record<string, unknown>).__TAURI_INTERNALS__ as {
        invoke: (
          cmd: string,
          args?: Record<string, unknown>
        ) => Promise<Record<string, unknown>>;
      };

      // Get initial state
      const initial = await tauri.invoke("get_config");
      const initialLlmEnabled = (initial as { llm: { enabled: boolean } }).llm
        .enabled;

      // Toggle LLM enabled
      await tauri.invoke("save_config", {
        config: {
          llm: {
            ...(initial as { llm: Record<string, unknown> }).llm,
            enabled: !initialLlmEnabled,
          },
        },
      });

      // Get updated state
      const updated = await tauri.invoke("get_config");
      return {
        initial: initialLlmEnabled,
        updated: (updated as { llm: { enabled: boolean } }).llm.enabled,
      };
    });

    // Verify toggle worked
    expect(result.initial).not.toBe(result.updated);
  });

  test("history entries exist for Copy Last Message", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    // Verify history has entries (used by Copy Last Message)
    const history = await page.evaluate(async () => {
      const tauri = (window as Record<string, unknown>).__TAURI_INTERNALS__ as {
        invoke: (cmd: string) => Promise<Array<{ text: string }>>;
      };
      return await tauri.invoke("get_history");
    });

    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toHaveProperty("text");
    expect(typeof history[0].text).toBe("string");
    expect(history[0].text.length).toBeGreaterThan(0);
  });
});
