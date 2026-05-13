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
