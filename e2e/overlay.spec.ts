import { test, expect } from "@playwright/test";

/**
 * Overlay E2E tests with visual verification.
 *
 * Uses Tauri's mock API with event mocking enabled to test overlay state transitions.
 */

// Run overlay tests serially to avoid race conditions with shared dev server
test.describe.configure({ mode: "serial" });

// Overlay uses native egui window (not a webview), so /overlay.html doesn't exist.
// These tests are only meaningful when a webview overlay entry point is present.
test.describe.skip("Overlay Visual Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Tauri IPC with window-specific event support
    await page.addInitScript(() => {
      const callbacks = new Map<number, (data: any) => void>();
      const listeners = new Map<string, number[]>();

      function registerCallback(callback: (data: any) => void): number {
        const id =
          (window.crypto?.getRandomValues(new Uint32Array(1))[0] as number) ||
          Math.floor(Math.random() * 1000000);
        callbacks.set(id, callback);
        return id;
      }

      function runCallback(id: number, data: any) {
        const callback = callbacks.get(id);
        if (callback) {
          callback(data);
        }
      }

      function handleListen(args: { event: string; handler: number; target?: any }): number {
        // Support both global and window-specific events
        const key = args.target ? `${args.target.label}:${args.event}` : args.event;
        if (!listeners.has(key)) {
          listeners.set(key, []);
        }
        listeners.get(key)!.push(args.handler);
        // Also register for global key (for backwards compatibility)
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
        callbacks.delete(args.id);
      }

      // Store overlay state for pull-based access (simulates backend state)
      let overlayState = "idle";
      (window as any).__setOverlayState = (state: string) => {
        overlayState = state;
      };

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          if (cmd === "plugin:event|listen") {
            return handleListen(args);
          }
          if (cmd === "plugin:event|emit") {
            handleEmit(args);
            return null;
          }
          if (cmd === "plugin:event|unlisten") {
            handleUnlisten(args);
            return null;
          }
          // Mock window label for getCurrentWebviewWindow
          if (cmd === "plugin:webview|current_webview_window") {
            return { label: "overlay" };
          }
          // Mock get_overlay_state command (pull-based state)
          if (cmd === "get_overlay_state") {
            console.log("E2E: get_overlay_state called, returning:", overlayState);
            return overlayState;
          }
          return undefined;
        },
        transformCallback: registerCallback,
        runCallback: runCallback,
        callbacks: callbacks,
      };

      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (event: string, id: number) => {
          handleUnlisten({ event, id });
        },
      };

      // Helper to emit events for testing (calls the internal emit)
      (window as any).__emitTauriEvent = async (event: string, payload: any) => {
        return (window as any).__TAURI_INTERNALS__.invoke("plugin:event|emit", {
          event,
          payload,
        });
      };
    });

    await page.goto("/overlay.html");
    // Wait for React to mount
    await page.waitForSelector(".overlay");
  });

  test("idle state shows horizontal line", async ({ page }) => {
    // Default state is idle
    await expect(page.locator(".idle-line")).toBeVisible();
    await expect(page.locator(".waveform")).not.toBeVisible();

    // Screenshot
    await page.screenshot({ path: "e2e/screenshots/overlay-idle.png" });
  });

  test("recording state shows waveform bars", async ({ page }) => {
    // Wait for React and async listeners to set up
    await page.waitForTimeout(200);

    // Emit recording state
    await page.evaluate(() => {
      return (window as any).__emitTauriEvent("overlay-state", "recording");
    });

    await expect(page.locator(".waveform")).toBeVisible({ timeout: 2000 });
    await expect(page.locator(".idle-line")).not.toBeVisible();

    // Verify 32 bars
    const bars = page.locator(".bar");
    await expect(bars).toHaveCount(32);

    await page.screenshot({ path: "e2e/screenshots/overlay-recording.png" });
  });

  test("recording bars respond to audio levels", async ({ page }) => {
    // Wait for React and async listeners to set up
    await page.waitForTimeout(200);

    // Set recording state
    await page.evaluate(() => {
      return (window as any).__emitTauriEvent("overlay-state", "recording");
    });

    // Wait for waveform to appear
    await expect(page.locator(".waveform")).toBeVisible({ timeout: 2000 });

    // Send audio levels to simulate recording activity
    // Emit a high level and wait for React to process
    await page.evaluate(() => {
      return (window as any).__emitTauriEvent("audio-level", 0.9);
    });
    await page.waitForTimeout(100);

    // Verify bars exist
    const bars = page.locator(".bar");
    await expect(bars).toHaveCount(32);

    // Take screenshot for visual verification
    // The actual audio level animation is best verified visually
    await page.screenshot({
      path: "e2e/screenshots/overlay-recording-levels.png",
    });
  });

  test("transcribing state shows 5 pulsing bars", async ({ page }) => {
    // Wait for React and async listeners to set up
    await page.waitForTimeout(200);

    // Emit transcribing state
    await page.evaluate(() => {
      return (window as any).__emitTauriEvent("overlay-state", "transcribing");
    });

    await expect(page.locator(".transcribing-pulse")).toBeVisible({ timeout: 2000 });

    // Verify 5 pulse bars
    const pulseBars = page.locator(".pulse-bar");
    await expect(pulseBars).toHaveCount(5);

    await page.screenshot({ path: "e2e/screenshots/overlay-transcribing.png" });
  });
});

// Overlay uses native egui window, not webview - /overlay.html doesn't exist.
test.describe.skip("Overlay Integration", () => {
  test("overlay page exists", async ({ page }) => {
    // Navigate to overlay entry point
    const response = await page.goto("/overlay.html");
    expect(response?.ok()).toBe(true);
  });
});

// Overlay uses native egui window, not webview - /overlay.html doesn't exist.
test.describe.skip("Overlay Pull-based State", () => {
  test("pulls initial recording state after listeners ready", async ({ page }) => {
    // Set up mock with recording state BEFORE page loads
    // This simulates the race condition: backend set state before frontend ready
    await page.addInitScript(() => {
      const callbacks = new Map<number, (data: any) => void>();
      const listeners = new Map<string, number[]>();

      function registerCallback(callback: (data: any) => void): number {
        const id =
          (window.crypto?.getRandomValues(new Uint32Array(1))[0] as number) ||
          Math.floor(Math.random() * 1000000);
        callbacks.set(id, callback);
        return id;
      }

      function runCallback(id: number, data: any) {
        const callback = callbacks.get(id);
        if (callback) {
          callback(data);
        }
      }

      function handleListen(args: { event: string; handler: number; target?: any }): number {
        const key = args.target ? `${args.target.label}:${args.event}` : args.event;
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
        callbacks.delete(args.id);
      }

      // IMPORTANT: Set initial state to "recording" to simulate race condition
      // Backend emitted "recording" BEFORE frontend listeners were ready
      const initialState = "recording";

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          if (cmd === "plugin:event|listen") {
            return handleListen(args);
          }
          if (cmd === "plugin:event|emit") {
            handleEmit(args);
            return null;
          }
          if (cmd === "plugin:event|unlisten") {
            handleUnlisten(args);
            return null;
          }
          if (cmd === "plugin:webview|current_webview_window") {
            return { label: "overlay" };
          }
          // Mock get_overlay_state - returns recording (the missed state)
          if (cmd === "get_overlay_state") {
            console.log("E2E: get_overlay_state called, returning:", initialState);
            return initialState;
          }
          return undefined;
        },
        transformCallback: registerCallback,
        runCallback: runCallback,
        callbacks: callbacks,
      };

      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (event: string, id: number) => {
          handleUnlisten({ event, id });
        },
      };
    });

    await page.goto("/overlay.html");
    await page.waitForSelector(".overlay");

    // The overlay should show waveform (recording state) WITHOUT any event emission
    // This proves pull-based initialization works
    await expect(page.locator(".waveform")).toBeVisible({ timeout: 2000 });
    await expect(page.locator(".idle-line")).not.toBeVisible();

    // Verify 32 bars
    const bars = page.locator(".bar");
    await expect(bars).toHaveCount(32);

    await page.screenshot({ path: "e2e/screenshots/overlay-pull-recording.png" });
  });

  test("pulls initial transcribing state", async ({ page }) => {
    await page.addInitScript(() => {
      const callbacks = new Map<number, (data: any) => void>();
      const listeners = new Map<string, number[]>();

      function registerCallback(callback: (data: any) => void): number {
        const id = Math.floor(Math.random() * 1000000);
        callbacks.set(id, callback);
        return id;
      }

      function runCallback(id: number, data: any) {
        const callback = callbacks.get(id);
        if (callback) callback(data);
      }

      function handleListen(args: { event: string; handler: number; target?: any }): number {
        const key = args.target ? `${args.target.label}:${args.event}` : args.event;
        if (!listeners.has(key)) listeners.set(key, []);
        listeners.get(key)!.push(args.handler);
        if (args.target && !listeners.has(args.event)) listeners.set(args.event, []);
        if (args.target) listeners.get(args.event)!.push(args.handler);
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
          if (index !== -1) eventListeners.splice(index, 1);
        }
        callbacks.delete(args.id);
      }

      // Set initial state to "transcribing"
      const initialState = "transcribing";

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          if (cmd === "plugin:event|listen") return handleListen(args);
          if (cmd === "plugin:event|emit") { handleEmit(args); return null; }
          if (cmd === "plugin:event|unlisten") { handleUnlisten(args); return null; }
          if (cmd === "plugin:webview|current_webview_window") return { label: "overlay" };
          if (cmd === "get_overlay_state") {
            console.log("E2E: get_overlay_state returning:", initialState);
            return initialState;
          }
          return undefined;
        },
        transformCallback: registerCallback,
        runCallback: runCallback,
        callbacks: callbacks,
      };

      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
    });

    await page.goto("/overlay.html");
    await page.waitForSelector(".overlay");

    // Should show transcribing state from pull
    await expect(page.locator(".transcribing-pulse")).toBeVisible({ timeout: 2000 });
    await expect(page.locator(".pulse-bar")).toHaveCount(5);

    await page.screenshot({ path: "e2e/screenshots/overlay-pull-transcribing.png" });
  });
});
