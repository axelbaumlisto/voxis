# Clipboard Reliability Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix double-paste in GUI apps, fix clipboard restore losing contents on Linux X11, clean up dead code.

**Architecture:** Current `copy_and_paste` already holds the clipboard handle alive on the same thread — this is correct. The fixes: (1) remove the second Ctrl+V that causes double-paste, (2) use `arboard::SetExtLinux::wait_until()` in `restore_clipboard` so clipboard manager picks up restored contents, (3) clean up dead `output_text` DRY violation. No background threads — same-thread hold is sufficient since X11 SelectionRequest is synchronous.

**Tech Stack:** Rust, arboard (Clipboard, SetExtLinux), enigo (keyboard simulation), Tauri v2

**Key constraint:** On Linux X11, clipboard is owned by the process/handle that set it. Dropping the handle = losing contents. `copy_and_paste` already holds the handle during paste — no changes needed there. `restore_clipboard` needs `wait_until()` to let clipboard manager pick up contents before drop.

---

## File Structure

**Files to modify:**
- `src-tauri/src/output/mod.rs` — paste shortcut, restore_clipboard, output_text cleanup
- `src-tauri/src/orchestrator/transcription.rs` — finalize_output cleanup
- `src-tauri/src/audio/mod.rs` — clippy never_loop fix

**No new files.**

---

## Task 1: Fix paste() — only Ctrl+Shift+V, no double-paste

> Fixes: double-paste in GUI apps. Ctrl+Shift+V works in terminals (standard paste) and GUI apps (paste-without-formatting — correct for plain text).

**Files:**
- Modify: `src-tauri/src/output/mod.rs` (lines 220–239 inside `paste()`)

- [ ] **Step 1: Replace the Linux paste block**

In `src-tauri/src/output/mod.rs`, replace the entire `#[cfg(target_os = "linux")]` block inside `paste()` (lines 223–239) with:

```rust
            // Linux: Ctrl+Shift+V only.
            // Terminals: standard paste shortcut.
            // GUI apps: paste-without-formatting (correct for plain text).
            // Do NOT add Ctrl+V — it causes double-paste in GUI apps.
            #[cfg(target_os = "linux")]
            {
                enigo
                    .key(Key::Control, Direction::Press)
                    .map_err(|e| OutputError::TypingError(e.to_string()))?;
                enigo
                    .key(Key::Shift, Direction::Press)
                    .map_err(|e| OutputError::TypingError(e.to_string()))?;
                enigo
                    .key(Key::Unicode('v'), Direction::Click)
                    .map_err(|e| OutputError::TypingError(e.to_string()))?;
                enigo
                    .key(Key::Shift, Direction::Release)
                    .map_err(|e| OutputError::TypingError(e.to_string()))?;
                enigo
                    .key(Key::Control, Direction::Release)
                    .map_err(|e| OutputError::TypingError(e.to_string()))?;
            }
```

- [ ] **Step 2: Verify it compiles and tests pass**

```bash
cd src-tauri && cargo check -p voice 2>&1 | tail -5
cd src-tauri && cargo test -p voice --lib 2>&1 | tail -5
```

Expected: no errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/output/mod.rs
git commit -m "fix: use only Ctrl+Shift+V on Linux — prevents double-paste in GUI apps"
```

---

## Task 2: Fix restore_clipboard with wait_until on Linux

> Fixes: clipboard restore losing contents because the handle is dropped before clipboard manager picks them up. Uses `arboard::SetExtLinux::wait_until()` — same pattern as `src-tauri/src/tray/mod.rs` lines 105–112.

**Files:**
- Modify: `src-tauri/src/output/mod.rs` (method `restore_clipboard`, lines 175–180)

- [ ] **Step 1: Read tray/mod.rs to see the existing wait_until pattern**

Read `src-tauri/src/tray/mod.rs` lines 100–115 for reference on how `wait_until` is used in the codebase.

- [ ] **Step 2: Replace `restore_clipboard`**

In `src-tauri/src/output/mod.rs`, replace the `restore_clipboard` method:

```rust
    /// Restore previously saved clipboard contents.
    ///
    /// On Linux, uses `wait_until()` to keep the handle alive until the
    /// clipboard manager acknowledges the contents (up to 500ms).
    /// Non-fatal on timeout — the user can still paste manually.
    pub fn restore_clipboard(&self, contents: ClipboardContents) -> Result<(), OutputError> {
        match contents {
            ClipboardContents::Text(text) => {
                #[cfg(target_os = "linux")]
                {
                    use arboard::SetExtLinux;
                    use std::time::{Duration, Instant};
                    let mut clipboard = Clipboard::new()
                        .map_err(|e| OutputError::ClipboardError(e.to_string()))?;
                    if let Err(e) = clipboard
                        .set()
                        .wait_until(Instant::now() + Duration::from_millis(500))
                        .text(text)
                    {
                        // Non-fatal: clipboard manager may be absent or slow
                        tracing::debug!("Clipboard restore wait timed out: {}", e);
                    }
                    Ok(())
                }
                #[cfg(not(target_os = "linux"))]
                {
                    self.copy_to_clipboard(&text)
                }
            }
            ClipboardContents::Empty => Ok(()),
        }
    }
```

- [ ] **Step 3: Verify it compiles and tests pass**

```bash
cd src-tauri && cargo check -p voice 2>&1 | tail -5
cd src-tauri && cargo test -p voice --lib 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/output/mod.rs
git commit -m "fix: use wait_until in restore_clipboard so clipboard manager picks up contents"
```

---

## Task 3: Clean up DRY violation — simplify output_text and finalize_output

> `output_text()` has zero callers in production code. `finalize_output` is the real entry point. Clean up the duplication and remove the redundant 200ms sleep (the 100ms post-paste hold inside `copy_and_paste` + restore delay is sufficient).

**Files:**
- Modify: `src-tauri/src/output/mod.rs` (method `output_text`)
- Modify: `src-tauri/src/orchestrator/transcription.rs` (method `finalize_output`)

- [ ] **Step 1: Verify output_text has no production callers**

```bash
cd src-tauri && grep -rn "output_text" src/ --include="*.rs"
```

Expected: only definition + tests. No calls from finalize_output or other production code.

- [ ] **Step 2: Simplify output_text**

Replace `output_text` in `src-tauri/src/output/mod.rs`:

```rust
    /// Copy to clipboard and optionally paste via keystroke.
    /// Note: `finalize_output` in orchestrator calls `copy_and_paste` directly
    /// with backup/restore. This method is a simpler convenience wrapper.
    pub fn output_text(&self, text: &str, auto_type: bool) -> Result<(), OutputError> {
        if auto_type {
            self.copy_and_paste(text)
        } else {
            self.copy_to_clipboard(text)
        }
    }
```

- [ ] **Step 3: Simplify finalize_output — remove redundant sleep**

In `src-tauri/src/orchestrator/transcription.rs`, in `finalize_output`, replace the clipboard else-block:

Find:
```rust
    } else {
        // Clipboard paste mode: backup clipboard, copy+paste (keeps handle alive), restore
        let saved = output.save_clipboard();

        if let Err(e) = output.copy_and_paste(text) {
            tracing::error!("Failed to copy+paste: {}", e);
        }

        // Give target app time to process paste
        std::thread::sleep(std::time::Duration::from_millis(200));

        // Restore original clipboard contents
        if let Err(e) = output.restore_clipboard(saved) {
            tracing::warn!("Failed to restore clipboard: {}", e);
        }
    }
```

Replace with:
```rust
    } else {
        // Clipboard paste mode: backup → copy+paste → restore
        // copy_and_paste holds clipboard handle for 100ms after paste keystroke,
        // which is enough for X11 SelectionRequest (synchronous).
        let saved = output.save_clipboard();

        if let Err(e) = output.copy_and_paste(text) {
            tracing::error!("Failed to copy+paste: {}", e);
        }

        // Restore original clipboard contents
        // restore_clipboard uses wait_until() on Linux to hold until
        // clipboard manager picks up the restored contents.
        if let Err(e) = output.restore_clipboard(saved) {
            tracing::debug!("Failed to restore clipboard: {}", e);
        }
    }
```

- [ ] **Step 4: Verify it compiles and tests pass**

```bash
cd src-tauri && cargo check -p voice 2>&1 | tail -5
cd src-tauri && cargo test -p voice --lib 2>&1 | tail -5
bun run test:run 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/output/mod.rs src-tauri/src/orchestrator/transcription.rs
git commit -m "refactor: simplify output_text and finalize_output, remove redundant sleep"
```

---

## Task 4: Fix clippy never_loop in audio/mod.rs

**Files:**
- Modify: `src-tauri/src/audio/mod.rs`

- [ ] **Step 1: Find the never_loop warning**

```bash
cd src-tauri && cargo clippy -p voice 2>&1 | grep -A 10 "never_loop"
```

- [ ] **Step 2: Read the offending code**

Read the flagged lines in `src-tauri/src/audio/mod.rs`. On non-macOS, the `Pause`/`Play` match arms are compiled out, leaving only `Close | Err(_) => return`. The loop exits on first iteration — replace with a single `recv()` call or add no-op arms for `Pause`/`Play` on all platforms.

- [ ] **Step 3: Fix and verify**

Apply the fix, then:

```bash
cd src-tauri && cargo clippy -p voice 2>&1 | grep -E "error|warning" | head -10
cd src-tauri && cargo test -p voice --lib 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/audio/mod.rs
git commit -m "fix: resolve clippy never_loop warning in audio module"
```

---

## Definition of Done

1. `paste()` sends only Ctrl+Shift+V on Linux (no double-paste)
2. `copy_and_paste()` keeps same-thread clipboard hold (already correct, no change needed)
3. `restore_clipboard()` uses `wait_until(500ms)` on Linux (clipboard manager gets contents)
4. `output_text()` is simplified — no DRY violation with `finalize_output`
5. `finalize_output` has no redundant 200ms sleep
6. Clippy clean (including audio/mod.rs `never_loop`)
7. All tests pass: `cargo test -p voice --lib` + `bun run test:run`

## Verification

After all tasks, run:

```bash
cd src-tauri && cargo test -p voice --lib 2>&1 | tail -5
cd src-tauri && cargo clippy -p voice 2>&1 | tail -10
bun run test:run 2>&1 | tail -5
bun run lint 2>&1 | tail -5
```

All must be clean.
