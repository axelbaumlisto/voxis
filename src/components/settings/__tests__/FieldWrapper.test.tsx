import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FieldWrapper from "../FieldWrapper";

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
