import { test, expect } from "@playwright/test";

/**
 * Settings Save E2E tests.
 *
 * Verifies that the status bar updates immediately after saving settings,
 * without requiring navigation to another page.
 */

test.describe("Settings Save", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Tauri IPC with mutable config state
    await page.addInitScript(() => {
      // Mock Tauri plugin-os for platform detection
      (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
        platform: "macos",
        eol: "\n",
        version: "15.0.0",
      };

      // Mutable config state
      let currentConfig = {
        api_key: "",
        model: "whisper-1",
        language: "auto",
        hotkey: "alt_r",
        auto_type: true,
        auto_enter: false,
        typing_delay: 10,
        notifications: true,
        backend: "cloud",
        debug: false,
        audio_device: "default",
        history_enabled: true,
        history_days: 30,
        active_provider: "cloud",
        cloud_provider: "openai",
        local_backend: "whisper_cpp",
        text_processing: true,
        paste_shortcuts: "ctrl_shift_v",
        vad: {
          enabled: false,
          threshold: 0.5,
        },
        overlay: {
          enabled: true,
          position: "bottom_right",
          size: "medium",
          margin: 20,
          audio_boost: 1.0,
        },
        llm: {
          enabled: false,
          provider: "openai",
          api_url: "",
          api_key: "",
          model: "gpt-4o-mini",
          prompt: "",
        },
        dictionary: {
          path: "",
          learning_mode: "disabled",
          learning_threshold: 3,
        },
      };

      // Track event listeners
      const callbacks = new Map<number, (data: any) => void>();
      let callbackId = 0;

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: any) => {
          switch (cmd) {
            case "get_config":
              // Return a copy to avoid reference issues
              return JSON.parse(JSON.stringify(currentConfig));
            case "save_config":
              // Update the config state
              if (args?.config) {
                currentConfig = { ...currentConfig, ...args.config };
              }
              return undefined;
            case "list_audio_devices":
              return [{ id: "default", name: "Default Device", is_default: true }];
            case "get_history":
              return [];
            case "get_audio_level":
              return 0;
            case "plugin:event|listen":
              // Mock event listener registration
              const id = callbackId++;
              callbacks.set(id, args.handler);
              return id;
            case "plugin:event|unlisten":
              callbacks.delete(args.id);
              return null;
            // Permission commands
            case "check_permissions":
              return [];
            case "request_microphone_permission":
            case "request_accessibility_permission":
              return true;
            case "get_llm_providers":
              return [];
            case "get_visualization_themes":
              return [
                { id: "default", name: "Default", description: "Default" },
                { id: "winamp_classic", name: "Winamp Classic", description: "Fire" },
              ];
            case "get_theme_colors":
              return { use_gradient: true, gradient_bottom: "#299400", gradient_middle: "#d6b521", gradient_top: "#ef3110", recording: "#ef3110", transcribing: "#69f0ae", idle: "#299400" };
            default:
              return undefined;
          }
        },
        transformCallback: (callback: (data: any) => void) => {
          const id = callbackId++;
          callbacks.set(id, callback);
          return id;
        },
      };
    });
  });

  test("header updates hotkey after saving settings", async ({ page }) => {
    await page.goto("/");

    // Wait for initial load
    await page.waitForSelector(".status-bar");

    // Check initial hotkey in status bar
    await expect(page.locator(".status-bar")).toContainText("Alt (Right)");

    // Go to settings
    await page.click('a[href="/settings"]');
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Find the hotkey field and change it to ctrl_r
    const hotkeyField = page.locator(".settings-field", {
      has: page.locator("text=Hotkey"),
    });
    await hotkeyField.locator("select").selectOption("ctrl_r");

    // Save
    await page.click('button:has-text("Save")');

    // Status bar should update immediately (without navigation)
    await expect(page.locator(".status-bar")).toContainText("Ctrl (Right)", {
      timeout: 2000,
    });
  });

  test("header updates hotkey when changing to F-key", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    // Initial check
    await expect(page.locator(".status-bar")).toContainText("Alt (Right)");

    // Navigate to settings
    await page.click('a[href="/settings"]');
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Change hotkey to F12
    const hotkeyField = page.locator(".settings-field", {
      has: page.locator("text=Hotkey"),
    });
    await hotkeyField.locator("select").selectOption("f12");

    // Save
    await page.click('button:has-text("Save")');

    // Status bar should show F12
    await expect(page.locator(".status-bar")).toContainText("F12", {
      timeout: 2000,
    });
  });
});
