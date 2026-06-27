import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FieldWrapper, { useFieldControlId } from "../FieldWrapper";
import AutoSubmitSelector from "../AutoSubmitSelector";
import OverlayBackendSelector from "../OverlayBackendSelector";
import AlwaysOnMicrophone from "../AlwaysOnMicrophone";
import AudioFeedback from "../AudioFeedback";

function ContextInput() {
  const id = useFieldControlId();
  return <input id={id} data-testid="ctx-input" />;
}

/**
 * Asserts that no FieldWrapper label has a `for` pointing at a missing id, i.e.
 * the generated id always lands on a real control (a11y dangling-htmlFor fix).
 */
function expectNoDanglingLabel(container: HTMLElement) {
  const labels = container.querySelectorAll("label.settings-field-label[for]");
  expect(labels.length).toBeGreaterThan(0);
  labels.forEach((label) => {
    const forId = label.getAttribute("for");
    expect(forId).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(forId!)}`)).not.toBeNull();
  });
}

describe("FieldWrapper", () => {
  it("renders label", () => {
    render(
      <FieldWrapper label="Test Label">
        <input />
      </FieldWrapper>
    );

    expect(screen.getByText("Test Label")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <FieldWrapper label="Test" description="Help text">
        <input />
      </FieldWrapper>
    );

    expect(screen.getByText("Help text")).toBeInTheDocument();
  });

  it("does not render description when not provided", () => {
    render(
      <FieldWrapper label="Test">
        <input />
      </FieldWrapper>
    );

    expect(screen.queryByText("Help text")).not.toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <FieldWrapper label="Test">
        <input data-testid="child-input" />
      </FieldWrapper>
    );

    expect(screen.getByTestId("child-input")).toBeInTheDocument();
  });

  it("applies default class", () => {
    const { container } = render(
      <FieldWrapper label="Test">
        <input />
      </FieldWrapper>
    );

    expect(container.querySelector(".settings-field")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <FieldWrapper label="Test" className="custom-class">
        <input />
      </FieldWrapper>
    );

    const field = container.querySelector(".settings-field");
    expect(field).toHaveClass("custom-class");
  });

  it("generates an id and associates label htmlFor with the child control", () => {
    const { container } = render(
      <FieldWrapper label="My Label">
        <ContextInput />
      </FieldWrapper>
    );

    const label = container.querySelector(".settings-field-label");
    const input = screen.getByTestId("ctx-input");
    const htmlFor = label?.getAttribute("for");

    expect(htmlFor).toBeTruthy();
    expect(input.getAttribute("id")).toBe(htmlFor);
  });

  it("has correct structure with header", () => {
    const { container } = render(
      <FieldWrapper label="Test">
        <input />
      </FieldWrapper>
    );

    expect(container.querySelector(".settings-field-header")).toBeInTheDocument();
    expect(container.querySelector(".settings-field-label")).toBeInTheDocument();
  });
});

describe("custom widgets resolve FieldWrapper label to a real control", () => {
  it("AutoSubmitSelector: no dangling label, select has accessible name", () => {
    const { container } = render(
      <AutoSubmitSelector label="Auto submit" value="off" onChange={vi.fn()} />
    );
    expectNoDanglingLabel(container);
    expect(screen.getByRole("combobox", { name: "Auto submit" })).toBeInTheDocument();
  });

  it("OverlayBackendSelector: no dangling label, checkbox has accessible name", () => {
    const { container } = render(
      <OverlayBackendSelector label="Overlay" value="webview" onChange={vi.fn()} />
    );
    expectNoDanglingLabel(container);
    expect(screen.getByRole("checkbox", { name: "Overlay" })).toBeInTheDocument();
  });

  it("AlwaysOnMicrophone: no dangling label, checkbox has accessible name", () => {
    const { container } = render(
      <AlwaysOnMicrophone label="Always on mic" value={false} onChange={vi.fn()} />
    );
    expectNoDanglingLabel(container);
    expect(screen.getByRole("checkbox", { name: "Always on mic" })).toBeInTheDocument();
  });

  it("AudioFeedback: no dangling label, primary checkbox has accessible name", () => {
    const { container } = render(
      <AudioFeedback
        label="Beeps"
        value={{ enabled: false, volume: 0.6 }}
        onChange={vi.fn()}
      />
    );
    expectNoDanglingLabel(container);
    expect(screen.getByRole("checkbox", { name: "Beeps" })).toBeInTheDocument();
  });
});
