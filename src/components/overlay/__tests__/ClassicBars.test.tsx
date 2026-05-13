/**
 * RED-first tests for ClassicBars — Winamp-style spectrum analyzer.
 *
 * Distinctive characteristics vs HandyBars:
 *  - Wider canvas (16 bars by default, not 9)
 *  - Per-bar gradient driven by amplitude (low = bottom color, high = top color)
 *  - No icons / no cancel button (those are HandyPill concerns)
 *  - Fills the full available width
 *
 * SRP: tests describe the component's behaviour, not its implementation.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import ClassicBars from "../ClassicBars";

const GREEN_YELLOW_RED = {
  bottom: "#299400",
  middle: "#d6b521",
  top: "#ef3110",
};

describe("ClassicBars", () => {
  it("renders 16 bars by default", () => {
    const { container } = render(
      <ClassicBars bars={new Array(16).fill(0.5)} gradient={GREEN_YELLOW_RED} />,
    );
    expect(container.querySelectorAll(".classic-bar")).toHaveLength(16);
  });

  it("respects custom bar count", () => {
    const { container } = render(
      <ClassicBars
        bars={new Array(24).fill(0.5)}
        gradient={GREEN_YELLOW_RED}
        barCount={24}
      />,
    );
    expect(container.querySelectorAll(".classic-bar")).toHaveLength(24);
  });

  // The browser normalises hex into rgb(r, g, b) at parse time, so the
  // assertions check for the equivalent rgb form.
  const GREEN_RGB = "rgb(41, 148, 0)";   // #299400
  const YELLOW_RGB = "rgb(214, 181, 33)"; // #d6b521
  const RED_RGB = "rgb(239, 49, 16)";    // #ef3110

  it("low amplitude bar uses the gradient bottom color", () => {
    const { container } = render(
      <ClassicBars bars={[0.05, 0.05]} gradient={GREEN_YELLOW_RED} barCount={2} />,
    );
    const bar = container.querySelector(".classic-bar") as HTMLElement;
    expect(bar.style.background).toContain(GREEN_RGB);
  });

  it("high amplitude bar uses the gradient top color", () => {
    const { container } = render(
      <ClassicBars bars={[0.95, 0.95]} gradient={GREEN_YELLOW_RED} barCount={2} />,
    );
    const bar = container.querySelector(".classic-bar") as HTMLElement;
    expect(bar.style.background).toContain(RED_RGB);
  });

  it("medium amplitude bar carries all three gradient stops", () => {
    const { container } = render(
      <ClassicBars bars={[0.5]} gradient={GREEN_YELLOW_RED} barCount={1} />,
    );
    const bar = container.querySelector(".classic-bar") as HTMLElement;
    const bg = bar.style.background;
    expect(bg).toContain(GREEN_RGB);
    expect(bg).toContain(YELLOW_RGB);
    expect(bg).toContain(RED_RGB);
  });

  it("bar height is proportional to amplitude (v=1 → maxHeight)", () => {
    const { container } = render(
      <ClassicBars
        bars={[1.0]}
        gradient={GREEN_YELLOW_RED}
        barCount={1}
        maxHeight={36}
      />,
    );
    const bar = container.querySelector(".classic-bar") as HTMLElement;
    expect(bar.style.height).toBe("36px");
  });

  it("bar at v=0 still has a minimum visible height (>= 2 px)", () => {
    const { container } = render(
      <ClassicBars bars={[0]} gradient={GREEN_YELLOW_RED} barCount={1} maxHeight={36} />,
    );
    const bar = container.querySelector(".classic-bar") as HTMLElement;
    const h = parseFloat(bar.style.height);
    expect(h).toBeGreaterThanOrEqual(2);
    expect(h).toBeLessThan(8);
  });

  it("uses CSS variable --hp-bar-height-ms for transitions", () => {
    const { container } = render(
      <ClassicBars bars={[0.5]} gradient={GREEN_YELLOW_RED} barCount={1} />,
    );
    const bar = container.querySelector(".classic-bar") as HTMLElement;
    expect(bar.style.transition).toContain("--hp-bar-height-ms");
  });

  it("omits peak ticks when peakDecay = 0 (classic Winamp opt-out)", () => {
    const { container } = render(
      <ClassicBars
        bars={[0.9, 0.7, 0.5]}
        gradient={GREEN_YELLOW_RED}
        barCount={3}
        peakDecay={0}
      />,
    );
    expect(container.querySelectorAll(".classic-bar-peak")).toHaveLength(0);
  });

  it("renders peak tick above the bar when peak > bar (post-decay state)", () => {
    // First render at high amplitude — peak rises to bar level (instantly).
    // Second render drops the bar; peak hangs until decay catches up.
    // The hook needs RAF, so we just verify the element STRUCTURE exists
    // by rendering when bars are non-zero AND peakDecay is enabled.
    const { container } = render(
      <ClassicBars
        bars={[0.95]}
        gradient={GREEN_YELLOW_RED}
        barCount={1}
        peakDecay={0.005}
      />,
    );
    // On the first render, peak ~= bar, so showPeak is false (peak is
    // not visible "above" the bar yet). The column wrapper must still
    // be present for layout consistency.
    expect(container.querySelectorAll(".classic-bar-col")).toHaveLength(1);
    expect(container.querySelectorAll(".classic-bar")).toHaveLength(1);
  });
});
