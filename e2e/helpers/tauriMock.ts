/**
 * Shared Tauri mock additions required for React app to mount.
 *
 * Without `transformCallback` and `check_permissions`, the app hangs on a black screen.
 * Call `addTauriMockEssentials(page)` BEFORE `page.goto()` in tests that mock `__TAURI_INTERNALS__`.
 */
import type { Page } from "@playwright/test";

/**
 * Patches an existing `__TAURI_INTERNALS__` mock with missing essentials:
 * - `transformCallback` (required by Tauri event system)
 * - `check_permissions` command (required by permission banner)
 * - `get_audio_level` command
 * - `get_visualization_themes` command
 * - OS plugin internals
 *
 * Must be called via addInitScript AFTER the test sets up its own `__TAURI_INTERNALS__`.
 */
export function addTauriMockEssentials(page: Page) {
  return page.addInitScript(() => {
    // Ensure OS plugin mock exists
    if (!(window as any).__TAURI_OS_PLUGIN_INTERNALS__) {
      (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
        platform: "macos",
        eol: "\n",
        version: "15.0.0",
      };
    }

    // Patch __TAURI_INTERNALS__ after the test's addInitScript sets it up
    const origSetup = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");

    // Watch for __TAURI_INTERNALS__ to be set, then patch it
    let patched = false;
    const patchTauri = () => {
      const tauri = (window as any).__TAURI_INTERNALS__;
      if (!tauri || patched) return;
      patched = true;

      // Add transformCallback if missing
      if (!tauri.transformCallback) {
        const callbacks = new Map<number, (data: unknown) => void>();
        let callbackId = 0;
        tauri.transformCallback = (callback: (data: unknown) => void) => {
          const id = callbackId++;
          callbacks.set(id, callback);
          return id;
        };
      }

      // Wrap invoke to handle missing commands
      const originalInvoke = tauri.invoke;
      tauri.invoke = async (cmd: string, args?: any) => {
        // Handle commands that the test mock might not cover
        switch (cmd) {
          case "check_permissions":
            try { return await originalInvoke(cmd, args); } catch {
              return [
                { name: "Microphone", status: "granted", description: "Required for audio recording" },
                { name: "Input Monitoring", status: "granted", description: "Required for global hotkey detection" },
              ];
            }
          case "get_audio_level":
            try { return await originalInvoke(cmd, args); } catch { return 0; }
          case "get_visualization_themes":
            try { return await originalInvoke(cmd, args); } catch {
              return [
                { id: "default", name: "Default", description: "Default theme" },
                { id: "winamp_classic", name: "Winamp Classic", description: "Classic fire spectrum" },
                { id: "dark", name: "Dark Purple", description: "Dark purple theme" },
                { id: "neon", name: "Neon", description: "Neon theme" },
                { id: "monochrome", name: "Monochrome", description: "Grayscale" },
              ];
            }
          case "list_audio_devices":
            try { return await originalInvoke(cmd, args); } catch {
              return [{ id: "default", name: "Default", is_default: true }];
            }
          default:
            return originalInvoke(cmd, args);
        }
      };
    };

    // Try to patch immediately, and also on a microtask (in case it's set later)
    patchTauri();
    Promise.resolve().then(patchTauri);
    setTimeout(patchTauri, 0);
  });
}
