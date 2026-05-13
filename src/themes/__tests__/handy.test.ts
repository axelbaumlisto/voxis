/**
 * RED-first tests for HandyPillTheme schema + resolver.
 *
 * These tests describe the contract for `src/themes/handy.ts` before
 * any implementation lands. They MUST fail on first run (module does
 * not exist) — then T1.2 implements the module to make them green.
 *
 * SOLID/DRY/KISS notes:
 *  - SRP: each test exercises a single behaviour;
 *  - KISS: zero mocks, no I/O — pure-function tests;
 *  - The default theme is exposed as a constant so tests don't repeat
 *    the literal 18-field object.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HANDY_THEME,
  resolveHandyTheme,
  themeBarMath,
  themeToCssVars,
  type HandyPillTheme,
} from "../handy";

describe("HandyPillTheme · resolver", () => {
  it("returns DEFAULT_HANDY_THEME when input is null", () => {
    expect(resolveHandyTheme(null)).toEqual(DEFAULT_HANDY_THEME);
  });

  it("returns DEFAULT_HANDY_THEME when input is undefined", () => {
    expect(resolveHandyTheme(undefined)).toEqual(DEFAULT_HANDY_THEME);
  });

  it("returns DEFAULT_HANDY_THEME when input lacks `handy_pill` block", () => {
    expect(
      resolveHandyTheme({ name: "anything", family: "organic_ring" }),
    ).toEqual(DEFAULT_HANDY_THEME);
  });

  it("merges partial palette with default animation", () => {
    const r = resolveHandyTheme({
      handy_pill: { palette: { icon_color: "#7cc287" } },
    });
    expect(r.palette.icon_color).toBe("#7cc287");
    // remaining palette fields take defaults
    expect(r.palette.bar_color).toBe(DEFAULT_HANDY_THEME.palette.bar_color);
    // animation block untouched
    expect(r.animation.smoothing_alpha).toBe(
      DEFAULT_HANDY_THEME.animation.smoothing_alpha,
    );
  });

  it("merges partial animation with default palette", () => {
    const r = resolveHandyTheme({
      handy_pill: { animation: { smoothing_alpha: 0.55 } },
    });
    expect(r.animation.smoothing_alpha).toBe(0.55);
    expect(r.animation.peak_decay).toBe(
      DEFAULT_HANDY_THEME.animation.peak_decay,
    );
    expect(r.palette.icon_color).toBe(DEFAULT_HANDY_THEME.palette.icon_color);
  });

  it("preserves all 18 fields when fully specified", () => {
    const full = {
      handy_pill: {
        palette: {
          icon_color: "#abc123",
          bar_color: "#def456",
          bar_glow: "#012345",
          shadow: "rgba(1, 2, 3, 0.4)",
          transcribing_text: "#ffffff",
          cancel_hover_bg: "rgba(1, 2, 3, 0.2)",
        },
        animation: {
          smoothing_alpha: 0.42,
          power_curve: 0.65,
          peak_decay: 0.9,
          bar_min_height_px: 5,
          bar_min_opacity: 0.25,
          bar_opacity_gain: 1.8,
          bar_height_ms: 75,
          bar_opacity_ms: 130,
          pill_fade_ms: 280,
          transcribing_pulse_ms: 1600,
          idle_breathing_amplitude: 0.12,
          idle_breathing_period_ms: 3500,
          cancel_hover_ms: 160,
        },
      },
    };
    const r: HandyPillTheme = resolveHandyTheme(full);
    expect(r.palette.icon_color).toBe("#abc123");
    expect(r.palette.cancel_hover_bg).toBe("rgba(1, 2, 3, 0.2)");
    expect(r.animation.idle_breathing_amplitude).toBe(0.12);
    expect(r.animation.bar_height_ms).toBe(75);
    expect(r.animation.cancel_hover_ms).toBe(160);
  });

  it("clamps idle_breathing_amplitude to [0, 0.3]", () => {
    const high = resolveHandyTheme({
      handy_pill: { animation: { idle_breathing_amplitude: 5 } },
    });
    expect(high.animation.idle_breathing_amplitude).toBe(0.3);
    const low = resolveHandyTheme({
      handy_pill: { animation: { idle_breathing_amplitude: -1 } },
    });
    expect(low.animation.idle_breathing_amplitude).toBe(0);
  });

  it("clamps smoothing_alpha to [0.05, 1.0]", () => {
    const high = resolveHandyTheme({
      handy_pill: { animation: { smoothing_alpha: 7 } },
    });
    expect(high.animation.smoothing_alpha).toBe(1.0);
    const low = resolveHandyTheme({
      handy_pill: { animation: { smoothing_alpha: -1 } },
    });
    expect(low.animation.smoothing_alpha).toBe(0.05);
  });

  it("clamps every ms-field to >= 1 ms (no zero/negative durations)", () => {
    const r = resolveHandyTheme({
      handy_pill: {
        animation: {
          bar_height_ms: -50,
          bar_opacity_ms: 0,
          pill_fade_ms: -300,
          transcribing_pulse_ms: 0,
          idle_breathing_period_ms: -1,
          cancel_hover_ms: 0,
        },
      },
    });
    expect(r.animation.bar_height_ms).toBeGreaterThanOrEqual(1);
    expect(r.animation.bar_opacity_ms).toBeGreaterThanOrEqual(1);
    expect(r.animation.pill_fade_ms).toBeGreaterThanOrEqual(1);
    expect(r.animation.transcribing_pulse_ms).toBeGreaterThanOrEqual(1);
    expect(r.animation.idle_breathing_period_ms).toBeGreaterThanOrEqual(1);
    expect(r.animation.cancel_hover_ms).toBeGreaterThanOrEqual(1);
  });
});

describe("themeToCssVars", () => {
  it("exports exactly 19 CSS-variable keys (6 palette + 13 animation)", () => {
    // 6 palette + 13 animation = 19. The plan originally said "12"
    // but cancel_hover_ms is a legitimate temporal parameter, so the
    // final schema settles at 13 animation fields.
    const vars = themeToCssVars(DEFAULT_HANDY_THEME);
    expect(Object.keys(vars).length).toBe(19);
  });

  it("includes all expected --hp-* keys", () => {
    const vars = themeToCssVars(DEFAULT_HANDY_THEME);
    const expected = [
      // palette (6)
      "--hp-icon",
      "--hp-bar",
      "--hp-bar-glow",
      "--hp-shadow",
      "--hp-transcribing-text",
      "--hp-cancel-hover-bg",
      // animation (12)
      "--hp-smoothing-alpha",
      "--hp-power-curve",
      "--hp-peak-decay",
      "--hp-bar-min-height-px",
      "--hp-bar-min-opacity",
      "--hp-bar-opacity-gain",
      "--hp-bar-height-ms",
      "--hp-bar-opacity-ms",
      "--hp-pill-fade-ms",
      "--hp-transcribing-pulse-ms",
      "--hp-breathing-amplitude",
      "--hp-breathing-period-ms",
      "--hp-cancel-hover-ms",
    ];
    for (const k of expected) {
      expect(vars).toHaveProperty(k);
    }
  });

  it("ms fields are stringified with 'ms' suffix", () => {
    const vars = themeToCssVars(DEFAULT_HANDY_THEME);
    expect(vars["--hp-bar-height-ms"]).toBe("60ms");
    expect(vars["--hp-pill-fade-ms"]).toBe("300ms");
    expect(vars["--hp-transcribing-pulse-ms"]).toBe("1500ms");
  });

  it("non-ms numeric fields are stringified without units", () => {
    const vars = themeToCssVars(DEFAULT_HANDY_THEME);
    expect(vars["--hp-smoothing-alpha"]).toBe("0.3");
    expect(vars["--hp-power-curve"]).toBe("0.7");
    expect(vars["--hp-bar-min-height-px"]).toBe("4");
  });
});

describe("themeBarMath", () => {
  it("returns only the 3 JS-driven fields", () => {
    const math = themeBarMath(DEFAULT_HANDY_THEME);
    expect(math).toEqual({
      smoothing_alpha: 0.3,
      power_curve: 0.7,
      peak_decay: 0.85,
    });
  });

  it("reflects custom theme values", () => {
    const custom = resolveHandyTheme({
      handy_pill: {
        animation: {
          smoothing_alpha: 0.5,
          power_curve: 0.4,
          peak_decay: 0.95,
        },
      },
    });
    expect(themeBarMath(custom)).toEqual({
      smoothing_alpha: 0.5,
      power_curve: 0.4,
      peak_decay: 0.95,
    });
  });
});
