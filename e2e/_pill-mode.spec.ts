import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("idle mode renders TranscriptionIcon", async ({ page }) => {
  await page.goto("/overlay.html");
  await page.waitForSelector(".recording-overlay");
  await mkdir("test-results/pill-mode", { recursive: true });
  await page.screenshot({ path: "test-results/pill-mode/idle.png" });
});

test("recording mode (URL forced) renders MicrophoneIcon + bars", async ({ page }) => {
  await page.goto("/overlay.html?mode=recording");
  await page.waitForSelector(".recording-overlay");
  await expect(page.locator(".recording-overlay")).toHaveAttribute("data-mode", "recording");
  await page.screenshot({ path: "test-results/pill-mode/recording.png" });
  const barCount = await page.locator(".bar").count();
  expect(barCount).toBe(9);
});
