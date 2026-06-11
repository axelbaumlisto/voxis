// src/harness/builtinThemes.ts
/**
 * Harness theme resolver — the dev-tool analogue of production fetchModule.
 * Resolves a builtin themeId to its ThemeModule via import.meta.glob, so the
 * harness loads the EXACT same theme code the overlay bundles, with no Tauri.
 */
import { validateThemeModule, type ThemeModule } from "../theme-engine/contract";

// Eagerly import every builtin theme index. Keyed by full path.
const modules = import.meta.glob("../theme-engine/builtin/*/index.ts", {
  eager: true,
}) as Record<string, unknown>;

function idFromPath(p: string): string {
  // ".../builtin/<id>/index.ts" → "<id>"
  const m = p.match(/builtin\/([^/]+)\/index\.ts$/);
  return m ? m[1] : p;
}

const byId = new Map<string, unknown>();
for (const [p, mod] of Object.entries(modules)) {
  byId.set(idFromPath(p), mod);
}

export const BUILTIN_THEME_IDS: string[] = Array.from(byId.keys()).sort();

export async function fetchBuiltinThemeModule(id: string): Promise<ThemeModule> {
  const mod = byId.get(id);
  if (mod === undefined) {
    throw new Error(`unknown builtin theme: ${id}`);
  }
  const res = validateThemeModule(mod);
  if (!res.ok) throw new Error(`invalid theme '${id}': ${res.error}`);
  return mod as ThemeModule;
}