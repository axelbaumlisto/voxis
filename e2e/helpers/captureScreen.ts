/**
 * Screen capture helpers \u2014 always axiomatic: it is possible to capture pill
 * pixels. If a capture returns blank, that is a bug in the app, not in this
 * code. We pin the technique to fullscreen `screencapture -x` then crop with
 * `sips`, because that is what the user's `clipshot` toolchain already proves
 * works for our NSPanel.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

const execFileAsync = promisify(execFile);

export interface PillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function captureFullScreen(outPng: string): Promise<void> {
  await mkdir(dirname(outPng), { recursive: true });
  await execFileAsync("screencapture", ["-x", outPng]);
}

export async function cropFromFullScreen(
  srcPng: string,
  rect: PillRect,
  outPng: string,
): Promise<{ bytes: number }> {
  await mkdir(dirname(outPng), { recursive: true });
  await execFileAsync("sips", [
    "--cropOffset",
    String(rect.y),
    String(rect.x),
    "-c",
    String(rect.height),
    String(rect.width),
    srcPng,
    "--out",
    outPng,
  ]);
  const st = await stat(outPng);
  return { bytes: st.size };
}

/**
 * One-shot helper: capture full screen, crop to pill bounds, return bytes
 * + path. Use in tests to assert non-blank content.
 */
export async function captureFullScreenPillCrop(
  rect: PillRect,
  outPng: string,
): Promise<{ bytes: number; fullPath: string; cropPath: string }> {
  const full = outPng.replace(/\.png$/, "-full.png");
  await captureFullScreen(full);
  const { bytes } = await cropFromFullScreen(full, rect, outPng);
  return { bytes, fullPath: full, cropPath: outPng };
}
