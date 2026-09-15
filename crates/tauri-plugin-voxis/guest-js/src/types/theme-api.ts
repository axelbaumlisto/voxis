// crates/tauri-plugin-voxis/guest-js/src/types/theme-api.ts
/**
 * Manual TYPE-ONLY mirror of `src/theme-engine/contract.ts`'s `ThemeApi`
 * (apiVersion 1) for this standalone package. Deliberately not a
 * `import type` across the package boundary into `../../../../src/...`:
 * this package has its own `tsconfig.json` with `rootDir: "src"` (so its
 * `dist/` output tree matches `src/`'s shape one-to-one) and ships its
 * own `.d.ts` — reaching outside `rootDir` for a *type-only* import is
 * possible in principle but ties this package's typecheck to the host
 * app's tsconfig/module graph being resolvable from an isolated
 * `bun install`, which it explicitly is not (see this package's
 * `package.json` — no workspace, own `node_modules`). Copying the type
 * keeps this package fully self-contained, at the cost of needing to
 * keep it in sync by hand if `contract.ts` ever changes; `THEME_API_VERSION`
 * below is the tripwire — bump both together.
 *
 * No runtime code is duplicated: theme *implementations* still come from
 * `themes/generated/*` (this package's own build-themes.ts output), never
 * re-executed from `src/theme-engine/builtin/**` sources.
 */

export const THEME_API_VERSION = 1 as const;

export type ThemeMode = "idle" | "recording" | "transcribing" | "error";

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

export interface ThemeApi {
  apiVersion: typeof THEME_API_VERSION;
  params: unknown;
  size: ThemeSize;
  onState(cb: (state: ThemeState) => void): () => void;
  actions: {
    cancel(): void;
  };
}

export interface ThemeInstance {
  unmount(): void;
}

export interface ThemeModule {
  mount(container: HTMLElement, api: ThemeApi): ThemeInstance;
}
