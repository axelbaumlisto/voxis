# Overlay Must Not Steal Window Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Problem (user-reported, high priority):** Clicking the overlay pill to dictate **moves window focus to the overlay**. The previously-focused window (chat box, editor, …) loses focus, so the auto-typed transcription no longer lands in it. The overlay must NEVER take focus — pressing it should start dictation while keyboard focus stays exactly where it was.

**Root cause:** The Linux/Windows backend is a plain Tauri `WebviewWindow` built with `.focused(false)` (webview.rs:152). `.focused(false)` only means "don't focus *on creation*" — a later pointer click on the window still activates it (the WM gives it focus on button-press). On macOS the NSPanel backend already sets `can_become_key_window: false` and never steals focus (nspanel.rs:7), so macOS is fine. The fix is Linux/GTK (and a note for Windows): mark the GTK toplevel as non-focus-accepting + a utility/dock window type so the WM never transfers focus to it on click.

**Fix (Linux/GTK3, where the bug is):** In the existing `#[cfg(target_os = "linux")] window.with_webview(...)` block in `build_overlay_window` (webview.rs ~line 187), on the toplevel `gtk::Window` also call:
- `set_accept_focus(false)` — the WM won't give it input focus.
- `set_type_hint(gdk::WindowTypeHint::Utility)` — hints "auxiliary, don't activate".
- `set_can_focus(false)` on the gtk window widget (belt-and-suspenders).

With `accept_focus = false`, a click still delivers the pointer event to the WebKit view (so our pointerdown→dictate handler fires), but the WM does not move keyboard focus — the prior window keeps focus and receives the typed text.

**Architecture:** Single, localized change in the Linux post-build GTK block. No frontend change, no orchestrator change. macOS already correct; Windows tracked as a follow-up note (WS_EX_NOACTIVATE) — out of scope for this Linux-first fix but documented.

**Tech Stack:** Rust, Tauri v2, gtk 0.18 (GTK3), webkit2gtk 2.0.2.

**SOLID / DRY / KISS rationale:**
- **SRP / locality** — the focus policy lives next to the other Linux GTK window tweaks already in `with_webview`.
- **OCP** — additive: three GTK calls in the existing cfg(linux) block; no behavior change on other platforms.
- **KISS** — uses the WM-level "don't accept focus" mechanism rather than re-focusing the previous window after the fact (fragile/racy).
- **DRY** — reuses the already-acquired `gtk_window` toplevel handle in that block.

**Anti-goals (YAGNI):** no "remember & restore previous focus" hack, no Windows implementation in this task (note only), no change to click-to-dictate wiring (it already works — we only stop the focus transfer).

---

## File Structure

- **Modify** `src-tauri/src/overlay_native/webview.rs` — in the `#[cfg(target_os = "linux")]` `with_webview` block, after obtaining `gtk_window` (the toplevel), set `accept_focus=false`, `type_hint=Utility`, `can_focus=false`. Add the `gdk` import path if needed (gtk re-exports gdk as `gtk::gdk`).
- **Possibly Modify** `src-tauri/Cargo.toml` — only if `gdk::WindowTypeHint` isn't reachable via the existing `gtk` dep; prefer `gtk::gdk::WindowTypeHint` (no new dep).

NOTE: the block currently does `if let Ok(gtk_window) = toplevel.downcast::<gtk::Window>() { gtk_window.resize(...) }`. Add the focus calls inside that same `if let Ok(gtk_window)` scope, before/after the resize — all on `gtk_window`.

---

## Task 1: Linux — make the overlay GTK window non-focus-stealing

**Files:**
- Modify: `src-tauri/src/overlay_native/webview.rs`

- [ ] **Step 1: Locate & edit the cfg(linux) with_webview block**

In `build_overlay_window`, the existing block reads (approx):
```rust
#[cfg(target_os = "linux")]
{
    let _ = window.with_webview(|webview| {
        use gtk::prelude::{Cast, GtkWindowExt, WidgetExt};
        let wv = webview.inner();
        wv.set_size_request(1, 1);
        if let Some(toplevel) = wv.toplevel() {
            if let Ok(gtk_window) = toplevel.downcast::<gtk::Window>() {
                gtk_window.resize(PILL_WIDTH as i32, PILL_HEIGHT as i32);
            }
        }
    });
    ...
}
```

Change it to also set the focus policy on `gtk_window` and the widget. The `GtkWindowExt` trait provides `set_accept_focus` and `set_type_hint`; `WidgetExt` provides `set_can_focus`:

```rust
#[cfg(target_os = "linux")]
{
    let _ = window.with_webview(|webview| {
        use gtk::prelude::{Cast, GtkWindowExt, WidgetExt};
        let wv = webview.inner();
        wv.set_size_request(1, 1);
        if let Some(toplevel) = wv.toplevel() {
            if let Ok(gtk_window) = toplevel.downcast::<gtk::Window>() {
                gtk_window.resize(PILL_WIDTH as i32, PILL_HEIGHT as i32);
                // Never steal keyboard focus from the active app: a click on
                // the pill still delivers the pointer event to WebKit (so
                // click-to-dictate works), but the WM must not transfer input
                // focus here, or auto-typed text would no longer reach the
                // user's focused window.
                gtk_window.set_accept_focus(false);
                gtk_window.set_can_focus(false);
                gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Utility);
            }
        }
    });
    // Re-assert size after the GTK-level fix ...
    let _ = window.set_size(LogicalSize::new(PILL_WIDTH as f64, PILL_HEIGHT as f64));
}
```

If `gtk::gdk::WindowTypeHint` does not resolve, try `use gtk::gdk;` then `gdk::WindowTypeHint::Utility`, or `gdk::WindowTypeHint::Dock`. Prefer `Utility`; if a compositor still activates Utility windows on click, `Dock` is the stronger "never focus" hint — pick whichever compiles and is available in the pinned gdk.

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo build 2>&1 | tail -8`
Expected: compiles. If `set_type_hint`/`WindowTypeHint` path is wrong, fix the import per the note above and rebuild.

- [ ] **Step 3: clippy + targeted check**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8` → 0 warnings.
(No new unit test — this is WM-level windowing behavior verified live in Task 2. Do NOT fabricate a unit test that can't observe focus.)

- [ ] **Step 4: Commit**

(Do NOT run bare `cargo fmt`; if formatting the touched file, use `cargo fmt -- --check` and only `git add` the one file.)

```bash
cd src-tauri && git add src/overlay_native/webview.rs
git commit -m "fix(overlay): Linux GTK window never steals focus (accept_focus=false, Utility hint)"
```

---

## Task 2: Verify live + ship

**Files:** none.

- [ ] **Step 1: Rust suites**

Run: `cd src-tauri && cargo test --lib 2>&1 | grep "test result"` → green (no regressions).
Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings` → 0 warnings.

- [ ] **Step 2: Live focus check (controller)**

Build + launch the debug binary via setsid (DISPLAY=:0 XAUTHORITY=/tmp/xauth_UYrikP). Open a focusable window (e.g. a text editor / terminal with a cursor). Note which window has focus (`xdotool getactivewindow getwindowname`). Then click-and-hold the overlay pill (xdotool at the pill center 1834+86,2060+18). Immediately re-check `xdotool getactivewindow getwindowname`:
- PASS: the active window is STILL the original window (overlay did not steal focus).
- FAIL: active window became "Recording Overlay".
Also confirm dictation still starts (log shows on_hotkey_pressed → Recording) — the click must still register even though focus didn't move.

- [ ] **Step 3: Ship**

```bash
git checkout main && git merge feature/overlay-no-focus-steal --no-edit
git branch -d feature/overlay-no-focus-steal
git push gitverse main
cd src-tauri && cargo build --release && cd ..
```

---

## Self-Review (run before execution)

**Spec coverage:**
- "фокус должен оставаться в том же месте" / text must still type into the user's window → GTK `accept_focus=false` + Utility hint stops the WM transferring focus on click; click still delivers to WebKit so dictation triggers. ✓
- macOS already non-activating (NSPanel can_become_key_window=false) → unaffected. ✓
- Windows → noted as follow-up (WS_EX_NOACTIVATE), not in scope. ✓

**Risk:** (1) Some compositors may still focus a Utility window on click — if the live check FAILS, escalate to `Dock` type hint and/or investigate KWin-specific rules; report findings rather than guessing further. (2) `accept_focus=false` must NOT block pointer events — it doesn't (it governs keyboard focus, not pointer delivery); the live check confirms dictation still fires. (3) The gdk path/import is the only compile risk — Step 1 note covers the fallbacks.

**Placeholder scan:** concrete edit + fallbacks; live verification defined. ✓

---

## Execution Handoff

Subagent-Driven: implementer `o/deepseek-v4-pro`; reviewer `o/fable-5` after Task 1 (advisory) — but the real proof is the live focus check (controller).
