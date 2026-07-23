// Capture a CLEAN overlay showcase image (no harness debug chrome) for the
// landing/docs "Recording overlay" tile.
//
// Why this exists: the harness page renders the overlay next to scenario
// buttons + a "Params JSON" panel; a naive full-page/element screenshot bakes
// that debug chrome into the image (the old overlay-theme.png did exactly
// that). This reads the theme CANVAS BACKBUFFER directly via toDataURL — which
// is chrome-free by construction — picks the brightest animated frame, then
// composites it (in-browser, on a <canvas>) onto the same near-black
// background the showcase tiles use, and exports the final tile.
//
// KISS: one job, driven entirely by the harness URL-preset API
// (?theme&mode&level&w&h) so there are no brittle UI clicks; compositing uses
// the browser's own canvas so there are ZERO extra npm deps. DRY: reuses the
// harness rather than re-implementing theme rendering.
//
// Usage (harness must be running on :5173 — `bun run harness`):
//   node scripts/capture-overlay-shot.mjs --out /abs/path.png \
//        [--theme radiolarian] [--mode recording] [--level 0.8] \
//        [--w 640] [--h 360] [--frames 16] [--scale 1.9] \
//        [--tileW 1280] [--tileH 720]
import { chromium } from "playwright";
import fs from "fs";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const OUT = arg("out", null);
if (!OUT) {
  console.error("ERROR: --out <path.png> is required");
  process.exit(2);
}
const THEME = arg("theme", "radiolarian");
const MODE = arg("mode", "recording");
const LEVEL = arg("level", "0.8");
const W = arg("w", "640");
const H = arg("h", "360");
const FRAMES = Number(arg("frames", "16"));
const SCALE = Number(arg("scale", "1.9"));
const BASE = arg("base", "http://localhost:5173");
const TILE_W = Number(arg("tileW", "1280")); // matches the other showcase tiles
const TILE_H = Number(arg("tileH", "720"));
const BG = arg("bg", "#0a0a0c"); // near-black, same as the bg-black tile frame

const url = `${BASE}/harness.html?theme=${THEME}&mode=${MODE}&level=${LEVEL}&w=${W}&h=${H}`;

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ colorScheme: "dark", deviceScaleFactor: 2 })).newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
// Drive an active "steady speech" animation for a lively frame.
await page.getByRole("button", { name: /Steady speech/i }).click().catch(() => {});

// Grab the brightest of N canvas-backbuffer frames (chrome-free by construction).
let best = null;
let bestMean = -1;
for (let i = 0; i < FRAMES; i++) {
  await page.waitForTimeout(170);
  const r = await page.evaluate(() => {
    const c = document.querySelector("[data-testid=theme-preview] canvas");
    if (!c) return null;
    let mean = 0;
    try {
      const g = c.getContext("2d");
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2];
      mean = s / ((d.length / 4) * 3);
    } catch { /* WebGL themes are not readable this way */ }
    return { url: c.toDataURL("image/png"), mean };
  });
  if (r && r.mean > bestMean) {
    bestMean = r.mean;
    best = r;
  }
}

if (!best || bestMean < 10) {
  await browser.close();
  console.error(
    `ERROR: canvas produced no visible content (mean=${bestMean?.toFixed(1)}). ` +
      `Theme "${THEME}" may be WebGL (unreadable) or needs a different level/size.`,
  );
  process.exit(1);
}

// Composite in-browser: draw the transparent frame centered+scaled onto a
// dark-filled tile canvas, then export. No native image deps.
const composited = await page.evaluate(
  async ({ dataUrl, tileW, tileH, scale, bg }) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = dataUrl;
    });
    const c = document.createElement("canvas");
    c.width = tileW;
    c.height = tileH;
    const g = c.getContext("2d");
    g.fillStyle = bg;
    g.fillRect(0, 0, tileW, tileH);
    const sw = img.width * scale;
    const sh = img.height * scale;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, (tileW - sw) / 2, (tileH - sh) / 2, sw, sh);
    return c.toDataURL("image/png");
  },
  { dataUrl: best.url, tileW: TILE_W, tileH: TILE_H, scale: SCALE, bg: BG },
);
await browser.close();

fs.writeFileSync(OUT, Buffer.from(composited.split(",")[1], "base64"));
console.log(`OK: ${OUT} (${TILE_W}x${TILE_H}, theme=${THEME}, frame mean=${bestMean.toFixed(1)})`);
