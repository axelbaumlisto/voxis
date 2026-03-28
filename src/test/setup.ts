import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { resetMocks, setupDefaultMocks } from "./mocks/tauri";
import { _resetPlatformCache } from "../lib/constants";

// =============================================================================
// Global Setup
// =============================================================================

// Setup default Tauri mocks
setupDefaultMocks();

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Reset mocks before each test
beforeEach(() => {
  resetMocks();
  _resetPlatformCache();
});

// =============================================================================
// Browser API Mocks
// =============================================================================

// Mock window.confirm
vi.stubGlobal("confirm", vi.fn(() => true));

// Mock clipboard API
Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  },
  writable: true,
});

// Mock matchMedia for responsive tests
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock Tauri plugin-os internals for platform detection
Object.defineProperty(window, "__TAURI_OS_PLUGIN_INTERNALS__", {
  writable: true,
  value: {
    platform: "macos",
    eol: "\n",
    version: "15.0.0",
  },
});
