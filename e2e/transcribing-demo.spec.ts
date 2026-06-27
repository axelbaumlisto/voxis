/**
 * E2E Demo: Transcribing animations for all 5 overlay themes.
 *
 * Launches the real overlay binary and cycles through each theme
 * in "transcribing" state for 3 seconds each.
 *
 * Run:
 *   bunx playwright test e2e/transcribing-demo.spec.ts
 *
 * Or directly (no browser needed):
 *   bun run e2e/transcribing-demo.spec.ts
 */
import { test } from "@playwright/test";
import { spawn, type ChildProcess } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OVERLAY_BIN = resolve(
  __dirname,
  "../src-tauri/target/debug/soupawhisper-overlay",
);

const THEMES = [
  { id: "default", name: "Default — traveling stadium wave (8 bars)" },
  { id: "neon", name: "Neon — Knight Rider scanner (10 bars)" },
  { id: "winamp_classic", name: "Winamp Classic — bouncing EQ (10 bars)" },
];

const SECONDS_PER_THEME = 3;

function sendCommand(proc: ChildProcess, cmd: string) {
  proc.stdin?.write(cmd + "\n");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

test.describe("Transcribing animation demo", () => {
  // Native overlay binary requires macOS and a pre-built binary
  test.skip(process.platform !== "darwin", "Native overlay demo requires macOS");
  test.setTimeout((THEMES.length * SECONDS_PER_THEME + 5) * 1000);

  test("cycle all 5 themes in transcribing state", async () => {
    const overlay = spawn(OVERLAY_BIN, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Give the overlay time to initialize its window
    await sleep(1500);

    for (const theme of THEMES) {
      console.log(`\n▶ ${theme.name}`);

      sendCommand(overlay, `theme ${theme.id}`);
      sendCommand(overlay, "show transcribing");

      await sleep(SECONDS_PER_THEME * 1000);
    }

    // Clean exit
    sendCommand(overlay, "hide");
    await sleep(200);
    sendCommand(overlay, "quit");

    await new Promise<void>((resolve) => {
      overlay.on("close", () => resolve());
      // Safety timeout
      setTimeout(() => {
        overlay.kill();
        resolve();
      }, 3000);
    });
  });
});
