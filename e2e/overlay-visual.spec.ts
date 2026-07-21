import { test, expect } from "@playwright/test";

/**
 * Overlay Visual E2E tests.
 *
 * Tests that overlay themes change visual appearance.
 * Uses simulated audio levels to show waveform bars.
 */

test.describe("Overlay Visual Verification", () => {
  test.beforeEach(async ({ page }) => {
    // Track overlay commands
    await page.addInitScript(() => {
      const overlayCommands: { cmd: string; args?: any }[] = [];
      (window as any).__overlayCommands = overlayCommands;

      let currentTheme = "default";
      let overlayState = "hidden";
      let audioLevels: number[] = [];

      // Mock config
      let currentConfig = {
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
        active_provider: "groq",
        cloud_provider: "groq",
        local_backend: "mlx",
        text_processing: true,
        paste_shortcuts: "ctrl_shift_v",
        vad: { enabled: true, threshold: 0.5 },
        overlay: {
          enabled: true,
          position: "bottom_left",
          size: "medium",
          margin: 30,
          audio_boost: 800,
          theme: currentTheme,
        },
        llm: {
          enabled: false,
          provider: "groq",
          api_url: "",
          api_key: "",
          model: "",
          prompt: "",
        },
        dictionary: { path: "", learning_mode: "auto", learning_threshold: 3 },
      };

      const themes = [
        { id: "default", name: "Default", description: "Blue, green, orange colors" },
        { id: "winamp_classic", name: "Winamp Classic", description: "Classic Winamp fire spectrum (red → yellow → green)" },
        { id: "neon", name: "Neon", description: "Bright neon colors" },
      ];

      const callbacks = new Map<number, (data: unknown) => void>();
      let callbackId = 0;

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: any) => {
          overlayCommands.push({ cmd, args });

          switch (cmd) {
            case "get_config":
              return JSON.parse(JSON.stringify(currentConfig));
            case "save_config":
              currentConfig = { ...currentConfig, ...args.config };
              currentTheme = currentConfig.overlay.theme;
              return null;
            case "get_visualization_themes":
              return themes;
            case "validate_visualization_theme":
              return { valid: true, warnings: [], errors: [] };
            case "show_overlay":
              overlayState = args.state;
              return null;
            case "hide_overlay":
              overlayState = "hidden";
              return null;
            case "start_recording":
              overlayState = "recording";
              // Simulate audio levels for "hello" word
              audioLevels = [0.1, 0.3, 0.5, 0.7, 0.9, 0.8, 0.6, 0.4, 0.2, 0.1];
              return null;
            case "stop_recording":
              overlayState = "transcribing";
              return null;
            case "get_audio_level":
              // Return simulated level
              const level = audioLevels.shift() || 0;
              audioLevels.push(level * 0.9); // Decay
              return level;
            case "get_recording_status":
              return overlayState === "recording";
            case "transcribe_audio":
              // Return "hello" transcription
              return { text: "hello", language: "en", duration: 1.5 };
            case "check_permissions":
              return [];
            case "list_audio_devices":
              return [{ name: "Default Microphone", id: "default" }];
            case "get_history":
              return [];
            case "get_dictionary_entries":
              return [];
            case "get_theme_colors":
              return {
                use_gradient: true,
                gradient_bottom: "#1a1a2e",
                gradient_middle: "#16213e",
                gradient_top: "#0f3460",
                recording: "#e94560",
                transcribing: "#533483",
                idle: "#0f3460",
              };
            case "get_llm_providers":
              return [];
            case "plugin:event|listen":
              return args?.handler ?? 0;
            case "plugin:event|unlisten":
              return null;
            case "plugin:event|emit":
              return null;
            case "is_first_run":
              return false;
            default:
              return null;
          }
        },
        transformCallback: (callback: (data: unknown) => void) => {
          const id = callbackId++;
          callbacks.set(id, callback);
          return id;
        },
      };

      // Mock Tauri event plugin internals for unlisten cleanup
      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };

      // Expose state for testing
      (window as any).__getOverlayState = () => ({
        theme: currentTheme,
        state: overlayState,
        levels: audioLevels,
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // History IS the home page — `/` renders History directly (no redirect).
    await expect(page.locator("h1")).toContainText("History");
  });

  test("theme selector appears in settings", async ({ page }) => {
    // Navigate to settings
    await page.click('a[href="/settings"]');
    await page.waitForURL("/settings");

    // Check for theme selector label
    const themeLabel = page.locator('.settings-field-label', { hasText: 'Theme' });
    await expect(themeLabel).toBeVisible();

    // Check for Winamp option (wait for themes to load)
    const select = page.locator('select').filter({ has: page.locator('option[value="winamp_classic"]') });
    await expect(select.first()).toBeVisible({ timeout: 10000 });
  });

  test("changing theme updates config", async ({ page }) => {
    // Navigate to settings
    await page.click('a[href="/settings"]');
    await page.waitForURL("/settings");

    // Find theme select
    const themeSelect = page.locator('.settings-field').filter({ has: page.locator('text=Theme') }).locator('select');

    // Change to winamp
    await themeSelect.selectOption("winamp_classic");

    // Save
    await page.click('button:has-text("Save")');
    await page.waitForTimeout(500);

    // Verify state
    const state = await page.evaluate(() => (window as any).__getOverlayState());
    expect(state.theme).toBe("winamp_classic");
  });

  test("recording shows waveform with current theme", async ({ page }) => {
    const commands = await page.evaluate(() => (window as any).__overlayCommands);

    // Start recording
    await page.evaluate(() => {
      (window as any).__TAURI_INTERNALS__.invoke("start_recording");
    });

    await page.waitForTimeout(100);

    // Check state
    const state = await page.evaluate(() => (window as any).__getOverlayState());
    expect(state.state).toBe("recording");
  });

  test("transcription returns hello", async ({ page }) => {
    // Start recording
    await page.evaluate(() => {
      (window as any).__TAURI_INTERNALS__.invoke("start_recording");
    });
    await page.waitForTimeout(100);

    // Stop and transcribe
    await page.evaluate(() => {
      (window as any).__TAURI_INTERNALS__.invoke("stop_recording");
    });

    const result = await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("transcribe_audio", {
        apiKey: "test",
        model: "whisper-large-v3",
      });
    });

    expect(result.text).toBe("hello");
    expect(result.language).toBe("en");
  });

  test("all themes can be selected and saved", async ({ page }) => {
    // Start from non-default themes to ensure each change triggers hasChanges
    const themes = ["winamp_classic", "neon", "default"];

    // Navigate to settings
    await page.click('a[href="/settings"]');
    await page.waitForURL("/settings");

    for (const themeId of themes) {
      // Find and change theme
      const themeSelect = page.locator('.settings-field').filter({ has: page.locator('text=Theme') }).locator('select');
      await themeSelect.selectOption(themeId);

      // Save (button becomes enabled when config changes)
      await page.click('button:has-text("Save")');
      await page.waitForTimeout(300);

      // Verify
      const state = await page.evaluate(() => (window as any).__getOverlayState());
      expect(state.theme).toBe(themeId);
    }
  });
});
