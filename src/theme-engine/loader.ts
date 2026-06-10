// src/theme-engine/loader.ts
/**
 * Theme module loader.
 * SRP: source text → validated ThemeModule. Fetching the text is the
 * caller's job (Tauri command readThemeScript).
 * Uses a Blob URL + dynamic import so the theme is a real ES module
 * (user code runs unsandboxed — trusted by design, see spec).
 *
 * Node's ESM loader (used by vitest's node environment) cannot import
 * `blob:` URLs, so on failure we retry through an equivalent `data:` URL —
 * still the real dynamic-import path, never a mock. Syntax errors and other
 * module-level failures surface from the retry and reject as expected.
 */
import { validateThemeModule, type ThemeModule } from "./contract";

async function importFromBlobUrl(source: string): Promise<unknown> {
  const blob = new Blob([source], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toDataUrl(source: string): string {
  // base64 keeps the URL safe regardless of source contents.
  // btoa + TextEncoder are available in both browsers and node >= 16.
  let binary = "";
  for (const byte of new TextEncoder().encode(source)) {
    binary += String.fromCharCode(byte);
  }
  return `data:text/javascript;base64,${btoa(binary)}`;
}

export async function loadThemeModuleFromSource(source: string): Promise<ThemeModule> {
  let mod: unknown;
  try {
    mod = await importFromBlobUrl(source);
  } catch {
    // Environment without blob: ESM support (e.g. node) — or a broken module.
    // Retry via data: URL; genuine module errors will reject here.
    mod = await import(/* @vite-ignore */ toDataUrl(source));
  }
  const res = validateThemeModule(mod);
  if (!res.ok) throw new Error(`invalid theme: ${res.error}`);
  return mod as ThemeModule;
}
