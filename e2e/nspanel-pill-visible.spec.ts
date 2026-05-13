/**
 * Axiomatic E2E for the NSPanel HandyPill:
 *
 *   1. Idle pill is visually present (light pixels > threshold).
 *   2. AltGr keypress is captured by the orchestrator (log probe).
 *   3. Recording pill renders bars + cancel — light pixel count grows
 *      significantly versus idle.
 *
 * macOS-only — NSPanel is AppKit specific.
 */
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { getVoicePid, findPillWindow } from "./helpers/voiceApp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import {
  captureWindowDirect,
  countLightPixels,
  diffPixelCount,
} from "./helpers/captureScreen";
import { ensureQuartzAvailable, pressAltGr } from "./helpers/keyboard";
import { readFileSync } from "node:fs";

// eslint-disable-next-line playwright/no-skipped-test
test.skip(process.platform !== "darwin", "NSPanel is macOS-only");

const SHOTS_DIR = "test-results/nspanel-pill";

// Mark as serial AND request 2 retries: AltGr injection via Quartz can be
// swallowed by macOS when other tests are also using accessibility APIs.
test.describe.configure({ mode: "serial", retries: 2 });

test.describe("NSPanel HandyPill -- pixel-level axioms", () => {
  let pid: string;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await mkdir(SHOTS_DIR, { recursive: true });
    await ensureQuartzAvailable();
    // Voice app must already be running — we don't manage its lifecycle here
    // because that conflicts with Playwright's own dev server.
    const found = await getVoicePid();
    if (!found) {
      throw new Error(
        "voice app is not running; start it manually:\n  cd /path/to/soup && bun run tauri dev",
      );
    }
    pid = found;
  });

  test("idle pill renders visible content (light pixels > 100)", async () => {
    const win = await findPillWindow(pid);
    expect(win, "pill window must exist after Setup: complete!").not.toBeNull();
    const direct = await captureWindowDirect(
      win!.id,
      `${SHOTS_DIR}/idle.png`,
    );
    // Idle pill = dark rounded rect + pink TranscriptionIcon at left.
    // Light-pixel count distinguishes a rendered pill from a blank canvas.
    const light = await countLightPixels(direct.cropPath);
    expect(
      light,
      `idle pill must show icon (light pixels > 100); see ${direct.cropPath} bytes=${direct.bytes} light=${light}`,
    ).toBeGreaterThan(100);
  });

  test("AltGr keypress is observed by the orchestrator", async () => {
    // Find most recent voice/tauri log.
    const { stdout: logPathOut } = await execFileAsync("bash", [
      "-c",
      "ls -t /tmp/tauri-*.log 2>/dev/null | head -1",
    ]);
    const logPath = logPathOut.trim();
    expect(logPath, "tauri dev log must exist under /tmp").not.toBe("");

    // Retry up to 3 times to absorb timing flake: rdev/orchestrator can
    // be momentarily busy (e.g. finishing a previous transcription cycle).
    const pattern =
      /on_hotkey_pressed: enter|Hotkey pressed: AltGr|stage now Recording|emit overlay state -> Recording/;
    let after = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const beforeSize = readFileSync(logPath).length;
      await pressAltGr(1500);
      await new Promise((r) => setTimeout(r, 1000));
      after = readFileSync(logPath, "utf8").slice(beforeSize);
      if (pattern.test(after)) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    expect(
      after,
      `orchestrator did not log a press after 3 attempts; last tail:\n${after.slice(-2000)}`,
    ).toMatch(pattern);
  });

  test("recording pill renders different content than idle", async () => {
    const win = await findPillWindow(pid);
    expect(win).not.toBeNull();

    // Wait for orchestrator to settle into Idle after any prior tests.
    await new Promise((r) => setTimeout(r, 2500));
    const idleSnap = await captureWindowDirect(
      win!.id,
      `${SHOTS_DIR}/idle-baseline.png`,
    );

    // Retry the recording capture up to 3 times to absorb timing flakes
    // (orchestrator may be busy finalising a previous cycle).
    let diff = 0;
    let recPath = `${SHOTS_DIR}/recording.png`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const altGr = pressAltGr(2500);
      await new Promise((r) => setTimeout(r, 1100));
      const recSnap = await captureWindowDirect(
        win!.id,
        `${SHOTS_DIR}/recording-attempt-${attempt}.png`,
      );
      await altGr;
      const d = await diffPixelCount(idleSnap.cropPath, recSnap.cropPath, 30);
      if (d > diff) {
        diff = d;
        recPath = recSnap.cropPath;
      }
      if (diff > 300) break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Pixel-level diff: recording mode swaps the left icon
    // (TranscriptionIcon -> MicrophoneIcon) AND adds 9 bars in the middle
    // AND adds a cancel-X glyph on the right. So at least ~300 pixels
    // must differ between the two captures.
    expect(
      diff,
      `recording pill must differ from idle (pixel diff > 300); best diff=${diff}\n  idle:      ${idleSnap.cropPath}\n  recording: ${recPath}`,
    ).toBeGreaterThan(300);
  });
});
