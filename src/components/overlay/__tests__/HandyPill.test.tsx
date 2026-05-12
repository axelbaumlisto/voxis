import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import HandyPill from "../HandyPill";

const BARS_RECORDING = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

describe("HandyPill", () => {
  it("renders compact pill root with fade-in class when visible", () => {
    const { container } = render(<HandyPill mode="recording" bars={BARS_RECORDING} visible />);
    const root = container.querySelector(".recording-overlay")!;
    expect(root).toBeTruthy();
    expect(root.className).toContain("fade-in");
  });

  it("omits fade-in when visible=false", () => {
    const { container } = render(<HandyPill mode="recording" bars={BARS_RECORDING} visible={false} />);
    const root = container.querySelector(".recording-overlay")!;
    expect(root.className).not.toContain("fade-in");
  });

  it("recording mode: shows MicrophoneIcon + bars + cancel button", () => {
    const { container, queryByTestId } = render(
      <HandyPill mode="recording" bars={BARS_RECORDING} visible />,
    );
    expect(queryByTestId("handy-pill-icon-microphone")).not.toBeNull();
    expect(queryByTestId("handy-pill-icon-transcription")).toBeNull();
    expect(container.querySelectorAll(".bar").length).toBe(BARS_RECORDING.length);
    expect(queryByTestId("handy-pill-cancel")).not.toBeNull();
  });

  it("transcribing mode: shows TranscriptionIcon + text, no bars, no cancel", () => {
    const { container, queryByTestId, getByText } = render(
      <HandyPill mode="transcribing" bars={BARS_RECORDING} visible />,
    );
    expect(queryByTestId("handy-pill-icon-transcription")).not.toBeNull();
    expect(queryByTestId("handy-pill-icon-microphone")).toBeNull();
    expect(getByText(/transcribing/i)).toBeTruthy();
    expect(container.querySelectorAll(".bar").length).toBe(0);
    expect(queryByTestId("handy-pill-cancel")).toBeNull();
  });

  it("idle mode: shows TranscriptionIcon, no bars, no cancel", () => {
    const { container, queryByTestId } = render(
      <HandyPill mode="idle" bars={BARS_RECORDING} visible />,
    );
    expect(queryByTestId("handy-pill-icon-transcription")).not.toBeNull();
    expect(container.querySelectorAll(".bar").length).toBe(0);
    expect(queryByTestId("handy-pill-cancel")).toBeNull();
  });

  it("error mode: shows transcription icon and error text", () => {
    const { container, getByText } = render(
      <HandyPill mode="error" bars={BARS_RECORDING} visible />,
    );
    expect(getByText(/error/i)).toBeTruthy();
    expect(container.querySelectorAll(".bar").length).toBe(0);
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    const { getByTestId } = render(
      <HandyPill mode="recording" bars={BARS_RECORDING} visible onCancel={onCancel} />,
    );
    fireEvent.click(getByTestId("handy-pill-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not crash when onCancel is omitted", () => {
    const { getByTestId } = render(
      <HandyPill mode="recording" bars={BARS_RECORDING} visible />,
    );
    expect(() => fireEvent.click(getByTestId("handy-pill-cancel"))).not.toThrow();
  });
});
