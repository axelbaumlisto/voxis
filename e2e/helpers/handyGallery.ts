/**
 * Helpers for the live Handy-theme gallery e2e suite.
 *
 * SRP/DRY: each helper does one thing; nothing here is duplicated from
 * `captureScreen.ts` — we re-use `captureWindowDirect` and `diffPixelCount`.
 *
 * KISS: zero abstractions over Tauri events / screencapture / PIL.
 *       Tests call these directly; helpers shell out to `python3` and
 *       `screencapture` so we don't pull in pngjs / pixelmatch / sharp.
 *
 * Three classes of helper:
 *   1) Theme + state drivers — call Tauri commands by name through the
 *      voice process (works because debug commands always emit, no
 *      orchestrator gating).
 *   2) Frame capture + animation utilities — sequence of PNGs +
 *      optional GIF rendering through PIL.
 *   3) Palette-aware pixel counters — distinguish "this looks like
 *      living_reed" from "this looks like neon" purely by counting
 *      pixels close to the theme's icon_color.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { captureWindowDirect } from "./captureScreen";

const execFileAsync = promisify(execFile);

// ---------- 1) Theme + state drivers ----------

/**
 * Tauri command invocation against a running voice process via the
 * built-in `tauri-cli` JS shim is NOT available outside the webview.
 * Instead, we emit the same events via a tiny Tauri-app trick: we
 * dispatch them through the dev-mode webview by `evaluate`-ing inside
 * Playwright. For NSPanel-backed runs we drive Tauri via a
 * Node-side IPC bridge…
 *
 * Simplest reliable path: just call the commands through a Playwright
 * tab opened against `/?` (the SoupaWhisper main window). It mounts
 * Tauri's runtime so `window.__TAURI_INTERNALS__.invoke()` works.
 *
 * To avoid coupling the gallery spec to the main UI, we keep this
 * helper invocation-agnostic: the caller passes a `page` already on
 * `/` (or anywhere with Tauri runtime active) and we call invoke
 * inside it.
 */
export async function setHandyTheme(
  page: import("@playwright/test").Page,
  themeId: string,
): Promise<void> {
  await page.evaluate(async (id: string) => {
    // @ts-expect-error window typing for Tauri runtime
    return window.__TAURI_INTERNALS__.invoke("debug_set_handy_theme", {
      themeId: id,
    });
  }, themeId);
}

export async function debugSetOverlayState(
  page: import("@playwright/test").Page,
  state: "idle" | "recording" | "transcribing" | "error",
): Promise<void> {
  await page.evaluate(async (s: string) => {
    // @ts-expect-error window typing
    return window.__TAURI_INTERNALS__.invoke("debug_set_overlay_state", {
      state: s,
    });
  }, state);
}

export async function debugEmitSpectrum(
  page: import("@playwright/test").Page,
  bins: number[],
): Promise<void> {
  await page.evaluate(async (b: number[]) => {
    // @ts-expect-error
    return window.__TAURI_INTERNALS__.invoke("debug_emit_spectrum", { bins: b });
  }, bins);
}

export async function debugEmitSilence(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(async () => {
    // @ts-expect-error
    return window.__TAURI_INTERNALS__.invoke("debug_emit_silence");
  });
}

/** Build a synthetic peak bin array — uniform high spectrum. */
export function peakBins(level = 0.9, count = 32): number[] {
  return Array.from({ length: count }, () => level);
}

// ---------- 2) Frame capture + animation ----------

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
 *   frame_duration_ms: per-frame display time in the GIF
 */
export async function saveGif(
  frames: string[],
  out: string,
  frame_duration_ms = 500,
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
        pass  # skip missing/corrupt frames
if imgs:
    imgs[0].save(
        ${JSON.stringify(out)},
        save_all=True,
        append_images=imgs[1:],
        duration=${frame_duration_ms},
        loop=0,
        disposal=2,
    )
`;
  await execFileAsync("python3", ["-c", py]);
}

// ---------- 3) Palette-aware pixel counters ----------

/**
 * Count pixels in `png` whose RGB is within `tolerance` of the given
 * target color. Tolerance is per-channel.
 */
export async function countMatchingPixels(
  png: string,
  r: number,
  g: number,
  b: number,
  tolerance = 14,
): Promise<number> {
  const py = `
from PIL import Image
img = Image.open(${JSON.stringify(png)}).convert("RGBA")
n = 0
for (R, G, B, A) in img.getdata():
    if A < 32: continue
    if abs(R-${r}) <= ${tolerance} and abs(G-${g}) <= ${tolerance} and abs(B-${b}) <= ${tolerance}:
        n += 1
print(n)
`;
  const { stdout } = await execFileAsync("python3", ["-c", py]);
  return parseInt(stdout.trim(), 10);
}

/**
 * Parse a hex color "#RRGGBB" or "#RGB" → {r, g, b}. Lowercase, throws
 * on invalid input.
 */
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

/**
 * Overlay PIL-diff (red where pixels differ by > threshold).
 * Useful for visual diff artefacts in PR attachments.
 */
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

// ---------- 4) HTML gallery builder ----------

export interface GalleryEntry {
  theme: string;
  frames: { label: string; path: string }[];
  gifs?: { label: string; path: string }[];
}

/**
 * Render a self-contained `index.html` in the gallery dir that shows
 * one row per theme, columns = frames + gifs. Used by the
 * globalTeardown to summarise live screenshots in a single artefact.
 */
export async function buildGalleryIndexHtml(
  galleryDir: string,
  entries: GalleryEntry[],
): Promise<void> {
  const rows = entries
    .map((e) => {
      const cells = [
        `<td class="label">${e.theme}</td>`,
        ...e.frames.map(
          (f) =>
            `<td class="frame"><div class="cap">${f.label}</div><img src="${f.path.replace(galleryDir + "/", "")}" alt="${f.label}"/></td>`,
        ),
        ...(e.gifs ?? []).map(
          (g) =>
            `<td class="frame"><div class="cap">${g.label}</div><img src="${g.path.replace(galleryDir + "/", "")}" alt="${g.label}"/></td>`,
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
<h1>Handy themes — live screenshot gallery</h1>
<table>
${rows}
</table>
</body></html>`;
  await writeFile(`${galleryDir}/index.html`, html);
}

// ---------- 5) Spawn a Playwright-driven Tauri runtime tab ----------

// Re-export the lower-level screencapture helper for convenience.
export { captureWindowDirect } from "./captureScreen";

// Silence unused-import warning on spawn (kept for future PID utilities).
void spawn;
