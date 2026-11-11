/**
 * Orb-family themes, in a REAL browser with real WebGL (SwiftShader in CI).
 *
 * jsdom cannot compile a shader, so the unit tests only prove the graceful
 * fallback. This is the gate that proves each ported Orbkit theme actually
 * compiles, draws, and reacts to the voice level — the same claim the
 * metaballs3d pulse spec makes for that theme.
 */
import { expect, test } from "@playwright/test";

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

const ORBS = ["orb_hydrogen", "orb_ion", "orb_nimbus", "orb_phosphor", "orb_dither"] as const;

for (const id of ORBS) {
  test(`${id}: compiles, draws, and reacts to the voice level`, async ({ page }) => {
    const warnings: string[] = [];
    const errors: string[] = [];
    page.on("console", (m) => {
      const text = m.text();
      if (m.type() === "warning") warnings.push(text);
      if (m.type() === "error") errors.push(text);
    });
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      // @ts-expect-error narrowing the overload for the test
      HTMLCanvasElement.prototype.getContext = function (type: string, attrs?: WebGLContextAttributes) {
        if (type === "webgl" || type === "experimental-webgl") {
          return orig.call(this, type, { ...(attrs || {}), preserveDrawingBuffer: true });
        }
        return orig.call(this, type, attrs as never);
      };
    });

    await page.goto(`/harness.html?theme=${id}&mode=recording&level=0.1&w=160&h=160&scale=1`);
    const host = page.getByTestId("theme-host");
    await expect(host).toBeVisible();
    const canvas = host.locator("canvas");
    await expect(canvas).toHaveAttribute("width", /\d+/);

    const measure = () =>
      canvas.evaluate((el: HTMLCanvasElement) => {
        const W = el.width, H = el.height;
        const scratch = document.createElement("canvas");
        scratch.width = W;
        scratch.height = H;
        const ctx = scratch.getContext("2d")!;
        ctx.drawImage(el, 0, 0);
        const d = ctx.getImageData(0, 0, W, H).data;
        let area = 0, sum = 0, rgb = 0;
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3];
          if (a > 40) { area++; sum += a; rgb += d[i] + d[i + 1] + d[i + 2]; }
        }
        // Some orbs (a full CRT screen, an LED wall) cover the whole square
        // with opaque pixels, so alpha area cannot move — the COLOUR must.
        return { area, meanAlpha: area ? sum / area : 0, meanRgb: area ? rgb / area : 0 };
      });

    // Let a few frames render; a black/blank canvas means the shader bailed.
    await expect.poll(async () => (await measure()).area, { timeout: 10_000 }).toBeGreaterThan(50);
    const quiet = await measure();

    await page.evaluate(() => {
      const el = document.querySelector('input[aria-label="Audio level"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, "0.95");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(600); // glide + a few frames
    const loud = await measure();

    expect(quiet.area, "the orb draws something at rest").toBeGreaterThan(50);
    // A voice-reactive orb must change with the level — area OR brightness.
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, b);
    const changed =
      rel(loud.area, quiet.area) > 0.03 ||
      rel(loud.meanAlpha, quiet.meanAlpha) > 0.03 ||
      rel(loud.meanRgb, quiet.meanRgb) > 0.03;
    expect(changed, `level change must alter the frame (${JSON.stringify({ quiet, loud })})`).toBe(true);

    expect(warnings.filter((w) => /shader compile failed|WebGL unavailable/.test(w))).toEqual([]);
    expect(errors).toEqual([]);
  });
}
