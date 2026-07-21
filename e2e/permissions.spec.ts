import { test, expect } from "@playwright/test";

/**
 * Permission-related E2E tests.
 *
 * These tests verify that the app loads gracefully even when
 * microphone permission is not granted (no crash).
 */
test.describe("Permissions", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Tauri API - simulate microphone permission denied
    await page.addInitScript(() => {
      // Mock Tauri plugin-os for platform detection
      (window as unknown as Record<string, unknown>).__TAURI_OS_PLUGIN_INTERNALS__ = {
        platform: "macos",
        eol: "\n",
        version: "15.0.0",
      };

      const callbacks = new Map<number, (data: unknown) => void>();
      let callbackId = 0;

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string) => {
          switch (cmd) {
            case "get_config":
              return {
                api_key: "",
                model: "whisper-large-v3",
                language: "auto",
                hotkey: "ctrl_r",
                auto_type: false,
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
                overlay: {
                  enabled: true,
                  position: "bottom_right",
                  size: "medium",
                  margin: 30,
                  audio_boost: 800.0,
                },
                llm: {
                  enabled: false,
                  provider: "groq",
                  api_url: "",
                  api_key: "",
                  model: "llama-3.1-8b-instant",
                  prompt: "",
                },
                dictionary: {
                  path: "",
                  learning_mode: "disabled",
                  learning_threshold: 3,
                },
              };
            case "save_config":
              return undefined;
            case "get_history":
              return [];
            case "get_dictionary_entries":
              return [];
            case "list_audio_devices":
              // Simulate permission denied error - this tests graceful fallback
              throw new Error(
                "Microphone permission required. Please grant access in System Settings."
              );
            case "check_permissions":
              return [
                { name: "Input Monitoring", status: "granted", description: "Required for global hotkey detection" },
                { name: "Microphone", status: "denied", description: "Required for audio recording" },
              ];
            case "get_audio_level":
              return 0;
            case "request_microphone_permission":
              return undefined;
            case "request_accessibility_permission":
              return undefined;
            case "is_first_run":
              return false;
            default:
              console.log("Unhandled invoke:", cmd);
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

  test("home page loads without crash when mic permission denied", async ({
    page,
  }) => {
    await page.goto("/");
    // History IS the home page — `/` renders History directly (no redirect).
    await expect(page).toHaveURL("/");
    await expect(page.locator("h1")).toContainText("History");
    // Should not show any crash/error page
    await expect(page.locator("body")).not.toContainText("crashed");
  });

  test("settings page loads when microphone permission denied", async ({
    page,
  }) => {
    await page.goto("/settings");
    // Wait for page to potentially render
    await page.waitForTimeout(1000);
    // Should show settings page, not crash - check for h1 or body content
    const body = page.locator("body");
    await expect(body).not.toContainText("crashed");
    await expect(body).not.toContainText("error");
  });

  test("history page loads without crash", async ({ page }) => {
    await page.goto("/history");
    await expect(page.locator("h1")).toContainText("History");
  });

  test("dictionary page loads without crash", async ({ page }) => {
    await page.goto("/dictionary");
    // Wait for page to potentially render
    await page.waitForTimeout(1000);
    // Verify no crash by checking body exists
    const body = page.locator("body");
    await expect(body).not.toContainText("crashed");
  });

  test("navigation sidebar is accessible", async ({ page }) => {
    await page.goto("/");

    // Wait for page to load
    await page.waitForSelector(".status-bar");

    // Verify sidebar links exist
    await expect(page.locator('a[href="/settings"]')).toBeVisible();
    await expect(page.locator('a[href="/history"]')).toBeVisible();
    await expect(page.locator('a[href="/dictionary"]')).toBeVisible();
  });

  test("permission banner shows when microphone denied", async ({ page }) => {
    await page.goto("/");

    // Wait for permission banner to appear (use first() since banner may appear in both Layout and HomePage)
    const banner = page.locator(".permission-banner").first();
    await expect(banner).toBeVisible();

    // Check banner content
    await expect(banner).toContainText("Microphone");
    await expect(banner).toContainText("Required for audio recording");
    await expect(banner).toContainText("[Open Settings]");

    // Save screenshot for verification
    await page.screenshot({ path: "e2e/screenshots/permission-banner-microphone.png" });
  });

  test("clicking microphone banner calls open_permission_settings", async ({ page }) => {
    // Track calls to open_permission_settings
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__permissionSettingsCalls__ = [];
    });

    // Override invoke to track open_permission_settings calls
    await page.addInitScript(() => {
      const originalInvoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke = async (cmd: string, args?: unknown) => {
        if (cmd === "open_permission_settings") {
          (window as unknown as { __permissionSettingsCalls__: unknown[] }).__permissionSettingsCalls__.push(args);
          return undefined;
        }
        return originalInvoke(cmd, args);
      };
    });

    await page.goto("/");

    // Wait for banner and click the [Open Settings] button inside it
    const banner = page.locator(".permission-banner").first();
    await expect(banner).toBeVisible();
    await banner.locator(".permission-banner-action").first().click();

    // Verify open_permission_settings was called with "Microphone"
    const calls = await page.evaluate(() => (window as unknown as { __permissionSettingsCalls__: unknown[] }).__permissionSettingsCalls__);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ permission: "Microphone" });
  });
});

/**
 * Input Monitoring permission denied tests.
 */
test.describe("Input Monitoring Permission", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Tauri API - simulate accessibility permission denied
    await page.addInitScript(() => {
      // Mock Tauri plugin-os for platform detection
      (window as unknown as Record<string, unknown>).__TAURI_OS_PLUGIN_INTERNALS__ = {
        platform: "macos",
        eol: "\n",
        version: "15.0.0",
      };

      const callbacks = new Map<number, (data: unknown) => void>();
      let callbackId = 0;

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string) => {
          switch (cmd) {
            case "get_config":
              return {
                api_key: "",
                model: "whisper-large-v3",
                language: "auto",
                hotkey: "ctrl_r",
                auto_type: false,
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
                overlay: {
                  enabled: true,
                  position: "bottom_right",
                  size: "medium",
                  margin: 30,
                  audio_boost: 800.0,
                },
                llm: {
                  enabled: false,
                  provider: "groq",
                  api_url: "",
                  api_key: "",
                  model: "llama-3.1-8b-instant",
                  prompt: "",
                },
                dictionary: {
                  path: "",
                  learning_mode: "disabled",
                  learning_threshold: 3,
                },
              };
            case "save_config":
              return undefined;
            case "get_history":
              return [];
            case "get_dictionary_entries":
              return [];
            case "list_audio_devices":
              return [{ name: "Default Microphone", id: "default" }];
            case "check_permissions":
              return [
                { name: "Input Monitoring", status: "denied", description: "Required for global hotkey detection" },
                { name: "Microphone", status: "granted", description: "Required for audio recording" },
              ];
            case "get_audio_level":
              return 0;
            case "request_microphone_permission":
              return undefined;
            case "request_accessibility_permission":
              return undefined;
            case "is_first_run":
              return false;
            default:
              console.log("Unhandled invoke:", cmd);
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

  test("permission banner shows when input monitoring denied", async ({ page }) => {
    await page.goto("/");

    // Use first() since banner may appear in both Layout and HomePage
    const banner = page.locator(".permission-banner").first();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Input Monitoring");
    await expect(banner).toContainText("Required for global hotkey detection");
    await expect(banner).toContainText("[Open Settings]");

    // Save screenshot for verification
    await page.screenshot({ path: "e2e/screenshots/permission-banner-input-monitoring.png" });
  });

  test("clicking input monitoring banner calls open_permission_settings", async ({ page }) => {
    // Track calls to open_permission_settings
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__permissionSettingsCalls__ = [];
    });

    // Override invoke to track open_permission_settings calls
    await page.addInitScript(() => {
      const originalInvoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke = async (cmd: string, args?: unknown) => {
        if (cmd === "open_permission_settings") {
          (window as unknown as { __permissionSettingsCalls__: unknown[] }).__permissionSettingsCalls__.push(args);
          return undefined;
        }
        return originalInvoke(cmd, args);
      };
    });

    await page.goto("/");

    // Wait for banner and click the [Open Settings] button inside it
    const banner = page.locator(".permission-banner").first();
    await expect(banner).toBeVisible();
    await banner.locator(".permission-banner-action").first().click();

    // Verify open_permission_settings was called with "Input Monitoring"
    const calls = await page.evaluate(() => (window as unknown as { __permissionSettingsCalls__: unknown[] }).__permissionSettingsCalls__);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ permission: "Input Monitoring" });
  });
});
