import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AlwaysOnMicrophone from "../AlwaysOnMicrophone";

describe("AlwaysOnMicrophone", () => {
  it("renders the toggle", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("always-on-microphone-toggle")).toBeTruthy();
  });

  it("hides the privacy warning while OFF", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("always-on-microphone-warning")).toBeNull();
  });

  it("shows the privacy warning when ON", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={true}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("always-on-microphone-warning")).toBeTruthy();
  });

  it("toggling fires onChange with the new value", () => {
    const onChange = vi.fn();
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("always-on-microphone-toggle"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
