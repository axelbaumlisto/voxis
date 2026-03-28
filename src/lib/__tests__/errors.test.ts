import { describe, it, expect } from "vitest";
import { getErrorMessage } from "../errors";

describe("getErrorMessage", () => {
  it("extracts message from Error instance", () => {
    const error = new Error("Something went wrong");
    expect(getErrorMessage(error)).toBe("Something went wrong");
  });

  it("returns string as-is", () => {
    expect(getErrorMessage("Direct error string")).toBe("Direct error string");
  });

  it("converts number to string", () => {
    expect(getErrorMessage(404)).toBe("404");
  });

  it("converts null to string", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("converts undefined to string", () => {
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("converts object to string", () => {
    const obj = { code: 500, message: "Server error" };
    expect(getErrorMessage(obj)).toBe("[object Object]");
  });

  it("handles TypeError", () => {
    const error = new TypeError("Cannot read property");
    expect(getErrorMessage(error)).toBe("Cannot read property");
  });

  it("handles RangeError", () => {
    const error = new RangeError("Value out of range");
    expect(getErrorMessage(error)).toBe("Value out of range");
  });

  it("handles empty string", () => {
    expect(getErrorMessage("")).toBe("");
  });

  it("handles boolean", () => {
    expect(getErrorMessage(false)).toBe("false");
    expect(getErrorMessage(true)).toBe("true");
  });
});
