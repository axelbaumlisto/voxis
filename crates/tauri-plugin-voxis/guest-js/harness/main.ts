// crates/tauri-plugin-voxis/guest-js/harness/main.ts
/**
 * Wires a mock `VoxisClient` (no `@tauri-apps/api`/Tauri runtime) into
 * `mountOverlay` so `<voxis-overlay>` can be eyeballed with fake levels —
 * `bun run harness:overlay` (root) / `bun run harness` (this package).
 */
import { mountOverlay } from "../src/overlay";
import { ThemeRegistry } from "../src/themes/registry";
import type { DictationResult, LevelEvent, Mode, PluginState } from "../src/types/contract";
import type { VoxisClient } from "../src/client";

const stateHandlers = new Set<(s: PluginState) => void>();
const levelHandlers = new Set<(l: LevelEvent) => void>();
const resultHandlers = new Set<(r: DictationResult) => void>();

let current: PluginState = "idle";
function setState(next: PluginState) {
  current = next;
  const stateEl = document.getElementById("state");
  if (stateEl) stateEl.textContent = `state: ${next}`;
  for (const cb of stateHandlers) cb(next);
}

let sessionCounter = 0;

const mockClient: VoxisClient = {
  async start(mode: Mode) {
    setState("recording");
    return `harness-session-${++sessionCounter}`;
  },
  async stop(id) {
    setState("transcribing");
    const result: DictationResult = {
      text: `(harness) recorded session ${id}`,
      language: "en",
      durationMs: 1200,
      guardOutcome: "finalized",
    };
    setTimeout(() => {
      setState("idle");
      for (const cb of resultHandlers) cb(result);
    }, 400);
    return result;
  },
  async cancel() {
    setState("idle");
  },
  async state() {
    return current;
  },
  async getProfile(): Promise<never> {
    throw new Error("harness: getProfile not implemented");
  },
  async applyProfile(): Promise<never> {
    throw new Error("harness: applyProfile not implemented");
  },
  async importProfileFromDesktop(): Promise<never> {
    throw new Error("harness: importProfileFromDesktop not implemented");
  },
  async importProfileFromQr(): Promise<never> {
    throw new Error("harness: importProfileFromQr not implemented");
  },
  async setHotkey() {},
  async setConsent() {},
  async holdLease() {},
  async dictate({ mode }) {
    await mockClient.start(mode);
    return new Promise((resolve) => resultHandlers.add(resolve));
  },
  async onState(cb) {
    stateHandlers.add(cb);
    return () => stateHandlers.delete(cb);
  },
  async onLevel(cb) {
    levelHandlers.add(cb);
    return () => levelHandlers.delete(cb);
  },
  async onResult(cb) {
    resultHandlers.add(cb);
    return () => resultHandlers.delete(cb);
  },
};

const themeSelect = document.getElementById("theme") as HTMLSelectElement;
for (const id of Object.keys(ThemeRegistry).sort()) {
  const opt = document.createElement("option");
  opt.value = id;
  opt.textContent = id;
  themeSelect.appendChild(opt);
}
themeSelect.value = "default";

const modeSelect = document.getElementById("mode") as HTMLSelectElement;

let overlayEl = mountOverlay(document.body, { client: mockClient, theme: themeSelect.value, mode: "hold" });

function remount() {
  overlayEl.remove();
  overlayEl = mountOverlay(document.body, {
    client: mockClient,
    theme: themeSelect.value,
    mode: modeSelect.value as Mode,
  });
}

themeSelect.addEventListener("change", remount);
modeSelect.addEventListener("change", remount);

let sweepTimer: ReturnType<typeof setInterval> | null = null;
document.getElementById("fake-level")?.addEventListener("click", () => {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
    for (const cb of levelHandlers) cb({ rms: 0, peak: 0, muted: false });
    return;
  }
  let t = 0;
  sweepTimer = setInterval(() => {
    t += 0.1;
    const level = (Math.sin(t) + 1) / 2;
    for (const cb of levelHandlers) cb({ rms: level, peak: Math.min(1, level + 0.1), muted: false });
  }, 100);
});
