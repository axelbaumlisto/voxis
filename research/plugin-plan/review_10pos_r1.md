VERDICT: APPROVE

Findings:
- None blocking.

Checked OK:
1. Persisted position wins: `const initial = loadPosition(config.storageKey) ?? this.resolveInitialPosition(config.initialPosition);` — `??` correctly means a stored position always short-circuits `initialPosition` resolution entirely. Confirmed by test "a persisted position wins over initialPosition".
2. Both the persisted branch and the resolved-initial branch feed into the same subsequent line: `const clamped = clampToViewport(initial, PILL_SIZE, this.safeArea(), readEffectiveViewport());`. There is no separate/early return for the explicit-`{x,y}` case — `resolveInitialPosition` just returns the raw point when `initialPosition` is an object, and clamping happens uniformly afterward. Verified `clampToViewport(pos, size, safeArea, viewport)` signature/order matches the call site and the test's expectation computation exactly. Confirmed by "explicit {x, y} within bounds is used as-is" and "...out of bounds is clamped via the existing clampToViewport" tests.
3. `cornerPosition("bottom-right", size, viewport)` reproduces the old inlined `defaultPosition()` formula bit-for-bit: `x = viewport.width - size.width - 16`, `y = viewport.height - size.height - 16` (CORNER_MARGIN = 16, same constant). `resolveInitialPosition(undefined)` calls exactly this, so existing users seeing no `initialPosition` get identical behavior. Test "default (no initialPosition) is unchanged" plus the standalone "bottom-right — same math..." unit test both lock this down.
4. Test coverage matches the checklist: all four corners (`cornerPosition` unit tests + parametrized `mountOverlay` corner tests), explicit point in-bounds and clamped out-of-bounds, persisted-wins, and unchanged default. No gaps found.
5. `index.ts` now exports `type { MountOverlayOptions, OverlayCorner }` — new type is part of the public surface.
6. No version-string literal assertions exist anywhere in the guest-js test suite (grepped `__tests__/` and `src/`) — the only `0.1.0`→`0.1.1` change is `package.json`, so there was nothing else requiring an update; item is correctly a no-op rather than a miss. Rust crate `Cargo.toml` version (0.1.0) is intentionally untouched since this is a JS-only guest-package change.
7. No gold-plating: `cornerPosition` is a minimal pure extraction with no new params/behavior beyond what `initialPosition` needs; `OverlayConfig.initialPosition` and the private resolver are the only new surface area; docs addition in THEMES.md is a single accurate paragraph + example, consistent with the code's actual contract (persisted wins, clamp still applies).

Minors:
- None worth raising.
