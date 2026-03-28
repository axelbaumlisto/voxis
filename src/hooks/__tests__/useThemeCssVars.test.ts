import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThemeCssVars } from "../useThemeCssVars";
import type { ThemeColors } from "../../lib/commands";

const testColors: ThemeColors = {
  gradient_bottom: "#111",
  gradient_middle: "#222",
  gradient_top: "#333",
  recording: "#f00",
  transcribing: "#0f0",
  idle: "#00f",
  use_gradient: true,
};

describe("useThemeCssVars", () => {
  beforeEach(() => {
    const root = document.documentElement;
    root.style.removeProperty("--spectrum-bottom");
    root.style.removeProperty("--spectrum-middle");
    root.style.removeProperty("--spectrum-top");
    root.style.removeProperty("--spectrum-recording");
    root.style.removeProperty("--spectrum-transcribing");
    root.style.removeProperty("--spectrum-idle");
  });

  it("sets CSS variables when colors provided", () => {
    renderHook(() => useThemeCssVars(testColors));
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--spectrum-bottom")).toBe("#111");
    expect(root.style.getPropertyValue("--spectrum-middle")).toBe("#222");
    expect(root.style.getPropertyValue("--spectrum-top")).toBe("#333");
    expect(root.style.getPropertyValue("--spectrum-recording")).toBe("#f00");
    expect(root.style.getPropertyValue("--spectrum-transcribing")).toBe("#0f0");
    expect(root.style.getPropertyValue("--spectrum-idle")).toBe("#00f");
  });

  it("does nothing when colors is null", () => {
    renderHook(() => useThemeCssVars(null));
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--spectrum-bottom")).toBe("");
  });
});
