# Overlay "Aquarium": bigger window + travelling, settling, continuous cell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development + superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax. All code via subagents (implementer `o/deepseek-v4-pro`, reviewer `o/fable-5`). NEVER run bare `cargo fmt` (it reformats ~42 unrelated files); use `cargo fmt -- --check` or format only touched files, and `git add` ONLY the named files.

## Problem (user request, Russian)

The living-cell overlay (`drifting_contour`) sits in a tiny 172×36 pill. The user wants:

1. **Aquarium**: enlarge the overlay window so the cell has room to *travel* ("аквариум по которому она могла путешествовать") — roughly 4× the cell's max size. **The empty/transparent area must NOT be clickable** — only the cell itself starts dictation. The Rust window size must change too ("сделай в раст размер тоже менялся, до какого нибудь адекватного" — implementer chooses an adequate value).
2. **Settle / calm down**: after dictation the cell must slowly relax back toward rest ("как будто мы перестали бить пальцем по аквариуму") — it must NOT hold its deformed/grown shape forever (current `growthRelease: 0` holds it).
3. **Continuity**: the cell resumes from where the previous dialog left it (drift position, growth, mutation phase), NOT reset to zero. Priority **(b) across app restarts** first, then (a) within a session (already works because the webview is not recreated between dialogs).
4. **Travel**: the cell slowly drifts around the aquarium (not just a big empty box with a centered cell).

(Task done earlier in a separate branch: overlay no longer steals window focus.)

## Chosen size & design decisions

- **Aquarium = 160×160** (square). Cell max diameter today ≈ 33px (height 36 × radiusFraction). 160×160 gives ~4–5× room each way. Window is bottom-anchored, so it grows **upward** from the current pill position (top expands; bottom edge stays where the pill was).
- **Per-theme size** (NOT global): the cell theme opts into the aquarium via its manifest; bars/pill/ring themes keep 172×36 so their layouts don't break. This is SRP/OCP-clean (other themes unaffected). The user's "тоже" referred to making Rust honor the theme's declared size.
- **Cell keeps its current absolute size** in the big aquarium (it must not scale up 4×). Introduce an absolute `baseRadiusPx` param; when set, the cell uses it instead of `min(w,h)*radiusFraction`. drifting_contour sets `baseRadiusPx ≈ 16`.
- **Travel**: cell centre `(cx,cy)` slowly wanders via low-frequency noise within `[margin, size-margin]`, instead of being pinned to `width/2,height/2`. Startle jolt + idle morph still applied on top.
- **Settle**: `growthRelease: 0 → ~0.012` so growth deflates slowly to rest; deformation already relaxes via `release`.
- **Hit-test = canvas alpha**: a pointerdown only starts dictation if the canvas pixel under the cursor is sufficiently opaque (the cell/cilia are drawn; empty aquarium is transparent). Generic (any theme), no theme-API plumbing, KISS. Themes that fill the canvas (bars) behave exactly as before.
- **Continuity persist (b)**: the cell theme (self-contained module, runs in the webview) reads/writes its own state to `localStorage` (drift offset, growth, elapsed-time seed). On mount it restores; throttled writes keep it current. Rust is NOT involved (DIP — theme owns its persistence). Within-session (a) is automatic since the renderer closure survives between dialogs.

**Tech Stack:** Rust/Tauri v2 (gtk3), React 18/TS, canvas 2D themes.

**SOLID/DRY/KISS:**
- SRP — window-sizing lives in the overlay backend; cell behavior in `cell.ts`; persistence owned by the theme.
- OCP — manifest gains optional size fields; absent → current 172×36 (back-compat for all existing themes).
- DRY — frontend canvas derives its size from the actual window (`window.innerWidth/Height`) instead of duplicating the constant; one `baseRadiusPx` fallback.
- KISS — alpha hit-test instead of a hit-region API; localStorage instead of a Rust persistence store.

**Anti-goals (YAGNI):** no true per-region click-through (empty clicks are simply ignored, not passed to the window behind — acceptable for a small bottom-anchored window; note as follow-up); no Rust-side persistence; no resizing UI; no change to non-cell themes' appearance.

---

## File Structure

- **Modify** `src-tauri/src/theme_engine/manifest.rs` — add optional `overlay_width: Option<u32>`, `overlay_height: Option<u32>` to `ThemeManifest` (serde default None). Tests: parse with/without.
- **Modify** `src-tauri/src/overlay_native/webview.rs` — (a) `set_theme` resizes+repositions the window to the theme's declared size (bottom-anchored, reapply min/max + Linux size_request lift); (b) startup builds at the active theme's size; factor a helper `apply_overlay_size(window, app, w, h)`.
- **Possibly Modify** `src-tauri/src/overlay_native/nspanel.rs` — `PILL_WIDTH/HEIGHT` stay as the DEFAULT; add `OverlaySize { width, height }` or just pass through. Keep changes minimal; the macOS NSPanel path may keep fixed size (note) — focus the resize on the webview backend (Linux/Win/primary).
- **Modify** `src-tauri/src/orchestrator/overlay_manager.rs` (the `set_theme` call sites, lines ~43 startup + ~74 on-change) — look up the theme's manifest size and pass it to the backend when the theme changes and at startup.
- **Modify** `src/overlay.tsx` — track `window.innerWidth/innerHeight` (resize listener) and pass as `width`/`height` to `ThemeHost` so the canvas always fills the actual window; add the alpha hit-test gate to the press controller wiring.
- **New** `src/overlay/hitTest.ts` — pure `isOpaqueAt(ctx-or-imageData, x, y, threshold)` helper + tests.
- **Modify** `src/theme-engine/renderers/cell.ts` — `baseRadiusPx` param (absolute size); drift/travel of `(cx,cy)`; persistence (read/write localStorage of `{driftSeed, growth, elapsed}`); keep settle via params.
- **Modify** `src/theme-engine/renderers/__tests__/cell.test.ts` — cover baseRadiusPx fallback, drift bounds, persistence serialize/restore (pure parts).
- **Modify** `src/theme-engine/builtin/drifting_contour/index.ts` — set `overlay`-related params: `baseRadiusPx ~16`, `growthRelease ~0.012`, drift params. **Modify** `src/theme-engine/builtin/drifting_contour/manifest.json` — add `overlay_width/height = 160`.
- **Modify** bundled outputs — `bun run build:themes` bundles `src/theme-engine/builtin/<id>/index.ts` → `src-tauri/themes/<id>/theme.js` and copies `manifest.json` → `theme.json`. Commit `src-tauri/themes/drifting_contour/{theme.js,theme.json}` (and any theme that inlines shared.ts if shared changes — it shouldn't here).

CONFIRMED paths (read repo): frontend theme source = `src/theme-engine/builtin/<id>/{index.ts,manifest.json}`; bundler `scripts/build-themes.ts`; `set_theme` call sites = `src-tauri/src/orchestrator/overlay_manager.rs:43` (startup) and `:74` (on change).

---

## Task 1: Manifest gains optional overlay size

**Files:** `src-tauri/src/theme_engine/manifest.rs`

- [ ] **Step 1 (TDD):** Add tests: a manifest JSON with `"overlay_width": 160, "overlay_height": 160` parses and exposes `Some(160)`; a manifest WITHOUT them parses with `None`. Run → FAIL (fields don't exist).
- [ ] **Step 2:** Add to `ThemeManifest`:
  ```rust
  #[serde(default)]
  pub overlay_width: Option<u32>,
  #[serde(default)]
  pub overlay_height: Option<u32>,
  ```
  (specta: derive should be fine for `Option<u32>`; if specta complains, add `#[specta(skip)]` like `params` — but prefer keeping it typed if it compiles.)
- [ ] **Step 3:** Run tests → PASS. `cargo build`, `cargo clippy --all-targets -- -D warnings` clean.
- [ ] **Step 4:** Commit (stage only manifest.rs): `git add src-tauri/src/theme_engine/manifest.rs && git commit -m "feat(theme): optional overlay_width/height in manifest"`.

## Task 2: Rust resizes the overlay window to the active theme's size

**Files:** `src-tauri/src/overlay_native/webview.rs`, `src-tauri/src/overlay_native/nspanel.rs` (consts/helpers), `src-tauri/src/commands/overlay.rs` (or theme-set call site), plus position helper.

- [ ] **Step 1 (TDD where pure):** The size→position math is the only pure piece. Add/extend a unit test that `compute_initial_position`-style logic (or `OverlayPositionConfig::calculate`) bottom-anchors correctly with height=160 (top grows up, bottom edge unchanged vs height=36 at the same anchor). Use the existing position test module in nspanel.rs. Run → as needed.
- [ ] **Step 2:** Implement `apply_overlay_size(window, app, w: u32, h: u32)` in webview.rs:
  - `window.set_min_size(Some(LogicalSize::new(w,h)))`, `set_max_size(Some(...))`, `set_size(LogicalSize::new(w,h))`.
  - Recompute position via `compute_initial_position` using `w,h` (so the window stays bottom-anchored and grows upward) and `set_position`.
  - Linux: re-run the `with_webview` size_request(1,1)+toplevel.resize(w,h) lift so WebKitGTK's 200×200 min doesn't clamp (160<200). Keep the Dock/accept_focus(false)/focus_on_map(false)/can_focus(false) policy intact (do not regress the focus fix).
- [ ] **Step 3:** Wire it:
  - At startup (`build_overlay_window`): look up the ACTIVE theme's manifest (loader) and build at its `overlay_width/height` if present, else PILL defaults.
  - On `set_theme(name)` (webview `OverlayBackend::set_theme`): before/after emitting the theme event, look up that theme's manifest size and call `apply_overlay_size` (on the main thread via `run_on_main_thread`). If the theme declares no size, reset to PILL defaults (so switching from aquarium → bars shrinks back).
  - The manifest lookup needs the loader/themes_dir. `set_theme` currently only has `theme_name` + `self.app`. Get the themes dir from `AppPaths`/loader state via `self.app.state()` or pass the size in from the command layer (commands/overlay.rs already has the loader). PREFERRED: resolve the size in the command/orchestrator layer that calls `set_theme`, and add a backend method `set_theme_with_size(name, Option<(w,h)>)` OR a separate `resize(w,h)` call right after `set_theme`. Pick the cleanest given the existing call sites — read them first (grep `set_theme(` call sites). Keep the trait change minimal.
- [ ] **Step 4:** macOS NSPanel: keep it simple — either implement the same resize on the nspanel backend, or (acceptable for v1) leave NSPanel at fixed size and add a code comment + plan note that aquarium resize is webview-backend-first. Do NOT break compilation on macOS.
- [ ] **Step 5:** `cargo build`, `cargo test --lib` green, `cargo clippy --all-targets -- -D warnings` 0. Commit named files only with message `feat(overlay): resize window to per-theme size (bottom-anchored)`.

## Task 3: Frontend canvas fills the actual window

**Files:** `src/overlay.tsx`

- [ ] **Step 1:** In `OverlayApp`, add `const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })` and a `resize` event listener that updates it (cleanup on unmount). Default values are fine for jsdom (0/0) — guard: fall back to undefined so ThemeHost uses its 172/36 defaults if innerWidth is 0.
- [ ] **Step 2:** Pass `width={size.width || undefined}` `height={size.height || undefined}` to `<ThemeHost>`. The wrapper div already is `width:100%;height:100%`.
- [ ] **Step 3:** Tests: extend overlay tests (if any) or add one asserting ThemeHost receives the window size; keep light (jsdom). Run frontend tests green.
- [ ] **Step 4:** Commit `src/overlay.tsx` (+ test): `feat(overlay): canvas fills actual window size`.

## Task 4: Hit-test — only the cell is clickable

**Files:** `src/overlay/hitTest.ts` (new), `src/overlay/__tests__/hitTest.test.ts` (new), `src/overlay.tsx`

- [ ] **Step 1 (TDD):** Write `src/overlay/__tests__/hitTest.test.ts` for a pure `isOpaqueAt(data: Uint8ClampedArray, width, x, y, threshold=10): boolean` that indexes `data[(y*width+x)*4+3]` (alpha) and returns alpha >= threshold; bounds-out → false. Run → FAIL (no impl).
- [ ] **Step 2:** Implement `src/overlay/hitTest.ts` with that pure function (+ a thin helper `isCanvasOpaqueAt(canvas, clientX, clientY, threshold)` that maps client coords → canvas pixel using `getBoundingClientRect` + devicePixelRatio and calls `getContext('2d').getImageData`). Keep the pure index function separately testable.
- [ ] **Step 3:** Wire into `overlay.tsx` press controller: in the `pointerdown` handler, find the canvas inside `wrapperRef` (`querySelector('canvas')`); if found and `!isCanvasOpaqueAt(canvas, e.clientX, e.clientY)` → return early (do NOT `press()`); otherwise proceed as today (press + setPointerCapture). If no canvas (non-canvas theme/jsdom) → behave as before (always allow), so nothing regresses.
- [ ] **Step 4:** Tests green (pure hitTest + existing pressController tests untouched). Commit new files + overlay.tsx: `feat(overlay): only clicks on the cell start dictation (alpha hit-test)`.

## Task 5: Cell keeps its size, travels the aquarium, settles, and persists

**Files:** `src/theme-engine/renderers/cell.ts`, `src/theme-engine/renderers/__tests__/cell.test.ts`

- [ ] **Step 1 (TDD):**
  - `baseRadiusPx`: assert that with `baseRadiusPx` set, `cellRadius`/base radius uses the absolute px (independent of large width/height); without it, falls back to `min(w,h)*radiusFraction`.
  - drift: a pure `cellDrift(t, width, height, baseR, params) -> {cx, cy}` that stays within `[baseR+margin, size-baseR-margin]` for a range of t (assert bounds). Slow (low-frequency noise).
  - persistence: pure `serializeCellState(state) -> string` / `parseCellState(str) -> state|null` (drift seed, growth, elapsed); parse of garbage → null (fail-safe).
  - Run → FAIL.
- [ ] **Step 2:** Implement:
  - `CellParams` gains `baseRadiusPx?: number`, drift params (`driftSpeed`, `driftMargin` or similar), and keep `growthRelease`.
  - `baseR` in `createCellRenderer` tick uses `params.baseRadiusPx ?? Math.min(width,height)*params.radiusFraction`, then applies growth swell.
  - Replace `cx = width/2 + sdx; cy = height/2 + sdy` with `const d = cellDrift(t, width, height, baseR, params); cx = d.cx + sdx; cy = d.cy + sdy;` (drift + startle jolt). Idle morph unchanged.
  - Persistence: on mount, `parseCellState(localStorage.getItem(KEY))` → seed `growth`, drift phase, and `startedAt` so `t` (elapsed) continues. Throttle writes (e.g. every ~500ms in tick, guarded by a timestamp) of `serializeCellState(...)`. Guard `typeof localStorage !== 'undefined'` + try/catch (jsdom/SSR safe).
- [ ] **Step 3:** Tests green. Run full TS suite (`bun run test:run`) green.
- [ ] **Step 4:** Commit cell.ts + test: `feat(cell): absolute size, aquarium drift, settle, and persisted continuity`.

## Task 6: Wire drifting_contour to the aquarium + bundle + live verify + ship

**Files:** `src/theme-engine/builtin/drifting_contour/index.ts`, its `manifest.json`, bundled `src-tauri/themes/drifting_contour/{theme.js,theme.json}`.

- [ ] **Step 1:** In drifting_contour params set: `baseRadiusPx: 16`, `growthRelease: 0.012` (settle), drift params (slow), keep cilia/startle/idle. In the theme's manifest add `"overlay_width": 160, "overlay_height": 160`.
- [ ] **Step 2:** `bun run build:themes`. Confirm the bundle regenerated. Copy to the live user dir if needed for testing: `cp src-tauri/themes/drifting_contour/theme.js ~/.config/soupawhisper/themes/drifting_contour/` and same for theme.json (user themes are not overwritten by seeding).
- [ ] **Step 3 (controller live verify):** rebuild debug, launch via setsid (`DISPLAY=:0 XAUTHORITY=/tmp/xauth_UYrikP`), confirm: (a) overlay window is ~160×160 (`xdotool ... getwindowgeometry`); (b) cell sits at its normal small size and slowly drifts; (c) clicking ON the cell starts dictation; clicking the empty aquarium does NOT; (d) after dictation the cell relaxes back (growth deflates); (e) focus still NOT stolen (regression check from the prior task); (f) restart the app → cell resumes near its previous drift/growth (continuity b). Capture a screenshot.
- [ ] **Step 4:** Stage the named frontend + bundled files only; commit `feat(theme): drifting_contour aquarium (size 160, settle, drift)`. Re-bundle note: if `shared.ts` changed, re-bundle ALL themes that inline it and commit them; here it shouldn't change.
- [ ] **Step 5 (ship):** Run full suites: `bun run test:run` green, `cd src-tauri && cargo test --lib` green + clippy 0, `bun run lint` (3 pre-existing warnings ok). Merge branch → main, delete branch, `git push gitverse main`, `cargo build --release`, relaunch.

---

## Self-Review (run before execution)

**Spec coverage:**
- Bigger window in Rust, adequate size → Task 1+2 (160×160, per-theme, bottom-anchored). ✓
- Empty area not clickable → Task 4 (alpha hit-test). ✓
- Cell keeps size + travels → Task 5 (baseRadiusPx + cellDrift). ✓
- Settle/calm → Task 5/6 (growthRelease 0.012, deformation release). ✓
- Continuity (b restarts primary, a session) → Task 5 (localStorage) + existing persistent webview. ✓
- Don't regress focus fix → Task 2 keeps Dock/accept_focus policy; Task 6 step 3e re-checks. ✓

**Risks:** (1) Runtime resize below WebKitGTK 200×200 min → mitigated by re-running the size_request(1,1) lift in apply_overlay_size; verify live. (2) Reposition math must bottom-anchor — verify the pill's bottom edge stays put when height grows. (3) Alpha hit-test reads getImageData each click — fine (one pixel). The cell glow has low-alpha edges; threshold ~10 keeps glow-only pixels non-clickable but the body/cilia clickable — tune live. (4) localStorage continuity must fail-safe (try/catch) so a corrupt value never breaks the overlay. (5) set_theme call-site plumbing for size — read call sites first; prefer resolving size in the command layer to avoid threading the loader into the backend.

**Placeholder scan:** concrete edits, fallbacks, and live checks defined. ✓

---

## Execution Handoff

Subagent-Driven. Per task: implementer `o/deepseek-v4-pro` with the task's acceptance (TDD evidence: test FAILs then PASSes; only-named-files staged; build/clippy/tests green). Reviewer `o/fable-5` advisory after the Rust task (Task 2) and the cell task (Task 5). Controller (me) does the live verification in Task 6 and the merge — never edits code.
