/**
 * Tests for OverlayBackendSelector (on/off toggle).
 *
 * There is now ONE overlay backend (webview) on every platform, so the control
 * is a boolean switch. The toggle must:
 *  - render checked when the backend is anything other than "none"
 *  - render unchecked when the backend is "none"
 *  - emit onChange("webview") when turned on, onChange("none") when turned off
 *  - warn the user that a restart is required when the value changes
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import OverlayBackendSelector from "../OverlayBackendSelector";

describe("OverlayBackendSelector", () => {
  it("renders checked when overlay is enabled (non-'none' value)", () => {
    render(
      <OverlayBackendSelector label="Overlay" value="webview" onChange={() => {}} />,
    );
    const toggle = screen.getByRole("checkbox") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("treats any legacy non-'none' value (e.g. 'auto') as enabled", () => {
    render(
      <OverlayBackendSelector label="Overlay" value="auto" onChange={() => {}} />,
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("renders unchecked when overlay is off ('none')", () => {
    render(
      <OverlayBackendSelector label="Overlay" value="none" onChange={() => {}} />,
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("emits 'webview' when turned on and 'none' when turned off", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <OverlayBackendSelector label="Overlay" value="none" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith("webview");

    rerender(
      <OverlayBackendSelector label="Overlay" value="webview" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith("none");
  });

  it("renders the label and description from props", () => {
    render(
      <OverlayBackendSelector
        label="Overlay"
        description="Show the recording overlay"
        value="webview"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Overlay")).toBeInTheDocument();
    expect(screen.getByText("Show the recording overlay")).toBeInTheDocument();
  });

  it("shows a restart-required notice once the value diverges from the initial value", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <OverlayBackendSelector label="Overlay" value="webview" onChange={onChange} />,
    );
    expect(screen.queryByText(/restart/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    rerender(
      <OverlayBackendSelector label="Overlay" value="none" onChange={onChange} />,
    );
    expect(screen.getByText(/restart/i)).toBeInTheDocument();
  });

  it("hides the restart notice when value returns to its initial value", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <OverlayBackendSelector label="Overlay" value="webview" onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("checkbox"));
    rerender(
      <OverlayBackendSelector label="Overlay" value="none" onChange={onChange} />,
    );
    expect(screen.getByText(/restart/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    rerender(
      <OverlayBackendSelector label="Overlay" value="webview" onChange={onChange} />,
    );
    expect(screen.queryByText(/restart/i)).not.toBeInTheDocument();
  });
});
