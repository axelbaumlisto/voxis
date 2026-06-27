import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

// Mock tauri window
const mockHide = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    hide: mockHide,
  }),
}));

// Mock clipboard
const mockCopyToClipboard = vi.fn();
vi.mock("../../lib/clipboard", () => ({
  copyToClipboard: (text: string) => mockCopyToClipboard(text),
}));

describe("useKeyboardShortcuts", () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Capture the keydown handler
    addEventListenerSpy = vi.spyOn(window, "addEventListener").mockImplementation((event, handler) => {
      if (event === "keydown") {
        keydownHandler = handler as (e: KeyboardEvent) => void;
      }
    });
    removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
    keydownHandler = null;
  });

  it("registers keydown listener on mount", () => {
    renderHook(() => useKeyboardShortcuts(null));
    expect(addEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("removes keydown listener on unmount", () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(null));
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("calls navigate for 'h' key (History)", () => {
    renderHook(() => useKeyboardShortcuts(null));
    expect(keydownHandler).not.toBeNull();

    const event = new KeyboardEvent("keydown", { key: "h" });
    keydownHandler!(event);

    expect(mockNavigate).toHaveBeenCalledWith("/history");
  });

  it("calls navigate for 'w' key (Dictionary)", () => {
    renderHook(() => useKeyboardShortcuts(null));
    expect(keydownHandler).not.toBeNull();

    const event = new KeyboardEvent("keydown", { key: "w" });
    keydownHandler!(event);

    expect(mockNavigate).toHaveBeenCalledWith("/dictionary");
  });

  it("calls navigate for 's' key (Settings)", () => {
    renderHook(() => useKeyboardShortcuts(null));
    expect(keydownHandler).not.toBeNull();

    const event = new KeyboardEvent("keydown", { key: "s" });
    keydownHandler!(event);

    expect(mockNavigate).toHaveBeenCalledWith("/settings");
  });

  it("copies to clipboard for 'c' key when transcription exists", () => {
    renderHook(() => useKeyboardShortcuts("Hello, world!"));
    expect(keydownHandler).not.toBeNull();

    const event = new KeyboardEvent("keydown", { key: "c" });
    keydownHandler!(event);

    expect(mockCopyToClipboard).toHaveBeenCalledWith("Hello, world!");
  });

  it("does not copy if lastTranscription is null", () => {
    renderHook(() => useKeyboardShortcuts(null));
    expect(keydownHandler).not.toBeNull();

    const event = new KeyboardEvent("keydown", { key: "c" });
    keydownHandler!(event);

    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it("hides window for Escape key", () => {
    renderHook(() => useKeyboardShortcuts(null));
    expect(keydownHandler).not.toBeNull();

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    keydownHandler!(event);

    expect(mockHide).toHaveBeenCalled();
  });

  it("ignores keypresses from input elements", () => {
    renderHook(() => useKeyboardShortcuts(null));
    expect(keydownHandler).not.toBeNull();

    const inputElement = document.createElement("input");
    const event = new KeyboardEvent("keydown", { key: "h" });
    Object.defineProperty(event, "target", { value: inputElement });
    keydownHandler!(event);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("ignores keypresses from textarea elements", () => {
    renderHook(() => useKeyboardShortcuts(null));
    expect(keydownHandler).not.toBeNull();

    const textareaElement = document.createElement("textarea");
    const event = new KeyboardEvent("keydown", { key: "s" });
    Object.defineProperty(event, "target", { value: textareaElement });
    keydownHandler!(event);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("ignores unknown shortcuts", () => {
    renderHook(() => useKeyboardShortcuts(null));
    expect(keydownHandler).not.toBeNull();

    const event = new KeyboardEvent("keydown", { key: "z" });
    keydownHandler!(event);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockHide).not.toHaveBeenCalled();
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it("updates context when dependencies change", () => {
    const { rerender } = renderHook(
      ({ transcription }) => useKeyboardShortcuts(transcription),
      { initialProps: { transcription: null as string | null } }
    );

    // Initially no transcription
    let event = new KeyboardEvent("keydown", { key: "c" });
    keydownHandler!(event);
    expect(mockCopyToClipboard).not.toHaveBeenCalled();

    // Clear mocks and rerender with transcription
    vi.clearAllMocks();
    rerender({ transcription: "New transcription" });

    // Now 'c' should copy
    event = new KeyboardEvent("keydown", { key: "c" });
    keydownHandler!(event);
    expect(mockCopyToClipboard).toHaveBeenCalledWith("New transcription");
  });
});
