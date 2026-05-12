import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import HandyBars from "../HandyBars";

describe("HandyBars", () => {
  it("renders one .bar element per input value", () => {
    const { container } = render(<HandyBars bars={[0, 0.25, 0.5, 0.75, 1]} />);
    expect(container.querySelectorAll(".bar")).toHaveLength(5);
  });

  it("computes height = min(maxHeight, 4 + pow(v, 0.7) * (maxHeight-4))", () => {
    const { container } = render(<HandyBars bars={[0]} />);
    const bar = container.querySelector(".bar") as HTMLElement;
    // v=0 \u2192 4 + 0 = 4px
    expect(bar.style.height).toBe("4px");
  });

  it("v=1 caps at maxHeight (default 20px)", () => {
    const { container } = render(<HandyBars bars={[1]} />);
    const bar = container.querySelector(".bar") as HTMLElement;
    expect(bar.style.height).toBe("20px");
  });

  it("applies opacity = max(0.2, v * 1.7)", () => {
    const { container } = render(<HandyBars bars={[0, 0.5, 1]} />);
    const bars = container.querySelectorAll(".bar");
    expect(parseFloat((bars[0] as HTMLElement).style.opacity)).toBeCloseTo(0.2);
    // 0.5 * 1.7 = 0.85
    expect(parseFloat((bars[1] as HTMLElement).style.opacity)).toBeCloseTo(0.85);
    // 1 * 1.7 capped to 1.0
    expect(parseFloat((bars[2] as HTMLElement).style.opacity)).toBeCloseTo(1.0);
  });

  it("uses custom color prop on every bar", () => {
    const { container } = render(<HandyBars bars={[0.5, 0.5]} color="#ff0000" />);
    for (const bar of Array.from(container.querySelectorAll(".bar"))) {
      expect((bar as HTMLElement).style.background).toMatch(/(rgb\(255, 0, 0\)|#ff0000)/i);
    }
  });

  it("renders nothing for an empty array", () => {
    const { container } = render(<HandyBars bars={[]} />);
    expect(container.querySelectorAll(".bar")).toHaveLength(0);
  });

  it("respects custom maxHeight", () => {
    const { container } = render(<HandyBars bars={[1]} maxHeight={40} />);
    const bar = container.querySelector(".bar") as HTMLElement;
    expect(bar.style.height).toBe("40px");
  });
});
