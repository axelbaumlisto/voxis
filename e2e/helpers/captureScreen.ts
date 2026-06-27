/**
 * Screen capture helpers \u2014 always axiomatic: it is possible to capture pill
 * pixels. If a capture returns blank, that is a bug in the app, not in this
 * code. We pin the technique to fullscreen `screencapture -x` then crop with
 * `sips`, because that is what the user's `clipshot` toolchain already proves
 * works for our overlay pill window.
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

/**
 * Direct window capture via `screencapture -l <wid>` — produces a tighter
 * PNG (no surrounding desktop) which is more sensitive for pixel diffing
 * the pill content.
 */
export async function captureWindowDirect(
  windowId: number,
  outPng: string,
): Promise<{ bytes: number; cropPath: string }> {
  await mkdir(dirname(outPng), { recursive: true });
  await execFileAsync("screencapture", [
    "-x",
    "-l",
    String(windowId),
    outPng,
  ]);
  const st = await stat(outPng);
  return { bytes: st.size, cropPath: outPng };
}

/**
 * Count non-background pixels in a PNG using Python+PIL. The pill
 * background is dark gray (~30,30,30); content (icons + bars) is much
 * lighter (pink/white). Returns the number of pixels brighter than
 * `threshold` in any RGB channel.
 */
export async function countLightPixels(
  png: string,
  threshold = 80,
): Promise<number> {
  const py = `
from PIL import Image
img = Image.open(${JSON.stringify(png)}).convert("RGBA")
count = 0
for (r,g,b,a) in img.getdata():
    if a < 32: continue
    if r > ${threshold} or g > ${threshold} or b > ${threshold}:
        count += 1
print(count)
`;
  const { stdout } = await execFileAsync("python3", ["-c", py]);
  return parseInt(stdout.trim(), 10);
}

/**
 * Perceptual pixel diff: count pixels where (r,g,b) differ between two
 * PNGs by more than `threshold` summed across channels. The two PNGs
 * must be the same dimensions; if not, returns -1.
 */
export async function diffPixelCount(
  a: string,
  b: string,
  threshold = 30,
): Promise<number> {
  const py = `
from PIL import Image
ia = Image.open(${JSON.stringify(a)}).convert("RGBA")
ib = Image.open(${JSON.stringify(b)}).convert("RGBA")
if ia.size != ib.size:
    print(-1)
else:
    da, db = list(ia.getdata()), list(ib.getdata())
    diff = 0
    for (r1,g1,b1,_),(r2,g2,b2,_) in zip(da, db):
        if abs(r1-r2) + abs(g1-g2) + abs(b1-b2) > ${threshold}:
            diff += 1
    print(diff)
`;
  const { stdout } = await execFileAsync("python3", ["-c", py]);
  return parseInt(stdout.trim(), 10);
}
