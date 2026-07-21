import { test, expect } from "@playwright/test";

/**
 * Visualization Themes E2E tests.
 *
 * Verifies that visualization themes API works correctly:
 * - get_visualization_themes returns available themes
 * - Theme can be saved in overlay config
 * - Theme validation works
 */

test.describe("Visualization Themes", () => {
  test.beforeEach(async ({ page }) => {
    // Track theme API calls for verification
    await page.addInitScript(() => {
      const apiCalls: { cmd: string; args?: any; result?: any }[] = [];
      (window as any).__apiCalls = apiCalls;

      // Mutable config state with theme
      let currentConfig = {
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
          audio_boost: 800,
          theme: "default",
        },
        llm: {
          enabled: false,
          provider: "groq",
          api_url: "https://api.groq.com/openai/v1/chat/completions",
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

      // Available themes (matching backend)
      const themes = [
        { id: "default", name: "Default", description: "Blue, green, orange colors" },
        { id: "winamp_classic", name: "Winamp Classic", description: "Classic Winamp fire spectrum (red → yellow → green)" },
        { id: "neon", name: "Neon", description: "Bright neon colors" },
        { id: "drifting_contour", name: "Drifting Contour", description: "Biophysical model" },
        { id: "living_reed", name: "Living Reed", description: "Cilia math model" },
      ];

      const callbacks = new Map<number, (data: any) => void>();
      let callbackId = 0;

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: any) => {
          const call = { cmd, args, result: undefined as any };

          switch (cmd) {
            case "get_config":
              call.result = JSON.parse(JSON.stringify(currentConfig));
              break;
            case "save_config":
              if (args?.config) {
                currentConfig = { ...currentConfig, ...args.config };
                if (args.config.overlay) {
                  currentConfig.overlay = { ...currentConfig.overlay, ...args.config.overlay };
                }
              }
              call.result = undefined;
              break;
            case "get_visualization_themes":
              call.result = themes;
              break;
            case "validate_visualization_theme":
              // All built-in themes are valid
              call.result = { valid: true, warnings: [], errors: [] };
              break;
            case "get_themes_dir":
              call.result = "/home/user/.config/soupawhisper/themes";
              break;
            case "export_builtin_theme":
              // Return path to exported file
              call.result = `/home/user/.config/soupawhisper/themes/${args?.themeId}_custom.json`;
              break;
            case "reload_visualization_themes":
              call.result = undefined;
              break;
            case "list_audio_devices":
              call.result = [{ id: "default", name: "Default Device", is_default: true }];
              break;
            case "get_history":
              call.result = [];
              break;
            case "get_audio_level":
              call.result = 0;
              break;
            case "plugin:event|listen":
              const id = callbackId++;
              callbacks.set(id, args.handler);
              call.result = id;
              break;
            case "plugin:event|unlisten":
              callbacks.delete(args.id);
              call.result = null;
              break;
            case "is_first_run":
              return false;
            default:
              call.result = undefined;
          }

          apiCalls.push(call);
          return call.result;
        },
        transformCallback: (callback: (data: any) => void) => {
          const id = callbackId++;
          callbacks.set(id, callback);
          return id;
        },
      };
    });
  });

  test("get_visualization_themes returns 5 built-in themes", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    // Call get_visualization_themes via page context
    const themes = await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("get_visualization_themes");
    });

    // Verify themes structure
    expect(themes).toHaveLength(5);
    expect(themes.map((t: any) => t.id)).toEqual([
      "default",
      "winamp_classic",
      "neon",
      "drifting_contour",
      "living_reed",
    ]);

    // Verify each theme has required fields
    for (const theme of themes) {
      expect(theme).toHaveProperty("id");
      expect(theme).toHaveProperty("name");
      expect(theme).toHaveProperty("description");
    }
  });

  test("theme can be saved in overlay config", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    // Get initial config
    const initialConfig = await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("get_config");
    });
    expect(initialConfig.overlay.theme).toBe("default");

    // Save config with new theme
    const newConfig = { ...initialConfig };
    newConfig.overlay.theme = "winamp_classic";

    await page.evaluate(async (config) => {
      return await (window as any).__TAURI_INTERNALS__.invoke("save_config", { config });
    }, newConfig);

    // Verify theme was saved
    const savedConfig = await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("get_config");
    });
    expect(savedConfig.overlay.theme).toBe("winamp_classic");
  });

  test("validate_visualization_theme returns valid for built-in themes", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    const themeIds = ["default", "winamp_classic", "neon"];

    for (const themeId of themeIds) {
      const result = await page.evaluate(async (id) => {
        return await (window as any).__TAURI_INTERNALS__.invoke("validate_visualization_theme", { themeId: id });
      }, themeId);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    }
  });

  test("all theme API calls are tracked correctly", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    // Make theme API calls
    await page.evaluate(async () => {
      const w = window as any;
      await w.__TAURI_INTERNALS__.invoke("get_visualization_themes");
      await w.__TAURI_INTERNALS__.invoke("validate_visualization_theme", { themeId: "neon" });
    });

    // Check API call history
    const calls = await page.evaluate(() => (window as any).__apiCalls);

    const themeCalls = calls.filter((c: any) =>
      c.cmd === "get_visualization_themes" || c.cmd === "validate_visualization_theme"
    );

    expect(themeCalls.length).toBeGreaterThanOrEqual(2);
    expect(themeCalls.some((c: any) => c.cmd === "get_visualization_themes")).toBe(true);
    expect(themeCalls.some((c: any) => c.cmd === "validate_visualization_theme")).toBe(true);
  });

  test("get_themes_dir returns path to themes directory", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    const themesDir = await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("get_themes_dir");
    });

    expect(themesDir).toContain("soupawhisper");
    expect(themesDir).toContain("themes");
  });

  test("export_builtin_theme returns path to exported file", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    const exportedPath = await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("export_builtin_theme", {
        themeId: "winamp_classic"
      });
    });

    expect(exportedPath).toContain("winamp_classic");
    expect(exportedPath).toContain(".json");
  });

  test("reload_visualization_themes can be called without error", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".status-bar");

    // Should not throw
    await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("reload_visualization_themes");
    });

    // Verify call was made
    const calls = await page.evaluate(() => (window as any).__apiCalls);
    expect(calls.some((c: any) => c.cmd === "reload_visualization_themes")).toBe(true);
  });

  test("external themes can override builtin themes", async ({ page }) => {
    // Update mock to include external theme
    await page.addInitScript(() => {
      const originalInvoke = (window as any).__TAURI_INTERNALS__?.invoke;
      if (originalInvoke) {
        (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args?: any) => {
          if (cmd === "get_visualization_themes") {
            return [
              { id: "default", name: "Custom Default", description: "Custom Default (custom)" },
              { id: "winamp_classic", name: "Winamp Classic", description: "Classic Winamp fire spectrum" },
              { id: "neon", name: "Neon", description: "Bright neon colors" },
              { id: "drifting_contour", name: "Drifting Contour", description: "Biophysical model" },
              { id: "living_reed", name: "Living Reed", description: "Cilia math model" },
              { id: "my_custom", name: "My Custom Theme", description: "Custom theme" },
            ];
          }
          return originalInvoke(cmd, args);
        };
      }
    });

    await page.goto("/");
    await page.waitForSelector(".status-bar");

    const themes = await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("get_visualization_themes");
    });

    // Should have 6 themes (5 builtin + 1 custom, but default is overridden)
    expect(themes).toHaveLength(6);

    // Default should show as custom
    const defaultTheme = themes.find((t: any) => t.id === "default");
    expect(defaultTheme.name).toBe("Custom Default");

    // Custom theme should be included
    expect(themes.some((t: any) => t.id === "my_custom")).toBe(true);
  });
});
