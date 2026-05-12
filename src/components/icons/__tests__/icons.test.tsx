/**
 * Contract tests for Handy-style SVG icons.
 * Each icon must:
 *   - render an <svg> with the given width/height (default 24×24)
 *   - apply the `color` prop to all <path fill=…>
 *   - propagate `className`
 *   - use viewBox 0 0 24 24 for visual parity with Handy upstream
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MicrophoneIcon from "../MicrophoneIcon";
import TranscriptionIcon from "../TranscriptionIcon";
import CancelIcon from "../CancelIcon";

const ICONS = [
  ["MicrophoneIcon", MicrophoneIcon],
  ["TranscriptionIcon", TranscriptionIcon],
  ["CancelIcon", CancelIcon],
] as const;

describe.each(ICONS)("%s", (name, Icon) => {
  it("renders an svg with default 24x24 size and FAA2CA fill", () => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    const fills = Array.from(svg.querySelectorAll("path")).map((p) =>
      p.getAttribute("fill"),
    );
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect(fill?.toUpperCase()).toBe("#FAA2CA");
    }
  });

  it("applies custom width / height / color props", () => {
    const { container } = render(
      <Icon width={32} height={32} color="#ff0000" />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
    const fills = Array.from(svg.querySelectorAll("path")).map((p) =>
      p.getAttribute("fill"),
    );
    for (const fill of fills) {
      expect(fill).toBe("#ff0000");
    }
    expect(`${name}`).toBeTruthy(); // satisfy unused-var lint
  });

  it("propagates className to svg root", () => {
    const { container } = render(<Icon className="my-icon" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("my-icon");
  });
});
