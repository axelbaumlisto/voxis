/**
 * Programmatic keypress via macOS Quartz \u2014 axiomatic. Requires
 * Accessibility permission on the Terminal/runner. Fails loudly if missing
 * rather than silently no-op'ing.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PYTHON_QUARTZ_PROBE = `
try:
    from Quartz import CGEventCreateKeyboardEvent
    print("ok")
except Exception as e:
    print(f"FAIL: {e}")
`;

export async function ensureQuartzAvailable(): Promise<void> {
  const { stdout } = await execFileAsync("python3", [
    "-c",
    PYTHON_QUARTZ_PROBE,
  ]);
  if (!stdout.trim().startsWith("ok")) {
    throw new Error(
      "python3 + Quartz not available; install via `pip3 install pyobjc-framework-Quartz`",
    );
  }
}

/**
 * Press AltGr (right Option, keycode 61) for `holdMs` ms, then release.
 */
export async function pressAltGr(holdMs: number): Promise<void> {
  const py = [
    "from Quartz import (",
    "    CGEventCreateKeyboardEvent, CGEventPost, CGEventSetFlags,",
    "    kCGHIDEventTap, kCGEventFlagMaskAlternate,",
    ")",
    "import time",
    "down = CGEventCreateKeyboardEvent(None, 61, True)",
    "CGEventSetFlags(down, kCGEventFlagMaskAlternate)",
    "CGEventPost(kCGHIDEventTap, down)",
    `time.sleep(${(holdMs / 1000).toFixed(3)})`,
    "up = CGEventCreateKeyboardEvent(None, 61, False)",
    "CGEventPost(kCGHIDEventTap, up)",
  ].join("\n");
  await execFileAsync("python3", ["-c", py]);
}
