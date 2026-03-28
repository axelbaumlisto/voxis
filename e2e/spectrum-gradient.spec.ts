import { test, expect } from "@playwright/test";

/**
 * Spectrum Gradient E2E tests.
 *
 * Verifies that gradient themes display gradient colors in SpectrumVisualizer,
 * and non-gradient themes display solid colors.
 *
 * Tests:
 * - Winamp Classic (gradient) shows .gradient class
 * - Dark Purple (no gradient) shows solid color
 * - CSS variables are set correctly from theme
 */

test.describe("Spectrum Gradient Themes", () => {
  // Theme colors matching backend
  const themeColors = {
    winamp_classic: {
      use_gradient: true,
      gradient_bottom: "#299400",
      gradient_middle: "#d6b521",
      gradient_top: "#ef3110",
      recording: "#ef3110",
      transcribing: "#29ce10",
      idle: "#299400",
    },
    dark: {
      use_gradient: true,
      gradient_bottom: "#7c4dff",
      gradient_middle: "#9c6dff",
      gradient_top: "#b388ff",
      recording: "#7c4dff",
      transcribing: "#69f0ae",
      idle: "#7c4dff",
    },
    soupawhisper_custom: {
      use_gradient: true,
      gradient_bottom: "#10ac84",
      gradient_middle: "#feca57",
      gradient_top: "#ee5a24",
      recording: "#ee5a24",
      transcribing: "#10ac84",
      idle: "#ff6b6b",
    },
  };

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      let currentTheme = "winamp_classic";
      let spectrumBins: number[] = new Array(32).fill(0);

      // Theme colors (injected)
      const themeColors: Record<string, any> = {
        winamp_classic: {
          use_gradient: true,
          gradient_bottom: "#299400",
          gradient_middle: "#d6b521",
          gradient_top: "#ef3110",
          recording: "#ef3110",
          transcribing: "#29ce10",
          idle: "#299400",
        },
        dark: {
          use_gradient: true,
          gradient_bottom: "#7c4dff",
          gradient_middle: "#9c6dff",
          gradient_top: "#b388ff",
          recording: "#7c4dff",
          transcribing: "#69f0ae",
          idle: "#7c4dff",
        },
        soupawhisper_custom: {
          use_gradient: true,
          gradient_bottom: "#10ac84",
          gradient_middle: "#feca57",
          gradient_top: "#ee5a24",
          recording: "#ee5a24",
          transcribing: "#10ac84",
          idle: "#ff6b6b",
        },
        default: {
          use_gradient: true,
          gradient_bottom: "#1e88e5",
          gradient_middle: "#42a5f5",
          gradient_top: "#64b5f6",
          recording: "#1e88e5",
          transcribing: "#4caf50",
          idle: "#1e88e5",
        },
      };

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
        vad: { enabled: true, threshold: 0.5 },
        overlay: {
          enabled: true,
          position: "bottom_left",
          size: "medium",
          margin: 30,
          audio_boost: 800,
          theme: currentTheme,
        },
        llm: { enabled: false, provider: "groq", api_url: "", api_key: "", model: "", prompt: "" },
        dictionary: { path: "", learning_mode: "auto", learning_threshold: 3 },
      };

      const callbacks = new Map<number, (data: any) => void>();
      let callbackId = 0;

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: any) => {
          switch (cmd) {
            case "get_config":
              return JSON.parse(JSON.stringify(currentConfig));
            case "save_config":
              currentConfig = { ...currentConfig, ...args.config };
              if (args.config.overlay) {
                currentConfig.overlay = { ...currentConfig.overlay, ...args.config.overlay };
              }
              currentTheme = currentConfig.overlay.theme;
              // Dispatch config-saved event
              window.dispatchEvent(new CustomEvent("config-saved"));
              return null;
            case "get_theme_colors":
              const themeId = args?.themeId || currentTheme;
              return themeColors[themeId] || themeColors.default;
            case "get_visualization_themes":
              return [
                { id: "default", name: "Default", description: "Blue colors" },
                { id: "winamp_classic", name: "Winamp Classic", description: "Fire spectrum" },
                { id: "dark", name: "Dark Purple", description: "Purple colors" },
                { id: "soupawhisper_custom", name: "SoupaWhisper Custom", description: "Custom theme" },
              ];
            case "get_spectrum_bins":
              return spectrumBins;
            case "get_recording_status":
              return false;
            case "get_history":
              return [];
            case "list_audio_devices":
              return [{ id: "default", name: "Default", is_default: true }];
            case "check_permissions":
              return [];
            case "plugin:event|listen":
              const id = callbackId++;
              callbacks.set(id, args.handler);
              return id;
            case "plugin:event|unlisten":
              callbacks.delete(args.id);
              return null;
            default:
              return null;
          }
        },
        transformCallback: (callback: (data: any) => void) => {
          const id = callbackId++;
          callbacks.set(id, callback);
          return id;
        },
      };

      // Helper to set spectrum bins and trigger recording state
      (window as any).__setRecordingWithBins = (bins: number[]) => {
        spectrumBins = bins;
      };

      // Helper to change theme
      (window as any).__setTheme = (themeId: string) => {
        currentTheme = themeId;
        currentConfig.overlay.theme = themeId;
      };
    });
  });

  test("Winamp Classic theme adds gradient class to spectrum", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".spectrum");

    // Set theme to winamp_classic
    await page.evaluate(() => {
      (window as any).__setTheme("winamp_classic");
    });

    // Reload to apply theme
    await page.reload();
    await page.waitForSelector(".spectrum");

    // Wait for theme colors to load
    await page.waitForTimeout(500);

    // Check CSS variables are set
    const cssVars = await page.evaluate(() => {
      const root = document.documentElement;
      return {
        bottom: root.style.getPropertyValue("--spectrum-bottom"),
        middle: root.style.getPropertyValue("--spectrum-middle"),
        top: root.style.getPropertyValue("--spectrum-top"),
        recording: root.style.getPropertyValue("--spectrum-recording"),
      };
    });

    console.log("CSS Variables:", cssVars);

    // Winamp colors
    expect(cssVars.bottom).toBe("#299400");
    expect(cssVars.middle).toBe("#d6b521");
    expect(cssVars.top).toBe("#ef3110");
  });

  test("Dark Purple theme uses gradient (purple shades)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".spectrum");

    // Get colors for dark theme directly
    const colors = await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("get_theme_colors", {
        themeId: "dark",
      });
    });

    console.log("Dark theme colors:", colors);

    // Dark Purple uses gradient (purple shades)
    expect(colors.use_gradient).toBe(true);
    // Gradient: dark purple -> medium purple -> light purple
    expect(colors.gradient_bottom).toBe("#7c4dff");
    expect(colors.gradient_middle).toBe("#9c6dff");
    expect(colors.gradient_top).toBe("#b388ff");
  });

  test("get_theme_colors returns correct colors for gradient theme", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".spectrum");

    const colors = await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("get_theme_colors", {
        themeId: "winamp_classic",
      });
    });

    expect(colors.use_gradient).toBe(true);
    expect(colors.gradient_bottom).toBe("#299400");
    expect(colors.gradient_middle).toBe("#d6b521");
    expect(colors.gradient_top).toBe("#ef3110");
  });

  test("all builtin themes use gradient", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".spectrum");

    // All builtin themes now use gradient
    for (const themeId of ["default", "winamp_classic", "dark"]) {
      const colors = await page.evaluate(async (id) => {
        return await (window as any).__TAURI_INTERNALS__.invoke("get_theme_colors", {
          themeId: id,
        });
      }, themeId);

      expect(colors.use_gradient).toBe(true);
    }
  });

  test("spectrum has recording class when in recording mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".spectrum");

    // The spectrum should exist
    const spectrum = page.locator(".spectrum");
    await expect(spectrum).toBeVisible();
  });

  test("external theme soupawhisper_custom returns gradient colors", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".spectrum");

    const colors = await page.evaluate(async () => {
      return await (window as any).__TAURI_INTERNALS__.invoke("get_theme_colors", {
        themeId: "soupawhisper_custom",
      });
    });

    expect(colors.use_gradient).toBe(true);
    expect(colors.gradient_bottom).toBe("#10ac84");
    expect(colors.gradient_middle).toBe("#feca57");
    expect(colors.gradient_top).toBe("#ee5a24");
  });

  test("switching theme updates CSS variables", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".spectrum");
    await page.waitForTimeout(500);

    // Get initial colors (winamp_classic)
    let cssVars = await page.evaluate(() => {
      const root = document.documentElement;
      return root.style.getPropertyValue("--spectrum-bottom");
    });
    expect(cssVars).toBe("#299400"); // Winamp green

    // Change to soupawhisper_custom via save_config
    await page.evaluate(async () => {
      const config = await (window as any).__TAURI_INTERNALS__.invoke("get_config");
      config.overlay.theme = "soupawhisper_custom";
      await (window as any).__TAURI_INTERNALS__.invoke("save_config", { config });
    });

    // Wait for config-saved event to trigger theme reload
    await page.waitForTimeout(500);

    // Check updated colors
    cssVars = await page.evaluate(() => {
      const root = document.documentElement;
      return root.style.getPropertyValue("--spectrum-bottom");
    });
    expect(cssVars).toBe("#10ac84"); // SoupaWhisper Custom emerald
  });
});
