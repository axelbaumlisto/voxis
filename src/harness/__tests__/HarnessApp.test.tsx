import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HarnessApp from "../HarnessApp";

describe("HarnessApp", () => {
  it("renders a theme picker, a mode picker, and the preview host", () => {
    render(<HarnessApp />);
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mode/i)).toBeInTheDocument();
    expect(screen.getByTestId("theme-host")).toBeInTheDocument();
  });
  it("lists builtin themes in the picker", () => {
    render(<HarnessApp />);
    const picker = screen.getByLabelText(/theme/i) as HTMLSelectElement;
    const values = Array.from(picker.options).map((o) => o.value);
    expect(values).toContain("drifting_contour");
    expect(values).toContain("radiolarian");
  });
  it("changing the audio level slider updates the readout", () => {
    render(<HarnessApp />);
    const slider = screen.getByLabelText(/audio level/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.75" } });
    expect(screen.getByText(/0\.75/)).toBeInTheDocument();
  });
  it("exposes scenario play buttons", () => {
    render(<HarnessApp />);
    expect(screen.getByRole("button", { name: /speech.*grow|grow/i })).toBeInTheDocument();
  });
});