# `@voxis/tauri-plugin-voxis` (guest-js)

Typed TypeScript API + a `<voxis-overlay>` web component for
`tauri-plugin-voxis` (the Rust crate, `crates/tauri-plugin-voxis`, this
package's sibling directory). Hand-written, **no codegen** — types mirror
the Rust command/event contract in `../contract/fixtures/*.json` and
`../src/models.rs` by hand; a change on the Rust side needs a matching
manual update here (the fixture-snapshot tests on both sides are the
safety net, not a generator).

Currently versioned **`0.1.1`**, independently of the Rust crate's own
`0.1.0` — bump each on its own schedule.

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
  setHotkey(spec: HotkeySpec): Promise<void>;
  setConsent(consented: boolean): Promise<void>;
  holdLease(id: SessionId): Promise<void>;
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

  In this mode the pill's pointer handlers only arm dragging and dispatch a
  `"voxis-overlay-press"` `CustomEvent` (`detail: { phase: "down" | "up" }`)
  for a host driving hold-to-talk itself; window `blur` is a no-op. **Use
  this mode whenever a host already has its own event subscription** — the
  default mode's own subscription and a host's own subscription would
  otherwise both react to the same events independently (two controllers,
  one session), which is the class of bug the "host" driver exists to rule
  out entirely, not just discourage.

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
