import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EntryDisplay from "../EntryDisplay";

describe("EntryDisplay", () => {
  it("renders source, arrow, and replacement", () => {
    render(<EntryDisplay source="solid" replacement="SOLID" />);

    expect(screen.getByText("solid")).toBeInTheDocument();
    expect(screen.getByText("→")).toBeInTheDocument();
    expect(screen.getByText("SOLID")).toBeInTheDocument();
  });

  it("uses default classPrefix for CSS classes", () => {
    const { container } = render(
      <EntryDisplay source="api" replacement="API" />
    );

    expect(container.querySelector(".dictionary-source")).toHaveTextContent("api");
    expect(container.querySelector(".dictionary-arrow")).toHaveTextContent("→");
    expect(container.querySelector(".dictionary-replacement")).toHaveTextContent("API");
  });

  it("uses custom classPrefix for CSS classes", () => {
    const { container } = render(
      <EntryDisplay source="dry" replacement="DRY" classPrefix="pending" />
    );

    expect(container.querySelector(".pending-source")).toHaveTextContent("dry");
    expect(container.querySelector(".pending-arrow")).toHaveTextContent("→");
    expect(container.querySelector(".pending-replacement")).toHaveTextContent("DRY");
  });

  it("renders empty strings correctly", () => {
    const { container } = render(<EntryDisplay source="" replacement="" />);

    expect(container.querySelector(".dictionary-source")).toHaveTextContent("");
    expect(container.querySelector(".dictionary-replacement")).toHaveTextContent("");
  });

  it("renders unicode text correctly", () => {
    render(<EntryDisplay source="солид" replacement="SOLID" />);

    expect(screen.getByText("солид")).toBeInTheDocument();
    expect(screen.getByText("SOLID")).toBeInTheDocument();
  });

  it("renders long text without truncation", () => {
    const longSource = "very-long-source-word";
    const longReplacement = "VeryLongReplacementWord";

    render(<EntryDisplay source={longSource} replacement={longReplacement} />);

    expect(screen.getByText(longSource)).toBeInTheDocument();
    expect(screen.getByText(longReplacement)).toBeInTheDocument();
  });

  it("renders with multiple classPrefix variants", () => {
    const prefixes = ["dictionary", "pending", "add-entry", "custom"];

    prefixes.forEach((prefix) => {
      const { container, unmount } = render(
        <EntryDisplay source="test" replacement="TEST" classPrefix={prefix} />
      );

      expect(container.querySelector(`.${prefix}-source`)).toBeInTheDocument();
      expect(container.querySelector(`.${prefix}-arrow`)).toBeInTheDocument();
      expect(container.querySelector(`.${prefix}-replacement`)).toBeInTheDocument();

      unmount();
    });
  });
});
