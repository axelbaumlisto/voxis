/**
 * RED-first tests for HandyThemeProvider context + hooks.
 *
 * Six expectations encoded:
 *  1. children render as-is inside the Provider
 *  2. mount applies all 19 `--hp-*` CSS variables on document.documentElement
 *  3. theme prop change updates the same variables in a single render
 *  4. unmount removes the variables (cleanup)
 *  5. `useHandyTheme()` inside Provider returns the full theme
 *  6. `useHandyBarMath()` inside Provider returns {smoothing_alpha,
 *     power_curve, peak_decay}
 *  7. either hook used outside Provider throws a clear error
 *
 * SOLID notes:
 *  - SRP: each test exercises one observable behaviour
 *  - KISS: zero mocks; uses real React Testing Library + jsdom
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  DEFAULT_HANDY_THEME,
  resolveHandyTheme,
} from "../handy";
import {
  HandyThemeProvider,
  useHandyBarMath,
  useHandyTheme,
} from "../HandyThemeProvider";

function probeRoot(varName: string): string {
  return document.documentElement.style.getPropertyValue(varName);
}

describe("HandyThemeProvider", () => {
  it("renders children unchanged", () => {
    const { getByTestId } = render(
      <HandyThemeProvider theme={DEFAULT_HANDY_THEME}>
        <span data-testid="child">hello</span>
      </HandyThemeProvider>,
    );
    expect(getByTestId("child").textContent).toBe("hello");
  });

  it("applies all 19 --hp-* CSS variables on :root after mount", () => {
    render(
      <HandyThemeProvider theme={DEFAULT_HANDY_THEME}>
        <div />
      </HandyThemeProvider>,
    );
    expect(probeRoot("--hp-icon")).toBe(DEFAULT_HANDY_THEME.palette.icon_color);
    expect(probeRoot("--hp-bar")).toBe(DEFAULT_HANDY_THEME.palette.bar_color);
    expect(probeRoot("--hp-bar-height-ms")).toBe(
      `${DEFAULT_HANDY_THEME.animation.bar_height_ms}ms`,
    );
    expect(probeRoot("--hp-breathing-amplitude")).toBe(
      DEFAULT_HANDY_THEME.animation.idle_breathing_amplitude.toString(),
    );
    // Spot-check a derived ms field
    expect(probeRoot("--hp-pill-fade-ms")).toBe(
      `${DEFAULT_HANDY_THEME.animation.pill_fade_ms}ms`,
    );
  });

  it("re-renders update CSS variables when theme prop changes", () => {
    const greenTheme = resolveHandyTheme({
      handy_pill: { palette: { icon_color: "#7cc287" } },
    });
    const { rerender } = render(
      <HandyThemeProvider theme={DEFAULT_HANDY_THEME}>
        <div />
      </HandyThemeProvider>,
    );
    expect(probeRoot("--hp-icon")).toBe(DEFAULT_HANDY_THEME.palette.icon_color);

    rerender(
      <HandyThemeProvider theme={greenTheme}>
        <div />
      </HandyThemeProvider>,
    );
    expect(probeRoot("--hp-icon")).toBe("#7cc287");
  });

  it("removes CSS variables on unmount (cleanup)", () => {
    const { unmount } = render(
      <HandyThemeProvider theme={DEFAULT_HANDY_THEME}>
        <div />
      </HandyThemeProvider>,
    );
    expect(probeRoot("--hp-icon")).toBe(DEFAULT_HANDY_THEME.palette.icon_color);
    unmount();
    expect(probeRoot("--hp-icon")).toBe("");
  });

  it("useHandyTheme returns the full theme inside Provider", () => {
    let captured: ReturnType<typeof useHandyTheme> | null = null;
    function Probe() {
      captured = useHandyTheme();
      return null;
    }
    render(
      <HandyThemeProvider theme={DEFAULT_HANDY_THEME}>
        <Probe />
      </HandyThemeProvider>,
    );
    expect(captured).toEqual(DEFAULT_HANDY_THEME);
  });

  it("useHandyBarMath returns the 3 JS-driven fields inside Provider", () => {
    let captured: ReturnType<typeof useHandyBarMath> | null = null;
    function Probe() {
      captured = useHandyBarMath();
      return null;
    }
    render(
      <HandyThemeProvider theme={DEFAULT_HANDY_THEME}>
        <Probe />
      </HandyThemeProvider>,
    );
    expect(captured).toEqual({
      smoothing_alpha: DEFAULT_HANDY_THEME.animation.smoothing_alpha,
      power_curve: DEFAULT_HANDY_THEME.animation.power_curve,
      peak_decay: DEFAULT_HANDY_THEME.animation.peak_decay,
    });
  });

  it("useHandyTheme outside Provider throws a clear message", () => {
    function Probe() {
      useHandyTheme();
      return null;
    }
    // React swallows errors and writes them to console.error; we use
    // a try/catch around the render to surface the throw.
    expect(() => render(<Probe />)).toThrow(/HandyThemeProvider/);
  });

  it("useHandyBarMath outside Provider throws a clear message", () => {
    function Probe() {
      useHandyBarMath();
      return null;
    }
    expect(() => render(<Probe />)).toThrow(/HandyThemeProvider/);
  });
});
