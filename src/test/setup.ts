import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { resetMocks, setupDefaultMocks } from "./mocks/tauri";
import { _resetPlatformCache } from "../lib/constants";

// Mock react-i18next — resolves keys to English translations for test assertions
import en from "../i18n/locales/en.json";

function resolveKey(key: string, translations: Record<string, unknown>): string {
  const parts = key.split(".");
  let current: unknown = translations;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key; // fallback to key
    }
  }
  return typeof current === "string" ? current : key;
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let text = resolveKey(key, en);
      if (opts) {
        Object.entries(opts).forEach(([k, v]) => {
          text = text.replace(`{{${k}}}`, String(v));
        });
      }
      return text;
    },
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

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
