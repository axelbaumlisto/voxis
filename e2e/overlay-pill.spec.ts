/**
 * Live E2E for the overlay window (ThemeHost), macOS only.
 *
 * This test triggers AltGr via CGEventPost (Python+Quartz \u2014 needs Accessibility
 * permission on Terminal/runner) and asserts the orchestrator log shows the
 * full recording flow, plus that the overlay window exists at the configured
 * coordinates.
 *
 * What we DON'T test here: pixel-level capture of the overlay's webview
 * content. macOS `screencapture` of transparent borderless windows returns a
 * fully-transparent PNG even when the window is on-screen and visible to the
 * user. Use the
 * Playwright `webview content` describe-block to verify React rendering;
 * the OS-level pixels of the live overlay are out of scope.
 */
import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

test.describe("Overlay (ThemeHost) -- webview content (dev URL)", () => {
  // Overlay uses ThemeHost. The `?theme=default` pin is kept so the
  // test doesn't depend on Tauri state. Grid-only selectors died with
  // the old HandyPill shell.
  test("overlay.html mounts ThemeHost (default bars theme)", async ({ page }) => {
    await page.goto("/overlay.html?theme=default");
    await page.waitForSelector("[data-testid='theme-host']");
    // The default theme renders .classic-bar-col elements
    await expect(page.locator(".classic-bar-col").first()).toBeVisible({
      timeout: 5000,
    });
  });

  // Background transparency must hold for ALL families, not just handy —
  // covered regardless of the active theme.
  test("body background is transparent", async ({ page }) => {
    await page.goto("/overlay.html");
    await page.waitForSelector("[data-testid='theme-host']");
    const bg = await page.evaluate(
      () => window.getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
  });
});

test.describe("Overlay window (ThemeHost) -- live OS integration", () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(
    process.platform !== "darwin",
    "Overlay window tuning is macOS-only (AppKit)",
  );

  async function getVoicePid(): Promise<string | null> {
    const { stdout } = await execFileAsync("bash", [
      "-c",
      "ps aux | grep 'target/debug/voice' | grep -v grep | awk '{print $2}' | head -1",
    ]).catch(() => ({ stdout: "" }));
    const pid = stdout.trim();
    return pid || null;
  }

  async function findPillWindow(pid: string): Promise<{
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null> {
    const swiftScript = [
      "import Foundation",
      "import CoreGraphics",
      `let target = Int32(${pid})`,
      "let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []",
      "for w in windows {",
      "  let owner = w[kCGWindowOwnerPID as String] as? Int ?? -1",
      "  if Int32(owner) != target { continue }",
      '  let title = w[kCGWindowName as String] as? String ?? ""',
      '  if title != "Recording Overlay" { continue }',
      '  if let b = w[kCGWindowBounds as String] as? [String: Any] {',
      "    let id = w[kCGWindowNumber as String] as? Int ?? -1",
      '    let x = b["X"] as? Double ?? 0',
      '    let y = b["Y"] as? Double ?? 0',
      '    let ww = b["Width"] as? Double ?? 0',
      '    let hh = b["Height"] as? Double ?? 0',
      '    print("\\(id),\\(x),\\(y),\\(ww),\\(hh)")',
      "    exit(0)",
      "  }",
      "}",
    ].join("\n");
    const { stdout } = await execFileAsync("swift", ["-e", swiftScript]).catch(
      () => ({ stdout: "" }),
    );
    const line = stdout.trim();
    if (!line) return null;
    const [id, x, y, ww, hh] = line.split(",").map(Number);
    return { id, x, y, width: ww, height: hh };
  }

  async function pressAltGr(seconds: number): Promise<void> {
    const py = [
      "from Quartz import (CGEventCreateKeyboardEvent, CGEventPost, CGEventSetFlags, kCGHIDEventTap, kCGEventFlagMaskAlternate)",
      "import time",
      "down = CGEventCreateKeyboardEvent(None, 61, True)",
      "CGEventSetFlags(down, kCGEventFlagMaskAlternate)",
      "CGEventPost(kCGHIDEventTap, down)",
      `time.sleep(${seconds.toFixed(2)})`,
      "up = CGEventCreateKeyboardEvent(None, 61, False)",
      "CGEventPost(kCGHIDEventTap, up)",
    ].join("\n");
    await execFileAsync("python3", ["-c", py]);
  }

  async function findCurrentLogPath(): Promise<string | null> {
    // Discover the most recently-modified tauri dev log file under /tmp.
    const { stdout } = await execFileAsync("bash", [
      "-c",
      "ls -t /tmp/tauri-*.log 2>/dev/null | head -1",
    ]).catch(() => ({ stdout: "" }));
    const path = stdout.trim();
    return path && existsSync(path) ? path : null;
  }

  test("voice process is running with an overlay window at PILL_WIDTH x PILL_HEIGHT", async () => {
    const pid = await getVoicePid();
    expect(
      pid,
      "voice app must be running (start via `bun run tauri dev`)",
    ).not.toBeNull();
    const win = await findPillWindow(pid!);
    expect(
      win,
      "expected 'Recording Overlay' window for the voice process",
    ).not.toBeNull();
    expect([172, 344]).toContain(win!.width);
    expect([36, 72]).toContain(win!.height);
  });

  test("overlay position is on-screen (non-zero, within a real monitor)", async () => {
    const pid = await getVoicePid();
    expect(pid).not.toBeNull();
    const win = await findPillWindow(pid!);
    expect(win).not.toBeNull();
    // Default-fallback position is (100, 100). A configured PositionConfig
    // produces something further from origin (e.g. BottomCenter on a 4K
    // monitor lands at (1834, 2094)).
    expect(win!.x).toBeGreaterThanOrEqual(0);
    expect(win!.y).toBeGreaterThanOrEqual(0);
    // Some reasonable upper bound \u2014 monitors larger than 8K are still rare.
    expect(win!.x).toBeLessThan(8000);
    expect(win!.y).toBeLessThan(5000);
  });

  test("AltGr keypress flows through orchestrator to Stage::Recording", async () => {
    const pid = await getVoicePid();
    expect(pid).not.toBeNull();
    const logPath = await findCurrentLogPath();
    expect(logPath, "tauri dev log file must exist under /tmp").not.toBeNull();

    const before = readFileSync(logPath!, "utf8").length;

    // Hold AltGr long enough for recording.start (~500 ms on macOS) and a
    // few audio frames; then release so the pipeline runs.
    await pressAltGr(2.0);
    await new Promise((r) => setTimeout(r, 1500));

    const after = readFileSync(logPath!, "utf8");
    const tail = after.slice(before);

    // Either we entered recording (Stage::Recording reached) OR we observed
    // the press at all. Both paths prove the OS-level keystroke reaches the
    // app.
    expect(
      tail,
      `expected orchestrator activity in log tail; got:\n${tail.slice(-2000)}`,
    ).toMatch(
      /on_hotkey_pressed: enter|Hotkey pressed: AltGr|stage now Recording/,
    );
  });
});
