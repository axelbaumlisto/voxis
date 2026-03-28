import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Section from "../Section";

describe("Section", () => {
  it("renders title", () => {
    render(<Section title="General Settings">Content here</Section>);

    expect(screen.getByText("General Settings")).toBeInTheDocument();
  });

  it("renders title as h3 element", () => {
    render(<Section title="Audio Settings">Content here</Section>);

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("Audio Settings");
  });

  it("renders children content", () => {
    render(
      <Section title="Test Section">
        <p>Child paragraph</p>
      </Section>
    );

    expect(screen.getByText("Child paragraph")).toBeInTheDocument();
  });

  it("renders multiple children", () => {
    render(
      <Section title="Test Section">
        <span>First child</span>
        <span>Second child</span>
      </Section>
    );

    expect(screen.getByText("First child")).toBeInTheDocument();
    expect(screen.getByText("Second child")).toBeInTheDocument();
  });

  it("has settings-section CSS class", () => {
    render(<Section title="Test">Content</Section>);

    expect(document.querySelector(".settings-section")).toBeInTheDocument();
  });

  it("has settings-section-title CSS class on title", () => {
    render(<Section title="Test">Content</Section>);

    const title = screen.getByText("Test");
    expect(title).toHaveClass("settings-section-title");
  });

  it("has settings-section-content CSS class on content wrapper", () => {
    render(<Section title="Test">Content</Section>);

    expect(
      document.querySelector(".settings-section-content")
    ).toBeInTheDocument();
  });

  it("renders children inside content wrapper", () => {
    render(
      <Section title="Test">
        <div data-testid="child-element">Child</div>
      </Section>
    );

    const contentWrapper = document.querySelector(".settings-section-content");
    const child = screen.getByTestId("child-element");

    expect(contentWrapper).toContainElement(child);
  });
});
