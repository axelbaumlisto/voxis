// src/theme-engine/contract.ts
/**
 * Theme Engine contract — apiVersion 1.
 * SRP: types + pure module validation only. No DOM, no Tauri, no I/O.
 */
export const THEME_API_VERSION = 1 as const;

export type ThemeMode = "idle" | "recording" | "transcribing" | "error";

/** State snapshot pushed to themes on every backend event. */
export interface ThemeState {
  mode: ThemeMode;
  /** Smoothed level in [0, 1]. */
  audioLevel: number;
  /** 32 FFT bins, each in [0, 1]. */
  spectrumBins: number[];
}

export interface ThemeSize {
  width: number;
  height: number;
}

/** Everything a theme may touch. Versioned; additive changes only within v1. */
export interface ThemeApi {
  apiVersion: typeof THEME_API_VERSION;
  /** Manifest `params` object (free-form JSON owned by the theme). */
  params: unknown;
  size: ThemeSize;
  /** Subscribe to state pushes. Returns unsubscribe. Fires immediately with current state. */
  onState(cb: (state: ThemeState) => void): () => void;
  actions: {
    /** Cancel the in-flight recording (maps to Tauri cancelOperation). */
    cancel(): void;
  };
}

export interface ThemeInstance {
  unmount(): void;
}

export interface ThemeModule {
  mount(container: HTMLElement, api: ThemeApi): ThemeInstance;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Pure structural check that an imported module satisfies ThemeModule. */
export function validateThemeModule(mod: unknown): ValidationResult {
  if (mod === null || typeof mod !== "object") {
    return { ok: false, error: "theme module is not an object" };
  }
  const mount = (mod as Record<string, unknown>).mount;
  if (typeof mount !== "function") {
    return { ok: false, error: "theme module does not export mount(container, api)" };
  }
  return { ok: true };
}
