// crates/tauri-plugin-voxis/guest-js/src/overlay.ts
/**
 * `<voxis-overlay>` — the plugin's draggable, hold-to-talk (or tap-to-
 * toggle) recording pill, rendered with the host's own theme-engine
 * contract via `theme-bridge.ts`/`themes/registry.ts`. Shadow DOM so the
 * host page's CSS can't accidentally reach in (or the overlay's own
 * styles leak out).
 *
 * Interaction model (`mode` option, plan Task 5 acceptance):
 * - `"hold"`: `pointerdown` on the pill starts a session immediately;
 *   `pointerup`/`pointercancel`/`lostpointercapture`/window `blur` all
 *   stop it — never a stuck recording, regardless of *how* the pointer
 *   gesture ends. The same pointerdown also arms the drag controller, so
 *   holding-and-dragging works in one gesture.
 * - `"toggle"`: a *tap* (pointer released without exceeding the drag
 *   threshold) starts a session if idle, stops it if recording; a real
 *   drag never toggles.
 * - A persistent recording indicator (visible dot + `aria-live` text) is
 *   shown whenever the plugin's own state is `"recording"`, independent
 *   of which mode triggered it — required for Toggle mode by App Store
 *   2.5.14, harmless (and arguably reassuring) in Hold mode too. This is
 *   unrelated to the compact/expanded size below — it's a top-right dot
 *   layered over whichever visual (idle handle or mounted theme) is
 *   currently showing.
 *
 * Driver model (`driver` option — separate from `mode`, which is the
 * hold/toggle *gesture* and unrelated to who owns the session):
 * - `"client"` (default): unchanged today's behaviour — the overlay
 *   creates/owns a `VoxisClient`, subscribes to `onState`/`onLevel`/
 *   `onResult` itself (`wireClientEvents`), and its own pointer handlers
 *   call `start`/`stop`/`holdLease` directly.
 * - `"host"`: for a host app that already holds its own long-lived
 *   `voxis://state`/`voxis://result` subscription (e.g. a `useVoxisRuntime`-
 *   style hook) and only wants this element as a pure *visual*
 *   indicator + drag-positioned pill, without a second competing
 *   subscriber/controller. No client is created or required, and no
 *   session is ever started here — pointer handling is left entirely to
 *   `wireDrag` (drag/position), with no `"voxis-overlay-press"` event or
 *   any other session/press signal emitted. A host that wants
 *   hold-to-talk drives press from its own container handlers: the
 *   host's own `setPointerCapture` on a light-DOM ancestor retargets the
 *   pointer away from the shadow-DOM `.pill`, so a `pointerup` dispatched
 *   from here would never reliably reach the host anyway (see naked's
 *   `useVoxisOverlayMount` doc) — the element does not pretend to offer
 *   an API the only real host cannot consume. The host drives the
 *   indicator/theme by calling `applyState`/`applyLevel`/`applyResult`
 *   with whatever it already receives from its own subscription — the
 *   exact same internal update path `wireClientEvents` uses in `"client"`
 *   mode (single code path, see `applyState` etc. below), and repositions
 *   or re-themes the live element via `setPosition`/`setTheme` (no
 *   remount). Window `blur` is a no-op in this mode (nothing here is
 *   started, so nothing here needs stopping).
 *
 * Compact/expanded lifecycle (A6 — full theme support):
 * A theme's manifest can declare an `overlay_width`/`overlay_height`
 * much larger than a plain pill (lavalamp/metaballs* are 120×120 WebGL
 * scenes; all_aquarium is 340×170) — squashing one of those into a fixed
 * 64×64 circle (this element's original, pre-A6 behaviour) makes it
 * unrecognisable. Two states, driven by `applyState`'s `PluginState`
 * exactly like the indicator dot is:
 * - `"compact"` (`idle`/`error`, unless `idleTheme` is set): a fixed
 *   56×56 circle "handle" — a ring (border) + a center dot, no mounted
 *   theme (no WebGL/canvas render loop while idle — battery). This is
 *   the element's resting size/shape, and what every pre-A6
 *   `initialPosition`/drag/clamp/snap computation now uses in place of
 *   the old constant `PILL_SIZE`.
 * - `"expanded"` (`recording`/`transcribing`, or always when
 *   `idleTheme: true`): the pill grows to the resolved theme's manifest
 *   size (`themes/registry.ts`'s `resolveThemeSize`, `FALLBACK_THEME_SIZE`
 *   64×64 for a manifest with no declared size — same as the pre-A6
 *   constant, so those themes are visually unchanged) and the theme
 *   itself is mounted (`mountThemeInstance`) and driven by
 *   `applyLevel`/`applyState` via `themeBridge`.
 * Growing/shrinking pivots around whichever edge the pill is already
 * closest to (`anchorGrow`) so it can't grow off-screen, and shrinking
 * always returns to the exact pre-growth position (`compactPosition`),
 * never wherever a drag mid-expansion happened to leave it — see
 * `growToExpanded`/`shrinkToCompact`. Shape follows `shapeRadius`: a
 * circle for a square ≤96px a side (both the 56×56 compact handle and
 * any theme with a small square manifest size), a rounded rect (16px)
 * otherwise. `MountOverlayOptions.idleTheme` opts a desktop-style host
 * (its own permanently-visible "socket") out of the compact/mount-
 * lifecycle entirely — the theme stays mounted and the pill stays
 * expanded even at idle.
 */
import { createClient, type VoxisClient, type UnlistenFn } from "./client";
import { createThemeBridge, pluginStateToThemeMode } from "./theme-bridge";
import { resolveTheme, resolveThemeSize } from "./themes/registry";
import {
  clampToViewport,
  createDragController,
  loadPosition,
  readEffectiveViewport,
  readSafeAreaInsets,
  savePosition,
  snapToNearestEdge,
  type DragController,
  type Point,
  type SafeArea,
  type Size,
} from "./drag";
import {
  COMPACT_SIZE,
  growToExpandedPosition,
  resolveCurrentSize,
  resolveInitialPosition,
  shapeRadius,
  shrinkToCompactPosition,
  type OverlayCorner,
  type OverlayLifecycleState,
} from "./overlay-geometry";
import { OverlaySessionController } from "./overlay-session";
import type { DictationResult, LevelEvent, Mode, PluginState, SessionId } from "./types/contract";
import type { ThemeInstance, ThemeModule } from "./types/theme-api";

export const TAG_NAME = "voxis-overlay";

// Geometry (`COMPACT_SIZE`, `cornerPosition`, `anchorGrow`, `shapeRadius`)
// and the `OverlayCorner`/`OverlayLifecycleState` types now live in
// `overlay-geometry.ts`; re-exported here so their long-standing import
// paths (`./overlay`) and public names are unchanged.
export { COMPACT_SIZE, anchorGrow, cornerPosition, shapeRadius } from "./overlay-geometry";
export type { OverlayCorner, OverlayLifecycleState } from "./overlay-geometry";

export interface MountOverlayOptions {
  theme?: string;
  /** Default `true`. */
  draggable?: boolean;
  /** `localStorage` key for the persisted drag position. Default `"default"`. */
  storageKey?: string;
  /**
   * Where the pill first appears when `loadPosition(storageKey)` finds
   * nothing persisted yet — e.g. a host that knows its own chrome
   * occupies the bottom-right corner (this option's original motivation:
   * naked's status control on a 390px viewport) can start the pill
   * somewhere it won't cover. Ignored entirely once a position has been
   * persisted (drag or a prior mount already wrote one) — a persisted
   * position always wins. A named corner resolves via `cornerPosition()`
   * (the same math `"bottom-right"`, today's unchanged default, has
   * always used); an explicit `{x, y}` is a top-left origin. Either way
   * the result is still run through the existing `clampToViewport` (safe
   * area + viewport) once mounted, so an out-of-bounds explicit point
   * can't place the pill off-screen. Default: `"bottom-right"`.
   */
  initialPosition?: Point | OverlayCorner;
  /** Default `"hold"`. */
  mode?: Mode;
  /** Injectable client (tests/harness); defaults to `createClient()` (real `@tauri-apps/api`). Ignored (and not required) when `driver: "host"`. */
  client?: VoxisClient;
  /**
   * Default `"client"` — the overlay owns a `VoxisClient` subscription and
   * drives `start`/`stop` itself (today's behaviour, unchanged). Pass
   * `"host"` when the host app already has its own `voxis://state`/
   * `voxis://result` subscription and only wants this element as a
   * visual indicator — see the module doc comment's "Driver model"
   * section for the full contract.
   */
  driver?: "client" | "host";
  /**
   * Default `false`. When `true`, the pill stays `"expanded"` (theme
   * mounted, at its manifest size) even while idle — for a desktop-style
   * host with its own permanently-visible "socket" for the overlay,
   * where shrinking to the compact handle would be the wrong visual.
   * See the module doc comment's "Compact/expanded lifecycle" section.
   */
  idleTheme?: boolean;
  /**
   * Injectable theme module (tests/harness), same spirit as `client`
   * above — bypasses `themes/registry.ts`'s `resolveTheme` entirely
   * (no real theme, e.g. WebGL, ever mounts) while `theme` still governs
   * `resolveThemeSize`'s manifest-size lookup, so a test can exercise
   * real manifest-driven sizing/growth without mounting a real theme.
   */
  themeModule?: ThemeModule;
}

interface OverlayConfig {
  theme: string;
  draggable: boolean;
  storageKey: string;
  initialPosition: Point | OverlayCorner | undefined;
  mode: Mode;
  driver: "client" | "host";
  client: VoxisClient | undefined;
  idleTheme: boolean;
  themeModule: ThemeModule | undefined;
}

let defined = false;

function ensureDefined(): void {
  if (defined) return;
  if (typeof customElements === "undefined") return; // non-DOM import context (e.g. type-checking only)
  if (!customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, VoxisOverlayElement);
  }
  defined = true;
}

export class VoxisOverlayElement extends HTMLElement {
  private config: OverlayConfig | null = null;
  private pillEl!: HTMLButtonElement;
  private themeContainerEl!: HTMLDivElement;
  private handleDotEl!: HTMLSpanElement;
  private dotEl!: HTMLSpanElement;
  private liveEl!: HTMLSpanElement;
  private themeInstance: ThemeInstance | null = null;
  private themeBridge: ReturnType<typeof createThemeBridge> | null = null;
  private themeMounted = false;
  private resolvedThemeModule: ThemeModule | null = null;
  private lifecycleState: OverlayLifecycleState = "compact";
  private expandedSize: Size = { width: 64, height: 64 };
  /** The pill's position right before the most recent `growToExpanded()` — restored verbatim by `shrinkToCompact()`, so a drag that happens while expanded never changes where the pill settles once it shrinks back. */
  private compactPosition: Point | null = null;
  /**
   * Set by `wireDrag`'s `onDragEnd` when a drag completes while
   * `lifecycleState === "expanded"` — `shrinkToCompact()` consumes this
   * to re-persist the restored *compact* position under `storageKey`,
   * overwriting whatever expanded-sized position `drag.ts`'s own
   * `endGesture` already wrote to storage (it persists unconditionally,
   * before `onDragEnd` ever runs). Without this, the compact resting
   * spot documented above would silently become the expanded-dragged
   * position across a reload (REJECT-FIX a6-r1 Finding 1).
   */
  private expandedDragOccurred = false;
  private dragController: DragController | null = null;
  private unlistenState: UnlistenFn | null = null;
  private unlistenLevel: UnlistenFn | null = null;
  private unlistenResult: UnlistenFn | null = null;
  /** Bumped on every connect; a `listen` resolving for an older generation
   * (or after disconnect) unsubscribes itself instead of storing the handle. */
  private eventGeneration = 0;
  /** Client-driver session control (start/stop/hold lease/pending-start race + the four release paths). `null` in `driver: "host"` mode, which never instantiates one. */
  private session: OverlaySessionController | null = null;
  private currentState: PluginState = "idle";
  private visualViewportTarget: VisualViewport | null = null;

  /** Called by `mountOverlay` before this element is inserted into the DOM. */
  configure(config: OverlayConfig): void {
    this.config = config;
  }

  connectedCallback(): void {
    const config = this.config;
    if (!config) {
      throw new Error("<voxis-overlay> must be configured via mountOverlay(), not created bare");
    }

    this.expandedSize = resolveThemeSize(config.theme);
    this.lifecycleState = config.idleTheme ? "expanded" : "compact";

    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .pill {
        position: fixed;
        border: none;
        background: #111;
        touch-action: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        z-index: 2147483647;
      }
      .pill.state-compact {
        border: 2px solid rgba(255, 255, 255, 0.35);
      }
      .pill.state-compact.mode-error {
        border-color: rgba(229, 57, 53, 0.7);
      }
      .theme-container { width: 100%; height: 100%; pointer-events: none; }
      .pill.state-compact .theme-container { display: none; }
      .handle-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #888;
        pointer-events: none;
      }
      .pill.state-expanded .handle-dot { display: none; }
      .pill.state-compact.mode-error .handle-dot { background: #e53935; }
      .dot {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #e53935;
        display: none;
      }
      .dot.visible { display: block; }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    `;

    this.pillEl = document.createElement("button");
    this.pillEl.className = "pill";
    this.pillEl.type = "button";
    this.pillEl.setAttribute("aria-label", "Voxis dictation");

    this.themeContainerEl = document.createElement("div");
    this.themeContainerEl.className = "theme-container";

    this.handleDotEl = document.createElement("span");
    this.handleDotEl.className = "handle-dot";
    this.handleDotEl.setAttribute("aria-hidden", "true");

    this.dotEl = document.createElement("span");
    this.dotEl.className = "dot";
    this.dotEl.setAttribute("aria-hidden", "true");

    this.liveEl = document.createElement("span");
    this.liveEl.className = "sr-only";
    this.liveEl.setAttribute("aria-live", "polite");

    this.pillEl.appendChild(this.themeContainerEl);
    this.pillEl.appendChild(this.handleDotEl);
    this.pillEl.appendChild(this.dotEl);
    shadow.appendChild(style);
    shadow.appendChild(this.pillEl);
    shadow.appendChild(this.liveEl);

    // Resolving (not mounting) the theme up front, regardless of the
    // initial lifecycle state, preserves the pre-A6 behaviour of an
    // unknown theme id warning immediately at mount — actually mounting
    // it (WebGL context, render loop) is deferred to `growToExpanded`/
    // `idleTheme`'s eager mount below.
    this.resolveThemeModule();
    this.applyLifecycleClasses();
    this.applyPillSize(this.currentSize());
    if (this.lifecycleState === "expanded") {
      this.mountThemeInstance();
    }
    // The very first layout is a size change too (see `dispatchResize`'s
    // contract): a host wiring its container off the event must not have to
    // wait for the first compact↔expanded transition.
    this.dispatchResize();

    // Client-driver session control (pointer/hold/lease + the four
    // release paths) is delegated to `OverlaySessionController`, and only
    // instantiated in `driver: "client"` mode. `driver: "host"` is a pure
    // visual/indicator mode: the host owns the session and drives press
    // from its own container handlers, so nothing session-related is
    // constructed here (drag arming is still wired by `wireDrag`). See the
    // module doc comment's "Driver model" section. The controller is built
    // before `wireDrag` so its pointer listeners register first, exactly
    // as the pre-refactor inline handlers did.
    if (config.driver === "client" && config.client) {
      this.session = new OverlaySessionController({
        pill: this.pillEl,
        mode: config.mode,
        client: config.client,
        isDragging: () => this.dragController?.isDragging ?? false,
      });
    }
    this.wireDrag(config);
    this.wireClientEvents(config);

    // Initial position — `env(safe-area-inset-*)` isn't computable until
    // connected (needs `document.body`); harmless default (bottom-right,
    // clamped) until the first `reposition()`.
    const initial =
      loadPosition(config.storageKey) ?? resolveInitialPosition(config.initialPosition, this.currentSize(), readEffectiveViewport());
    const clamped = clampToViewport(initial, this.currentSize(), this.safeArea(), readEffectiveViewport());
    this.pillEl.style.left = `${clamped.x}px`;
    this.pillEl.style.top = `${clamped.y}px`;

    this.wireViewportReflow();
  }

  disconnectedCallback(): void {
    this.eventGeneration++;
    this.dragController?.destroy();
    this.dragController = null;
    this.unlistenState?.();
    this.unlistenState = null;
    this.unlistenLevel?.();
    this.unlistenLevel = null;
    this.unlistenResult?.();
    this.unlistenResult = null;
    this.session?.destroy();
    this.session = null;
    this.unmountThemeInstance();
    this.visualViewportTarget?.removeEventListener("resize", this.handleViewportChange);
    this.visualViewportTarget?.removeEventListener("scroll", this.handleViewportChange);
    this.visualViewportTarget = null;
    window.removeEventListener("resize", this.handleViewportChange);
    window.removeEventListener("orientationchange", this.handleViewportChange);
  }

  private wireViewportReflow(): void {
    this.visualViewportTarget = window.visualViewport ?? null;
    this.visualViewportTarget?.addEventListener("resize", this.handleViewportChange);
    this.visualViewportTarget?.addEventListener("scroll", this.handleViewportChange);
    window.addEventListener("resize", this.handleViewportChange);
    window.addEventListener("orientationchange", this.handleViewportChange);
  }

  private currentPillPos(): Point {
    const left = parseFloat(this.pillEl.style.left || "0");
    const top = parseFloat(this.pillEl.style.top || "0");
    return { x: Number.isFinite(left) ? left : 0, y: Number.isFinite(top) ? top : 0 };
  }

  /** The pill's current on-screen size — `COMPACT_SIZE` or the resolved theme's manifest size, whichever `lifecycleState` is active. Every drag/clamp/snap/corner computation reads this instead of a fixed constant. */
  private currentSize(): Size {
    return resolveCurrentSize(this.lifecycleState, this.expandedSize);
  }

  /** Public read-only mirror of `currentSize()` — for a host that wants to size its own container/layout around the pill (`MountOverlayOptions`/module doc comment's "host-driven mode" note); also carried in the `"voxis-overlay-resize"` event's `detail`. */
  get size(): Size {
    return this.currentSize();
  }

  /** `"compact"` or `"expanded"` — see the module doc comment. */
  get lifecycle(): OverlayLifecycleState {
    return this.lifecycleState;
  }

  /**
   * Live-move the pill's COMPACT RESTING SPOT to `{x, y}` without tearing
   * the element (or its mounted theme/WebGL context) down — the host-facing
   * seam a `driver: "host"` caller uses on every placement commit (a drag,
   * a viewport change, a lifecycle re-anchor), in place of remounting.
   *
   * `p` always means the same thing, whatever the lifecycle: "the compact
   * pill rests here" (clamped with `COMPACT_SIZE`, recorded as
   * `compactPosition`). While compact the pill is placed there; while
   * expanded the pill is placed where `growToExpanded` would have put it
   * from that spot (`growToExpandedPosition`), so a host that re-anchors
   * mid-recording (the iOS keyboard opening/closing while dictating) keeps
   * ONE owner of the position and the later `shrinkToCompact` lands on the
   * host's ring, not on a stale pre-grow spot. E3 (`ideal.md`), 2026-09-19:
   * the previous "expanded: clamp with the expanded size, leave
   * `compactPosition` alone" semantics gave the expanded pill the compact
   * anchor as its top-left AND restored to the old spot on stop — the fourth
   * way to get «два кольца».
   */
  setPosition(p: Point): void {
    if (!this.pillEl || !this.config) return;
    const compact = clampToViewport(p, COMPACT_SIZE, this.safeArea(), readEffectiveViewport());
    this.compactPosition = compact;
    const placed =
      this.lifecycleState === "expanded"
        ? growToExpandedPosition(compact, this.expandedSize, this.safeArea(), readEffectiveViewport())
        : compact;
    this.pillEl.style.left = `${placed.x}px`;
    this.pillEl.style.top = `${placed.y}px`;
  }

  /**
   * Live-swap the theme without re-creating the element — the host-facing
   * seam a `driver: "host"` caller uses on a theme change, in place of
   * remounting. Re-resolves the theme module (dropping the cached one so
   * the next mount picks up the new id) and its manifest size. While
   * compact the theme isn't mounted, so this only records the new theme/
   * size for the next `growToExpanded`; while expanded it swaps in a
   * *fresh* theme container (so a prior theme's WebGL context/canvas
   * can't leak into the new mount), re-mounts the theme, resizes the
   * pill, and dispatches `"voxis-overlay-resize"` if the manifest size
   * changed. Exactly one unmount + one mount per expanded swap.
   */
  setTheme(id: string): void {
    if (!this.config) return;
    this.config.theme = id;
    this.resolvedThemeModule = null;
    const newSize = resolveThemeSize(id);
    const sizeChanged = newSize.width !== this.expandedSize.width || newSize.height !== this.expandedSize.height;
    this.expandedSize = newSize;
    if (this.lifecycleState !== "expanded") return;
    this.unmountThemeInstance();
    const fresh = document.createElement("div");
    fresh.className = "theme-container";
    this.themeContainerEl.replaceWith(fresh);
    this.themeContainerEl = fresh;
    this.applyPillSize(this.currentSize());
    this.mountThemeInstance();
    if (sizeChanged) this.dispatchResize();
  }

  private handleViewportChange = (): void => {
    if (!this.pillEl || !this.config) return;
    // `driver: "host"`: the HOST owns placement — it re-anchors on its own
    // signals (keyboard/key-panel geometry, safe area, viewport) and drives
    // this element through `setPosition`. Snapping here as well made two
    // authorities move one pill: on the iPad (2026-09-19, naked 63dfa464)
    // a transient visualViewport resize left the pill at y=878 while the
    // host's ring stayed at y=930 — "two rings", 52px apart, until the
    // next placement change. One owner: in host mode this is a no-op.
    if (this.config.driver === "host") return;
    const snapped = snapToNearestEdge(this.currentPillPos(), this.currentSize(), this.safeArea(), readEffectiveViewport());
    this.pillEl.style.left = `${snapped.x}px`;
    this.pillEl.style.top = `${snapped.y}px`;
    if (this.config.draggable) {
      savePosition(this.config.storageKey, snapped);
    }
  };

  private safeArea(): SafeArea {
    try {
      return readSafeAreaInsets(document);
    } catch {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  /**
   * Resolves (but does not mount) this instance's theme module —
   * `config.themeModule` if injected (tests/harness, bypasses the
   * registry entirely), otherwise `themes/registry.ts`'s `resolveTheme`
   * (warns + falls back to default for an unknown id). Cached: calling
   * this more than once must not re-warn.
   */
  private resolveThemeModule(): ThemeModule {
    if (this.config?.themeModule) return this.config.themeModule;
    if (!this.resolvedThemeModule) {
      this.resolvedThemeModule = resolveTheme(this.config?.theme);
    }
    return this.resolvedThemeModule;
  }

  /** Mounts the resolved theme into `themeContainerEl`, sized to `expandedSize`, and wires its `cancel` action — a no-op if already mounted (`idleTheme` mounts eagerly at connect; `growToExpanded` mounts on the way in). */
  private mountThemeInstance(): void {
    if (this.themeMounted) return;
    const themeModule = this.resolveThemeModule();
    this.themeBridge = createThemeBridge(this.expandedSize, undefined, {
      // Routes through the session controller (no-op in `driver: "host"`,
      // which has no controller/session).
      cancel: () => this.session?.cancel(),
    });
    this.themeInstance = themeModule.mount(this.themeContainerEl, this.themeBridge.api);
    this.themeMounted = true;
  }

  /** Unmounts the theme instance (stopping its render loop) — a no-op if not currently mounted (`idleTheme` never calls this). */
  private unmountThemeInstance(): void {
    if (!this.themeMounted) return;
    this.themeInstance?.unmount();
    this.themeInstance = null;
    this.themeBridge = null;
    this.themeMounted = false;
  }

  private applyPillSize(size: Size): void {
    this.pillEl.style.width = `${size.width}px`;
    this.pillEl.style.height = `${size.height}px`;
    this.pillEl.style.borderRadius = shapeRadius(size);
  }

  private applyLifecycleClasses(): void {
    this.pillEl.classList.toggle("state-compact", this.lifecycleState === "compact");
    this.pillEl.classList.toggle("state-expanded", this.lifecycleState === "expanded");
    this.pillEl.classList.toggle("mode-error", this.currentState === "error");
  }

  /** Dispatches `"voxis-overlay-resize"` (module doc comment's "host-driven mode" note) — after every size/lifecycle change, both programmatic (grow/shrink) and this being the very first layout. */
  private dispatchResize(): void {
    const size = this.currentSize();
    this.dispatchEvent(
      new CustomEvent("voxis-overlay-resize", {
        detail: { width: size.width, height: size.height, state: this.lifecycleState },
      }),
    );
  }

  /**
   * `"compact"` -> `"expanded"`: mounts the theme (if not already, e.g.
   * `idleTheme`), grows from `COMPACT_SIZE` to `expandedSize` pivoting
   * around whichever edge the pill is closest to (`anchorGrow`), then
   * clamps the result to the viewport/safe area the same way every other
   * position this element computes is. Remembers the pre-growth position
   * as `compactPosition` for `shrinkToCompact` to restore verbatim.
   */
  private growToExpanded(): void {
    this.compactPosition = this.currentPillPos();
    this.mountThemeInstance();
    const clamped = growToExpandedPosition(this.compactPosition, this.expandedSize, this.safeArea(), readEffectiveViewport());
    this.lifecycleState = "expanded";
    this.applyLifecycleClasses();
    this.applyPillSize(this.expandedSize);
    this.pillEl.style.left = `${clamped.x}px`;
    this.pillEl.style.top = `${clamped.y}px`;
    this.dispatchResize();
  }

  /**
   * `"expanded"` -> `"compact"`: unmounts the theme (unless `idleTheme`,
   * which never reaches this method — see `updateLifecycle`) and
   * restores the exact position captured by the preceding `growToExpanded`
   * (never wherever a drag mid-expansion left the pill — module doc
   * comment's "Compact/expanded lifecycle" section). If a drag completed
   * while expanded (`expandedDragOccurred`), re-persists this restored
   * compact position under `storageKey` — correcting the expanded-sized
   * position `drag.ts`'s own `endGesture` already wrote to storage on
   * that drag, so the next mount with the same `storageKey` still loads
   * the compact resting spot, not the expanded one (Finding 1, REJECT-FIX
   * a6-r1).
   */
  private shrinkToCompact(): void {
    this.unmountThemeInstance();
    const restore = this.compactPosition ?? this.currentPillPos();
    const clamped = shrinkToCompactPosition(restore, this.safeArea(), readEffectiveViewport());
    this.lifecycleState = "compact";
    this.compactPosition = null;
    this.applyLifecycleClasses();
    this.applyPillSize(COMPACT_SIZE);
    this.pillEl.style.left = `${clamped.x}px`;
    this.pillEl.style.top = `${clamped.y}px`;
    if (this.expandedDragOccurred && this.config) {
      savePosition(this.config.storageKey, clamped);
    }
    this.expandedDragOccurred = false;
    this.dispatchResize();
  }

  /** Recomputes the target lifecycle state from `currentState`/`idleTheme` and transitions if it changed. Called by `applyState`. */
  private updateLifecycle(): void {
    if (!this.config) return;
    const target: OverlayLifecycleState =
      this.config.idleTheme || this.currentState === "recording" || this.currentState === "transcribing"
        ? "expanded"
        : "compact";
    if (target === this.lifecycleState) return;
    if (target === "expanded") {
      this.growToExpanded();
    } else {
      this.shrinkToCompact();
    }
  }

  private wireDrag(config: OverlayConfig): void {
    if (!config.draggable) return;
    this.dragController = createDragController(this.pillEl, {
      storageKey: config.storageKey,
      getSize: () => this.currentSize(),
      getSafeArea: () => this.safeArea(),
      getViewport: () => readEffectiveViewport(),
      onDragEnd: (pos, dragged) => {
        if (!dragged) return;
        if (this.lifecycleState === "expanded") {
          // Do not persist an expanded-sized dragged position under the
          // same storageKey as the compact resting spot — shrinkToCompact()
          // re-saves the restored compact position instead (Finding 1,
          // REJECT-FIX a6-r1; see expandedDragOccurred's doc comment).
          this.expandedDragOccurred = true;
          return;
        }
        savePosition(config.storageKey, pos);
      },
    });
  }

  /**
   * `driver: "client"` only — subscribes to the client's own
   * `onState`/`onLevel`/`onResult` and forwards every payload straight
   * into `applyState`/`applyLevel`/`applyResult`, the exact same public
   * methods a `driver: "host"` caller uses from its own subscription.
   * Single code path (DRY): this method's only job is "where the events
   * come from," never "what happens when they arrive."
   */
  private wireClientEvents(config: OverlayConfig): void {
    if (config.driver !== "client") return;
    const client = config.client;
    if (!client) return;

    // `listen` is a real IPC round-trip under Tauri. If the element is
    // disconnected before it resolves (React StrictMode's mount→unmount→mount,
    // a route change), `disconnectedCallback` has nothing to call yet and the
    // late-resolving handle would leak the subscription for the page's
    // lifetime (blind review R3). Unsubscribe immediately in that case.
    const generation = ++this.eventGeneration;
    const keep = (assign: (fn: UnlistenFn) => void) => (fn: UnlistenFn) => {
      if (!this.isConnected || generation !== this.eventGeneration) {
        fn();
        return;
      }
      assign(fn);
    };

    void client.onState((state) => this.applyState(state)).then(keep((fn) => { this.unlistenState = fn; }));
    void client.onLevel((level) => this.applyLevel(level)).then(keep((fn) => { this.unlistenLevel = fn; }));
    void client.onResult((result) => this.applyResult(result)).then(keep((fn) => { this.unlistenResult = fn; }));
  }

  /**
   * Pushes a `voxis://state` payload into the overlay's indicator/theme.
   * In `driver: "client"` mode this is called internally by
   * `wireClientEvents`; in `driver: "host"` mode the host calls it
   * directly from its own `onState` subscription. Also drives the
   * compact/expanded lifecycle (`updateLifecycle`) — see the module doc
   * comment's "Compact/expanded lifecycle" section.
   */
  applyState(state: PluginState): void {
    this.currentState = state;
    this.updateIndicator();
    this.updateLifecycle();
    this.themeBridge?.setFromLevel(pluginStateToThemeMode(state), 0, false);
    // `[fixed per REJECT-FIX L3]` The plugin can end a session on its
    // own (silence/max-duration/stream-died guard outcomes) with no
    // pointer/hotkey release ever happening on this side — `state`
    // goes back to `"idle"` (and `onResult` below fires) without
    // `stopActive()` ever running, which used to leave
    // `activeSessionId` pointing at a session the plugin has already
    // forgotten. The next tap would then call `stop(staleId)` on a
    // dead session instead of starting a new one.
    if (state === "idle") {
      this.session?.clearActiveSession();
    }
  }

  /** Pushes a `voxis://level` payload into the theme bridge. See `applyState` doc for the two calling drivers. */
  applyLevel(level: LevelEvent): void {
    this.themeBridge?.setFromLevel(pluginStateToThemeMode(this.currentState), level.rms, level.muted);
  }

  /**
   * Notifies the overlay that a `voxis://result` arrived — clears any
   * session id/lease this element was itself tracking (a no-op in
   * `driver: "host"` mode, which never tracks one). `[fixed per
   * REJECT-FIX L3]` Belt-and-braces alongside the `applyState` idle
   * check above — `voxis://result` is the more specific "this session is
   * over" signal (a result always accompanies the session ending,
   * whereas `state === "idle"` alone doesn't identify *which* session
   * ended, though in practice the plugin's single-flight guarantee means
   * there is only ever one).
   */
  applyResult(_result: DictationResult): void {
    this.session?.clearActiveSession();
  }

  private updateIndicator(): void {
    const recording = this.currentState === "recording";
    this.dotEl.classList.toggle("visible", recording);
    this.liveEl.textContent = recording ? "Recording" : "";
    this.applyLifecycleClasses();
  }

  /** Result of the *current or most recently active* session, if any is still tracked — mainly for tests/harness introspection. `null` in `driver: "host"` mode. */
  get activeSession(): SessionId | null {
    return this.session?.activeSession ?? null;
  }
}

/**
 * Mounts a `<voxis-overlay>` into `container` (default `document.body`).
 * `theme` unresolved -> `themes/registry.ts`'s default + `console.warn`.
 */
export function mountOverlay(container: HTMLElement = document.body, options: MountOverlayOptions = {}): VoxisOverlayElement {
  ensureDefined();
  const driver = options.driver ?? "client";
  const el = document.createElement(TAG_NAME) as VoxisOverlayElement;
  el.configure({
    theme: options.theme ?? "default",
    draggable: options.draggable ?? true,
    storageKey: options.storageKey ?? "default",
    initialPosition: options.initialPosition,
    mode: options.mode ?? "hold",
    driver,
    // `driver: "host"`: no client is created or required (per-task KISS
    // contract) — a host that also happens to pass one gets it stored but
    // unused, since `wireClientEvents` and `OverlaySessionController` are
    // only reached in `driver: "client"` mode.
    client: driver === "host" ? options.client : options.client ?? createClient(),
    idleTheme: options.idleTheme ?? false,
    themeModule: options.themeModule,
  });
  container.appendChild(el);
  return el;
}

export type { DictationResult };
