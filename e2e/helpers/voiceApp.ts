/**
 * Deterministic voice app lifecycle for E2E:
 *   - kill everything related (voice, tauri dev, vite, node)
 *   - start fresh with a known log path
 *   - wait for "Setup: complete!"
 *   - probe pill window via Swift CGWindowList
 *
 * SRP: process lifecycle only. Pixel checks / keypress live in sibling
 *      helpers.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

export const VOICE_LOG = "/tmp/tauri-e2e-voice.log";
const REPO_ROOT = process.cwd();

export interface PillWindow {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function killAll(): Promise<void> {
  // Best-effort kill; ignore failures because nothing may match.
  await execFileAsync("bash", [
    "-c",
    "pkill -9 -f 'target/debug/voice|tauri dev|node.*vite|bun run tauri' 2>/dev/null; true",
  ]).catch(() => {});
  // Give the OS time to actually reap zombies and free port 5173.
  await sleep(2000);
}

export async function start(): Promise<void> {
  // Truncate log so each run is a fresh tail.
  await execFileAsync("bash", ["-c", `: > ${VOICE_LOG}`]).catch(() => {});

  // Spawn detached so Playwright can move on; redirect stdout/stderr to log.
  const proc = spawn("bun", ["run", "tauri", "dev"], {
    cwd: REPO_ROOT,
    env: { ...process.env, RUST_BACKTRACE: "full" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const append = (chunk: Buffer) => {
    try {
      // Append best-effort.
      require("node:fs").appendFileSync(VOICE_LOG, chunk);
    } catch {
      // ignore
    }
  };
  proc.stdout?.on("data", append);
  proc.stderr?.on("data", append);
  proc.unref();
}

export async function waitForSetupComplete(timeoutMs = 90_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(VOICE_LOG)) {
      const log = readFileSync(VOICE_LOG, "utf8");
      if (log.includes("Setup: complete!")) {
        const pid = await getVoicePid();
        if (pid) {
          // Allow webview to fully load.
          await sleep(2500);
          return pid;
        }
      }
    }
    await sleep(500);
  }
  throw new Error(
    `voice app did not reach 'Setup: complete!' within ${timeoutMs} ms; log tail:\n${tailLog(2000)}`,
  );
}

export async function getVoicePid(): Promise<string | null> {
  const { stdout } = await execFileAsync("bash", [
    "-c",
    "ps aux | grep 'target/debug/voice' | grep -v grep | awk '{print $2}' | head -1",
  ]).catch(() => ({ stdout: "" }));
  const pid = stdout.trim();
  return pid || null;
}

export async function findPillWindow(pid: string): Promise<PillWindow | null> {
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

function tailLog(n: number): string {
  try {
    const content = readFileSync(VOICE_LOG, "utf8");
    return content.slice(-n);
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
