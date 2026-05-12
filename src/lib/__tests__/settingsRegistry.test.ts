import { describe, it, expect } from "vitest";
import {
  SETTINGS_REGISTRY,
  getSections,
  getSettingsBySection,
  SettingDefinition,
  WidgetType,
} from "../settingsRegistry";

describe("settingsRegistry.ts", () => {
  // ===========================================================================
  // Registry Structure Tests
  // ===========================================================================
  describe("SETTINGS_REGISTRY structure", () => {
    it("is a non-empty array", () => {
      expect(Array.isArray(SETTINGS_REGISTRY)).toBe(true);
      expect(SETTINGS_REGISTRY.length).toBeGreaterThan(0);
    });

    it("contains all required sections", () => {
      const sections = getSections();
      expect(sections).toContain("Provider");
      expect(sections).toContain("Recording");
      expect(sections).toContain("Output");
      expect(sections).toContain("Overlay");
      expect(sections).toContain("VAD");
      expect(sections).toContain("LLM");
      expect(sections).toContain("Advanced");
    });

    it("VAD section has backend selector and tuning controls", () => {
      const vad = getSettingsBySection("VAD");
      const keys = vad.map((s) => s.key);
      expect(keys).toContain("vad.backend");
      expect(keys).toContain("vad.onset_frames");
      expect(keys).toContain("vad.hangover_frames");
      expect(keys).toContain("vad.prefill_frames");
    });

    it("each setting has required fields", () => {
      for (const setting of SETTINGS_REGISTRY) {
        expect(setting).toHaveProperty("key");
        expect(setting).toHaveProperty("label");
        expect(setting).toHaveProperty("widgetType");
        expect(setting).toHaveProperty("section");

        expect(typeof setting.key).toBe("string");
        expect(setting.key.length).toBeGreaterThan(0);
        expect(typeof setting.label).toBe("string");
        expect(setting.label.length).toBeGreaterThan(0);
        expect(typeof setting.section).toBe("string");
        expect(setting.section.length).toBeGreaterThan(0);
      }
    });

    it("all keys are unique", () => {
      const keys = SETTINGS_REGISTRY.map((s) => s.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it("widgetType is valid type", () => {
      const validTypes: WidgetType[] = ["select", "switch", "input", "password", "hotkey", "custom"];
      for (const setting of SETTINGS_REGISTRY) {
        expect(validTypes).toContain(setting.widgetType);
      }
    });
  });

  // ===========================================================================
  // Select Widget Tests
  // ===========================================================================
  describe("select widgets", () => {
    const selectSettings = SETTINGS_REGISTRY.filter((s) => s.widgetType === "select");

    // Helper to get options from a setting (supports both static and dynamic options)
    const getSettingOptions = (setting: typeof selectSettings[0]) => {
      return setting.getOptions?.() ?? setting.options ?? [];
    };

    it("all select widgets have options array or getOptions function", () => {
      for (const setting of selectSettings) {
        const hasOptions = setting.options !== undefined || setting.getOptions !== undefined;
        expect(hasOptions).toBe(true);
        const options = getSettingOptions(setting);
        expect(Array.isArray(options)).toBe(true);
        expect(options.length).toBeGreaterThan(0);
      }
    });

    it("all options have label and value", () => {
      for (const setting of selectSettings) {
        for (const option of getSettingOptions(setting)) {
          expect(option).toHaveProperty("label");
          expect(option).toHaveProperty("value");
          expect(typeof option.label).toBe("string");
          expect(typeof option.value).toBe("string");
        }
      }
    });

    it("option labels are not empty", () => {
      for (const setting of selectSettings) {
        for (const option of getSettingOptions(setting)) {
          expect(option.label.length).toBeGreaterThan(0);
        }
      }
    });
  });

  // ===========================================================================
  // Switch Widget Tests
  // ===========================================================================
  describe("switch widgets", () => {
    const switchSettings = SETTINGS_REGISTRY.filter((s) => s.widgetType === "switch");

    it("has switch settings", () => {
      expect(switchSettings.length).toBeGreaterThan(0);
    });

    it("switch settings do not have options", () => {
      for (const setting of switchSettings) {
        expect(setting.options).toBeUndefined();
      }
    });

    it("switch settings may have description", () => {
      const withDescription = switchSettings.filter((s) => s.description);
      expect(withDescription.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Input Widget Tests
  // ===========================================================================
  describe("input widgets", () => {
    const inputSettings = SETTINGS_REGISTRY.filter((s) => s.widgetType === "input");

    it("has input settings", () => {
      expect(inputSettings.length).toBeGreaterThan(0);
    });

    it("input settings may have placeholder", () => {
      const withPlaceholder = inputSettings.filter((s) => s.placeholder);
      expect(withPlaceholder.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Password Widget Tests
  // ===========================================================================
  describe("password widgets", () => {
    const passwordSettings = SETTINGS_REGISTRY.filter((s) => s.widgetType === "password");

    it("has password settings", () => {
      expect(passwordSettings.length).toBeGreaterThan(0);
    });

    it("api_key uses password widget", () => {
      const apiKeySetting = SETTINGS_REGISTRY.find((s) => s.key === "api_key");
      expect(apiKeySetting?.widgetType).toBe("password");
    });

    it("llm.api_key uses password widget", () => {
      const llmApiKeySetting = SETTINGS_REGISTRY.find((s) => s.key === "llm.api_key");
      expect(llmApiKeySetting?.widgetType).toBe("password");
    });
  });

  // ===========================================================================
  // Nested Key Tests
  // ===========================================================================
  describe("nested keys (dot notation)", () => {
    const nestedKeys = SETTINGS_REGISTRY.filter((s) => s.key.includes("."));

    it("has nested keys", () => {
      expect(nestedKeys.length).toBeGreaterThan(0);
    });

    it("overlay settings use nested keys", () => {
      const overlayKeys = nestedKeys.filter((s) => s.key.startsWith("overlay."));
      expect(overlayKeys.length).toBeGreaterThan(0);
      expect(overlayKeys.some((s) => s.key === "overlay.enabled")).toBe(true);
      expect(overlayKeys.some((s) => s.key === "overlay.position")).toBe(true);
      expect(overlayKeys.some((s) => s.key === "overlay.size")).toBe(true);
      expect(overlayKeys.some((s) => s.key === "overlay.margin")).toBe(true);
    });

    it("llm settings use nested keys", () => {
      const llmKeys = nestedKeys.filter((s) => s.key.startsWith("llm."));
      expect(llmKeys.length).toBeGreaterThan(0);
      expect(llmKeys.some((s) => s.key === "llm.enabled")).toBe(true);
      expect(llmKeys.some((s) => s.key === "llm.api_key")).toBe(true);
    });

    it("nested keys have exactly two parts", () => {
      for (const setting of nestedKeys) {
        const parts = setting.key.split(".");
        expect(parts.length).toBe(2);
        expect(parts[0].length).toBeGreaterThan(0);
        expect(parts[1].length).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================
  // getSections Tests
  // ===========================================================================
  describe("getSections", () => {
    it("returns array of strings", () => {
      const sections = getSections();
      expect(Array.isArray(sections)).toBe(true);
      sections.forEach((s) => expect(typeof s).toBe("string"));
    });

    it("returns unique sections", () => {
      const sections = getSections();
      const unique = new Set(sections);
      expect(unique.size).toBe(sections.length);
    });

    it("preserves order of appearance", () => {
      const sections = getSections();
      // First setting's section should be first in list
      expect(sections[0]).toBe(SETTINGS_REGISTRY[0].section);
    });

    it("contains expected number of sections", () => {
      const sections = getSections();
      expect(sections.length).toBeGreaterThanOrEqual(6); // Provider, Recording, Output, Overlay, LLM, Advanced
    });
  });

  // ===========================================================================
  // getSettingsBySection Tests
  // ===========================================================================
  describe("getSettingsBySection", () => {
    it("returns array of settings", () => {
      const settings = getSettingsBySection("Provider");
      expect(Array.isArray(settings)).toBe(true);
    });

    it("all returned settings belong to requested section", () => {
      const sections = getSections();
      for (const section of sections) {
        const settings = getSettingsBySection(section);
        for (const setting of settings) {
          expect(setting.section).toBe(section);
        }
      }
    });

    it("returns non-empty array for known sections", () => {
      const sections = getSections();
      for (const section of sections) {
        const settings = getSettingsBySection(section);
        expect(settings.length).toBeGreaterThan(0);
      }
    });

    it("returns empty array for unknown section", () => {
      const settings = getSettingsBySection("NonExistentSection");
      expect(settings).toEqual([]);
    });

    it("Provider section has api_key and model", () => {
      const settings = getSettingsBySection("Provider");
      const keys = settings.map((s) => s.key);
      expect(keys).toContain("api_key");
      expect(keys).toContain("model");
      expect(keys).toContain("language");
    });

    it("Recording section has hotkey", () => {
      const settings = getSettingsBySection("Recording");
      const keys = settings.map((s) => s.key);
      expect(keys).toContain("hotkey");
    });

    it("Output section has auto_type", () => {
      const settings = getSettingsBySection("Output");
      const keys = settings.map((s) => s.key);
      expect(keys).toContain("auto_type");
      expect(keys).toContain("auto_enter");
      expect(keys).toContain("notifications");
    });

    it("Overlay section has overlay.enabled", () => {
      const settings = getSettingsBySection("Overlay");
      const keys = settings.map((s) => s.key);
      expect(keys).toContain("overlay.enabled");
      expect(keys).toContain("overlay.position");
    });

    it("overlay.theme uses the async custom theme selector", () => {
      const setting = SETTINGS_REGISTRY.find((s) => s.key === "overlay.theme");
      expect(setting).toBeDefined();
      expect(setting?.widgetType).toBe("custom");
      expect(setting?.customComponent).toBe("theme-select");
      expect(setting?.options).toBeUndefined();
    });

    it("overlay.backend uses the platform-aware custom selector", () => {
      const setting = SETTINGS_REGISTRY.find((s) => s.key === "overlay.backend");
      expect(setting).toBeDefined();
      expect(setting?.widgetType).toBe("custom");
      expect(setting?.customComponent).toBe("overlay-backend-select");
      // Options for `overlay.backend` are owned by the custom component
      // (so it can render per-option `disabled` based on platform).
      expect(setting?.options).toBeUndefined();
    });

    it("LLM section has llm.enabled", () => {
      const settings = getSettingsBySection("LLM");
      const keys = settings.map((s) => s.key);
      expect(keys).toContain("llm.enabled");
    });

    it("Advanced section has debug", () => {
      const settings = getSettingsBySection("Advanced");
      const keys = settings.map((s) => s.key);
      expect(keys).toContain("debug");
      expect(keys).toContain("backend");
    });
  });

  // ===========================================================================
  // Specific Settings Tests
  // ===========================================================================
  describe("specific settings validation", () => {
    it("cloud_provider has groq and openai options", () => {
      const setting = SETTINGS_REGISTRY.find((s) => s.key === "cloud_provider");
      expect(setting).toBeDefined();
      expect(setting?.widgetType).toBe("select");
      const values = setting?.options?.map((o) => o.value);
      expect(values).toContain("groq");
      expect(values).toContain("openai");
    });

    it("model has whisper model options", () => {
      const setting = SETTINGS_REGISTRY.find((s) => s.key === "model");
      expect(setting).toBeDefined();
      expect(setting?.widgetType).toBe("select");
      const values = setting?.options?.map((o) => o.value);
      expect(values).toContain("whisper-large-v3");
    });

    it("language has auto and common languages", () => {
      const setting = SETTINGS_REGISTRY.find((s) => s.key === "language");
      expect(setting).toBeDefined();
      const values = setting?.options?.map((o) => o.value);
      expect(values).toContain("auto");
      expect(values).toContain("en");
      expect(values).toContain("ru");
    });

    it("hotkey has function key and ctrl options", () => {
      const setting = SETTINGS_REGISTRY.find((s) => s.key === "hotkey");
      expect(setting).toBeDefined();
      // hotkey uses getOptions for dynamic platform-specific options
      const options = setting?.getOptions?.() ?? setting?.options ?? [];
      const values = options.map((o) => o.value);
      expect(values).toContain("ctrl_r");
      expect(values).toContain("f12");
    });

    it("overlay.position has all corner and center options", () => {
      const setting = SETTINGS_REGISTRY.find((s) => s.key === "overlay.position");
      expect(setting).toBeDefined();
      const values = setting?.options?.map((o) => o.value);
      expect(values).toContain("bottom_left");
      expect(values).toContain("bottom_right");
      expect(values).toContain("top_left");
      expect(values).toContain("top_right");
      expect(values).toContain("center");
    });

    it("overlay.size has small, medium, large", () => {
      const setting = SETTINGS_REGISTRY.find((s) => s.key === "overlay.size");
      expect(setting).toBeDefined();
      const values = setting?.options?.map((o) => o.value);
      expect(values).toContain("small");
      expect(values).toContain("medium");
      expect(values).toContain("large");
    });

    it("backend has platform options", () => {
      const setting = SETTINGS_REGISTRY.find((s) => s.key === "backend");
      expect(setting).toBeDefined();
      const values = setting?.options?.map((o) => o.value);
      expect(values).toContain("auto");
      expect(values).toContain("x11");
      expect(values).toContain("wayland");
    });
  });

  // ===========================================================================
  // Type Tests
  // ===========================================================================
  describe("type definitions", () => {
    it("SettingDefinition has correct shape", () => {
      const setting: SettingDefinition = {
        key: "test",
        label: "Test",
        widgetType: "input",
        section: "Test",
      };
      expect(setting.key).toBe("test");
      expect(setting.widgetType).toBe("input");
    });

    it("SettingDefinition accepts optional fields", () => {
      const setting: SettingDefinition = {
        key: "test",
        label: "Test",
        widgetType: "select",
        section: "Test",
        options: [{ label: "A", value: "a" }],
        placeholder: "Enter value",
        description: "Description here",
      };
      expect(setting.options).toBeDefined();
      expect(setting.placeholder).toBeDefined();
      expect(setting.description).toBeDefined();
    });

    it("WidgetType accepts all valid values", () => {
      const types: WidgetType[] = ["select", "switch", "input", "password", "hotkey", "custom"];
      expect(types.length).toBe(6);
    });
  });
});
