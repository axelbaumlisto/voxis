import { describe, it, expect } from "vitest";
import {
  getStatusClass,
  getStatusText,
  getStatusIcon,
  formatHotkey,
  formatHotkeySimple,
  RecordingState,
  StatusInfo,
} from "../status";

describe("status.ts", () => {
  // ===========================================================================
  // getStatusClass Tests
  // ===========================================================================
  describe("getStatusClass", () => {
    it("returns 'error' when error is present", () => {
      expect(getStatusClass("idle", "Something went wrong")).toBe("error");
      expect(getStatusClass("recording", "Error message")).toBe("error");
      expect(getStatusClass("transcribing", "Failed")).toBe("error");
    });

    it("returns state when no error", () => {
      expect(getStatusClass("idle", null)).toBe("idle");
      expect(getStatusClass("recording", null)).toBe("recording");
      expect(getStatusClass("transcribing", null)).toBe("transcribing");
    });
  });

  // ===========================================================================
  // getStatusText Tests
  // ===========================================================================
  describe("getStatusText", () => {
    it("shows error message when error is present", () => {
      const info: StatusInfo = { state: "idle", error: "API Error", hotkey: "Ctrl (Right)" };
      expect(getStatusText(info)).toBe("! API Error");
    });

    it("shows recording message with hotkey", () => {
      const info: StatusInfo = { state: "recording", error: null, hotkey: "F12" };
      expect(getStatusText(info)).toBe("REC  Recording...  Release F12 to stop");
    });

    it("shows transcribing message", () => {
      const info: StatusInfo = { state: "transcribing", error: null, hotkey: "Ctrl" };
      expect(getStatusText(info)).toBe("Transcribing...  Please wait");
    });

    it("shows ready message with hotkey", () => {
      const info: StatusInfo = { state: "idle", error: null, hotkey: "Alt (Right)" };
      expect(getStatusText(info)).toBe("Ready  Press Alt (Right) to record");
    });

    it("error takes precedence over state", () => {
      const info: StatusInfo = { state: "recording", error: "Connection lost", hotkey: "F12" };
      expect(getStatusText(info)).toContain("Connection lost");
      expect(getStatusText(info)).not.toContain("Recording");
    });
  });

  // ===========================================================================
  // getStatusIcon Tests
  // ===========================================================================
  describe("getStatusIcon", () => {
    it("returns ! for error", () => {
      expect(getStatusIcon("idle", "error")).toBe("!");
      expect(getStatusIcon("recording", "error")).toBe("!");
    });

    it("returns filled circle for recording", () => {
      expect(getStatusIcon("recording", null)).toBe("\u25CF");
    });

    it("returns half circle for transcribing", () => {
      expect(getStatusIcon("transcribing", null)).toBe("\u25D0");
    });

    it("returns empty circle for idle", () => {
      expect(getStatusIcon("idle", null)).toBe("\u25CB");
    });
  });

  // ===========================================================================
  // formatHotkey Tests
  // ===========================================================================
  describe("formatHotkey", () => {
    it("formats right modifier", () => {
      expect(formatHotkey("ctrl_r")).toBe("Ctrl (Right)");
      expect(formatHotkey("alt_r")).toBe("Alt (Right)");
    });

    it("formats left modifier", () => {
      expect(formatHotkey("ctrl_l")).toBe("Ctrl (Left)");
      expect(formatHotkey("alt_l")).toBe("Alt (Left)");
    });

    it("formats ctrl", () => {
      expect(formatHotkey("ctrl")).toBe("Ctrl");
      expect(formatHotkey("CTRL")).toBe("Ctrl");
    });

    it("formats alt", () => {
      expect(formatHotkey("alt")).toBe("Alt");
      expect(formatHotkey("ALT")).toBe("Alt");
    });

    it("formats shift", () => {
      expect(formatHotkey("shift")).toBe("Shift");
      expect(formatHotkey("SHIFT")).toBe("Shift");
    });

    it("formats super", () => {
      expect(formatHotkey("super")).toBe("Super");
    });

    it("formats function keys", () => {
      expect(formatHotkey("f1")).toBe("F1");
      expect(formatHotkey("f12")).toBe("F12");
      expect(formatHotkey("F10")).toBe("F10");
    });

    it("handles mixed case", () => {
      expect(formatHotkey("Ctrl_R")).toBe("Ctrl (Right)");
      expect(formatHotkey("Alt_L")).toBe("Alt (Left)");
    });
  });

  // ===========================================================================
  // formatHotkeySimple Tests
  // ===========================================================================
  describe("formatHotkeySimple", () => {
    it("replaces underscores with plus", () => {
      expect(formatHotkeySimple("ctrl_r")).toBe("Ctrl+r");
    });

    it("capitalizes modifiers", () => {
      expect(formatHotkeySimple("ctrl")).toBe("Ctrl");
      expect(formatHotkeySimple("alt")).toBe("Alt");
      expect(formatHotkeySimple("shift")).toBe("Shift");
      expect(formatHotkeySimple("super")).toBe("Super");
    });

    it("handles multiple underscores", () => {
      expect(formatHotkeySimple("ctrl_shift_a")).toBe("Ctrl+Shift+a");
    });
  });

  // ===========================================================================
  // Type Tests
  // ===========================================================================
  describe("types", () => {
    it("RecordingState accepts valid values", () => {
      const states: RecordingState[] = ["idle", "recording", "transcribing"];
      expect(states.length).toBe(3);
    });

    it("StatusInfo has required fields", () => {
      const info: StatusInfo = {
        state: "idle",
        error: null,
        hotkey: "F12",
      };
      expect(info.state).toBe("idle");
      expect(info.error).toBeNull();
      expect(info.hotkey).toBe("F12");
    });
  });
});
