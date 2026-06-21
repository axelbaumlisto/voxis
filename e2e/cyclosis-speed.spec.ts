import { test, expect } from "@playwright/test";

test("interior granules must not move more than 2px per 100ms in idle", async ({ page }) => {
  await page.goto("/harness.html?theme=drifting_contour&mode=idle&level=0&w=420&h=420&scale=1");
  const cv = page.getByTestId("theme-host").locator("canvas");
  await expect(cv).toHaveAttribute("width", "420");
  await page.waitForTimeout(2000); // let sim settle

  // Collect 11 snapshots of bright-pixel positions, 100ms apart
  const snapshots: { cx: number; cy: number; spots: { x: number; y: number }[] }[] = [];

  for (let i = 0; i < 11; i++) {
    const snap = await page.evaluate(() => {
      const canvas = document.querySelector("canvas")!;
      const ctx = canvas.getContext("2d")!;
      const img = ctx.getImageData(0, 0, 420, 420).data;

      // cell centroid (all non-black pixels)
      let sx = 0, sy = 0, cnt = 0;
      for (let y = 0; y < 420; y++)
        for (let x = 0; x < 420; x++) {
          const b = img[(y * 420 + x) * 4] + img[(y * 420 + x) * 4 + 1] + img[(y * 420 + x) * 4 + 2];
          if (b > 50) { sx += x; sy += y; cnt++; }
        }
      const cx = cnt ? sx / cnt : 210;
      const cy = cnt ? sy / cnt : 210;

      // collect bright interior pixels (granules + vacuoles)
      const spots: { x: number; y: number; b: number }[] = [];
      for (let y = 0; y < 420; y++)
        for (let x = 0; x < 420; x++) {
          const idx = (y * 420 + x) * 4;
          const b = img[idx] + img[idx + 1] + img[idx + 2];
          const dist = Math.hypot(x - cx, y - cy);
          if (b > 120 && dist > 3 && dist < 12) spots.push({ x, y, b });
        }
      spots.sort((a, b) => b.b - a.b);
      return { cx, cy, spots: spots.slice(0, 30).map((s) => ({ x: s.x, y: s.y })) };
    });
    snapshots.push(snap);
    if (i < 10) await page.waitForTimeout(100);
  }

  // For every consecutive pair, match nearest spots and measure displacement
  const displacements: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    for (const cp of curr.spots) {
      let best = Infinity;
      for (const pp of prev.spots) {
        const d = Math.hypot(cp.x - pp.x, cp.y - pp.y);
        if (d < best) best = d;
      }
      if (best < 20) displacements.push(best);
    }
  }

  const avgDisplacement = displacements.reduce((a, b) => a + b, 0) / displacements.length;
  const maxDisplacement = Math.max(...displacements);

  console.log(`Frames: ${snapshots.length}, matched pairs: ${displacements.length}`);
  console.log(`Avg displacement per 100ms: ${avgDisplacement.toFixed(2)}px (= ${(avgDisplacement * 10).toFixed(0)}px/s)`);
  console.log(`Max displacement per 100ms: ${maxDisplacement.toFixed(2)}px`);
  console.log(`Cell radius: ~17px, full circumference: ~107px`);
  console.log(`Avg angular speed: ~${((avgDisplacement * 10) / 107 * 360).toFixed(0)}°/s`);
  console.log(`Full revolution: ~${(107 / (avgDisplacement * 10)).toFixed(0)}s`);

  // ASSERT: interior must look calm
  // 0.5px/100ms = 5px/s ≈ 17°/s = 1 rev per ~21s — visually stable
  expect(avgDisplacement).toBeLessThan(0.5);
});
