/// <reference types="vite/client" />

/**
 * Type declarations for Vite features used in this project.
 *
 * CSS Modules — `*.module.css` imports return a string-keyed map of
 * mangled class names. Without this, `tsc` (run via `bun run build`)
 * fails with TS2307 even though `vite dev` works fine.
 */
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.module.scss" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

/**
 * Tauri v2 injects `window.__TAURI_INTERNALS__` at runtime. The
 * `useTauriEvent` hook probes it to safely skip listener setup in mocked
 * E2E environments. Declared here so `tsc` (run via `bun run build`)
 * recognizes the property.
 */
interface Window {
  __TAURI_INTERNALS__?: {
    transformCallback?: (...args: unknown[]) => unknown;
    [key: string]: unknown;
  };
}
