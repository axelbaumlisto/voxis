import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AudioFeedback from "../AudioFeedback";

describe("AudioFeedback", () => {
  it("renders toggle + volume slider", () => {
    render(
      <AudioFeedback
        label="Audio feedback"
        value={{ enabled: true, volume: 0.5 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("audio-feedback-toggle")).toBeTruthy();
    expect(screen.getByTestId("audio-feedback-volume")).toBeTruthy();
  });

  it("toggling fires onChange with updated 'enabled'", () => {
    const onChange = vi.fn();
    render(
      <AudioFeedback
        label="Audio feedback"
        value={{ enabled: false, volume: 0.6 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("audio-feedback-toggle"));
    expect(onChange).toHaveBeenCalledWith({ enabled: true, volume: 0.6 });
  });

  it("slider is disabled while master toggle is off", () => {
    render(
      <AudioFeedback
        label="Audio feedback"
        value={{ enabled: false, volume: 0.5 }}
        onChange={() => {}}
      />,
    );
    const slider = screen.getByTestId("audio-feedback-volume") as HTMLInputElement;
    expect(slider.disabled).toBe(true);
  });

  it("changing the slider fires onChange with new volume", () => {
    const onChange = vi.fn();
    render(
      <AudioFeedback
        label="Audio feedback"
        value={{ enabled: true, volume: 0.5 }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("audio-feedback-volume"), {
      target: { value: "0.85" },
    });
    expect(onChange).toHaveBeenCalledWith({ enabled: true, volume: 0.85 });
  });

  it("falls back to safe defaults when value is undefined", () => {
    // Robust to a partial config blob coming from the backend.
    render(
      <AudioFeedback
        label="Audio feedback"
        // @ts-expect-error \u2014 deliberately exercising the defensive path
        value={undefined}
        onChange={() => {}}
      />,
    );
    const toggle = screen.getByTestId("audio-feedback-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });
});
