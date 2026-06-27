import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TextAreaField from "../TextAreaField";

describe("TextAreaField", () => {
  it("renders label and textarea", () => {
    render(<TextAreaField label="Models" value="" onChange={() => {}} />);

    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows current value", () => {
    render(
      <TextAreaField label="Models" value={"line1\nline2"} onChange={() => {}} />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("line1\nline2");
  });

  it("calls onChange with the string value", () => {
    const handleChange = vi.fn();
    render(<TextAreaField label="Models" value="" onChange={handleChange} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "new text" } });

    expect(handleChange).toHaveBeenCalledWith("new text");
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it("renders description if provided", () => {
    render(
      <TextAreaField
        label="Models"
        value=""
        onChange={() => {}}
        description="One per line"
      />
    );

    expect(screen.getByText("One per line")).toBeInTheDocument();
  });

  it("does not render description if not provided", () => {
    render(<TextAreaField label="Models" value="" onChange={() => {}} />);

    expect(screen.queryByText(/per line/i)).not.toBeInTheDocument();
  });

  it("applies rows when provided", () => {
    render(
      <TextAreaField label="Models" value="" onChange={() => {}} rows={4} />
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("rows", "4");
  });

  it("applies placeholder when provided", () => {
    render(
      <TextAreaField
        label="Models"
        value=""
        onChange={() => {}}
        placeholder="gpt-4:GPT-4"
      />
    );

    expect(screen.getByPlaceholderText("gpt-4:GPT-4")).toBeInTheDocument();
  });

  it("has correct css classes", () => {
    render(<TextAreaField label="Models" value="" onChange={() => {}} />);

    const container = screen.getByText("Models").closest(".settings-field");
    expect(container).toBeInTheDocument();
    expect(
      container?.querySelector(".settings-field-input")
    ).toBeInTheDocument();
  });
});
