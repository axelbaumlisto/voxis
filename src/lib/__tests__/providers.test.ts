import { describe, it, expect } from "vitest";
import {
  parseModelsFromText,
  modelsToText,
  generateProviderId,
  isDuplicateProviderId,
} from "../providers";

describe("parseModelsFromText", () => {
  it("parses simple model id", () => {
    const result = parseModelsFromText("gpt-4");
    expect(result).toEqual([{ id: "gpt-4", name: "gpt-4" }]);
  });

  it("parses id:name format", () => {
    const result = parseModelsFromText("gpt-4:GPT-4");
    expect(result).toEqual([{ id: "gpt-4", name: "GPT-4" }]);
  });

  it("parses multiple lines", () => {
    const result = parseModelsFromText("gpt-4:GPT-4\ngpt-3.5-turbo:GPT-3.5 Turbo");
    expect(result).toEqual([
      { id: "gpt-4", name: "GPT-4" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    ]);
  });

  it("handles names with colons", () => {
    const result = parseModelsFromText("model-v1:Model: Version 1");
    expect(result).toEqual([{ id: "model-v1", name: "Model: Version 1" }]);
  });

  it("trims whitespace", () => {
    const result = parseModelsFromText("  gpt-4  :  GPT-4  ");
    expect(result).toEqual([{ id: "gpt-4", name: "GPT-4" }]);
  });

  it("filters empty lines", () => {
    const result = parseModelsFromText("gpt-4\n\n\ngpt-3.5-turbo");
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty text", () => {
    expect(parseModelsFromText("")).toEqual([]);
    expect(parseModelsFromText("   \n  \n  ")).toEqual([]);
  });
});

describe("modelsToText", () => {
  it("formats model with same id and name", () => {
    const result = modelsToText([{ id: "gpt-4", name: "gpt-4" }]);
    expect(result).toBe("gpt-4");
  });

  it("formats model with different id and name", () => {
    const result = modelsToText([{ id: "gpt-4", name: "GPT-4" }]);
    expect(result).toBe("gpt-4:GPT-4");
  });

  it("joins multiple models with newlines", () => {
    const result = modelsToText([
      { id: "gpt-4", name: "GPT-4" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    ]);
    expect(result).toBe("gpt-4:GPT-4\ngpt-3.5-turbo:GPT-3.5 Turbo");
  });

  it("returns empty string for empty array", () => {
    expect(modelsToText([])).toBe("");
  });
});

describe("generateProviderId", () => {
  it("converts name to lowercase", () => {
    expect(generateProviderId("OpenAI")).toBe("openai");
  });

  it("replaces spaces with hyphens", () => {
    expect(generateProviderId("My Provider")).toBe("my-provider");
  });

  it("replaces multiple special chars with single hyphen", () => {
    expect(generateProviderId("My   Provider!!!")).toBe("my-provider");
  });

  it("removes leading/trailing hyphens", () => {
    expect(generateProviderId("--My Provider--")).toBe("my-provider");
  });

  it("handles unicode characters", () => {
    expect(generateProviderId("My Провайдер")).toBe("my");
  });

  it("preserves numbers", () => {
    expect(generateProviderId("GPT-4")).toBe("gpt-4");
    expect(generateProviderId("Provider 123")).toBe("provider-123");
  });
});

describe("isDuplicateProviderId", () => {
  const existingIds = ["openai", "groq", "custom-1"];

  it("returns true for existing id", () => {
    expect(isDuplicateProviderId("openai", existingIds)).toBe(true);
    expect(isDuplicateProviderId("groq", existingIds)).toBe(true);
  });

  it("returns false for new id", () => {
    expect(isDuplicateProviderId("anthropic", existingIds)).toBe(false);
    expect(isDuplicateProviderId("custom-2", existingIds)).toBe(false);
  });

  it("is case sensitive", () => {
    expect(isDuplicateProviderId("OpenAI", existingIds)).toBe(false);
    expect(isDuplicateProviderId("GROQ", existingIds)).toBe(false);
  });
});
