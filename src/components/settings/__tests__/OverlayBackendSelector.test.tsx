/**
 * Tests for OverlayBackendSelector.
 *
 * The selector must:
 *  - render every option from OVERLAY_BACKEND_OPTIONS
 *  - show the current value as selected
 *  - emit onChange with the new value on selection
 *  - disable the `nspanel` option on non-macOS platforms with a hint
 *  - warn the user that a restart is required when the value changes
 *
 * Platform detection is mocked via `Object.defineProperty(navigator, "platform")`
 * because jsdom exposes a writable descriptor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import OverlayBackendSelector from "../OverlayBackendSelector";
import { OVERLAY_BACKEND_OPTIONS } from "../../../lib/constants";

function setPlatform(platform: string) {
  Object.defineProperty(window.navigator, "platform", {
    value: platform,
    configurable: true,
  });
}

const ORIGINAL_PLATFORM = window.navigator.platform;

describe("OverlayBackendSelector", () => {
  beforeEach(() => {
    setPlatform("MacIntel"); // assume macOS by default
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
  });

  it("renders all backend options", () => {
    render(
      <OverlayBackendSelector
        label="Backend"
        value="auto"
        onChange={() => {}}
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(OVERLAY_BACKEND_OPTIONS.length);
    for (const opt of OVERLAY_BACKEND_OPTIONS) {
      expect(
        options.find((o) => (o as HTMLOptionElement).value === opt.value),
      ).toBeTruthy();
    }
  });

  it("marks the current value as selected", () => {
    render(
      <OverlayBackendSelector
        label="Backend"
        value="subprocess"
        onChange={() => {}}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("subprocess");
  });

  it("calls onChange with the new value when user selects another option", () => {
    const onChange = vi.fn();
    render(
      <OverlayBackendSelector label="Backend" value="auto" onChange={onChange} />,
    );

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "nspanel" } });
    expect(onChange).toHaveBeenCalledWith("nspanel");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("renders the label and description from props", () => {
    render(
      <OverlayBackendSelector
        label="Overlay Backend"
        description="Pick how the overlay renders"
        value="auto"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Overlay Backend")).toBeInTheDocument();
    expect(screen.getByText("Pick how the overlay renders")).toBeInTheDocument();
  });

  it("disables nspanel option on non-macOS platforms", () => {
    setPlatform("Win32");
    render(
      <OverlayBackendSelector label="Backend" value="auto" onChange={() => {}} />,
    );

    const nspanelOption = screen
      .getAllByRole("option")
      .find((o) => (o as HTMLOptionElement).value === "nspanel") as
      | HTMLOptionElement
      | undefined;

    expect(nspanelOption).toBeDefined();
    expect(nspanelOption?.disabled).toBe(true);
  });

  it("enables nspanel option on macOS", () => {
    setPlatform("MacIntel");
    render(
      <OverlayBackendSelector label="Backend" value="auto" onChange={() => {}} />,
    );

    const nspanelOption = screen
      .getAllByRole("option")
      .find((o) => (o as HTMLOptionElement).value === "nspanel") as
      | HTMLOptionElement
      | undefined;

    expect(nspanelOption).toBeDefined();
    expect(nspanelOption?.disabled).toBe(false);
  });

  it("shows a platform hint when nspanel is disabled", () => {
    setPlatform("Linux x86_64");
    render(
      <OverlayBackendSelector label="Backend" value="auto" onChange={() => {}} />,
    );
    const hint = screen.getByTestId("overlay-backend-platform-hint");
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/macOS only/i);
  });

  it("does not show the platform hint when nspanel is enabled", () => {
    setPlatform("MacIntel");
    render(
      <OverlayBackendSelector label="Backend" value="auto" onChange={() => {}} />,
    );
    expect(
      screen.queryByTestId("overlay-backend-platform-hint"),
    ).not.toBeInTheDocument();
  });

  it("shows a restart-required notice once the value diverges from the initial value", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <OverlayBackendSelector label="Backend" value="auto" onChange={onChange} />,
    );
    // Initially no notice.
    expect(screen.queryByText(/restart/i)).not.toBeInTheDocument();

    // User changes value.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "subprocess" },
    });
    // Parent reflects new value back.
    rerender(
      <OverlayBackendSelector
        label="Backend"
        value="subprocess"
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/restart/i)).toBeInTheDocument();
  });

  it("hides the restart notice when value returns to its initial value", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <OverlayBackendSelector label="Backend" value="auto" onChange={onChange} />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "subprocess" },
    });
    rerender(
      <OverlayBackendSelector
        label="Backend"
        value="subprocess"
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/restart/i)).toBeInTheDocument();

    // Revert.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "auto" } });
    rerender(
      <OverlayBackendSelector label="Backend" value="auto" onChange={onChange} />,
    );
    expect(screen.queryByText(/restart/i)).not.toBeInTheDocument();
  });
});
