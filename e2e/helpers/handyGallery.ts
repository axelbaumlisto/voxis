/**
 * Helpers for the live Handy-theme gallery e2e suite.
 *
 * Three driver categories:
 *  1) Socket-based command driver (sends JSON-RPC to the running voice
 *     process via $APP_CONFIG/com.soupawhisper.voice/debug.sock).
 *  2) Frame capture + animation utilities (uses `screencapture` and
 *     Python+PIL through `execFile` — no extra npm deps).
 *  3) Palette-aware pixel counters + HTML gallery builder.
 *
 * SOLID/DRY/KISS:
 *  - SRP: each function does one thing; nothing duplicates `captureScreen.ts`.
 *  - DIP: tests depend on these helpers, not on Tauri/Playwright internals.
 *  - DRY: socket path + command shape match `setup/debug_socket.rs`.
 *  - KISS: net.createConnection over a Unix socket; no MessagePack / WS.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { createConnection } from "node:net";

import { captureWindowDirect } from "./captureScreen";

const execFileAsync = promisify(execFile);

// ============================================================================
// 1) Socket driver — talk to voice's debug RPC
// ============================================================================

/**
 * Resolve the path to `debug.sock` for the current platform. Matches the
 * Tauri `app_config_dir()` resolution in `setup/debug_socket.rs`.
 */
export function debugSocketPath(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      "com.soupawhisper.voice",
      "debug.sock",
    );
  }
  // Linux / others
  return join(home, ".config", "soupawhisper", "debug.sock");
}

/**
 * Send one JSON-RPC message to the debug socket and wait for the reply.
 * Returns the parsed `{ok, error?}` response.
 */
export async function rpcCall(
  payload: unknown,
  timeoutMs = 2000,
): Promise<{ ok: boolean; error?: string }> {
  const path = debugSocketPath();
  return new Promise((resolve, reject) => {
    const client = createConnection(path);
    let buffer = "";
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error(`debug socket rpc timeout after ${timeoutMs} ms`));
    }, timeoutMs);
    client.on("connect", () => {
      client.write(`${JSON.stringify(payload)}\n`);
    });
    client.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const nl = buffer.indexOf("\n");
      if (nl >= 0) {
        clearTimeout(timer);
        const line = buffer.slice(0, nl);
        client.destroy();
        try {
          resolve(JSON.parse(line));
        } catch (e) {
          reject(new Error(`bad reply: ${line} (${e})`));
        }
      }
    });
    client.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new Error(
          `debug socket connect failed (${e.message}); ` +
            `is voice running in debug mode? expected ${path}`,
        ),
      );
    });
  });
}

export async function setHandyTheme(themeId: string): Promise<void> {
  const r = await rpcCall({ cmd: "set_handy_theme", theme: themeId });
  if (!r.ok) throw new Error(`set_handy_theme(${themeId}): ${r.error}`);
}

export async function setOverlayState(
  state: "hidden" | "idle" | "recording" | "transcribing",
): Promise<void> {
  const r = await rpcCall({ cmd: "set_overlay_state", state });
  if (!r.ok) throw new Error(`set_overlay_state(${state}): ${r.error}`);
}

export async function emitSpectrum(bins: number[]): Promise<void> {
  const r = await rpcCall({ cmd: "emit_spectrum", bins });
  if (!r.ok) throw new Error(`emit_spectrum: ${r.error}`);
}

export async function emitSilence(): Promise<void> {
  const r = await rpcCall({ cmd: "emit_silence" });
  if (!r.ok) throw new Error(`emit_silence: ${r.error}`);
}

/** Build a synthetic peak bin array — uniform high spectrum. */
export function peakBins(level = 0.9, count = 32): number[] {
  return Array.from({ length: count }, () => level);
}

// ============================================================================
// 2) Frame capture + animation
// ============================================================================

/**
 * Capture `count` PNGs of `windowId` spaced `intervalMs` apart.
 * Returns the list of file paths written.
 */
export async function captureFrames(
  windowId: number,
  outDir: string,
  prefix: string,
  count: number,
  intervalMs: number,
): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const p = `${outDir}/${prefix}-${String(i).padStart(2, "0")}.png`;
    try {
      await captureWindowDirect(windowId, p);
    } catch {
      // Some compositors momentarily lose the window during transitions;
      // skip the frame rather than failing the whole sequence.
    }
    paths.push(p);
    if (i + 1 < count) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return paths;
}

/**
 * Combine PNG frames into an animated GIF via Python+PIL.
 *   frameDurationMs: per-frame display time in the GIF
 */
export async function saveGif(
  frames: string[],
  out: string,
  frameDurationMs = 500,
): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const framesJson = JSON.stringify(frames);
  const py = `
from PIL import Image
paths = ${framesJson}
imgs = []
for p in paths:
    try:
        imgs.append(Image.open(p).convert("RGBA"))
    except Exception:
        pass
if imgs:
    imgs[0].save(
        ${JSON.stringify(out)},
        save_all=True,
        append_images=imgs[1:],
        duration=${frameDurationMs},
        loop=0,
        disposal=2,
    )
`;
  await execFileAsync("python3", ["-c", py]);
}

// ============================================================================
// 3) Palette-aware pixel counters + HTML gallery
// ============================================================================

/**
 * Count pixels in `png` whose RGB is "close to" (r, g, b) by Euclidean
 * distance. `tolerance` is the maximum squared distance for a match
 * (default 80**2 = 6400 — catches most anti-aliased edges of the target
 * hue while excluding wallpaper colours and other themes).
 *
 * Why Euclidean instead of per-channel:
 *  - Anti-aliased SVGs produce pixels that mix the target with the
 *    surrounding (white wallpaper / dark backdrop). Per-channel diff
 *    of e.g. 30 in G is normal even though the pixel is clearly the
 *    target hue. Euclidean distance handles this naturally because
 *    distance is small even when one channel is heavily mixed.
 *  - Example: neon target (255, 0, 255). Anti-aliased rendition
 *    (224, 48, 240) — per-channel max diff 48 (FAIL @ tolerance 36);
 *    Euclidean distance √(31² + 48² + 15²) = √3490 = 59 (PASS @ 80).
 */
export async function countMatchingPixels(
  png: string,
  r: number,
  g: number,
  b: number,
  tolerance = 80,
): Promise<number> {
  const py = `
from PIL import Image
img = Image.open(${JSON.stringify(png)}).convert("RGBA")
tol2 = ${tolerance * tolerance}
n = 0
for (R, G, B, A) in img.getdata():
    if A < 32: continue
    d2 = (R-${r})*(R-${r}) + (G-${g})*(G-${g}) + (B-${b})*(B-${b})
    if d2 <= tol2:
        n += 1
print(n)
`;
  const { stdout } = await execFileAsync("python3", ["-c", py]);
  return parseInt(stdout.trim(), 10);
}

/**
 * Count opaque pixels that are NOT background-white (i.e. any visible
 * theme color). Used for the bars-family idle assertion where the
 * gradient at 2px min height is anti-aliased through all three stops
 * and the resulting hue can't be matched against a specific reference.
 *
 * "Non-white" = max RGB channel < 240 (anything reasonably saturated).
 */
export async function countOpaqueNonWhitePixels(png: string): Promise<number> {
  const py = `
from PIL import Image
img = Image.open(${JSON.stringify(png)}).convert("RGBA")
n = 0
for (R, G, B, A) in img.getdata():
    if A < 32: continue
    if R >= 240 and G >= 240 and B >= 240: continue
    n += 1
print(n)
`;
  const { stdout } = await execFileAsync("python3", ["-c", py]);
  return parseInt(stdout.trim(), 10);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "").toLowerCase();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  throw new Error(`hexToRgb: cannot parse '${hex}'`);
}

export async function saveDiffOverlay(
  a: string,
  b: string,
  out: string,
  threshold = 30,
): Promise<{ diffPixels: number }> {
  await mkdir(dirname(out), { recursive: true });
  const py = `
from PIL import Image
ia = Image.open(${JSON.stringify(a)}).convert("RGBA")
ib = Image.open(${JSON.stringify(b)}).convert("RGBA")
W, H = ia.size
diff = Image.new("RGBA", (W, H))
count = 0
da, db = ia.load(), ib.load()
out = diff.load()
for y in range(H):
    for x in range(W):
        r1,g1,b1,a1 = da[x, y]
        r2,g2,b2,a2 = db[x, y]
        d = abs(r1-r2) + abs(g1-g2) + abs(b1-b2)
        if d > ${threshold}:
            count += 1
            out[x, y] = (255, 0, 0, 255)
        else:
            avg = ((r1+r2)//4, (g1+g2)//4, (b1+b2)//4, 192)
            out[x, y] = avg
diff.save(${JSON.stringify(out)})
print(count)
`;
  const { stdout } = await execFileAsync("python3", ["-c", py]);
  return { diffPixels: parseInt(stdout.trim(), 10) };
}

export interface GalleryEntry {
  theme: string;
  frames: { label: string; path: string }[];
  gifs?: { label: string; path: string }[];
}

export async function buildGalleryIndexHtml(
  galleryDir: string,
  entries: GalleryEntry[],
): Promise<void> {
  const rel = (p: string) => p.replace(`${galleryDir}/`, "");
  const rows = entries
    .map((e) => {
      const cells = [
        `<td class="label">${e.theme}</td>`,
        ...e.frames.map(
          (f) =>
            `<td class="frame"><div class="cap">${f.label}</div><img src="${rel(f.path)}" alt="${f.label}"/></td>`,
        ),
        ...(e.gifs ?? []).map(
          (g) =>
            `<td class="frame"><div class="cap">${g.label}</div><img src="${rel(g.path)}" alt="${g.label}"/></td>`,
        ),
      ];
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("\n");
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Handy theme live gallery</title>
<style>
  body { font: 12px/1.4 -apple-system, sans-serif; background: #1a1a1a; color: #ddd; margin: 16px; }
  table { border-collapse: collapse; }
  td { padding: 4px 8px; vertical-align: top; }
  td.label { font-weight: 600; white-space: nowrap; text-transform: capitalize; color: #fff; }
  td.frame { background: #222; border: 1px solid #444; }
  td.frame img { display: block; max-width: 220px; image-rendering: pixelated; }
  .cap { color: #999; font-size: 10px; margin-bottom: 2px; }
  h1 { margin-top: 0; font-weight: 400; }
</style></head>
<body>
<h1>Handy themes — live screenshot gallery (${entries.length} themes)</h1>
<table>
${rows}
</table>
</body></html>`;
  await writeFile(`${galleryDir}/index.html`, html);
}

// Re-export the lower-level screencapture helper for convenience.
export { captureWindowDirect } from "./captureScreen";
