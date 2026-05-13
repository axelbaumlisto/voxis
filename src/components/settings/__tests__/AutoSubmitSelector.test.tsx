import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AutoSubmitSelector from "../AutoSubmitSelector";

describe("AutoSubmitSelector", () => {
  it("renders all 4 options", () => {
    render(<AutoSubmitSelector label="Auto-submit" value="off" onChange={() => {}} />);
    const select = screen.getByTestId("auto-submit-select") as HTMLSelectElement;
    const values = Array.from(select.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(values).toEqual(["off", "enter", "cmd_enter", "shift_enter"]);
  });

  it("changing fires onChange with the new value", () => {
    const onChange = vi.fn();
    render(<AutoSubmitSelector label="Auto-submit" value="off" onChange={onChange} />);
    fireEvent.change(screen.getByTestId("auto-submit-select"), {
      target: { value: "enter" },
    });
    expect(onChange).toHaveBeenCalledWith("enter");
  });

  it("falls back to 'off' when given an unknown value", () => {
    // Robust to stale config blobs (e.g. removed variant). The
    // dropdown must still render and show a safe default.
    render(
      <AutoSubmitSelector label="Auto-submit" value="something_weird" onChange={() => {}} />,
    );
    const select = screen.getByTestId("auto-submit-select") as HTMLSelectElement;
    expect(select.value).toBe("off");
  });
});
