import { test, expect } from "@playwright/test";
import { createOverlayHarness, type OverlayHarness } from "./helpers/nativeOverlay";

test.describe.configure({ mode: "serial" });

// Native overlay harness requires macOS (screencapture + Swift + native binary)
test.describe("Native overlay organic themes", () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(process.platform !== "darwin", "Native overlay harness requires macOS");
  test.setTimeout(180_000);
  let harness: OverlayHarness;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    harness = await createOverlayHarness({
      x: 140,
      y: 140,
      width: 400,
      height: 100,
    });
  });

  test.afterAll(async () => {
    await harness?.close();
  });

  // Playwright requires the first callback argument to stay an object destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  test("captures distinct organic theme screenshots in recording state", async ({}, testInfo) => {
    const outputDir = testInfo.outputPath("organic-recording");

    const quietReed = await harness.captureTheme({
      themeId: "quiet_reed",
      state: "recording",
      outputPath: `${outputDir}/quiet_reed.png`,
    });
    const livingReed = await harness.captureTheme({
      themeId: "living_reed",
      state: "recording",
      outputPath: `${outputDir}/living_reed.png`,
    });
    const driftingContour = await harness.captureTheme({
      themeId: "drifting_contour",
      state: "recording",
      outputPath: `${outputDir}/drifting_contour.png`,
    });

    expect(quietReed.fileSize).toBeGreaterThan(0);
    expect(livingReed.fileSize).toBeGreaterThan(0);
    expect(driftingContour.fileSize).toBeGreaterThan(0);

    expect(quietReed.sha256).not.toBe(livingReed.sha256);
    expect(quietReed.sha256).not.toBe(driftingContour.sha256);
    expect(livingReed.sha256).not.toBe(driftingContour.sha256);
  });

  // Playwright requires the first callback argument to stay an object destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  test("captures distinct recording and transcribing screenshots for living_reed", async ({}, testInfo) => {
    const outputDir = testInfo.outputPath("living-reed-states");

    const recording = await harness.captureTheme({
      themeId: "living_reed",
      state: "recording",
      outputPath: `${outputDir}/living_reed_recording.png`,
    });
    const transcribing = await harness.captureTheme({
      themeId: "living_reed",
      state: "transcribing",
      outputPath: `${outputDir}/living_reed_transcribing.png`,
    });

    expect(recording.fileSize).toBeGreaterThan(0);
    expect(transcribing.fileSize).toBeGreaterThan(0);
    expect(recording.sha256).not.toBe(transcribing.sha256);
  });

  // Playwright requires the first callback argument to stay an object destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  test("captures changing transcribing pulse frames for living_reed", async ({}, testInfo) => {
    const outputDir = testInfo.outputPath("living-reed-transcribing-pulse");

    const first = await harness.captureTheme({
      themeId: "living_reed",
      state: "transcribing",
      outputPath: `${outputDir}/living_reed_transcribing_1.png`,
    });
    const second = await harness.captureTheme({
      themeId: "living_reed",
      state: "transcribing",
      outputPath: `${outputDir}/living_reed_transcribing_2.png`,
    });

    expect(first.fileSize).toBeGreaterThan(0);
    expect(second.fileSize).toBeGreaterThan(0);
    expect(first.sha256).not.toBe(second.sha256);
  });
});
