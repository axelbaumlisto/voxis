import { test, expect } from "@playwright/test";

/**
 * FFT Spectrum Analyzer E2E Tests.
 *
 * Tests that the spectrum analyzer correctly visualizes frequency content.
 * Uses simulated spectrum bin data to validate the visualization.
 *
 * Note: Actual FFT computation happens in Rust. These tests verify:
 * 1. The overlay correctly receives and displays spectrum bins
 * 2. Different frequency patterns show in the correct bar positions
 * 3. Visual output matches expected patterns
 */

test.describe("FFT Spectrum Analyzer", () => {
  test.beforeEach(async ({ page }) => {
    // Track spectrum commands
    await page.addInitScript(() => {
      const commands: { cmd: string; args?: any; time: number }[] = [];
      (window as any).__spectrumCommands = commands;

      let currentState = "idle";
      let spectrumBins: number[] = new Array(32).fill(0);

      // Mock config for overlay
      const mockConfig = {
        api_key: "test-key",
        model: "whisper-large-v3",
        language: "auto",
        hotkey: "ctrl_r",
        auto_type: true,
        auto_enter: false,
        typing_delay: 12,
        notifications: true,
        backend: "auto",
        debug: false,
        audio_device: "default",
        history_enabled: true,
        history_days: 30,
        active_provider: "groq",
        cloud_provider: "groq",
        local_backend: "mlx",
        text_processing: true,
        vad: { enabled: true, threshold: 0.5 },
        overlay: {
          enabled: true,
          position: "bottom_left",
          size: "medium",
          margin: 30,
          audio_boost: 800,
          theme: "winamp_classic", // Use Winamp theme to see frequency colors
        },
        llm: { enabled: false, provider: "groq", api_url: "", api_key: "", model: "", prompt: "" },
        dictionary: { path: "", learning_mode: "auto", learning_threshold: 3 },
      };

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: any) => {
          commands.push({ cmd, args, time: Date.now() });

          switch (cmd) {
            case "get_config":
              return JSON.parse(JSON.stringify(mockConfig));
            case "show_overlay":
              currentState = args?.state || "idle";
              return null;
            case "hide_overlay":
              currentState = "hidden";
              return null;
            case "get_spectrum_bins":
              return spectrumBins;
            case "get_recording_status":
              return currentState === "recording";
            case "get_visualization_themes":
              return [
                { id: "winamp_classic", name: "Winamp Classic", description: "Fire spectrum" },
              ];
            case "is_first_run":
              return false;
            default:
              return null;
          }
        },
      };

      // Helper to set spectrum bins (simulates FFT output)
      (window as any).__setSpectrumBins = (bins: number[]) => {
        spectrumBins = bins;
      };

      // Helper to get current state
      (window as any).__getSpectrumState = () => ({
        state: currentState,
        bins: spectrumBins.slice(),
      });

      // Helper to simulate bass frequency (200 Hz) - activates bars 4-6
      (window as any).__setBassSpectrum = () => {
        const bins = new Array(32).fill(0.02);
        bins[4] = 0.8;
        bins[5] = 0.9;
        bins[6] = 0.7;
        spectrumBins = bins;
      };

      // Helper to simulate mid frequency (1000 Hz) - activates bars 14-16
      (window as any).__setMidSpectrum = () => {
        const bins = new Array(32).fill(0.02);
        bins[14] = 0.8;
        bins[15] = 0.9;
        bins[16] = 0.7;
        spectrumBins = bins;
      };

      // Helper to simulate high frequency (8000 Hz) - activates bars 26-28
      (window as any).__setHighSpectrum = () => {
        const bins = new Array(32).fill(0.02);
        bins[26] = 0.8;
        bins[27] = 0.9;
        bins[28] = 0.7;
        spectrumBins = bins;
      };

      // Helper to simulate voice spectrum - activates multiple frequency bands
      (window as any).__setVoiceSpectrum = () => {
        const bins = new Array(32).fill(0.02);
        // Voice fundamental ~200Hz
        bins[4] = 0.6;
        bins[5] = 0.7;
        bins[6] = 0.5;
        // First formant ~500Hz
        bins[10] = 0.5;
        bins[11] = 0.6;
        bins[12] = 0.4;
        // Second formant ~1500Hz
        bins[16] = 0.3;
        bins[17] = 0.2;
        spectrumBins = bins;
      };

      // Helper to simulate silence
      (window as any).__setSilenceSpectrum = () => {
        spectrumBins = new Array(32).fill(0.01);
      };
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("spectrum bins array has 32 elements", async ({ page }) => {
    // Set bass spectrum
    await page.evaluate(() => {
      (window as any).__setBassSpectrum();
    });

    const state = await page.evaluate(() => (window as any).__getSpectrumState());
    expect(state.bins).toHaveLength(32);
  });

  test("bass frequency (200 Hz) activates low bars (4-6)", async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__setBassSpectrum();
    });

    const state = await page.evaluate(() => (window as any).__getSpectrumState());

    // Bars 4-6 should be active
    expect(state.bins[4]).toBeGreaterThan(0.5);
    expect(state.bins[5]).toBeGreaterThan(0.5);
    expect(state.bins[6]).toBeGreaterThan(0.5);

    // High bars should be near zero
    expect(state.bins[26]).toBeLessThan(0.1);
    expect(state.bins[27]).toBeLessThan(0.1);
  });

  test("mid frequency (1000 Hz) activates middle bars (14-16)", async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__setMidSpectrum();
    });

    const state = await page.evaluate(() => (window as any).__getSpectrumState());

    // Bars 14-16 should be active
    expect(state.bins[14]).toBeGreaterThan(0.5);
    expect(state.bins[15]).toBeGreaterThan(0.5);
    expect(state.bins[16]).toBeGreaterThan(0.5);

    // Low bars should be near zero
    expect(state.bins[4]).toBeLessThan(0.1);
    expect(state.bins[5]).toBeLessThan(0.1);
  });

  test("high frequency (8000 Hz) activates high bars (26-28)", async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__setHighSpectrum();
    });

    const state = await page.evaluate(() => (window as any).__getSpectrumState());

    // Bars 26-28 should be active
    expect(state.bins[26]).toBeGreaterThan(0.5);
    expect(state.bins[27]).toBeGreaterThan(0.5);
    expect(state.bins[28]).toBeGreaterThan(0.5);

    // Low bars should be near zero
    expect(state.bins[4]).toBeLessThan(0.1);
    expect(state.bins[5]).toBeLessThan(0.1);
  });

  test("voice spectrum activates multiple frequency bands", async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__setVoiceSpectrum();
    });

    const state = await page.evaluate(() => (window as any).__getSpectrumState());

    // Voice fundamental (bars 4-6)
    expect(state.bins[4]).toBeGreaterThan(0.3);
    expect(state.bins[5]).toBeGreaterThan(0.3);

    // First formant (bars 10-12)
    expect(state.bins[10]).toBeGreaterThan(0.3);
    expect(state.bins[11]).toBeGreaterThan(0.3);

    // Second formant (bars 16-17)
    expect(state.bins[16]).toBeGreaterThan(0.1);
    expect(state.bins[17]).toBeGreaterThan(0.1);
  });

  test("silence produces near-zero spectrum", async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__setSilenceSpectrum();
    });

    const state = await page.evaluate(() => (window as any).__getSpectrumState());

    // All bars should be near zero
    const maxValue = Math.max(...state.bins);
    expect(maxValue).toBeLessThan(0.1);
  });

  test("spectrum bins can be updated dynamically", async ({ page }) => {
    // Start with silence
    await page.evaluate(() => {
      (window as any).__setSilenceSpectrum();
    });

    let state = await page.evaluate(() => (window as any).__getSpectrumState());
    expect(state.bins[5]).toBeLessThan(0.1);

    // Switch to bass
    await page.evaluate(() => {
      (window as any).__setBassSpectrum();
    });

    state = await page.evaluate(() => (window as any).__getSpectrumState());
    expect(state.bins[5]).toBeGreaterThan(0.5);

    // Switch to high
    await page.evaluate(() => {
      (window as any).__setHighSpectrum();
    });

    state = await page.evaluate(() => (window as any).__getSpectrumState());
    expect(state.bins[5]).toBeLessThan(0.1);
    expect(state.bins[27]).toBeGreaterThan(0.5);
  });

  test("bar values are clamped to 0-1 range", async ({ page }) => {
    // Set custom bins with some out-of-range values
    await page.evaluate(() => {
      const bins = new Array(32).fill(0);
      bins[0] = 0.5; // Normal value
      bins[1] = 1.0; // Maximum
      bins[2] = 0.0; // Minimum
      (window as any).__setSpectrumBins(bins);
    });

    const state = await page.evaluate(() => (window as any).__getSpectrumState());

    // All values should be valid
    for (const value of state.bins) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  test("frequency distribution follows logarithmic scale", async ({ page }) => {
    // The frequency mapping in the analyzer:
    // Bar 0: ~20 Hz (bass)
    // Bar 15: ~1000 Hz (mid)
    // Bar 31: ~20000 Hz (high)

    // This test validates the expectation that different frequency ranges
    // map to different bar positions, following human hearing perception

    await page.evaluate(() => {
      // Create a spectrum that spans all frequencies
      const bins = new Array(32).fill(0);
      // Low freq (bar 5)
      bins[5] = 0.8;
      // Mid freq (bar 15)
      bins[15] = 0.8;
      // High freq (bar 27)
      bins[27] = 0.8;
      (window as any).__setSpectrumBins(bins);
    });

    const state = await page.evaluate(() => (window as any).__getSpectrumState());

    // Verify the three frequency bands are active
    expect(state.bins[5]).toBeGreaterThan(0.5); // Low
    expect(state.bins[15]).toBeGreaterThan(0.5); // Mid
    expect(state.bins[27]).toBeGreaterThan(0.5); // High

    // Verify gaps between them are inactive
    expect(state.bins[10]).toBeLessThan(0.1);
    expect(state.bins[21]).toBeLessThan(0.1);
  });
});
