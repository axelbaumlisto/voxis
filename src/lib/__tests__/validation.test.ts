import { describe, it, expect } from "vitest";
import { isValidApiUrl, validateProvider } from "../validation";

describe("isValidApiUrl", () => {
  it("accepts valid https URL", () => {
    expect(isValidApiUrl("https://api.example.com/v1")).toBe(true);
  });

  it("accepts valid http URL", () => {
    expect(isValidApiUrl("http://localhost:8080")).toBe(true);
  });

  it("accepts https URL with path and query", () => {
    expect(isValidApiUrl("https://api.openai.com/v1/chat/completions?timeout=30")).toBe(true);
  });

  it("rejects invalid URL", () => {
    expect(isValidApiUrl("not-a-url")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidApiUrl("")).toBe(false);
  });

  it("rejects ftp protocol", () => {
    expect(isValidApiUrl("ftp://files.example.com")).toBe(false);
  });

  it("rejects file protocol", () => {
    expect(isValidApiUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects URL without protocol", () => {
    expect(isValidApiUrl("api.example.com/v1")).toBe(false);
  });
});

describe("validateProvider", () => {
  it("returns errors for empty provider", () => {
    const errors = validateProvider({});
    expect(errors).toContain("Name is required");
    expect(errors).toContain("API URL is required");
    expect(errors).toContain("At least one model is required");
  });

  it("returns no errors for valid provider", () => {
    const errors = validateProvider({
      name: "Test Provider",
      api_url: "https://api.test.com/v1",
      models: [{ id: "model1", name: "Model 1" }],
    });
    expect(errors).toHaveLength(0);
  });

  it("returns error for empty name", () => {
    const errors = validateProvider({
      name: "   ",
      api_url: "https://api.test.com",
      models: [{ id: "model1", name: "Model 1" }],
    });
    expect(errors).toContain("Name is required");
  });

  it("returns error for invalid URL", () => {
    const errors = validateProvider({
      name: "Test",
      api_url: "not-a-valid-url",
      models: [{ id: "model1", name: "Model 1" }],
    });
    expect(errors).toContain("API URL must be a valid HTTP/HTTPS URL");
  });

  it("returns error for empty models array", () => {
    const errors = validateProvider({
      name: "Test",
      api_url: "https://api.test.com",
      models: [],
    });
    expect(errors).toContain("At least one model is required");
  });

  it("accepts http URL for local development", () => {
    const errors = validateProvider({
      name: "Local Provider",
      api_url: "http://localhost:8080/v1",
      models: [{ id: "local-model", name: "Local Model" }],
    });
    expect(errors).toHaveLength(0);
  });
});
