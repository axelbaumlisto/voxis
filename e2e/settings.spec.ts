import { test, expect } from "@playwright/test";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Tauri API before navigating
    await page.addInitScript(() => {
      // Mock Tauri plugin-os for platform detection (simulate macOS)
      (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
        platform: "macos",
        eol: "\n",
        version: "15.0.0",
      };

      // Mock the Tauri invoke function
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: any) => {
          switch (cmd) {
            case "get_config":
              return {
                api_key: "test-api-key",
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
                paste_shortcuts: "ctrl_shift_v",
                vad: { enabled: false, threshold: 0.5 },
                overlay: {
                  enabled: true,
                  position: "bottom_right",
                  size: "medium",
                  margin: 30,
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
            case "list_audio_devices":
              return [{ id: "default", name: "Default Device", is_default: true }];
            case "get_llm_providers":
              return [];
            case "check_permissions":
              return [
                { name: "Microphone", status: "granted", description: "Required for audio recording" },
                { name: "Input Monitoring", status: "granted", description: "Required for global hotkey detection" },
              ];
            case "get_audio_level":
              return 0;
            case "get_visualization_themes":
              return [
                { id: "default", name: "Default", description: "Default" },
                { id: "winamp_classic", name: "Winamp Classic", description: "Fire spectrum" },
                { id: "neon", name: "Neon", description: "Neon" },
              ];
            case "get_theme_colors":
              return {
                use_gradient: true,
                gradient_bottom: "#299400",
                gradient_middle: "#d6b521",
                gradient_top: "#ef3110",
                recording: "#ef3110",
                transcribing: "#69f0ae",
                idle: "#299400",
              };
            case "plugin:event|listen":
              return Math.floor(Math.random() * 1000000);
            case "plugin:event|unlisten":
              return null;
            case "is_first_run":
              return false;
            default:
              console.log("Unhandled invoke:", cmd);
              return undefined;
          }
        },
        transformCallback: (callback: (data: unknown) => void) => {
          return Math.floor(Math.random() * 1000000);
        },
      };
    });

    await page.goto("/settings");
  });

  test("loads saved settings", async ({ page }) => {
    // Wait for loading to complete
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Check that sections are rendered (use section titles specifically)
    await expect(page.locator(".settings-section-title", { hasText: "Provider" })).toBeVisible();
    await expect(page.locator(".settings-section-title", { hasText: "Recording" })).toBeVisible();
    await expect(page.locator(".settings-section-title", { hasText: "Output" })).toBeVisible();
  });

  test("changes language selection", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Find the Language select
    const languageField = page.locator(".settings-field", {
      has: page.locator("text=Language"),
    });
    const select = languageField.locator("select");

    // Change to Russian
    await select.selectOption("ru");

    // Save button should be enabled
    const saveButton = page.locator('button:has-text("Save")');
    await expect(saveButton).toBeEnabled();
  });

  test("toggles boolean setting", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Find the Auto-type toggle switch and click it
    const autoTypeField = page.locator(".settings-field-switch", {
      has: page.locator("text=Auto-type"),
    });
    const switchLabel = autoTypeField.locator("label.switch");
    await switchLabel.click();

    // Save button should be enabled
    const saveButton = page.locator('button:has-text("Save")');
    await expect(saveButton).toBeEnabled();
  });

  test("save button is disabled when no changes", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    const saveButton = page.locator('button:has-text("Save")');
    await expect(saveButton).toBeDisabled();
  });

  test("renders all settings sections", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Check all section headings
    const sections = [
      "Provider",
      "Recording",
      "Output",
      "Overlay",
      "LLM",
      "Advanced",
    ];

    for (const section of sections) {
      await expect(
        page.locator(".settings-section-title", { hasText: section })
      ).toBeVisible();
    }
  });

  test("hotkey dropdown shows platform-specific options", async ({ page }) => {
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Find the Hotkey select
    const hotkeyField = page.locator(".settings-field", {
      has: page.locator("text=Hotkey"),
    });
    const select = hotkeyField.locator("select");

    // Get all options
    const options = await select.locator("option").allTextContents();

    // Should include function keys (common to all platforms)
    expect(options).toContain("F12");
    expect(options).toContain("F8");

    // Should include modifier keys (Ctrl, Alt, Command/Win)
    expect(options.some(opt => opt.includes("Ctrl") || opt.includes("⌃"))).toBe(true);
    expect(options.some(opt => opt.includes("Alt") || opt.includes("⌥"))).toBe(true);
    // Should include super keys (Command on macOS, Win on Windows/Linux)
    expect(options.some(opt =>
      opt.includes("⌘") || opt.includes("Cmd") || opt.includes("Win")
    )).toBe(true);
  });
});
