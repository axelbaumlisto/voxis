import { describe, it, expect } from "vitest";
import { getConfigValue } from "../config";
import { AppConfig } from "../commands";

describe("config utilities", () => {
  const mockConfig: AppConfig = {
    api_key: "test-key",
    model: "whisper-large-v3",
    language: "auto",
    hotkey: "Super+Shift+S",
    auto_type: true,
    auto_enter: false,
    typing_delay: 12,
    notifications: true,
    backend: "auto",
    debug: false,
    audio_device: "default",
    history_enabled: true,
    history_days: 30,
    active_provider: "cloud",
    cloud_provider: "groq",
    local_backend: "faster-whisper",
    text_processing: true,
    vad: {
      enabled: true,
      threshold: 0.5,
    },
    overlay: {
      enabled: true,
      position: "bottom_left",
      size: "medium",
      margin: 30,
      audio_boost: 800,
      theme: "default",
    },
    llm: {
      enabled: false,
      provider: "groq",
      api_url: "",
      api_key: "test-llm-key",
      model: "llama3",
      prompt: "",
    },
    dictionary: {
      path: "",
      learning_mode: "auto",
      learning_threshold: 3,
    },
  };

  describe("getConfigValue", () => {
    it("should get top-level value", () => {
      expect(getConfigValue(mockConfig, "hotkey")).toBe("Super+Shift+S");
    });

    it("should get top-level string value", () => {
      expect(getConfigValue(mockConfig, "audio_device")).toBe("default");
    });

    it("should get nested value with dot notation", () => {
      expect(getConfigValue(mockConfig, "llm.provider")).toBe("groq");
      expect(getConfigValue(mockConfig, "llm.model")).toBe("llama3");
      expect(getConfigValue(mockConfig, "llm.api_key")).toBe("test-llm-key");
    });

    it("should get nested boolean value", () => {
      expect(getConfigValue(mockConfig, "overlay.enabled")).toBe(true);
    });

    it("should get nested numeric value", () => {
      expect(getConfigValue(mockConfig, "overlay.margin")).toBe(30);
      expect(getConfigValue(mockConfig, "dictionary.learning_threshold")).toBe(3);
    });

    it("should get overlay audio_boost value", () => {
      expect(getConfigValue(mockConfig, "overlay.audio_boost")).toBe(800);
    });

    it("should return undefined for non-existent top-level key", () => {
      expect(getConfigValue(mockConfig, "nonexistent")).toBeUndefined();
    });

    it("should return undefined for non-existent nested key", () => {
      expect(getConfigValue(mockConfig, "llm.nonexistent")).toBeUndefined();
    });

    it("should return undefined for invalid parent key", () => {
      expect(getConfigValue(mockConfig, "invalid.key")).toBeUndefined();
    });

    it("should return object for parent path", () => {
      const llmConfig = getConfigValue(mockConfig, "llm");
      expect(llmConfig).toEqual({
        enabled: false,
        provider: "groq",
        api_url: "",
        api_key: "test-llm-key",
        model: "llama3",
        prompt: "",
      });
    });

    it("should get vad nested values", () => {
      expect(getConfigValue(mockConfig, "vad.enabled")).toBe(true);
      expect(getConfigValue(mockConfig, "vad.threshold")).toBe(0.5);
    });

    it("should get dictionary nested values", () => {
      expect(getConfigValue(mockConfig, "dictionary.learning_mode")).toBe("auto");
      expect(getConfigValue(mockConfig, "dictionary.learning_threshold")).toBe(3);
    });
  });
});
