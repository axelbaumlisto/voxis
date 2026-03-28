# Multi-Agent SOLID/DRY/KISS/TDD Improvements — Design Spec

**Date:** 2026-03-25
**Project:** soupawhisper (TALRI)
**Scope:** 6 parallel agents, one improvement each
**Strategy:** All agents work simultaneously in isolated git worktrees; merge in dependency order afterward

---

## Background

The codebase was rated 8.4/10 on SOLID/DRY/KISS/TDD. Six remaining improvements were identified. Each targets a single file cluster with no overlap, making full parallelization safe.

---

## Agent Assignments

### Agent 1 — `agent-ocp-registry` (OCP)

**Principle:** Open/Closed — open for extension, closed for modification.

**Problem:** `SettingsPage.tsx:82–112` contains a manual `if/else` chain keyed on `setting.customComponent` string. Adding a new custom widget requires modifying `SettingsPage` itself.

**Files touched:**
- `src/pages/SettingsPage.tsx`
- `src/lib/customWidgetRegistry.ts` (new)

**Task:** Create `customWidgetRegistry.ts` with a `Record<string, ComponentFactory>` map. Register `ProviderSelect` and `ThemeSelect` there. Replace the if/else block in `SettingsPage.renderSettingField` with a single registry lookup. Adding future custom widgets requires only updating the registry file.

**Acceptance criteria:**
- No `if (setting.customComponent === ...)` in SettingsPage
- All existing settings render correctly
- `bun run test:run` passes

---

### Agent 2 — `agent-srp-hotkey` (SRP)

**Principle:** Single Responsibility — a component should have one reason to change.

**Problem:** `HomePage.tsx:31–50` embeds raw Tauri `listen()` calls for hotkey events. The component is responsible for both rendering UI and managing hotkey subscriptions.

**Files touched:**
- `src/pages/HomePage.tsx`
- `src/hooks/useHotkey.ts` (new)

**Task:** Extract the `listen("hotkey-pressed")` / `listen("hotkey-released")` logic into `useHotkey(onPress: () => void, onRelease: () => void)`. The hook manages subscription lifecycle (setup + cleanup). `HomePage` calls `useHotkey(handlePress, handleRelease)` and only renders.

**Acceptance criteria:**
- `HomePage` imports from `useHotkey`, no direct `listen()` calls
- Hook handles unlisten on unmount
- `bun run test:run` passes (including new `useHotkey.test.ts` if feasible)

---

### Agent 3 — `agent-srp-theme` (SRP)

**Principle:** Single Responsibility — one reason to change per unit.

**Problem:** `useThemeColors.ts` (90 lines) does five things: fetches config, fetches theme colors, validates the colors object, applies CSS variables to DOM, and listens to `config-saved` events.

**Files touched:**
- `src/hooks/useThemeColors.ts` → split into two files
- `src/hooks/useThemeCssVars.ts` (new)

**Task:** Extract DOM mutation logic into `useThemeCssVars(colors: ThemeColors | null)` which sets CSS custom properties. `useThemeColors` retains fetch/validate/cache/event logic and calls `useThemeCssVars` internally. Callers continue to use `useThemeColors()` unchanged.

**Acceptance criteria:**
- `useThemeCssVars` is independently testable (pure DOM side effect)
- Public API of `useThemeColors` unchanged
- `bun run test:run` passes

---

### Agent 4 — `agent-dry-orchestrator` (DRY)

**Principle:** Don't Repeat Yourself — eliminate duplicate logic.

**Problem:** `orchestrator/mod.rs` has two config-loading methods: `load_config_static(app: &AppHandle)` (line 144) used at startup, and `load_config(&self)` (line 233) used during operation. They implement the same logic with different receiver types.

**Files touched:**
- `src-tauri/src/orchestrator/mod.rs`

**Task:** Remove `load_config_static`. Pass initial config as a parameter to `Orchestrator::new()` or call `load_config` via `&self` in the start path. Single code path for config loading throughout the orchestrator lifetime.

**Acceptance criteria:**
- `load_config_static` removed
- All existing orchestrator tests pass: `cargo test -p voice`
- No regression in config loading behavior

---

### Agent 5 — `agent-tdd-failed` (TDD)

**Principle:** Test-Driven Design — untested code is untrustworthy code.

**Problem:** `src-tauri/src/commands/failed.rs` (76 lines) has zero unit tests. It handles retry and dismiss operations on failed transcriptions — logic that is easy to break silently.

**Files touched:**
- `src-tauri/src/commands/failed.rs`

**Task:** Add `#[cfg(test)] mod tests` with unit tests covering:
- `get_failed_transcriptions` returns stored items
- `retry_transcription` updates status
- `dismiss_failed_transcription` removes item
Use `tempfile` for test DB isolation (following existing patterns in the codebase).

**Acceptance criteria:**
- At least 3 new passing tests
- `cargo test -p voice commands::failed` all green

---

### Agent 6 — `agent-tdd-x11` (TDD)

**Principle:** Test-Driven Design — platform-specific code especially needs tests.

**Problem:** `src-tauri/src/overlay_native/x11_utils.rs` has no tests. The functions (`should_skip_taskbar`, `set_window_type`, etc.) use unsafe X11 FFI that can silently fail.

**Files touched:**
- `src-tauri/src/overlay_native/x11_utils.rs`

**Task:** Add `#[cfg(test)] mod tests` with:
- Unit tests for pure/logic functions (e.g., type computation, atom name mapping)
- Tests that skip in CI/headless using `std::env::var("CI").is_ok()` or `DISPLAY` check (following existing `test_clipboard_copy` pattern)

**Acceptance criteria:**
- At least 2 new tests
- `cargo test -p voice overlay_native::x11_utils` passes
- Tests do not fail in headless CI environments

---

## Merge Order

After all 6 worktrees complete:

1. `agent-tdd-failed` → merge to main (additive only)
2. `agent-tdd-x11` → merge to main (additive only)
3. `agent-dry-orchestrator` → merge to main (one file)
4. `agent-srp-hotkey` → merge to main (new file + small edit)
5. `agent-srp-theme` → merge to main (new file + split)
6. `agent-ocp-registry` → merge to main (new file + SettingsPage change)

Run `bun run test:run && cargo test -p voice` after each merge to verify no regressions.

---

## Definition of Done

**Per-agent (checked inside the worktree):**
1. Code changes are committed
2. Relevant tests pass (the specific test command listed for that agent)
3. `bun run lint` (frontend agents) or `cargo check` (Rust agents) reports no errors

**Per-merge (checked in main after each worktree is merged):**
4. `bun run test:run && cargo test -p voice` — full test suite green

The full improvement cycle is complete when all 6 agents are merged to `main` and the full test suite passes.
