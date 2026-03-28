import { describe, it, expect } from "vitest";
import {
  validateProviderUrl,
  validateProviderForm,
  type ProviderFormData,
} from "../providerValidation";

describe("validateProviderUrl", () => {
  it("returns true for valid https URL", () => {
    expect(validateProviderUrl("https://api.example.com/v1/chat/completions")).toBe(true);
  });

  it("returns true for valid http URL", () => {
    expect(validateProviderUrl("http://localhost:8080/v1/chat/completions")).toBe(true);
  });

  it("returns false for invalid or unsupported URLs", () => {
    expect(validateProviderUrl("")).toBe(false);
    expect(validateProviderUrl("not-a-url")).toBe(false);
    expect(validateProviderUrl("ftp://api.example.com")).toBe(false);
  });
});

describe("validateProviderForm", () => {
  const validData: ProviderFormData = {
    name: "OpenAI Compatible",
    apiUrl: "https://api.example.com/v1/chat/completions",
    models: [{ id: "model-1", name: "Model 1" }],
  };

  it("returns no errors for valid form", () => {
    expect(validateProviderForm(validData)).toEqual([]);
  });

  it("returns required field errors", () => {
    const errors = validateProviderForm({
      name: " ",
      apiUrl: " ",
      models: [],
    });

    expect(errors).toEqual([
      "Name is required",
      "API URL is required",
      "At least one model is required",
    ]);
  });

  it("returns URL format error for invalid URL", () => {
    const errors = validateProviderForm({
      ...validData,
      apiUrl: "invalid-url",
    });

    expect(errors).toContain("API URL must be a valid HTTP/HTTPS URL");
  });
});
