import { test, expect } from "@playwright/test";

/**
 * Visual E2E validation for Dark Purple theme gradient.
 *
 * This test validates that the purple gradient is visually rendered
 * in the SpectrumVisualizer during recording state.
 *
 * Validates:
 * - CSS variables are set correctly (purple gradient colors)
 * - .gradient class is present on spectrum element
 * - Computed background-image contains linear-gradient with purple colors
 * - Screenshot for visual confirmation
 */

test.describe("Winamp Classic Theme Visual Gradient", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const callbacks = new Map<number, (data: any) => void>();
      const listeners = new Map<string, number[]>();
      let callbackId = 0;

      // Spectrum bins - all at max height to clearly show gradient
      // Full height bars will display gradient from dark purple (bottom) to light purple (top)
      let spectrumBins: number[] = Array(32).fill(1.0);

      // Theme colors
      const themeColors: Record<string, any> = {
        winamp_classic: {
          use_gradient: true,
          gradient_bottom: "#299400", // Green
          gradient_middle: "#d6b521", // Yellow
          gradient_top: "#ef3110", // Red
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

      // Config with dark theme
      const currentConfig = {
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
          theme: "winamp_classic", // Winamp Classic - visible gradient
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

      // Initial state is recording
      let currentState = "recording";

      function registerCallback(callback: (data: any) => void): number {
        const id = callbackId++;
        callbacks.set(id, callback);
        return id;
      }

      function runCallback(id: number, data: any) {
        const callback = callbacks.get(id);
        if (callback) {
          callback(data);
        }
      }

      function handleListen(args: {
        event: string;
        handler: number;
        target?: any;
      }): number {
        const key = args.target
          ? `${args.target.label}:${args.event}`
          : args.event;
        if (!listeners.has(key)) {
          listeners.set(key, []);
        }
        listeners.get(key)!.push(args.handler);
        // Also register for global key
        if (args.target && !listeners.has(args.event)) {
          listeners.set(args.event, []);
        }
        if (args.target) {
          listeners.get(args.event)!.push(args.handler);
        }
        return args.handler;
      }

      function handleEmit(args: { event: string; payload: any }) {
        const eventListeners = listeners.get(args.event) || [];
        for (const handlerId of eventListeners) {
          runCallback(handlerId, { event: args.event, payload: args.payload });
        }
      }

      function handleUnlisten(args: { event: string; id: number }) {
        const eventListeners = listeners.get(args.event);
        if (eventListeners) {
          const index = eventListeners.indexOf(args.id);
          if (index !== -1) {
            eventListeners.splice(index, 1);
          }
        }
      }

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: any) => {
          switch (cmd) {
            case "plugin:event|listen":
              return handleListen(args);
            case "plugin:event|emit":
              handleEmit(args);
              return null;
            case "plugin:event|unlisten":
              handleUnlisten(args);
              return null;
            case "get_config":
              return JSON.parse(JSON.stringify(currentConfig));
            case "save_config":
              return null;
            case "get_theme_colors":
              const themeId = args?.themeId || currentConfig.overlay.theme;
              return themeColors[themeId] || themeColors.default;
            case "get_visualization_themes":
              return [
                { id: "default", name: "Default", description: "Blue colors" },
                {
                  id: "dark",
                  name: "Dark Purple",
                  description: "Purple colors",
                },
              ];
            case "get_spectrum_bins":
              return spectrumBins;
            case "get_recording_status":
              return currentState === "recording";
            case "get_overlay_state":
              return currentState;
            case "get_audio_level":
              return 0.5;
            case "get_history":
              return [];
            case "list_audio_devices":
              return [{ id: "default", name: "Default", is_default: true }];
            case "check_permissions":
              return [];
            default:
              return null;
          }
        },
        transformCallback: (callback: (data: any) => void) => {
          return registerCallback(callback);
        },
      };

      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (event: string, id: number) => {
          handleUnlisten({ event, id });
        },
      };

      // Helper to emit events
      (window as any).__emitTauriEvent = async (
        event: string,
        payload: any
      ) => {
        return (window as any).__TAURI_INTERNALS__.invoke("plugin:event|emit", {
          event,
          payload,
        });
      };

      // Helper to set spectrum bins
      (window as any).__setSpectrumBins = (bins: number[]) => {
        spectrumBins = bins;
      };
    });
  });

  test("spectrum shows fire gradient during recording", async ({ page }) => {
    // Navigate and wait for spectrum
    await page.goto("/");
    await page.waitForSelector(".spectrum");

    // Wait for React and theme colors to load
    await page.waitForTimeout(300);

    // Emit recording state to trigger recording mode
    await page.evaluate(() => {
      (window as any).__emitTauriEvent("state-changed", "recording");
    });

    // Wait for state update
    await page.waitForTimeout(200);

    // 1. Check CSS variables are set (purple gradient)
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

    // Winamp Classic: Green → Yellow → Red
    expect(cssVars.bottom).toBe("#299400"); // Green
    expect(cssVars.middle).toBe("#d6b521"); // Yellow
    expect(cssVars.top).toBe("#ef3110"); // Red
    expect(cssVars.recording).toBe("#ef3110"); // Recording color

    // 2. Check that .gradient class is present
    const spectrum = page.locator(".spectrum.recording.gradient");
    await expect(spectrum).toBeVisible();

    // 3. Check computed style on bar contains gradient
    const barStyle = await page.evaluate(() => {
      const bar = document.querySelector(
        ".spectrum.recording.gradient .spectrum-bar"
      );
      if (!bar) return null;
      return window.getComputedStyle(bar).backgroundImage;
    });

    console.log("Bar background-image:", barStyle);

    expect(barStyle).not.toBeNull();
    expect(barStyle).toContain("linear-gradient");
    // Check for green color (rgb(41, 148, 0) = #299400)
    expect(barStyle).toContain("rgb(41, 148, 0)");

    // 4. Take screenshot for visual confirmation
    await page.screenshot({
      path: "e2e/screenshots/winamp-fire-gradient.png",
      fullPage: false,
    });
  });

  test("all bars at max height show full gradient", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".spectrum");
    await page.waitForTimeout(300);

    // Emit recording state
    await page.evaluate(() => {
      (window as any).__emitTauriEvent("state-changed", "recording");
    });
    await page.waitForTimeout(200);

    // Wait for spectrum to be in recording mode with gradient
    const spectrum = page.locator(".spectrum.recording.gradient");
    await expect(spectrum).toBeVisible();

    // Check that bars are at max height (all bins = 1.0)
    const barHeights = await page.evaluate(() => {
      const bars = document.querySelectorAll(
        ".spectrum.recording.gradient .spectrum-bar"
      );
      return Array.from(bars)
        .slice(0, 8)
        .map((bar) => {
          const height = window.getComputedStyle(bar).height;
          return parseFloat(height);
        });
    });

    console.log("Bar heights:", barHeights);

    // All bars should be at max height (close to 48px = spectrum height - padding)
    for (const height of barHeights) {
      expect(height).toBeGreaterThan(40); // At least 40px (close to max)
    }
  });

  test("switching to transcribing state changes display", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".spectrum");
    await page.waitForTimeout(300);

    // Start in recording mode
    await page.evaluate(() => {
      (window as any).__emitTauriEvent("state-changed", "recording");
    });
    await page.waitForTimeout(200);

    // Verify recording mode
    const recordingSpectrum = page.locator(".spectrum.recording");
    await expect(recordingSpectrum).toBeVisible();

    // Switch to transcribing
    await page.evaluate(() => {
      (window as any).__emitTauriEvent("state-changed", "transcribing");
    });
    await page.waitForTimeout(200);

    // Verify transcribing mode (no gradient class, uses solid color)
    const transcribingSpectrum = page.locator(".spectrum.transcribing");
    await expect(transcribingSpectrum).toBeVisible();

    // Transcribing doesn't use gradient class
    const hasGradientClass = await page.evaluate(() => {
      const spectrum = document.querySelector(".spectrum");
      return spectrum?.classList.contains("gradient");
    });
    expect(hasGradientClass).toBe(false);
  });
});

test.describe("Dark Purple Theme Visual Gradient", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const callbacks = new Map<number, (data: any) => void>();
      const listeners = new Map<string, number[]>();
      let callbackId = 0;

      // Spectrum bins - all at max height to clearly show gradient
      let spectrumBins: number[] = Array(32).fill(1.0);

      // Theme colors
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

      // Config with dark (purple) theme
      const currentConfig = {
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
          theme: "dark", // Dark Purple theme
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

      let currentState = "recording";

      function registerCallback(callback: (data: any) => void): number {
        const id = callbackId++;
        callbacks.set(id, callback);
        return id;
      }

      function runCallback(id: number, data: any) {
        const callback = callbacks.get(id);
        if (callback) {
          callback(data);
        }
      }

      function handleListen(args: {
        event: string;
        handler: number;
        target?: any;
      }): number {
        const key = args.target
          ? `${args.target.label}:${args.event}`
          : args.event;
        if (!listeners.has(key)) {
          listeners.set(key, []);
        }
        listeners.get(key)!.push(args.handler);
        if (args.target && !listeners.has(args.event)) {
          listeners.set(args.event, []);
        }
        if (args.target) {
          listeners.get(args.event)!.push(args.handler);
        }
        return args.handler;
      }

      function handleEmit(args: { event: string; payload: any }) {
        const eventListeners = listeners.get(args.event) || [];
        for (const handlerId of eventListeners) {
          runCallback(handlerId, { event: args.event, payload: args.payload });
        }
      }

      function handleUnlisten(args: { event: string; id: number }) {
        const eventListeners = listeners.get(args.event);
        if (eventListeners) {
          const index = eventListeners.indexOf(args.id);
          if (index !== -1) {
            eventListeners.splice(index, 1);
          }
        }
      }

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: any) => {
          switch (cmd) {
            case "plugin:event|listen":
              return handleListen(args);
            case "plugin:event|emit":
              handleEmit(args);
              return null;
            case "plugin:event|unlisten":
              handleUnlisten(args);
              return null;
            case "get_config":
              return JSON.parse(JSON.stringify(currentConfig));
            case "save_config":
              return null;
            case "get_theme_colors":
              const themeId = args?.themeId || currentConfig.overlay.theme;
              return themeColors[themeId] || themeColors.default;
            case "get_visualization_themes":
              return [
                { id: "default", name: "Default", description: "Blue colors" },
                {
                  id: "dark",
                  name: "Dark Purple",
                  description: "Purple colors",
                },
              ];
            case "get_spectrum_bins":
              return spectrumBins;
            case "get_recording_status":
              return currentState === "recording";
            case "get_overlay_state":
              return currentState;
            case "get_audio_level":
              return 0.5;
            case "get_history":
              return [];
            case "list_audio_devices":
              return [{ id: "default", name: "Default", is_default: true }];
            case "check_permissions":
              return [];
            default:
              return null;
          }
        },
        transformCallback: (callback: (data: any) => void) => {
          return registerCallback(callback);
        },
      };

      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (event: string, id: number) => {
          handleUnlisten({ event, id });
        },
      };

      (window as any).__emitTauriEvent = async (
        event: string,
        payload: any
      ) => {
        return (window as any).__TAURI_INTERNALS__.invoke("plugin:event|emit", {
          event,
          payload,
        });
      };

      (window as any).__setSpectrumBins = (bins: number[]) => {
        spectrumBins = bins;
      };
    });
  });

  test("spectrum shows purple gradient during recording", async ({ page }) => {
    // Navigate and wait for spectrum
    await page.goto("/");
    await page.waitForSelector(".spectrum");

    // Wait for React and theme colors to load
    await page.waitForTimeout(300);

    // Emit recording state to trigger recording mode
    await page.evaluate(() => {
      (window as any).__emitTauriEvent("state-changed", "recording");
    });

    // Wait for state update
    await page.waitForTimeout(200);

    // 1. Check CSS variables are set (purple gradient)
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

    // Dark Purple: purple gradient colors
    expect(cssVars.bottom).toBe("#7c4dff"); // Dark purple
    expect(cssVars.middle).toBe("#9c6dff"); // Medium purple
    expect(cssVars.top).toBe("#b388ff"); // Light purple
    expect(cssVars.recording).toBe("#7c4dff"); // Recording color

    // 2. Check that .gradient class is present
    const spectrum = page.locator(".spectrum.recording.gradient");
    await expect(spectrum).toBeVisible();

    // 3. Check computed style on bar contains gradient
    const barStyle = await page.evaluate(() => {
      const bar = document.querySelector(
        ".spectrum.recording.gradient .spectrum-bar"
      );
      if (!bar) return null;
      return window.getComputedStyle(bar).backgroundImage;
    });

    console.log("Bar background-image:", barStyle);

    expect(barStyle).not.toBeNull();
    expect(barStyle).toContain("linear-gradient");
    // Check for purple color (rgb(124, 77, 255) = #7c4dff)
    expect(barStyle).toContain("rgb(124, 77, 255)");

    // 4. Take screenshot for visual confirmation
    await page.screenshot({
      path: "e2e/screenshots/dark-purple-gradient.png",
      fullPage: false,
    });
  });

  test("all bars at max height show full purple gradient", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".spectrum");
    await page.waitForTimeout(300);

    // Emit recording state
    await page.evaluate(() => {
      (window as any).__emitTauriEvent("state-changed", "recording");
    });
    await page.waitForTimeout(200);

    // Wait for spectrum to be in recording mode with gradient
    const spectrum = page.locator(".spectrum.recording.gradient");
    await expect(spectrum).toBeVisible();

    // Check that bars are at max height (all bins = 1.0)
    const barHeights = await page.evaluate(() => {
      const bars = document.querySelectorAll(
        ".spectrum.recording.gradient .spectrum-bar"
      );
      return Array.from(bars)
        .slice(0, 8)
        .map((bar) => {
          const height = window.getComputedStyle(bar).height;
          return parseFloat(height);
        });
    });

    console.log("Bar heights:", barHeights);

    // All bars should be at max height (close to 48px = spectrum height - padding)
    for (const height of barHeights) {
      expect(height).toBeGreaterThan(40); // At least 40px (close to max)
    }
  });
});
