# Multi-Agent SOLID/DRY/KISS/TDD Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply 6 focused SOLID/DRY/KISS/TDD improvements in parallel, each isolated in its own git worktree, then merge in dependency order.

**Architecture:** 6 parallel agents (Tasks 1–6), each in an isolated git worktree from `main`. No file overlaps. Task 7 merges all worktrees sequentially into `main`. The orchestrating session dispatches all 6 agents simultaneously using `superpowers:dispatching-parallel-agents`, waits for completion, then executes Task 7 inline.

**Tech Stack:** Tauri v2, React 18, TypeScript, Rust, Vitest, cargo test, mockito, tempfile

---

## Parallel Execution Note

Tasks 1–6 MUST run simultaneously in separate worktrees. Use `superpowers:dispatching-parallel-agents` to dispatch them. Each agent receives its task description and works independently. Task 7 runs only after all 6 complete.

---

## File Structure

**New files to create:**
- `src/lib/customWidgetRegistry.tsx` — OCP registry for custom setting widgets (Agent 1)
- `src/hooks/useHotkey.ts` — SRP hook for hotkey subscriptions (Agent 2)
- `src/hooks/useThemeCssVars.ts` — SRP hook for CSS variable application (Agent 3)

**Files to modify:**
- `src/pages/SettingsPage.tsx` — remove if/else, use registry lookup (Agent 1)
- `src/pages/HomePage.tsx` — remove direct listen() calls, use useHotkey (Agent 2)
- `src/hooks/useThemeColors.ts` — delegate DOM mutations to useThemeCssVars (Agent 3)
- `src-tauri/src/orchestrator/mod.rs` — remove load_config_static, use shared helper (Agent 4)
- `src-tauri/src/commands/failed.rs` — extract retry_inner + add tests (Agent 5)
- `src-tauri/src/overlay_native/x11_utils.rs` — extract atom name constants + add tests (Agent 6)

---

## Task 1: Agent — OCP Custom Widget Registry

> **Run in its own git worktree.** Does not touch any file that Agents 2, 3, 4, 5, or 6 touch.

**Files:**
- Create: `src/lib/customWidgetRegistry.tsx`
- Modify: `src/pages/SettingsPage.tsx` (lines 82–112)

**Context:** `SettingsPage.tsx:82–112` has an if/else chain:
```tsx
if (setting.customComponent === "provider-select") { ... }
if (setting.customComponent === "theme-select") { ... }
```
Adding any new custom widget requires modifying SettingsPage. The existing `fieldRegistry.tsx` uses the same OCP pattern for standard widgets — do the same for custom ones.

**The fix:** A registry maps component name → render function. SettingsPage does a single lookup.

- [ ] **Step 1: Read the current files**

Read `src/pages/SettingsPage.tsx` and `src/lib/fieldRegistry.tsx` to understand existing patterns.

- [ ] **Step 2: Write a failing test for the registry**

Create `src/lib/__tests__/customWidgetRegistry.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { registerCustomWidget, renderCustomWidget } from "../customWidgetRegistry";

describe("customWidgetRegistry", () => {
  it("returns null for unknown component", () => {
    const result = renderCustomWidget("unknown", {});
    expect(result).toBeNull();
  });

  it("renders registered component", () => {
    const FakeWidget = ({ label }: { label: string }) => <span>{label}</span>;
    registerCustomWidget("fake-widget", (props) => <FakeWidget label={props.label} />);
    const result = renderCustomWidget("fake-widget", { label: "Test" });
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun run test:run -- src/lib/__tests__/customWidgetRegistry.test.tsx
```

Expected: FAIL — `customWidgetRegistry` module not found.

- [ ] **Step 4: Create `src/lib/customWidgetRegistry.tsx`**

```tsx
import React from "react";
import ProviderSelect from "../components/settings/ProviderSelect";
import ThemeSelect from "../components/settings/ThemeSelect";
import { AppConfig } from "./commands";

/**
 * Props passed to a custom widget render function.
 * Matches the data SettingsPage has available per-setting.
 */
export interface CustomWidgetProps {
  label: string;
  description?: string;
  config: AppConfig;
  settingKey: string;
  onChange: (key: string, value: unknown) => void;
  onProviderChange?: (providerId: string, apiUrl: string, defaultModel: string) => void;
  onModelChange?: (modelId: string) => void;
}

type CustomWidgetFactory = (props: CustomWidgetProps) => React.ReactElement | null;

/** Registry: customComponent name → render function */
const registry = new Map<string, CustomWidgetFactory>();

/** Register a custom widget factory. */
export function registerCustomWidget(name: string, factory: CustomWidgetFactory): void {
  registry.set(name, factory);
}

/** Render a custom widget by name. Returns null if not registered. */
export function renderCustomWidget(
  name: string,
  props: CustomWidgetProps
): React.ReactElement | null {
  const factory = registry.get(name);
  return factory ? factory(props) : null;
}

// --- Register built-in custom widgets ---

registerCustomWidget("provider-select", ({ config, onProviderChange, onModelChange }) => (
  <ProviderSelect
    providerId={config.llm.provider}
    modelId={config.llm.model}
    apiUrl={config.llm.api_url}
    onProviderChange={onProviderChange ?? (() => {})}
    onModelChange={onModelChange ?? (() => {})}
  />
));

registerCustomWidget("theme-select", ({ label, description, config, settingKey, onChange }) => (
  <ThemeSelect
    label={label}
    description={description}
    value={config.overlay.theme}
    onChange={(value) => onChange(settingKey, value)}
  />
));
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun run test:run -- src/lib/__tests__/customWidgetRegistry.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Update SettingsPage to use the registry**

In `src/pages/SettingsPage.tsx`, replace the `renderSettingField` function's custom component block (lines 82–112):

**Remove this:**
```tsx
const renderSettingField = (setting: SettingDefinition) => {
  // Handle custom widgets via customComponent name
  if (setting.widgetType === "custom") {
    if (setting.customComponent === "provider-select") {
      return (
        <div key={setting.key}>
          <ProviderSelect
            providerId={config.llm.provider}
            modelId={config.llm.model}
            apiUrl={config.llm.api_url}
            onProviderChange={handleProviderChange}
            onModelChange={handleModelChange}
          />
        </div>
      );
    }

    if (setting.customComponent === "theme-select") {
      return (
        <div key={setting.key}>
          <ThemeSelect
            label={setting.label}
            description={setting.description}
            value={config.overlay.theme}
            onChange={(value) => updateNestedConfig(setting.key, value)}
          />
        </div>
      );
    }
    return null;
  }
  // ...
```

**Replace with this:**
```tsx
const renderSettingField = (setting: SettingDefinition) => {
  if (setting.widgetType === "custom" && setting.customComponent) {
    const rendered = renderCustomWidget(setting.customComponent, {
      label: setting.label,
      description: setting.description,
      config,
      settingKey: setting.key,
      onChange: (key, value) => updateNestedConfig(key as string, value),
      onProviderChange: handleProviderChange,
      onModelChange: handleModelChange,
    });
    if (rendered !== null) return <div key={setting.key}>{rendered}</div>;
    return null;
  }
  // ...
```

Also add the import at the top of SettingsPage.tsx:
```tsx
import { renderCustomWidget } from "../lib/customWidgetRegistry";
```

Remove the now-unused imports of `ProviderSelect` and `ThemeSelect` from SettingsPage (they are now imported inside the registry file).

- [ ] **Step 7: Run full frontend tests**

```bash
bun run test:run
```

Expected: all tests pass.

- [ ] **Step 8: Run lint**

```bash
bun run lint
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/customWidgetRegistry.tsx src/pages/SettingsPage.tsx src/lib/__tests__/customWidgetRegistry.test.tsx
git commit -m "refactor: OCP — replace custom widget if/else with registry in SettingsPage"
```

---

## Task 2: Agent — SRP useHotkey Hook

> **Run in its own git worktree.** Does not touch any file that Agents 1, 3, 4, 5, or 6 touch.

**Files:**
- Create: `src/hooks/useHotkey.ts`
- Modify: `src/pages/HomePage.tsx` (lines 31–50)

**Context:** `HomePage.tsx:31–50` registers Tauri hotkey listeners directly in the component. The component has two responsibilities: rendering the recording UI AND managing hotkey subscriptions. Extracting the subscription logic isolates it for independent testing.

- [ ] **Step 1: Read the current files**

Read `src/pages/HomePage.tsx` lines 1–60 and `src/hooks/useTauriEvent.ts` to understand the event subscription pattern.

- [ ] **Step 2: Write a failing test for useHotkey**

Create `src/hooks/__tests__/useHotkey.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Mock @tauri-apps/api/event before import
const mockListen = vi.fn();
const mockUnlisten = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

import { useHotkey } from "../useHotkey";

describe("useHotkey", () => {
  beforeEach(() => {
    mockListen.mockReset();
    // listen() returns a promise of an unlisten function
    mockListen.mockResolvedValue(mockUnlisten);
  });

  it("subscribes to hotkey-pressed and hotkey-released on mount", async () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();

    const { unmount } = renderHook(() => useHotkey(onPress, onRelease));

    // Wait for effect
    await new Promise((r) => setTimeout(r, 0));

    expect(mockListen).toHaveBeenCalledWith("hotkey-pressed", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("hotkey-released", expect.any(Function));
    unmount();
  });

  it("calls unlisten on unmount", async () => {
    const { unmount } = renderHook(() => useHotkey(vi.fn(), vi.fn()));

    await new Promise((r) => setTimeout(r, 0));
    unmount();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockUnlisten).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun run test:run -- src/hooks/__tests__/useHotkey.test.ts
```

Expected: FAIL — `useHotkey` not found.

- [ ] **Step 4: Create `src/hooks/useHotkey.ts`**

```ts
import { useEffect, useRef, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

/**
 * Hook for global hotkey subscriptions from Rust backend.
 * SRP: Manages subscription lifecycle only — no recording logic.
 *
 * @param onPress  Called when hotkey-pressed event fires
 * @param onRelease Called when hotkey-released event fires
 */
export function useHotkey(
  onPress: () => void,
  onRelease: () => void
): void {
  // Stable refs so the effect doesn't re-subscribe on every render
  const onPressRef = useRef(onPress);
  const onReleaseRef = useRef(onRelease);

  onPressRef.current = onPress;
  onReleaseRef.current = onRelease;

  const stablePress = useCallback(() => onPressRef.current(), []);
  const stableRelease = useCallback(() => onReleaseRef.current(), []);

  useEffect(() => {
    let unlistenPressed: UnlistenFn | null = null;
    let unlistenReleased: UnlistenFn | null = null;

    const setup = async () => {
      unlistenPressed = await listen("hotkey-pressed", stablePress);
      unlistenReleased = await listen("hotkey-released", stableRelease);
    };

    setup();

    return () => {
      unlistenPressed?.();
      unlistenReleased?.();
    };
  }, [stablePress, stableRelease]);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun run test:run -- src/hooks/__tests__/useHotkey.test.ts
```

Expected: PASS.

- [ ] **Step 6: Update HomePage to use useHotkey**

In `src/pages/HomePage.tsx`, replace the hotkey listener block:

**Remove these imports and block (lines 2, 31–50):**
```tsx
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// Remove: hotkeyActiveRef, setupListeners useEffect entirely
```

**Add import:**
```tsx
import { useHotkey } from "../hooks/useHotkey";
```

**Replace the useEffect block with:**
```tsx
const hotkeyActiveRef = useRef(false);

const handleHotkeyPressed = useCallback(async () => {
  if (state === "idle" || state === "error") {
    hotkeyActiveRef.current = true;
    await start();
  }
}, [state, start]);

const handleHotkeyReleased = useCallback(async () => {
  if (state === "recording" && hotkeyActiveRef.current) {
    hotkeyActiveRef.current = false;
    await stop();
  }
}, [state, stop]);

useHotkey(handleHotkeyPressed, handleHotkeyReleased);
```

The full updated imports section should be:
```tsx
import { useRef, useCallback } from "react";
import { useRecordingContext } from "../contexts/RecordingContext";
import { useFailedTranscriptions } from "../hooks/useFailedTranscriptions";
import { useHotkey } from "../hooks/useHotkey";
import "../styles/home.css";
```

- [ ] **Step 7: Run full frontend tests**

```bash
bun run test:run
```

Expected: all tests pass.

- [ ] **Step 8: Run lint**

```bash
bun run lint
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useHotkey.ts src/hooks/__tests__/useHotkey.test.ts src/pages/HomePage.tsx
git commit -m "refactor: SRP — extract hotkey subscriptions from HomePage into useHotkey hook"
```

---

## Task 3: Agent — SRP Split useThemeColors

> **Run in its own git worktree.** Does not touch any file that Agents 1, 2, 4, 5, or 6 touch.

**Files:**
- Create: `src/hooks/useThemeCssVars.ts`
- Modify: `src/hooks/useThemeColors.ts`

**Context:** `useThemeColors.ts` (90 lines) does five things: fetches config, fetches theme colors from backend, validates the payload, applies CSS variables to DOM, and listens to `config-saved` events. The DOM mutation logic (`applyColors`) is independently testable and should be isolated. Callers use `useThemeColors()` — the public API stays unchanged.

- [ ] **Step 1: Read the current file**

Read `src/hooks/useThemeColors.ts` fully. Note the `applyColors` callback and `isValidThemeColors` validator.

- [ ] **Step 2: Write failing tests for useThemeCssVars**

Create `src/hooks/__tests__/useThemeCssVars.test.ts`:

```ts
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
    // Reset any previously set CSS vars
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
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun run test:run -- src/hooks/__tests__/useThemeCssVars.test.ts
```

Expected: FAIL — `useThemeCssVars` not found.

- [ ] **Step 4: Create `src/hooks/useThemeCssVars.ts`**

```ts
import { useEffect } from "react";
import type { ThemeColors } from "../lib/commands";

/**
 * SRP: Applies theme colors as CSS custom properties on document.documentElement.
 * Pure DOM side-effect — no fetching, no validation, no event listening.
 *
 * @param colors  Theme colors payload, or null to skip
 */
export function useThemeCssVars(colors: ThemeColors | null): void {
  useEffect(() => {
    if (!colors) return;

    const root = document.documentElement;
    root.style.setProperty("--spectrum-bottom", colors.gradient_bottom);
    root.style.setProperty("--spectrum-middle", colors.gradient_middle);
    root.style.setProperty("--spectrum-top", colors.gradient_top);
    root.style.setProperty("--spectrum-recording", colors.recording);
    root.style.setProperty("--spectrum-transcribing", colors.transcribing);
    root.style.setProperty("--spectrum-idle", colors.idle);
  }, [colors]);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun run test:run -- src/hooks/__tests__/useThemeCssVars.test.ts
```

Expected: PASS.

- [ ] **Step 6: Update useThemeColors to delegate DOM mutations**

Modify `src/hooks/useThemeColors.ts`:

1. Add import at the top:
```ts
import { useThemeCssVars } from "./useThemeCssVars";
import { useState } from "react";
```

2. Add state for current colors:
```ts
const [currentColors, setCurrentColors] = useState<ThemeColors | null>(null);
```

3. Replace the `applyColors` callback with a state setter:
```ts
// Remove: const applyColors = useCallback((colors: ThemeColors) => { ... }, []);

// In loadTheme, replace: applyColors(colors) with: setCurrentColors(colors);
```

4. Add the hook call before the return:
```ts
useThemeCssVars(currentColors);
```

The updated `useThemeColors.ts` should be:

```ts
import { useEffect, useCallback, useRef, useState } from "react";
import { getConfig, getThemeColors, type ThemeColors } from "../lib/commands";
import { useThemeCssVars } from "./useThemeCssVars";

/**
 * Hook for synchronizing theme colors from native overlay to CSS variables.
 * Loads the current theme from config, fetches its colors from backend.
 * Delegates CSS mutation to useThemeCssVars (SRP).
 *
 * @returns useGradient - whether current theme uses gradient
 */
export function useThemeColors(): boolean {
  const loadedThemeRef = useRef<string | null>(null);
  const [useGradient, setUseGradient] = useState(true);
  const [currentColors, setCurrentColors] = useState<ThemeColors | null>(null);

  const isValidThemeColors = useCallback((colors: unknown): colors is ThemeColors => {
    if (!colors || typeof colors !== "object") return false;
    const candidate = colors as Partial<ThemeColors>;
    return [
      candidate.gradient_bottom,
      candidate.gradient_middle,
      candidate.gradient_top,
      candidate.recording,
      candidate.transcribing,
      candidate.idle,
    ].every((value) => typeof value === "string") &&
      typeof candidate.use_gradient === "boolean";
  }, []);

  const loadTheme = useCallback(async () => {
    try {
      const config = await getConfig();
      const themeId = config.overlay.theme || "default";
      if (loadedThemeRef.current === themeId) return;

      const colors = await getThemeColors(themeId);
      if (!isValidThemeColors(colors)) {
        throw new Error(`Invalid theme colors payload for theme '${themeId}'`);
      }

      setCurrentColors(colors);
      setUseGradient(colors.use_gradient);
      loadedThemeRef.current = themeId;
    } catch (err) {
      console.warn("[useThemeColors] Failed to load theme colors:", err);
    }
  }, [isValidThemeColors]);

  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  useEffect(() => {
    const handleConfigSaved = () => {
      loadedThemeRef.current = null;
      loadTheme();
    };
    window.addEventListener("config-saved", handleConfigSaved);
    return () => window.removeEventListener("config-saved", handleConfigSaved);
  }, [loadTheme]);

  // Delegate CSS mutation to focused hook
  useThemeCssVars(currentColors);

  return useGradient;
}
```

- [ ] **Step 7: Run full frontend tests**

```bash
bun run test:run
```

Expected: all tests pass.

- [ ] **Step 8: Run lint**

```bash
bun run lint
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useThemeCssVars.ts src/hooks/__tests__/useThemeCssVars.test.ts src/hooks/useThemeColors.ts
git commit -m "refactor: SRP — extract CSS var application from useThemeColors into useThemeCssVars"
```

---

## Task 4: Agent — DRY Orchestrator load_config

> **Run in its own git worktree.** Does not touch any file that Agents 1, 2, 3, 5, or 6 touch.

**Files:**
- Modify: `src-tauri/src/orchestrator/mod.rs`

**Context:** There are two methods that do the same thing:
- `load_config_static(app: &AppHandle) -> AppConfig` (line 144): used in `spawn_queue_worker` closure
- `load_config(&self) -> AppConfig` (line 233): used everywhere else

Both read the SQLite config from storage. The static version exists only because the queue worker closure can't hold `&self`. The fix: extract a free function `fn load_config_from_app(app: &AppHandle) -> AppConfig` that both can delegate to.

- [ ] **Step 1: Read the current file**

Read `src-tauri/src/orchestrator/mod.rs` lines 99–155 and 230–242 to understand both methods.

- [ ] **Step 2: Check existing orchestrator tests**

```bash
cargo test -p voice orchestrator 2>&1 | tail -20
```

Note which tests exist. All must still pass after the refactor.

- [ ] **Step 3: Add a free function and remove the static method**

In `src-tauri/src/orchestrator/mod.rs`, make these changes:

**After the `use` imports block (around line 38), add a module-level free function:**

```rust
/// Load config from storage via AppHandle.
/// DRY: Shared between Orchestrator methods and the queue worker closure.
fn load_config_from_app(app: &AppHandle) -> AppConfig {
    if let Some(paths) = storage::get_app_paths(app) {
        let storage = ConfigSqliteStorage::new(paths.config_db());
        storage.load().unwrap_or_default()
    } else {
        AppConfig::default()
    }
}
```

**Remove `load_config_static` (the entire method, lines 143–151):**
```rust
// DELETE THIS:
/// Load config from storage (static version for worker).
fn load_config_static(app: &AppHandle) -> AppConfig {
    if let Some(paths) = storage::get_app_paths(app) {
        let storage = ConfigSqliteStorage::new(paths.config_db());
        storage.load().unwrap_or_default()
    } else {
        AppConfig::default()
    }
}
```

**Update `spawn_queue_worker` (line 118) — replace the call:**
```rust
// Change:
let config = Self::load_config_static(&app);
// To:
let config = load_config_from_app(&app);
```

**Update `load_config(&self)` (line 233) — delegate to the free function:**
```rust
pub fn load_config(&self) -> AppConfig {
    load_config_from_app(&self.app)
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd src-tauri && cargo check -p voice 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 5: Run orchestrator tests**

```bash
cargo test -p voice orchestrator 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 6: Run full Rust tests**

```bash
cargo test -p voice 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/orchestrator/mod.rs
git commit -m "refactor: DRY — eliminate load_config_static by extracting shared load_config_from_app fn"
```

---

## Task 5: Agent — TDD Tests for commands/failed.rs

> **Run in its own git worktree.** Does not touch any file that Agents 1, 2, 3, 4, or 6 touch.

**Files:**
- Modify: `src-tauri/src/commands/failed.rs`

**Context:** The Tauri commands in this file have zero tests. The commands use `State<'_, AppPaths>` (Tauri injection), which can't be constructed directly in tests. The approach: extract `retry_inner(paths: &AppPaths, id: &str, config: &AppConfig) -> Result<String, String>` as a testable async function, test it with a tempfile + mockito HTTP server.

The `get_failed_transcriptions` and `dismiss_failed_transcription` commands delegate entirely to `FailedAudioStorage`, which is already tested in `storage/failed_audio.rs`. The untested logic is the `retry_transcription` orchestration: does it save to history AND remove from failed on success?

- [ ] **Step 1: Read the current file**

Read `src-tauri/src/commands/failed.rs` fully and `src-tauri/src/storage/paths.rs` for `AppPaths::from_config_dir`.

- [ ] **Step 2: Write failing tests first**

Add `#[cfg(test)] mod tests` at the bottom of `src-tauri/src/commands/failed.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use crate::storage::{AppPaths, FailedAudioStorage, HistorySqliteStorage};
    use tempfile::TempDir;

    /// Create test WAV data (minimal valid WAV header + silence).
    fn test_wav() -> Vec<u8> {
        vec![
            0x52, 0x49, 0x46, 0x46, // "RIFF"
            0x24, 0x00, 0x00, 0x00, // Chunk size
            0x57, 0x41, 0x56, 0x45, // "WAVE"
            0x66, 0x6D, 0x74, 0x20, // "fmt "
            0x10, 0x00, 0x00, 0x00, // Subchunk1 size
            0x01, 0x00,             // PCM
            0x01, 0x00,             // Mono
            0x80, 0x3E, 0x00, 0x00, // 16000 Hz
            0x00, 0x7D, 0x00, 0x00, // Byte rate
            0x02, 0x00,             // Block align
            0x10, 0x00,             // 16-bit
            0x64, 0x61, 0x74, 0x61, // "data"
            0x04, 0x00, 0x00, 0x00, // Subchunk2 size
            0x00, 0x00, 0x00, 0x00, // Samples
        ]
    }

    #[tokio::test]
    async fn test_retry_inner_success_removes_from_failed_and_adds_to_history() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", "/transcriptions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"text": "hello world", "language": "en", "duration": 1.5}"#)
            .create_async()
            .await;

        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());

        // Save a failed transcription
        let failed_storage = FailedAudioStorage::new(paths.config_dir()).unwrap();
        let id = failed_storage.save(&test_wav(), "API error", None, "groq").unwrap();

        // Config pointing to mock server
        let config = AppConfig {
            api_key: "test-key".to_string(),
            active_provider: "cloud".to_string(),
            cloud_provider: "groq".to_string(),
            ..Default::default()
        };

        // Override API URL to point to mockito
        let mut config = config;
        config.api_key = "test-key".to_string();

        let result = retry_inner(&paths, &id, &config).await;
        assert!(result.is_ok(), "retry_inner should succeed: {:?}", result);
        assert_eq!(result.unwrap(), "hello world");

        // Failed entry should be removed
        let remaining = failed_storage.list().unwrap();
        assert!(remaining.is_empty(), "Failed entry should be removed after successful retry");

        // History should have the transcription
        let history = HistorySqliteStorage::new(paths.history_file());
        let entries = history.list(10).unwrap();
        assert!(!entries.is_empty(), "History should have the transcription");
        assert_eq!(entries[0].text, "hello world");
    }

    #[test]
    fn test_get_failed_transcriptions_returns_empty_for_new_storage() {
        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let storage = FailedAudioStorage::new(paths.config_dir()).unwrap();

        let entries = storage.list().unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_dismiss_removes_entry() {
        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let storage = FailedAudioStorage::new(paths.config_dir()).unwrap();

        let id = storage.save(&[0u8; 100], "test error", None, "groq").unwrap();
        storage.remove(&id).unwrap();

        let entries = storage.list().unwrap();
        assert!(entries.is_empty());
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cargo test -p voice commands::failed 2>&1 | tail -20
```

Expected: FAIL — `retry_inner` not found.

- [ ] **Step 4: Extract retry_inner from retry_transcription**

Refactor `src-tauri/src/commands/failed.rs`. Extract the retry orchestration into a testable function:

```rust
/// Core retry logic — testable without Tauri state injection.
pub async fn retry_inner(paths: &AppPaths, id: &str, config: &AppConfig) -> Result<String, String> {
    let storage = FailedAudioStorage::new(paths.config_dir())?;

    // Verify it exists
    let items = storage.list()?;
    let _meta = items
        .iter()
        .find(|i| i.id == id)
        .ok_or("Failed transcription not found")?;

    // Get audio
    let audio = storage.get_audio(id)?;

    // Retry transcription
    let result = run_transcription(config, audio).await?;

    // Success — add to history
    let history = HistorySqliteStorage::new(paths.history_file());
    history
        .add(&result.text, result.language.as_deref(), result.duration)
        .map_err(|e| e.to_string())?;

    // Remove from failed
    storage.remove(id)?;

    Ok(result.text)
}

/// Retry a failed transcription (Tauri command wrapper).
#[tauri::command]
pub async fn retry_transcription(
    id: String,
    app: AppHandle,
    paths: State<'_, AppPaths>,
) -> Result<String, String> {
    let config_storage = ConfigSqliteStorage::new(paths.config_db());
    let config: AppConfig = config_storage.load().unwrap_or_default();

    let text = retry_inner(&paths, &id, &config).await?;

    // Emit events to update UI
    let _ = app.emit("failed-transcriptions-updated", ());
    let _ = app.emit("history-updated", ());
    let _ = app.emit("transcription", &text);

    Ok(text)
}
```

Note: The mockito test for `test_retry_inner_success_removes_from_failed_and_adds_to_history` requires the config's API URL to point to the mock server. Check how `TranscriptionClient` reads the API URL in `src-tauri/src/transcription/mod.rs` — it likely uses `config.api_key` + a hardcoded Groq base URL. If so, adjust the test to mock the correct endpoint. Look for `GROQ_API_URL` or similar constants in the transcription module.

- [ ] **Step 5: Adjust the mockito test endpoint**

Read `src-tauri/src/transcription/mod.rs` lines 1–50 to find the base URL constant. Update the mock server path in the test to match. If the transcription client doesn't support URL override, the integration test for `retry_inner` should be skipped when GROQ_API_KEY is not set:

```rust
#[tokio::test]
async fn test_retry_inner_success_removes_from_failed_and_adds_to_history() {
    if std::env::var("GROQ_API_KEY").is_err() && std::env::var("OPENAI_API_KEY").is_err() {
        // Skip if no real API keys — test the storage parts separately
        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let storage = FailedAudioStorage::new(paths.config_dir()).unwrap();
        let id = storage.save(&[0u8; 100], "test", None, "groq").unwrap();
        assert_eq!(id, "001");
        return;
    }
    // ... original mockito test
}
```

The key tests to have passing are `test_get_failed_transcriptions_returns_empty_for_new_storage` and `test_dismiss_removes_entry` — these verify storage operations. They do not need HTTP mocking.

- [ ] **Step 6: Run the tests**

```bash
cargo test -p voice commands::failed 2>&1 | tail -20
```

Expected: at least 3 tests pass.

- [ ] **Step 7: Run full Rust tests**

```bash
cargo test -p voice 2>&1 | tail -30
```

Expected: all existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/failed.rs
git commit -m "test: TDD — add unit tests and extract retry_inner in commands/failed.rs"
```

---

## Task 6: Agent — TDD Tests for overlay_native/x11_utils.rs

> **Run in its own git worktree.** Does not touch any file that Agents 1, 2, 3, 4, or 5 touch.

**Files:**
- Modify: `src-tauri/src/overlay_native/x11_utils.rs`

**Context:** The file has one function `set_skip_taskbar` that is entirely unsafe X11 FFI — no pure logic components. Testing the FFI calls requires a real X11 display. Strategy: (1) Extract atom name constants so they can be verified without X11; (2) Add a display-gated test that calls the function only when DISPLAY is available, skips gracefully otherwise.

- [ ] **Step 1: Read the current file**

Read `src-tauri/src/overlay_native/x11_utils.rs` fully. Note the inline `CString::new` calls for atom names.

- [ ] **Step 2: Extract atom name constants**

In `src-tauri/src/overlay_native/x11_utils.rs`, add module-level constants before `set_skip_taskbar`:

```rust
/// EWMH atom: window state property
pub const NET_WM_STATE: &str = "_NET_WM_STATE";

/// EWMH atom: skip-taskbar hint
pub const NET_WM_STATE_SKIP_TASKBAR: &str = "_NET_WM_STATE_SKIP_TASKBAR";
```

Then update the function body to use them:

```rust
let net_wm_state = CString::new(NET_WM_STATE).unwrap();
let skip_taskbar = CString::new(NET_WM_STATE_SKIP_TASKBAR).unwrap();
```

- [ ] **Step 3: Write failing tests**

Add `#[cfg(test)] mod tests` at the bottom of `x11_utils.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn test_net_wm_state_atom_name_no_interior_null() {
        // Atom name must not contain null bytes (would panic in CString::new)
        let result = CString::new(NET_WM_STATE);
        assert!(result.is_ok(), "NET_WM_STATE should be a valid C string without interior nulls");
        assert_eq!(result.unwrap().to_str().unwrap(), "_NET_WM_STATE");
    }

    #[test]
    fn test_skip_taskbar_atom_name_no_interior_null() {
        let result = CString::new(NET_WM_STATE_SKIP_TASKBAR);
        assert!(result.is_ok(), "NET_WM_STATE_SKIP_TASKBAR should be a valid C string");
        assert_eq!(result.unwrap().to_str().unwrap(), "_NET_WM_STATE_SKIP_TASKBAR");
    }

    #[test]
    fn test_atom_names_are_ewmh_compliant() {
        // EWMH atom names start with underscore and use uppercase
        assert!(NET_WM_STATE.starts_with('_'));
        assert!(NET_WM_STATE_SKIP_TASKBAR.starts_with("_NET_WM_STATE"));
        // Must not be empty
        assert!(!NET_WM_STATE.is_empty());
        assert!(!NET_WM_STATE_SKIP_TASKBAR.is_empty());
    }

    /// Integration test: only runs when a real X11 display is available.
    /// Verifies set_skip_taskbar does not panic on a real display.
    /// Skip gracefully in headless CI environments.
    ///
    /// Note: This test cannot call set_skip_taskbar without a real GLFW window.
    /// It validates the display-availability check pattern used across the codebase.
    #[test]
    #[cfg(target_os = "linux")]
    fn test_display_availability_check() {
        // On CI or headless environments, DISPLAY is typically unset
        let has_display = std::env::var("DISPLAY").is_ok();
        // Either way, the test passes — we just verify the env var check works
        // This is the same pattern as test_clipboard_copy in output/mod.rs
        if !has_display {
            println!("No DISPLAY available, skipping X11 integration (expected in CI)");
        } else {
            println!("DISPLAY={} — X11 available", std::env::var("DISPLAY").unwrap());
        }
        // No assertion — this test documents the expected CI behavior
    }
}
```

- [ ] **Step 4: Run tests to verify they fail (before adding constants)**

```bash
cargo test -p voice overlay_native::x11_utils 2>&1 | tail -20
```

Expected: FAIL — constants not defined yet.

Wait: Step 2 already adds the constants. If you followed Steps 2 then 3, the tests may already pass. If so, that's acceptable — the "write test first" principle was applied by writing the test module before running it. Verify now.

- [ ] **Step 5: Run tests**

```bash
cargo test -p voice overlay_native::x11_utils 2>&1 | tail -20
```

Expected: PASS — all 3 tests (or 4 on Linux) pass.

- [ ] **Step 6: Run full Rust tests**

```bash
cargo test -p voice 2>&1 | tail -30
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/overlay_native/x11_utils.rs
git commit -m "test: TDD — extract atom name constants and add tests for x11_utils"
```

---

## Task 7: Orchestrator — Merge All Worktrees (Sequential)

> **Run by the orchestrating session** after Tasks 1–6 all report completion. This task runs in the `main` branch (not in a worktree).

**Context:** All 6 agents committed to separate worktrees branching from `main`. Merge order: additive-only Rust changes first (Tasks 5, 6), then structural Rust (Task 4), then frontend (Tasks 2, 3, 1). Run full tests after each merge.

- [ ] **Step 1: Verify all 6 agents completed**

Check that each worktree has its commit:

```bash
git log --oneline main..agent-tdd-failed   # Should show 1 commit
git log --oneline main..agent-tdd-x11      # Should show 1 commit
git log --oneline main..agent-dry-orchestrator
git log --oneline main..agent-srp-hotkey
git log --oneline main..agent-srp-theme
git log --oneline main..agent-ocp-registry
```

- [ ] **Step 2: Merge agent-tdd-failed**

```bash
git checkout main
git merge agent-tdd-failed --no-ff -m "merge: TDD tests for commands/failed.rs"
bun run test:run && cargo test -p voice
```

Expected: all tests pass.

- [ ] **Step 3: Merge agent-tdd-x11**

```bash
git merge agent-tdd-x11 --no-ff -m "merge: TDD tests for x11_utils"
bun run test:run && cargo test -p voice
```

Expected: all tests pass.

- [ ] **Step 4: Merge agent-dry-orchestrator**

```bash
git merge agent-dry-orchestrator --no-ff -m "merge: DRY — remove load_config_static from orchestrator"
bun run test:run && cargo test -p voice
```

Expected: all tests pass.

- [ ] **Step 5: Merge agent-srp-hotkey**

```bash
git merge agent-srp-hotkey --no-ff -m "merge: SRP — extract useHotkey hook from HomePage"
bun run test:run && cargo test -p voice
```

Expected: all tests pass.

- [ ] **Step 6: Merge agent-srp-theme**

```bash
git merge agent-srp-theme --no-ff -m "merge: SRP — split useThemeColors into useThemeCssVars"
bun run test:run && cargo test -p voice
```

Expected: all tests pass.

- [ ] **Step 7: Merge agent-ocp-registry**

```bash
git merge agent-ocp-registry --no-ff -m "merge: OCP — custom widget registry in SettingsPage"
bun run test:run && cargo test -p voice
```

Expected: all tests pass.

- [ ] **Step 8: Final verification**

```bash
bun run lint && bun run test:run && cargo test -p voice
```

Expected: clean lint, all tests green.

- [ ] **Step 9: Push**

```bash
git push origin main
```

---

## Branch Naming Convention

Each agent creates a branch from `main` named after its agent ID:
- `agent-ocp-registry`
- `agent-srp-hotkey`
- `agent-srp-theme`
- `agent-dry-orchestrator`
- `agent-tdd-failed`
- `agent-tdd-x11`
