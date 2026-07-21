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

  // Regression: verify the harness + macOS draw pipeline produces visible output
  // for at least one theme. Uses winamp_classic (Bars family), which is known to
  // render in the current overlay binary build.
  //
  // SOLID/KISS: a single positive assertion documents the working baseline. If
  // this test starts failing the harness itself is broken (vs theme-specific issues).
  // eslint-disable-next-line no-empty-pattern
  test("captures non-blank screenshot for winamp_classic baseline", async ({}, testInfo) => {
    const outputDir = testInfo.outputPath("baseline");

    const result = await harness.captureTheme({
      themeId: "winamp_classic",
      state: "recording",
      outputPath: `${outputDir}/winamp_classic.png`,
    });

    // Empty/transparent PNGs encode to ~1700 bytes for 400x100. Real content is
    // multiple KB. Use 5000 as a conservative threshold.
    expect(result.fileSize).toBeGreaterThan(5000);
  });

  // Regression coverage for native overlay organic theme fixes.
  // - theme.rs::organic_template + 3 distinct builtins (different shape + colors)
  // - bundled themes/<id>/theme.json updated to match
  // - convert_theme_file now parses file.organic_ring (was always None → blank)
  // Each captured PNG must be non-blank (>5KB) and have a distinct hash.
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

    // Non-blank threshold: empty 400x100 PNGs encode to ~1700 bytes. After
    // the organic_ring loader fix, even quiet_reed (thin stroke, wide gap)
    // produces ~4 KB; living_reed and drifting_contour produce much more.
    // 3000 reliably separates blank from rendered.
    expect(quietReed.fileSize).toBeGreaterThan(3000);
    expect(livingReed.fileSize).toBeGreaterThan(3000);
    expect(driftingContour.fileSize).toBeGreaterThan(3000);

    expect(quietReed.sha256).not.toBe(livingReed.sha256);
    expect(quietReed.sha256).not.toBe(driftingContour.sha256);
    expect(livingReed.sha256).not.toBe(driftingContour.sha256);
  });

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

    expect(recording.fileSize).toBeGreaterThan(3000);
    expect(transcribing.fileSize).toBeGreaterThan(3000);
    expect(recording.sha256).not.toBe(transcribing.sha256);
  });

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

    expect(first.fileSize).toBeGreaterThan(3000);
    expect(second.fileSize).toBeGreaterThan(3000);
    expect(first.sha256).not.toBe(second.sha256);
  });
});
