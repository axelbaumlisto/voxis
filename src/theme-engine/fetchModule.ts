// src/theme-engine/fetchModule.ts
/**
 * Production fetchModule: Tauri command → source text → loader.
 * DIP: this is the only place that imports from ../bindings for theme
 * fetching.  ThemeHost receives this as a prop and stays Tauri-free.
 */
import { commands } from "../bindings";
import { loadThemeModuleFromSource } from "./loader";
import type { ThemeModule } from "./contract";

export async function fetchThemeModule(themeId: string): Promise<ThemeModule> {
  const result = await commands.readThemeScript(themeId);
  // readThemeScript returns Result<string, string> (generated specta wrapper)
  // shape: { status: "ok", data: string } | { status: "error", error: string }
  if (typeof result === "object" && result !== null && "status" in result) {
    if (result.status !== "ok") {
      throw new Error(
        String((result as { error?: unknown }).error ?? "unknown error"),
      );
    }
    return loadThemeModuleFromSource(
      (result as { data: string }).data,
    );
  }
  // Defensive: if the binding shape ever changes to a plain string
  if (typeof result === "string") {
    return loadThemeModuleFromSource(result);
  }
  throw new Error("unexpected readThemeScript shape");
}
