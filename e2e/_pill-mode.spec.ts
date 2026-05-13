import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// These tests pin the HANDY family (mic icon + 9 bars + cancel) via
// the `?theme=handy` URL override — with the family router live, the
// default theme is winamp_classic (bars) and would not render the
// HandyPill grid these assertions describe.
test("idle mode renders TranscriptionIcon (handy family)", async ({ page }) => {
  await page.goto("/overlay.html?theme=handy");
  await page.waitForSelector(".recording-overlay");
  await mkdir("test-results/pill-mode", { recursive: true });
  await page.screenshot({ path: "test-results/pill-mode/idle.png" });
});

test("recording mode (URL forced) renders MicrophoneIcon + bars (handy family)", async ({ page }) => {
  await page.goto("/overlay.html?mode=recording&theme=handy");
  await page.waitForSelector(".recording-overlay");
  await expect(page.locator(".recording-overlay")).toHaveAttribute("data-mode", "recording");
  await page.screenshot({ path: "test-results/pill-mode/recording.png" });
  const barCount = await page.locator(".bar").count();
  expect(barCount).toBe(9);
});
