# `@voxis/tauri-plugin-voxis` (guest-js)

Typed TypeScript API + a `<voxis-overlay>` web component for
`tauri-plugin-voxis` (the Rust crate, `crates/tauri-plugin-voxis`, this
package's sibling directory). Hand-written, **no codegen** — types mirror
the Rust command/event contract in `../contract/fixtures/*.json` and
`../src/models.rs` by hand; a change on the Rust side needs a matching
manual update here (the fixture-snapshot tests on both sides are the
safety net, not a generator).

Currently versioned **`0.9.2`** (0.9.2: the theme select shows theme names via `status.themes`; 0.9.1: `overlayHidden` toggle split from `overlayPlacement`; 0.9.0: settings manifest + `getSettings`/`setSettings`), independently of the Rust crate's own
version — bump each on its own schedule. (`0.4.0`, additive: new
`setProvider(opts)` command for typing a Groq key / self-hosted URL in
directly, no Voxis desktop needed. `0.2.0` earlier: the pill now resolves
each theme's manifest `overlay_width`/`overlay_height` instead of a fixed
64×64 — see "Compact/expanded lifecycle" below.)

## Install

Not published to npm. Two supported ways a host consumes this package:

1. **Vendored tarball** (naked's current approach): `bun run build` in this
   directory produces `dist/`; `npm pack` (or the repo's own bundling
   script, if one exists on the host side) produces a `.tgz` a host adds as
   `"@voxis/tauri-plugin-voxis": "file:vendor/voxis-tauri-plugin-voxis-<ver>.tgz"`.
   **Bump the tarball's version/filename on every rebuild** — bun/vite's
   build caches do not reliably invalidate on a same-named file overwrite,
   so re-vendoring without bumping the version can silently ship stale JS
   (a real incident during naked's own integration, see
   `.pi/plans/tauri-plugin-voxis.md`'s Task 10 part 3 "lessons").
2. **Git dependency** pointing at this subdirectory, if the host's package
   manager supports git+subpath deps against the private Forgejo remote
   (same credential caveat as the Rust crate's own README — the Forgejo
   repo is private, and CI needs its own auth to clone it).

`package.json`'s `peerDependencies` requires `@tauri-apps/api@^2` — a host
supplies its own copy (already a dependency of any Tauri 2 frontend).

## `createClient` — typed command/event wrappers

```ts
import { createClient } from "@voxis/tauri-plugin-voxis";

const client = createClient(); // real @tauri-apps/api under the hood
const id = await client.start("hold");
// ... later
const result = await client.stop(id); // DictationResult { text, language?, durationMs, guardOutcome }
```

`createClient({ invoke, listen })` accepts injectable `invoke`/`listen`
functions matching `@tauri-apps/api/core`'s `invoke` and
`@tauri-apps/api/event`'s `listen` shapes — this is what makes the
`harness/` page, this package's own vitest suite, and `overlay.ts` itself
runnable with zero real Tauri runtime.

`VoxisClient` methods (1:1 with the Rust commands — see the Rust crate's
own README for the full per-command semantics/error shapes):

```ts
interface VoxisClient {
  start(mode: "hold" | "toggle"): Promise<SessionId>;
  stop(id: SessionId): Promise<DictationResult>;
  cancel(id: SessionId): Promise<void>;
  state(): Promise<PluginState>;
  getProfile(): Promise<VoxisProfileDto>;
  applyProfile(bytes: number[], keySource: KeySourceDto): Promise<ImportSummary>;
  importProfileFromDesktop(): Promise<ImportSummary>;
  importProfileFromQr(payload: string, code: string): Promise<ImportSummary>;
  // Manual entry (no desktop/QR): apiKey null=keep, ""=clear, else set;
  // apiUrlOverride null=Groq default, else an http(s) URL; model null=unchanged.
  setProvider(opts: { apiKey: string | null; apiUrlOverride: string | null; model: string | null }): Promise<ImportSummary>;
  setHotkey(spec: HotkeySpec): Promise<void>;
  setConsent(consented: boolean): Promise<void>;
  holdLease(id: SessionId): Promise<void>;
  // 0.9.0 settings: { values, status } (never the API key); partial patch,
  // rejects { kind: "invalid", field, message }; the manifest (local).
  getSettings(): Promise<VoxisSettingsSnapshot>;
  setSettings(values: VoxisSettingsPatch): Promise<VoxisSettingsSnapshot>;
  settingsManifest(): SettingsManifest;
  onState(cb: (s: PluginState) => void): Promise<UnlistenFn>;
  onLevel(cb: (l: LevelEvent) => void): Promise<UnlistenFn>;
  onResult(cb: (r: DictationResult) => void): Promise<UnlistenFn>;
  dictate(opts: { mode: Mode }): Promise<DictationResult>; // convenience: start() + await the matching voxis://result
}
```

`dictate()` does not itself call `stop()` — a caller ends the session
(pointer release, hotkey release, a Stop button) and `dictate()`'s promise
resolves once the matching `voxis://result` arrives. It rejects instead of
hanging if the session ends without ever producing a result (`error`
state, or `idle` with no result inside a short grace window).

## Settings manifest (`settings.ts`, 0.9.0)

The plugin describes its own settings as JSON — `voxisSettingsManifest` /
`settingsManifest()` (source: `src/voxis-settings-manifest.json`). A host
renders one settings tab per plugin from it; schema v1 (field kinds
`toggle`/`select`/`text`/`secret`/`number`/`status`/`action`/`file-import`,
`{ en, ru }` texts, `store: "plugin" | "host"`, conditions
`{ query: "status" | "values" | "host", path, equals | notEquals | truthy }`
with `all`/`any`, `visibleWhen`/`enabledWhen`+`disabledReason`/
`required`+`requiredStatus`) is documented at the top of `src/settings.ts`.
`validateSettingsManifest(m)` returns the list of problems (empty = valid).
`store: "plugin"` fields go through `getSettings()`/`setSettings()`;
`store: "host"` fields (`enabled`, `overlayHidden`, `overlayPlacement`, `overlayOffsetX/Y`,
`dictationChord`) are the host's to persist.

## `mountOverlay` — the `<voxis-overlay>` web component

```ts
import { mountOverlay } from "@voxis/tauri-plugin-voxis";

const el = mountOverlay(document.body, { theme: "waveform", draggable: true });
```

Renders a draggable recording pill using the same theme-engine contract
Voxis desktop's native overlay uses (`docs/THEMES.md`; builtin themes are
bundled as self-contained ESM via `scripts/build-themes.ts`, **not** loaded
through Blob/`import()` — this element works under a strict
`script-src 'self'` CSP, which is why naked can mount it inside its own
webview unmodified).

### Two driver modes

- **`driver: "client"`** (default, unchanged since introduction): the
  element creates and owns its own `VoxisClient`, subscribes to
  `voxis://state`/`voxis://level`/`voxis://result` itself, and drives
  `start`/`stop` off its own pointer gestures.
- **`driver: "host"`**: the element never creates a client and never
  subscribes to anything — a host that already holds its own long-lived
  subscription (e.g. a `useVoxisRuntime`-style hook) feeds it manually:

  ```ts
  const el = mountOverlay(document.body, { driver: "host" });
  client.onState((s) => el.applyState(s));
  client.onLevel((l) => el.applyLevel(l));
  client.onResult((r) => el.applyResult(r));
  ```

  This mode is a pure visual/indicator: the pill's pointer handling only
  arms dragging — no session is started here and no press event is
  emitted. A host driving hold-to-talk wires press from its own container
  handlers (its `setPointerCapture` on a light-DOM ancestor retargets the
  pointer away from the shadow-DOM pill, so a press event dispatched from
  the element could not reach the host reliably anyway); window `blur` is
  a no-op. **Use this mode whenever a host already has its own event
  subscription** — the default mode's own subscription and a host's own
  subscription would otherwise both react to the same events
  independently (two controllers, one session), which is the class of bug
  the "host" driver exists to rule out entirely, not just discourage.

  Position and theme are live seams — a host repositions or re-themes the
  running element instead of remounting it:

  ```ts
  el.setPosition({ x, y }); // "the COMPACT pill rests here" — in every
                            // lifecycle state (0.7.0). Compact: placed there
                            // (clamped with COMPACT_SIZE). Expanded: placed
                            // where a grow from that spot lands, and the
                            // next shrink returns TO that spot — so a host
                            // that re-anchors mid-recording (keyboard
                            // opening/closing while dictating) stays the one
                            // owner of the position. No remount.
  el.setTheme("lavalamp");  // re-resolves module + manifest size; while
                            // expanded, swaps only the theme container
                            // (fresh WebGL context) and emits
                            // "voxis-overlay-resize" if the size changed
  ```

### Other `MountOverlayOptions`

- `theme?: string` — theme id (see `ThemeRegistry`/`resolveTheme`); unknown
  id → default theme + a console warning, never a hard failure.
- `draggable?: boolean` (default `true`) — pointer-drag with position
  persisted to `localStorage[storageKey]`, snapping to the nearest edge,
  clamped to the viewport/safe-area (`env(safe-area-inset-*)`).
- `storageKey?: string` (default `"default"`) — `localStorage` key for the
  persisted position; a host mounting more than one overlay instance
  (unusual) needs distinct keys.
- `initialPosition?: Point | "top-left" | "top-right" | "bottom-left" |
  "bottom-right"` — where the pill first appears **only when nothing is
  persisted yet**; a persisted position (from a prior drag or mount) always
  wins over this. Default `"bottom-right"`. Use this to avoid a host's own
  fixed chrome in that corner (e.g. naked overrides to `"top-right"` on
  narrow phone viewports to avoid its own bottom-right status control).
- `mode?: "hold" | "toggle"` (default `"hold"`).
- `client?: VoxisClient` — injectable, ignored (and not required) under
  `driver: "host"`.
- `idleTheme?: boolean` (default `false`) — see "Compact/expanded
  lifecycle" below.
- `board?: boolean` (default `true`) — `false` drops the dark board under
  the expanded window (0.8.0): only the theme is drawn, for a host that lays
  an always-shown window (`idleTheme`) over its own content. The compact
  handle keeps its fill.

`initialPosition` is the compact RESTING spot in every lifecycle (0.8.0),
the same meaning `setPosition` has had since 0.7.0: an `idleTheme` window is
born grown from it, where the host's first `setPosition` to the same spot
leaves it (0.7.0 placed the window's top-left there, and the first
re-anchor then moved it by the size difference). A persisted position is
still the pill's own last top-left.

### Compact/expanded lifecycle (theme-sized overlay)

A theme's manifest can declare an `overlay_width`/`overlay_height` far
bigger than a plain pill (lavalamp/metaballs* are 120×120 WebGL scenes;
`all_aquarium` is 340×170) — squashing one of those into a fixed 64×64
circle made it unrecognisable (a lava lamp rendered at pill scale is just
a dotted smear). The element now has two sizes/states, driven by
`applyState`'s `PluginState` (both drivers, `"client"` and `"host"`):

- **`"compact"`** (`idle`/`error`, the default resting state): a fixed
  56×56 circle "handle" (a ring + a center dot) — **no theme is mounted**,
  so there's no WebGL/canvas render loop while idle (battery).
- **`"expanded"`** (`recording`/`transcribing`): the pill grows to the
  theme's resolved manifest size (`resolveThemeSize`; `FALLBACK_THEME_SIZE`
  64×64 for a manifest with no declared size — unchanged for those themes)
  and the theme is mounted and driven by `applyState`/`applyLevel` exactly
  as before. Growing/shrinking pivots around whichever edge the pill is
  already closest to, so it can't grow off-screen, and shrinking always
  returns to the exact pre-growth position — a drag mid-expansion doesn't
  change where the pill settles once it shrinks back. Shape: a circle for
  a square ≤96px a side, a 16px-radius rounded rect otherwise.

`idleTheme: true` opts a host out of this entirely (e.g. a desktop host
with its own permanently-visible "socket" for the overlay) — the theme
stays mounted and the pill stays `"expanded"` even at idle.

A host can read the current size via `el.size`/`el.lifecycle`, or listen
for `"voxis-overlay-resize"` (`detail: { width, height, state }`,
`state` being `"compact" | "expanded"`) to resize its own layout around
the pill instead of polling.

## In-app hotkey (`HotkeyMachine`/`bindHotkey`)

For hosts on a platform/build with no OS-level global hotkey (iPad with an
external keyboard while the host is focused; any desktop webview wanting a
page-scoped binding instead of the OS-level one):

```ts
import { bindHotkey } from "@voxis/tauri-plugin-voxis";

const bound = bindHotkey(
  { key: "alt_r", mode: "hold" },
  { onPress: () => client.start("hold"), onRelease: (id) => client.stop(id) }
);
// later: bound.unbind();
```

`HotkeyMachine` is a pure `Pressed`/`Released` state machine (unit-testable
without a DOM); `bindHotkey` wires it to `document`/`window` `keydown`/
`keyup`, with auto-repeat filtering and a keyup-loss timeout (`blur` forces
a synthetic release — a key held down while the window loses focus must
not leave the session running forever). Throws
`UnrecognizedHotkeySpecError` **synchronously at construction** for a spec
outside `SINGLE_KEY_CODES` (mirrors `voxis_core::hotkey::KEY_TABLE`, no
`f13`+) or an unparseable `"Mod+Mod+Key"` combo — fail loud at bind time,
not silently no-op on the first keypress.

## Hold-mode lease (`startHoldLease`)

```ts
import { startHoldLease } from "@voxis/tauri-plugin-voxis";

const lease = startHoldLease({ sendHeartbeat: () => client.holdLease(sessionId) });
// on stop/cancel/any terminal state:
lease.stop();
```

Ticks `sendHeartbeat()` at 1 Hz (configurable) while a Hold session is
active — the plugin's Rust-side watcher cancels the session after 3 missed
beats (`LeaseLost`), so a webview crash/reload doesn't leave the
microphone open. `startHoldLease` itself guarantees the interval stops on
every exit path (explicit `.stop()`, a heartbeat call rejecting, and the
page's own `pagehide`) — a caller does not need its own belt-and-braces
cleanup on top of calling `.stop()` at the right two or three call sites.
Not needed for Toggle-mode sessions.

## Drag/viewport helpers (`drag.ts`)

Exported mostly for the overlay's own internal use, but usable directly by
a host building a custom draggable control against the same
viewport/safe-area rules: `clampToViewport`, `snapToNearestEdge`,
`readSafeAreaInsets`, `readEffectiveViewport` — all pure functions taking
an already-read `Viewport`/`SafeArea`, so they're unit-testable without a
real browser window.

## Building / testing

```sh
bun install
bun run build       # scripts/build-themes.ts (bundles builtin theme.js) + tsc -> dist/
bun run test         # scripts/build-themes.ts + vitest run
bun run typecheck     # tsc --noEmit
bun run harness       # vite --config vite.harness.config.ts — visual harness with a mocked client
```

The theme source for `ThemeRegistry` is `scripts/build-themes.ts`'s own
output (a second, self-contained ESM `theme.js` per builtin theme), **not**
`src/theme-engine/builtin/**` directly — that source tree uses relative
imports (`../../renderers/bars`) that only resolve inside the desktop app's
own build, not a standalone guest-js bundle. `ThemeRegistry` statically
imports the built output; there is no Blob/data-URL `import()` loader in
this package (a real CSP requirement, not a style preference — see
`docs/THEMES.md`'s "Appendix" for why).

## Contract fixtures

`../contract/fixtures/{commands,events,dictation-result,profile-v1,
profile-qr}.json` are the wire-format source of truth both this package
and the Rust crate snapshot-test against independently. A change to either
side's types must update the fixture and both sides' tests in the same
change — there is no generator keeping them in sync automatically.
