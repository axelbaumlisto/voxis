// crates/tauri-plugin-voxis/guest-js/vitest.config.ts
// Self-contained (per the plan's Task 5 file list): this package is a
// standalone npm package (its own node_modules via `bun install`), not a
// workspace member of the root vitest config, so it needs its own runner
// config rather than extending `../../../vitest.config.ts`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["__tests__/**/*.test.ts"],
  },
});
