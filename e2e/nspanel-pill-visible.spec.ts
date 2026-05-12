/**
 * Axiomatic E2E for the NSPanel HandyPill:
 *
 *   1. Idle pill is visually present (fullscreen crop has content).
 *   2. Recording pill renders bars (recording crop differs significantly
 *      from idle crop).
 *   3. AltGr keypress is captured by the orchestrator.
 *
 * RED-first: these tests should fail until the NSPanel actually paints the
 * webview content. Once GREEN, they guard the regression.
 *
 * macOS-only \u2014 NSPanel is AppKit specific.
 */
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { getVoicePid, findPillWindow } from "./helpers/voiceApp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { captureFullScreenPillCrop } from "./helpers/captureScreen";
import { ensureQuartzAvailable, pressAltGr } from "./helpers/keyboard";
import { readFileSync } from "node:fs";

// eslint-disable-next-line playwright/no-skipped-test
test.skip(process.platform !== "darwin", "NSPanel is macOS-only");

const SHOTS_DIR = "test-results/nspanel-pill";

test.describe.configure({ mode: "serial" });

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

  test("idle pill is visible (>3 KB fullscreen crop)", async () => {
    const win = await findPillWindow(pid);
    expect(win, "pill window must exist after Setup: complete!").not.toBeNull();
    const { bytes, cropPath } = await captureFullScreenPillCrop(
      win!,
      `${SHOTS_DIR}/idle.png`,
    );
    expect(
      bytes,
      `idle pill crop must contain visible content; see ${cropPath} (bytes=${bytes})`,
    ).toBeGreaterThan(3000);
  });

  test("AltGr keypress is observed by the orchestrator", async () => {
    // Find most recent voice/tauri log.
    const { stdout: logPathOut } = await execFileAsync("bash", [
      "-c",
      "ls -t /tmp/tauri-*.log 2>/dev/null | head -1",
    ]);
    const logPath = logPathOut.trim();
    expect(logPath, "tauri dev log must exist under /tmp").not.toBe("");

    const beforeSize = readFileSync(logPath).length;
    await pressAltGr(1500);
    await new Promise((r) => setTimeout(r, 800));
    const after = readFileSync(logPath, "utf8").slice(beforeSize);
    expect(
      after,
      `orchestrator did not log a press / Stage::Recording; tail:\n${after.slice(-2000)}`,
    ).toMatch(
      /on_hotkey_pressed: enter|Hotkey pressed: AltGr|stage now Recording/,
    );
  });

  test("recording pill crop differs from idle (bars rendered)", async () => {
    const win = await findPillWindow(pid);
    expect(win).not.toBeNull();

    // Capture idle baseline (the previous test may have left a state).
    await new Promise((r) => setTimeout(r, 1500));
    const idle = await captureFullScreenPillCrop(
      win!,
      `${SHOTS_DIR}/idle-before-rec.png`,
    );

    // Hold AltGr long enough for orchestrator to reach Stage::Recording and
    // for the spectrum polling to send a few non-empty bins to the webview.
    const recordingPromise = pressAltGr(2500);
    // Capture mid-press.
    await new Promise((r) => setTimeout(r, 1500));
    const recording = await captureFullScreenPillCrop(
      win!,
      `${SHOTS_DIR}/recording.png`,
    );
    await recordingPromise;

    // Both crops should be non-trivial (>3 KB) and they must differ in size
    // significantly (\u2265 200 bytes) because the recording state adds bars
    // and the microphone icon (different SVG paths).
    expect(idle.bytes).toBeGreaterThan(3000);
    expect(recording.bytes).toBeGreaterThan(3000);
    expect(
      Math.abs(recording.bytes - idle.bytes),
      `recording crop should differ from idle by \u2265200 bytes; idle=${idle.bytes} recording=${recording.bytes}`,
    ).toBeGreaterThanOrEqual(200);
  });
});
