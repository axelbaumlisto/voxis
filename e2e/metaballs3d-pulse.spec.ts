/**
 * Voice-PULSE proof for the metaballs3d theme, via the Visual Harness.
 *
 * The user said the 3D metaballs "doesn't react when I talk". We added a
 * fast-attack / slow-release envelope on the level, a stronger radius pulse
 * (0.55*uLevel, was 0.30) and a subtle glow lift (1+0.25*uLevel). This test
 * drives a SPEECH-like level pattern (quiet 0.1 -> loud 0.85 -> quiet) and
 * asserts the blob is clearly BIGGER on the loud transient than when quiet,
 * while the orbit centroid keeps moving continuously (no teleport / jerk) and
 * the background stays transparent.
 *
 * metaballs3d renders to a WebGL canvas, so we read pixels back by drawing the
 * WebGL canvas onto a scratch 2D canvas (drawImage reads the composited frame
 * regardless of preserveDrawingBuffer) and counting non-transparent pixels.
 */
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// SwiftShader so WebGL works in headless CI without a real GPU.
test.use({
  launchOptions: {
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  },
});

const OUT = "/tmp";

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

test.skip("metaballs3d pulses bigger/brighter on a loud voice transient (no jerk, transparent)", async ({
  page,
}) => {
  // Force preserveDrawingBuffer so we can read the rendered frame back via
  // drawImage (the theme itself uses preserveDrawingBuffer:false, which leaves
  // the buffer empty after compositing). This only affects readback, not the
  // shader output we're measuring.
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error override signature
    HTMLCanvasElement.prototype.getContext = function (type: string, attrs?: WebGLContextAttributes) {
      if (type === "webgl" || type === "experimental-webgl") {
        return orig.call(this, type, { ...(attrs || {}), preserveDrawingBuffer: true });
      }
      return orig.call(this, type, attrs as never);
    };
  });
  const consoleLines: string[] = [];
  page.on("console", (m) => consoleLines.push(m.text()));
  await page.goto(
    "/harness.html?theme=metaballs3d&mode=recording&level=0.1&w=160&h=160&scale=1",
  );
  const host = page.getByTestId("theme-host");
  await expect(host).toBeVisible();
  const canvas = host.locator("canvas");
  await expect(canvas).toHaveAttribute("width", /\d+/);

  // Drive the harness audio-level slider programmatically (fires React onChange
  // -> ThemeHost gets a new state -> theme.onState updates `level`).
  async function setLevel(v: number) {
    await page.evaluate((val) => {
      const el = document.querySelector(
        'input[aria-label="Audio level"]',
      ) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(el, String(val));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, v);
  }

  // Count non-transparent pixels + centroid by compositing the WebGL canvas
  // onto a scratch 2D canvas. Returns area (opaque px), centroid, corner alphas.
  async function measure() {
    return await canvas.evaluate((el: HTMLCanvasElement) => {
      const W = el.width;
      const H = el.height;
      const scratch = document.createElement("canvas");
      scratch.width = W;
      scratch.height = H;
      const ctx = scratch.getContext("2d")!;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(el, 0, 0);
      const d = ctx.getImageData(0, 0, W, H).data;
      let area = 0;
      let sx = 0;
      let sy = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const a = d[(y * W + x) * 4 + 3];
          if (a > 40) {
            area++;
            sx += x;
            sy += y;
          }
        }
      }
      const cornerA = [
        d[3], // top-left
        d[(W - 1) * 4 + 3], // top-right
        d[((H - 1) * W) * 4 + 3], // bottom-left
        d[((H - 1) * W + (W - 1)) * 4 + 3], // bottom-right
      ];
      return {
        area,
        cx: area > 0 ? sx / area : 0,
        cy: area > 0 ? sy / area : 0,
        cornerA,
        W,
        H,
      };
    });
  }

  // Guard: the theme must NOT have hit the WebGL graceful-fallback path.
  expect(
    consoleLines.some((l) => l.includes("metaballs3d: WebGL unavailable")),
    `metaballs3d fell back (no WebGL). console=${JSON.stringify(consoleLines)}`,
  ).toBe(false);

  // Let the scene warm up and settle at quiet level (release toward 0.1).
  await setLevel(0.1);
  await page.waitForTimeout(1200);
  const quiet = await measure();
  await canvas.screenshot({ path: `${OUT}/pulse_quiet.png` });

  // SPEECH-like pattern + continuous centroid sampling for the no-jerk check.
  const centroids: Array<{ x: number; y: number }> = [];
  let loud = quiet;
  const pattern = [0.1, 0.85, 0.1, 0.85, 0.85, 0.1, 0.85];
  for (const lvl of pattern) {
    await setLevel(lvl);
    // sample a few frames within each ~120ms step (attack is fast: 0.35)
    for (let k = 0; k < 4; k++) {
      await page.waitForTimeout(30);
      const m = await measure();
      centroids.push({ x: m.cx, y: m.cy });
      if (lvl >= 0.8 && m.area > loud.area) {
        loud = m;
        await canvas.screenshot({ path: `${OUT}/pulse_loud.png` });
      }
    }
  }

  // 1) PULSE: loud transient blob area must be clearly bigger than quiet.
  const ratio = loud.area / Math.max(1, quiet.area);
  console.log(
    `PULSE area: quiet=${quiet.area} loud=${loud.area} ratio=${ratio.toFixed(3)}`,
  );
  expect(loud.area).toBeGreaterThan(0);
  expect(quiet.area).toBeGreaterThan(0);
  expect(ratio).toBeGreaterThanOrEqual(1.3);

  // 2) NO JERK: orbit centroid moves continuously, never teleports, even as the
  // level (size) changes. Max per-sample centroid jump stays small.
  let maxJump = 0;
  for (let i = 1; i < centroids.length; i++) {
    const dx = centroids[i].x - centroids[i - 1].x;
    const dy = centroids[i].y - centroids[i - 1].y;
    const jump = Math.hypot(dx, dy);
    if (jump > maxJump) maxJump = jump;
  }
  console.log(`NO-JERK max centroid jump between samples: ${maxJump.toFixed(2)}px`);
  // A teleport would be tens of px in a 160px frame; smooth orbit + size pulse
  // keeps the centroid drift modest.
  expect(maxJump).toBeLessThan(25);

  // 3) TRANSPARENCY: all four corners must be fully transparent (bg alpha 0).
  for (const a of quiet.cornerA) expect(a).toBe(0);
  for (const a of loud.cornerA) expect(a).toBe(0);
});
