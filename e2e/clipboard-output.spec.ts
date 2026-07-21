import { test, expect } from "@playwright/test";

/**
 * E2E tests for clipboard backup/restore output mode.
 *
 * Tests Tauri event → UI state flow:
 * - state-changed events update .status-bar class and text
 * - error events show error in status bar
 * - auto_type setting saved correctly via settings page
 *
 * UI structure (from Layout.tsx):
 *   .status-bar.{idle|recording|transcribing|error}  — shows state
 *   .header-error                                     — error in header
 *   .status-bar with text "! <error>"                 — error state
 */

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    api_key: "test-key",
    model: "whisper-large-v3",
    language: "auto",
    hotkey: "alt_r",
    auto_type: false,
    auto_enter: false,
    typing_delay: 12,
    notifications: true,
    backend: "cloud",
    debug: false,
    audio_device: "default",
    history_enabled: true,
    history_days: 30,
    active_provider: "cloud",
    cloud_provider: "groq",
    local_backend: "faster-whisper",
    text_processing: false,
    paste_shortcuts: "ctrl_shift_v",
    vad: { enabled: false, threshold: 0.5 },
    overlay: {
      enabled: false,
      position: "bottom_right",
      size: "medium",
      margin: 30,
      audio_boost: 1.0,
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
    ...overrides,
  };
}

/**
 * Setup Tauri mocks with proper transformCallback/event delivery.
 *
 * Tauri v2 event system:
 *   1. listen(eventName, handler) calls transformCallback(handler) → stores at window._${id}
 *   2. Calls invoke('plugin:event|listen', {event, handler: id})
 *   3. When event fires, Tauri calls window._${id}({event, payload})
 * We replicate step 3 in emitEvent() so useTauriEvent hooks work in tests.
 */
function setupMocks(page: any, config: Record<string, unknown>) {
  return page.addInitScript(
    ([cfg]: [Record<string, unknown>]) => {
      (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
        platform: "linux",
        eol: "\n",
        version: "6.0.0",
      };

      let currentConfig = JSON.parse(JSON.stringify(cfg));
      const invokeCalls: { cmd: string; args: any }[] = [];

      // eventName → list of callback IDs registered via transformCallback
      const eventHandlers = new Map<string, number[]>();
      let callbackId = 0;

      (window as any).__TAURI_INTERNALS__ = {
        // Stores callback at window._${id} — same as real Tauri v2
        transformCallback: (callback: Function, once: boolean = false) => {
          const id = callbackId++;
          const prop = `_${id}`;
          Object.defineProperty(window, prop, {
            value: (result: any) => {
              if (once) Reflect.deleteProperty(window, prop);
              return callback(result);
            },
            writable: false,
            configurable: true,
          });
          return id;
        },

        invoke: async (cmd: string, args?: any) => {
          invokeCalls.push({ cmd, args: args ?? {} });

          switch (cmd) {
            case "get_config":
              return JSON.parse(JSON.stringify(currentConfig));

            case "save_config":
              if (args?.config) {
                currentConfig = { ...currentConfig, ...args.config };
              }
              return undefined;

            case "list_audio_devices":
              return [
                { id: "default", name: "Default Device", is_default: true },
              ];

            case "get_llm_providers":
              return [];

            case "check_permissions":
              return [];

            case "request_microphone_permission":
            case "request_accessibility_permission":
              return true;

            case "get_audio_level":
              return 0;

            case "get_history":
              return [];

            case "get_failed_transcriptions":
              return [];

            case "get_dictionary":
              return [];

            case "get_pending_suggestions":
              return [];

            case "plugin:event|listen": {
              const name: string = args?.event ?? "";
              const handlerId: number = args?.handler ?? -1;
              if (!eventHandlers.has(name)) eventHandlers.set(name, []);
              eventHandlers.get(name)!.push(handlerId);
              return callbackId++;
            }

            case "plugin:event|unlisten":
              return null;

            case "get_visualization_themes":
              return [{ id: "default", name: "Default", description: "Default" }];
            case "get_theme_colors":
              return { use_gradient: true, gradient_bottom: "#299400", gradient_middle: "#d6b521", gradient_top: "#ef3110", recording: "#ef3110", transcribing: "#69f0ae", idle: "#299400" };

            case "is_first_run":

              return false;

            default:
              return undefined;
          }
        },
      };

      (window as any).__testHelpers = {
        getInvokeCalls: () => invokeCalls,
        getConfig: () => JSON.parse(JSON.stringify(currentConfig)),

        // Deliver event to all registered listeners via window._${handlerId}
        emitEvent: (event: string, payload: any) => {
          const handlers = eventHandlers.get(event) ?? [];
          for (const handlerId of handlers) {
            const fn = (window as any)[`_${handlerId}`];
            if (typeof fn === "function") {
              fn({ event, payload });
            }
          }
        },
      };
    },
    [config],
  );
}

// ---------------------------------------------------------------------------
// Status bar state transitions
// ---------------------------------------------------------------------------

test.describe("Status bar state via Tauri events", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page, makeConfig());
    await page.goto("/history");
    // Wait for layout to render
    await expect(page.locator(".status-bar")).toBeVisible({ timeout: 5000 });
  });

  test("idle: status-bar has idle class and ready text", async ({ page }) => {
    await expect(page.locator(".status-bar")).toHaveClass(/idle/i, {
      timeout: 3000,
    });
    await expect(page.locator(".status-bar")).toContainText(/ready/i);
  });

  test("state-changed=Recording: status-bar gets recording class", async ({
    page,
  }) => {
    await page.evaluate(() =>
      (window as any).__testHelpers.emitEvent("state-changed", "recording"),
    );
    await expect(page.locator(".status-bar")).toHaveClass(/recording/i, {
      timeout: 3000,
    });
    await expect(page.locator(".status-bar")).toContainText(/recording/i);
  });

  test("state-changed=Transcribing: status-bar gets transcribing class", async ({
    page,
  }) => {
    await page.evaluate(() =>
      (window as any).__testHelpers.emitEvent("state-changed", "transcribing"),
    );
    await expect(page.locator(".status-bar")).toHaveClass(/transcribing/i, {
      timeout: 3000,
    });
    await expect(page.locator(".status-bar")).toContainText(/transcribing/i);
  });

  test("state-changed=Idle after recording: returns to idle", async ({
    page,
  }) => {
    await page.evaluate(() =>
      (window as any).__testHelpers.emitEvent("state-changed", "recording"),
    );
    await expect(page.locator(".status-bar")).toHaveClass(/recording/i, {
      timeout: 3000,
    });

    await page.evaluate(() =>
      (window as any).__testHelpers.emitEvent("state-changed", "idle"),
    );
    await expect(page.locator(".status-bar")).toHaveClass(/idle/i, {
      timeout: 3000,
    });
  });

  test("full cycle: idle→recording→transcribing→idle", async ({ page }) => {
    const bar = page.locator(".status-bar");

    await page.evaluate(() =>
      (window as any).__testHelpers.emitEvent("state-changed", "recording"),
    );
    await expect(bar).toHaveClass(/recording/i, { timeout: 3000 });

    await page.evaluate(() =>
      (window as any).__testHelpers.emitEvent("state-changed", "transcribing"),
    );
    await expect(bar).toHaveClass(/transcribing/i, { timeout: 3000 });

    await page.evaluate(() =>
      (window as any).__testHelpers.emitEvent("state-changed", "idle"),
    );
    await expect(bar).toHaveClass(/idle/i, { timeout: 3000 });
    await expect(bar).toContainText(/ready/i);
  });

  test("error event: status-bar shows error class and message", async ({
    page,
  }) => {
    await page.evaluate(() =>
      (window as any).__testHelpers.emitEvent(
        "error",
        "Audio too large: exceeds 25MB limit",
      ),
    );
    await expect(page.locator(".status-bar")).toHaveClass(/error/i, {
      timeout: 3000,
    });
    await expect(page.locator(".status-bar")).toContainText(
      "Audio too large",
    );
  });

  test("transcription event clears error state", async ({ page }) => {
    // Trigger an error first
    await page.evaluate(() =>
      (window as any).__testHelpers.emitEvent("error", "Something went wrong"),
    );
    await expect(page.locator(".status-bar")).toHaveClass(/error/i, {
      timeout: 3000,
    });

    // Successful transcription clears error
    await page.evaluate(() =>
      (window as any).__testHelpers.emitEvent("transcription", "Hello world"),
    );
    await expect(page.locator(".status-bar")).not.toHaveClass(/error/i, {
      timeout: 3000,
    });
  });
});

// ---------------------------------------------------------------------------
// Output mode config (auto_type)
// ---------------------------------------------------------------------------

test.describe("Output mode config (auto_type)", () => {
  test("get_config called on page load", async ({ page }) => {
    await setupMocks(page, makeConfig({ auto_type: false }));
    await page.goto("/history");
    await expect(page.locator(".status-bar")).toBeVisible({ timeout: 5000 });

    const calls: { cmd: string }[] = await page.evaluate(
      () => (window as any).__testHelpers.getInvokeCalls(),
    );
    expect(calls.some((c) => c.cmd === "get_config")).toBe(true);
  });

  test("settings page: Output section is visible", async ({ page }) => {
    await setupMocks(page, makeConfig({ auto_type: false }));
    await page.goto("/settings");
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    await expect(
      page
        .locator(".settings-section-title")
        .filter({ hasText: /output/i })
        .first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("save_config called with auto_type=false preserved after toggle of other setting", async ({
    page,
  }) => {
    await setupMocks(
      page,
      makeConfig({ auto_type: false, notifications: true }),
    );
    await page.goto("/settings");
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    // Click the label.switch for Notifications to change it (enables Save button)
    // SwitchField renders: <label class="switch"><input type="checkbox"/><span class="switch-slider"/></label>
    const notifLabel = page
      .locator(".settings-field")
      .filter({ hasText: /notification/i })
      .locator("label.switch")
      .first();
    await notifLabel.click();

    // Save button is now enabled
    const saveBtn = page.locator("button.primary").filter({ hasText: /save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 3000 });
    await saveBtn.click();

    // Verify save_config was called and auto_type stayed false
    const calls: { cmd: string; args: any }[] = await page.evaluate(
      () => (window as any).__testHelpers.getInvokeCalls(),
    );
    const saveCall = calls.find((c) => c.cmd === "save_config");
    expect(saveCall).toBeDefined();
    expect(saveCall?.args?.config?.auto_type).toBe(false);
  });

  test("save_config called with auto_type=true when configured", async ({
    page,
  }) => {
    await setupMocks(
      page,
      makeConfig({ auto_type: true, notifications: true }),
    );
    await page.goto("/settings");
    await expect(page.locator("text=Loading...")).toBeHidden({ timeout: 5000 });

    const notifLabel = page
      .locator(".settings-field")
      .filter({ hasText: /notification/i })
      .locator("label.switch")
      .first();
    await notifLabel.click();

    const saveBtn = page.locator("button.primary").filter({ hasText: /save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 3000 });
    await saveBtn.click();

    const calls: { cmd: string; args: any }[] = await page.evaluate(
      () => (window as any).__testHelpers.getInvokeCalls(),
    );
    const saveCall = calls.find((c) => c.cmd === "save_config");
    expect(saveCall).toBeDefined();
    expect(saveCall?.args?.config?.auto_type).toBe(true);
  });
});
