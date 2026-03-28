import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LANGUAGE_OPTIONS,
  BACKEND_OPTIONS,
  OVERLAY_POSITION_OPTIONS,
  OVERLAY_SIZE_OPTIONS,
  AUDIO_BOOST_OPTIONS,
  HOTKEY_OPTIONS,
  CLOUD_PROVIDER_OPTIONS,
  WHISPER_MODEL_OPTIONS,
  LEARNING_MODE_OPTIONS,
  getHotkeyOptions,
  SelectOption,
} from "../constants";

/**
 * Helper to validate option array structure.
 */
function validateOptions(options: SelectOption[], name: string) {
  it(`${name} has valid structure`, () => {
    expect(Array.isArray(options)).toBe(true);
    expect(options.length).toBeGreaterThan(0);

    for (const option of options) {
      expect(option).toHaveProperty("label");
      expect(option).toHaveProperty("value");
      expect(typeof option.label).toBe("string");
      expect(typeof option.value).toBe("string");
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.value.length).toBeGreaterThan(0);
    }
  });

  it(`${name} has unique values`, () => {
    const values = options.map((o) => o.value);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });
}

describe("Constants Validation", () => {
  describe("LANGUAGE_OPTIONS", () => {
    validateOptions(LANGUAGE_OPTIONS, "LANGUAGE_OPTIONS");

    it("includes auto-detect option", () => {
      const autoOption = LANGUAGE_OPTIONS.find((o) => o.value === "auto");
      expect(autoOption).toBeDefined();
      expect(autoOption?.label).toBe("Auto-detect");
    });

    it("includes common languages", () => {
      const values = LANGUAGE_OPTIONS.map((o) => o.value);
      expect(values).toContain("en");
      expect(values).toContain("ru");
      expect(values).toContain("de");
      expect(values).toContain("fr");
    });
  });

  describe("BACKEND_OPTIONS", () => {
    validateOptions(BACKEND_OPTIONS, "BACKEND_OPTIONS");

    it("includes auto option", () => {
      const autoOption = BACKEND_OPTIONS.find((o) => o.value === "auto");
      expect(autoOption).toBeDefined();
    });

    it("includes platform-specific backends", () => {
      const values = BACKEND_OPTIONS.map((o) => o.value);
      expect(values).toContain("x11");
      expect(values).toContain("wayland");
    });
  });

  describe("OVERLAY_POSITION_OPTIONS", () => {
    validateOptions(OVERLAY_POSITION_OPTIONS, "OVERLAY_POSITION_OPTIONS");

    it("has 9 positions", () => {
      expect(OVERLAY_POSITION_OPTIONS.length).toBe(9);
    });

    it("includes corner positions", () => {
      const values = OVERLAY_POSITION_OPTIONS.map((o) => o.value);
      expect(values).toContain("bottom_left");
      expect(values).toContain("bottom_right");
      expect(values).toContain("top_left");
      expect(values).toContain("top_right");
    });

    it("includes center position", () => {
      const centerOption = OVERLAY_POSITION_OPTIONS.find(
        (o) => o.value === "center"
      );
      expect(centerOption).toBeDefined();
    });
  });

  describe("OVERLAY_SIZE_OPTIONS", () => {
    validateOptions(OVERLAY_SIZE_OPTIONS, "OVERLAY_SIZE_OPTIONS");

    it("has 3 size options", () => {
      expect(OVERLAY_SIZE_OPTIONS.length).toBe(3);
    });

    it("includes small, medium, large", () => {
      const values = OVERLAY_SIZE_OPTIONS.map((o) => o.value);
      expect(values).toContain("small");
      expect(values).toContain("medium");
      expect(values).toContain("large");
    });
  });

  describe("AUDIO_BOOST_OPTIONS", () => {
    validateOptions(AUDIO_BOOST_OPTIONS, "AUDIO_BOOST_OPTIONS");

    it("values are numeric strings", () => {
      for (const option of AUDIO_BOOST_OPTIONS) {
        const numValue = Number(option.value);
        expect(Number.isNaN(numValue)).toBe(false);
        expect(numValue).toBeGreaterThan(0);
      }
    });

    it("values are in ascending order", () => {
      const numericValues = AUDIO_BOOST_OPTIONS.map((o) => Number(o.value));
      for (let i = 1; i < numericValues.length; i++) {
        expect(numericValues[i]).toBeGreaterThan(numericValues[i - 1]);
      }
    });
  });

  describe("HOTKEY_OPTIONS", () => {
    validateOptions(HOTKEY_OPTIONS, "HOTKEY_OPTIONS");

    it("includes function keys", () => {
      const values = HOTKEY_OPTIONS.map((o) => o.value);
      expect(values.some((v) => v.startsWith("f"))).toBe(true);
    });

    it("includes ctrl modifiers", () => {
      const values = HOTKEY_OPTIONS.map((o) => o.value);
      expect(values.some((v) => v.includes("ctrl"))).toBe(true);
    });
  });

  describe("CLOUD_PROVIDER_OPTIONS", () => {
    validateOptions(CLOUD_PROVIDER_OPTIONS, "CLOUD_PROVIDER_OPTIONS");

    it("includes groq and openai", () => {
      const values = CLOUD_PROVIDER_OPTIONS.map((o) => o.value);
      expect(values).toContain("groq");
      expect(values).toContain("openai");
    });
  });

  describe("WHISPER_MODEL_OPTIONS", () => {
    validateOptions(WHISPER_MODEL_OPTIONS, "WHISPER_MODEL_OPTIONS");

    it("includes whisper models", () => {
      for (const option of WHISPER_MODEL_OPTIONS) {
        expect(option.value.toLowerCase()).toContain("whisper");
      }
    });
  });

  describe("LEARNING_MODE_OPTIONS", () => {
    validateOptions(LEARNING_MODE_OPTIONS, "LEARNING_MODE_OPTIONS");

    it("includes disabled option", () => {
      const disabledOption = LEARNING_MODE_OPTIONS.find(
        (o) => o.value === "disabled"
      );
      expect(disabledOption).toBeDefined();
    });

    it("includes auto option", () => {
      const autoOption = LEARNING_MODE_OPTIONS.find((o) => o.value === "auto");
      expect(autoOption).toBeDefined();
    });
  });

  describe("getHotkeyOptions (dynamic)", () => {
    // Note: platform() is mocked to return "macos" in test setup
    // We test the behavior with the mocked platform

    it("returns an array of options", () => {
      const options = getHotkeyOptions();
      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);
    });

    it("all options have label and value", () => {
      const options = getHotkeyOptions();
      for (const option of options) {
        expect(option).toHaveProperty("label");
        expect(option).toHaveProperty("value");
        expect(typeof option.label).toBe("string");
        expect(typeof option.value).toBe("string");
      }
    });

    it("includes Command keys on macOS (mocked)", () => {
      const options = getHotkeyOptions();
      const superL = options.find(o => o.value === "super_l");
      const superR = options.find(o => o.value === "super_r");

      expect(superL).toBeDefined();
      expect(superR).toBeDefined();
    });

    it("uses macOS symbols on macOS (mocked)", () => {
      const options = getHotkeyOptions();

      const cmdL = options.find(o => o.value === "super_l");
      const altL = options.find(o => o.value === "alt_l");
      const ctrlL = options.find(o => o.value === "ctrl_l");

      expect(cmdL?.label).toContain("⌘");
      expect(altL?.label).toContain("⌥");
      expect(ctrlL?.label).toContain("⌃");
    });

    it("includes function keys", () => {
      const options = getHotkeyOptions();
      const f12 = options.find(o => o.value === "f12");
      const f8 = options.find(o => o.value === "f8");

      expect(f12).toBeDefined();
      expect(f8).toBeDefined();
      expect(f12?.label).toBe("F12");
    });

    it("includes Ctrl and Alt keys", () => {
      const options = getHotkeyOptions();

      expect(options.find(o => o.value === "ctrl_l")).toBeDefined();
      expect(options.find(o => o.value === "ctrl_r")).toBeDefined();
      expect(options.find(o => o.value === "alt_l")).toBeDefined();
      expect(options.find(o => o.value === "alt_r")).toBeDefined();
    });
  });
});
