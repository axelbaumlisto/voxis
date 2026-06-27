import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleShortcut,
  getFooterShortcuts,
  SHORTCUTS,
  ShortcutContext,
} from "../keyboardShortcuts";

describe("keyboardShortcuts", () => {
  let mockContext: ShortcutContext;

  beforeEach(() => {
    mockContext = {
      navigate: vi.fn(),
      lastTranscription: null,
      closeWindow: vi.fn(),
    };
  });

  describe("handleShortcut", () => {
    it("ignores events from input elements", () => {
      const input = document.createElement("input");
      const event = new KeyboardEvent("keydown", { key: "h" });
      Object.defineProperty(event, "target", { value: input });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(false);
      expect(mockContext.navigate).not.toHaveBeenCalled();
    });

    it("ignores events from textarea elements", () => {
      const textarea = document.createElement("textarea");
      const event = new KeyboardEvent("keydown", { key: "s" });
      Object.defineProperty(event, "target", { value: textarea });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(false);
      expect(mockContext.navigate).not.toHaveBeenCalled();
    });

    it("handles Escape key to close window", () => {
      const event = new KeyboardEvent("keydown", { key: "Escape" });
      Object.defineProperty(event, "target", { value: document.body });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(true);
      expect(mockContext.closeWindow).toHaveBeenCalled();
    });

    it("handles h key to navigate to history", () => {
      const event = new KeyboardEvent("keydown", { key: "h" });
      Object.defineProperty(event, "target", { value: document.body });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(true);
      expect(mockContext.navigate).toHaveBeenCalledWith("/history");
    });

    it("handles w key to navigate to dictionary", () => {
      const event = new KeyboardEvent("keydown", { key: "w" });
      Object.defineProperty(event, "target", { value: document.body });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(true);
      expect(mockContext.navigate).toHaveBeenCalledWith("/dictionary");
    });

    it("handles s key to navigate to settings", () => {
      const event = new KeyboardEvent("keydown", { key: "s" });
      Object.defineProperty(event, "target", { value: document.body });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(true);
      expect(mockContext.navigate).toHaveBeenCalledWith("/settings");
    });

    it("handles c key to copy transcription when available", () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: mockWriteText },
      });

      mockContext.lastTranscription = "Test transcription";
      const event = new KeyboardEvent("keydown", { key: "c" });
      Object.defineProperty(event, "target", { value: document.body });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(true);
      expect(mockWriteText).toHaveBeenCalledWith("Test transcription");
    });

    it("handles c key gracefully when no transcription", () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: mockWriteText },
      });

      mockContext.lastTranscription = null;
      const event = new KeyboardEvent("keydown", { key: "c" });
      Object.defineProperty(event, "target", { value: document.body });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(true);
      expect(mockWriteText).not.toHaveBeenCalled();
    });

    it("returns false for unregistered keys", () => {
      const event = new KeyboardEvent("keydown", { key: "x" });
      Object.defineProperty(event, "target", { value: document.body });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(false);
    });

    it("handles uppercase keys by converting to lowercase", () => {
      const event = new KeyboardEvent("keydown", { key: "H" });
      Object.defineProperty(event, "target", { value: document.body });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(true);
      expect(mockContext.navigate).toHaveBeenCalledWith("/history");
    });

    it("matches by physical code under a non-Latin layout (Russian)", () => {
      // Physical H key on a Russian layout emits the char "р", but code stays "KeyH".
      const event = new KeyboardEvent("keydown", { key: "р", code: "KeyH" });
      Object.defineProperty(event, "target", { value: document.body });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(true);
      expect(mockContext.navigate).toHaveBeenCalledWith("/history");
    });

    it("matches Settings by code under Russian layout (s -> ы)", () => {
      const event = new KeyboardEvent("keydown", { key: "ы", code: "KeyS" });
      Object.defineProperty(event, "target", { value: document.body });

      const result = handleShortcut(event, mockContext);
      expect(result).toBe(true);
      expect(mockContext.navigate).toHaveBeenCalledWith("/settings");
    });
  });

  describe("getFooterShortcuts", () => {
    it("returns all shortcuts", () => {
      const shortcuts = getFooterShortcuts();
      expect(shortcuts).toBe(SHORTCUTS);
      expect(shortcuts.length).toBeGreaterThan(0);
    });

    it("includes expected shortcuts", () => {
      const shortcuts = getFooterShortcuts();
      const keys = shortcuts.map((s) => s.key);

      expect(keys).toContain("h");
      expect(keys).toContain("w");
      expect(keys).toContain("s");
      expect(keys).toContain("c");
      expect(keys).toContain("escape");
    });

    it("has labels for all shortcuts", () => {
      const shortcuts = getFooterShortcuts();

      for (const shortcut of shortcuts) {
        expect(shortcut.label).toBeTruthy();
        expect(shortcut.keyLabel).toBeTruthy();
      }
    });
  });

  describe("SHORTCUTS registry", () => {
    it("all shortcuts have required properties", () => {
      for (const shortcut of SHORTCUTS) {
        expect(shortcut.code).toBeTruthy();
        expect(shortcut.key).toBeTruthy();
        expect(shortcut.label).toBeTruthy();
        expect(shortcut.keyLabel).toBeTruthy();
        expect(typeof shortcut.action).toBe("function");
      }
    });

    it("shortcuts have unique keys", () => {
      const keys = SHORTCUTS.map((s) => s.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it("shortcuts have unique physical codes", () => {
      const codes = SHORTCUTS.map((s) => s.code);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });
});
