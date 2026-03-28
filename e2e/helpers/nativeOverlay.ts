import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const TAURI_DIR = resolve(PROJECT_ROOT, "src-tauri");
const OVERLAY_BIN = resolve(TAURI_DIR, "target/debug/soupawhisper-overlay");
const DEFAULT_SETTLE_MS = 250;
const BOOT_MS = 1500;
const RECORDING_SPECTRUM = [
  0.22, 0.34, 0.49, 0.66, 0.78, 0.88, 0.94, 0.98,
  1.00, 0.96, 0.91, 0.86, 0.78, 0.72, 0.67, 0.61,
  0.55, 0.49, 0.43, 0.39, 0.35, 0.31, 0.28, 0.26,
  0.30, 0.37, 0.46, 0.58, 0.71, 0.83, 0.91, 0.97,
];
const RECORDING_LEVELS = [0.42, 0.58, 0.74, 0.88, 0.96, 0.91, 0.84, 0.78, 0.86, 0.93];

export type OverlayVisualState = "recording" | "transcribing";

export interface OverlayRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedOverlayImage {
  path: string;
  fileSize: number;
  sha256: string;
}

export interface CaptureThemeOptions {
  themeId: string;
  state: OverlayVisualState;
  outputPath: string;
}

export interface OverlayHarness {
  captureTheme(options: CaptureThemeOptions): Promise<CapturedOverlayImage>;
  close(): Promise<void>;
}

export interface CaptureRetryDependencies {
  waitForWindowId(pid: number): Promise<number>;
  captureOverlayRegion(windowId: number, outputPath: string): Promise<CapturedOverlayImage>;
  sleep(ms: number): Promise<void>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureOverlayBinary() {
  try {
    const stat = await fs.stat(OVERLAY_BIN);
    if (stat.isFile() && stat.size > 0) {
      return;
    }
  } catch {
    // Fall through to build.
  }

  await execFileAsync("cargo", ["build", "--bin", "soupawhisper-overlay"], {
    cwd: TAURI_DIR,
  });
}

async function sha256ForFile(path: string) {
  const data = await fs.readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

async function assertFileExists(path: string) {
  const stat = await fs.stat(path);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Expected screenshot at ${path} to be a non-empty file`);
  }
  return stat;
}

async function getWindowIdForPid(pid: number): Promise<number | null> {
  const swiftScript = [
    "import Foundation",
    "import CoreGraphics",
    `let targetPid = Int32(${pid})`,
    "let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []",
    "for window in windows {",
    `  let ownerPid = window[kCGWindowOwnerPID as String] as? Int ?? -1`,
    `  let layer = window[kCGWindowLayer as String] as? Int ?? 0`,
    `  if Int32(ownerPid) != targetPid || layer < 0 { continue }`,
    `  if let bounds = window[kCGWindowBounds as String] as? [String: Any], let width = bounds["Width"] as? Double, let height = bounds["Height"] as? Double, width < 20 || height < 20 { continue }`,
    "  if let windowId = window[kCGWindowNumber as String] as? Int { print(windowId); break }",
    "}",
  ].join("\n");

  const { stdout } = await execFileAsync("swift", ["-e", swiftScript]);
  const id = stdout.trim();
  return id ? Number(id) : null;
}

async function waitForWindowId(pid: number, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const windowId = await getWindowIdForPid(pid);
    if (windowId) {
      return windowId;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for overlay window for pid ${pid}`);
}

export async function captureOverlayRegion(windowId: number, outputPath: string) {
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await execFileAsync("screencapture", ["-x", "-l", `${windowId}`, outputPath]);

  const stat = await assertFileExists(outputPath);
  const sha256 = await sha256ForFile(outputPath);

  return {
    path: outputPath,
    fileSize: stat.size,
    sha256,
  } satisfies CapturedOverlayImage;
}

export async function captureOverlayWindowForPid(
  pid: number,
  outputPath: string,
  {
    retries = 3,
    retryDelayMs = 180,
    waitForWindowId: waitForWindowIdImpl = waitForWindowId,
    captureOverlayRegion: captureOverlayRegionImpl = captureOverlayRegion,
    sleep: sleepImpl = sleep,
  }: Partial<CaptureRetryDependencies> & {
    retries?: number;
    retryDelayMs?: number;
  } = {},
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const windowId = await waitForWindowIdImpl(pid);
      return await captureOverlayRegionImpl(windowId, outputPath);
    } catch (error) {
      lastError = error;
      if (attempt === retries - 1) {
        break;
      }
      await sleepImpl(retryDelayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to capture overlay window for pid ${pid}`);
}

export async function createOverlayHarness(region: OverlayRegion): Promise<OverlayHarness> {
  if (process.platform !== "darwin") {
    throw new Error("Native overlay screenshot harness currently supports macOS only");
  }

  await ensureOverlayBinary();

  const overlay = spawn(OVERLAY_BIN, [], {
    cwd: TAURI_DIR,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (!overlay.stdin) {
    throw new Error("Failed to acquire stdin for overlay subprocess");
  }

  const send = async (command: string, settleMs = DEFAULT_SETTLE_MS) => {
    overlay.stdin!.write(`${command}\n`);
    await sleep(settleMs);
  };

  await sleep(BOOT_MS);
  await send(`pos ${region.x} ${region.y} ${region.width} ${region.height}`, 400);

  return {
    async captureTheme({ themeId, state, outputPath }: CaptureThemeOptions) {
      await send(`theme ${themeId}`, 300);
      await send(`show ${state}`, 300);

      if (state === "recording") {
        await send(`spectrum [${RECORDING_SPECTRUM.join(",")}]`, 80);
        for (const level of RECORDING_LEVELS) {
          await send(`level ${level.toFixed(2)}`, 35);
        }
        await send(`spectrum [${RECORDING_SPECTRUM.join(",")}]`, 40);
        await sleep(80);
      } else {
        await send(`level 0.06`, 80);
        await sleep(700);
      }

      const image = await captureOverlayWindowForPid(overlay.pid!, outputPath);
      await send("hide", 120);
      return image;
    },

    async close() {
      if (overlay.killed) {
        return;
      }

      await send("hide", 80);
      await send("quit", 80);

      await Promise.race([
        new Promise<void>((resolve) => overlay.once("close", () => resolve())),
        sleep(2000).then(() => {
          if (!overlay.killed) {
            overlay.kill("SIGKILL");
          }
        }),
      ]);
    },
  };
}
