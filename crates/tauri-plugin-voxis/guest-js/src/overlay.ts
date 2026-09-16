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
 *   style hook) and only wants this element as a *visual* indicator +
 *   drag-positioned pill, without a second competing subscriber/
 *   controller. No client is created or required; the pill's pointer
 *   handlers only arm the drag controller and dispatch a
 *   `"voxis-overlay-press"` `CustomEvent` (`detail: {phase: "down" |
 *   "up"}}`) on the element itself — the host can listen for that to
 *   implement its own hold-to-talk if it wants one, or ignore it
 *   entirely and just call `start`/`stop` from its own UI. The host
 *   drives the indicator/theme by calling `applyState`/`applyLevel`/
 *   `applyResult` with whatever it already receives from its own
 *   subscription — the exact same internal update path `wireClientEvents`
 *   uses in `"client"` mode (single code path, see `applyState` etc.
 *   below). Window `blur` is a no-op in this mode (nothing here is
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
  type Viewport,
} from "./drag";
import { startHoldLease, type Lease } from "./lease";
import type { DictationResult, LevelEvent, Mode, PluginState, SessionId } from "./types/contract";
import type { ThemeInstance, ThemeModule } from "./types/theme-api";

export const TAG_NAME = "voxis-overlay";

/** The pill's fixed idle/error size — see the module doc comment's "Compact/expanded lifecycle" section. */
export const COMPACT_SIZE: Size = { width: 56, height: 56 };

/** Named starting corners for `MountOverlayOptions.initialPosition` — see that option's doc comment. */
export type OverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNER_MARGIN = 16;

/** `"compact"` (idle handle, theme unmounted) or `"expanded"` (theme mounted at its manifest size) — see the module doc comment. */
export type OverlayLifecycleState = "compact" | "expanded";

/**
 * Resolves a named corner to a top-left `{x, y}` in `viewport`, inset by
 * `CORNER_MARGIN` on the relevant edges — the same math the element's
 * bottom-right default has always used (pre-`initialPosition`, this was
 * inlined as a private `defaultPosition()` method; extracted here as a
 * pure, viewport-injectable function so both `"bottom-right"`'s default
 * behaviour and every other named corner share one implementation, and
 * so it's unit-testable without mounting the custom element). The
 * caller (`connectedCallback`) still runs the result through
 * `clampToViewport` with the real safe area, so this function itself
 * doesn't need to know about safe-area insets.
 */
export function cornerPosition(corner: OverlayCorner, size: Size, viewport: Viewport): Point {
  const x = corner === "top-left" || corner === "bottom-left" ? CORNER_MARGIN : viewport.width - size.width - CORNER_MARGIN;
  const y = corner === "top-left" || corner === "top-right" ? CORNER_MARGIN : viewport.height - size.height - CORNER_MARGIN;
  return { x, y };
}

/**
 * Grows (or shrinks) a box from `fromSize` at `pos` to `toSize`, pivoting
 * around whichever edge — independently on each axis — `pos`'s center is
 * already closer to, so the box extends *away* from the nearer edge
 * instead of risking going off-screen (e.g. a pill resting near the
 * right edge grows leftward, keeping its right edge roughly fixed).
 * Pure/unclamped — the caller (`growToExpanded`/`shrinkToCompact`) still
 * runs the result through the existing `clampToViewport`, so an anchor
 * edge itself right at the viewport boundary still ends up on-screen.
 */
export function anchorGrow(pos: Point, fromSize: Size, toSize: Size, viewport: Viewport): Point {
  const centerX = pos.x + fromSize.width / 2;
  const centerY = pos.y + fromSize.height / 2;
  const nearerRight = viewport.width - centerX < centerX;
  const nearerBottom = viewport.height - centerY < centerY;
  const x = nearerRight ? pos.x + fromSize.width - toSize.width : pos.x;
  const y = nearerBottom ? pos.y + fromSize.height - toSize.height : pos.y;
  return { x, y };
}

/**
 * A circle for a square box no larger than 96px a side (the 56×56
 * compact handle, and any theme whose manifest size happens to be a
 * small square) — a rounded rect (16px radius) for everything else,
 * i.e. any non-square size or a square larger than 96px (e.g.
 * lavalamp/metaballs*'s 120×120).
 */
export function shapeRadius(size: Size): string {
  return size.width === size.height && size.width <= 96 ? "50%" : "16px";
}

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
  private lease: Lease | null = null;
  private activeSessionId: SessionId | null = null;
  private stopRequested = false;
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

    this.wirePointerHandling(config);
    this.wireDrag(config);
    this.wireClientEvents(config);

    // Initial position — `env(safe-area-inset-*)` isn't computable until
    // connected (needs `document.body`); harmless default (bottom-right,
    // clamped) until the first `reposition()`.
    const initial = loadPosition(config.storageKey) ?? this.resolveInitialPosition(config.initialPosition);
    const clamped = clampToViewport(initial, this.currentSize(), this.safeArea(), readEffectiveViewport());
    this.pillEl.style.left = `${clamped.x}px`;
    this.pillEl.style.top = `${clamped.y}px`;

    this.wireViewportReflow();
  }

  disconnectedCallback(): void {
    this.dragController?.destroy();
    this.dragController = null;
    this.unlistenState?.();
    this.unlistenState = null;
    this.unlistenLevel?.();
    this.unlistenLevel = null;
    this.unlistenResult?.();
    this.unlistenResult = null;
    this.lease?.stop();
    this.lease = null;
    this.unmountThemeInstance();
    window.removeEventListener("blur", this.handleWindowBlur);
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
    return this.lifecycleState === "expanded" ? this.expandedSize : COMPACT_SIZE;
  }

  /** Public read-only mirror of `currentSize()` — for a host that wants to size its own container/layout around the pill (`MountOverlayOptions`/module doc comment's "host-driven mode" note); also carried in the `"voxis-overlay-resize"` event's `detail`. */
  get size(): Size {
    return this.currentSize();
  }

  /** `"compact"` or `"expanded"` — see the module doc comment. */
  get lifecycle(): OverlayLifecycleState {
    return this.lifecycleState;
  }

  private handleViewportChange = (): void => {
    if (!this.pillEl || !this.config) return;
    const snapped = snapToNearestEdge(this.currentPillPos(), this.currentSize(), this.safeArea(), readEffectiveViewport());
    this.pillEl.style.left = `${snapped.x}px`;
    this.pillEl.style.top = `${snapped.y}px`;
    if (this.config.draggable) {
      savePosition(this.config.storageKey, snapped);
    }
  };

  /** Resolves `MountOverlayOptions.initialPosition` — see that option's doc comment for the persisted-position-wins contract. */
  private resolveInitialPosition(initialPosition: Point | OverlayCorner | undefined): Point {
    if (initialPosition === undefined) return cornerPosition("bottom-right", this.currentSize(), readEffectiveViewport());
    if (typeof initialPosition === "string") return cornerPosition(initialPosition, this.currentSize(), readEffectiveViewport());
    return initialPosition;
  }

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
      cancel: () => {
        if (this.activeSessionId) void this.stopActive();
      },
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
    const viewport = readEffectiveViewport();
    const grown = anchorGrow(this.compactPosition, COMPACT_SIZE, this.expandedSize, viewport);
    const clamped = clampToViewport(grown, this.expandedSize, this.safeArea(), viewport);
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
    const clamped = clampToViewport(restore, COMPACT_SIZE, this.safeArea(), readEffectiveViewport());
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

  private wirePointerHandling(config: OverlayConfig): void {
    if (config.driver === "host") {
      this.wirePointerHandlingHostDriven();
      return;
    }

    let pointerId: number | null = null;
    let dragThresholdExceeded = false;

    const onPointerDown = (e: PointerEvent) => {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      dragThresholdExceeded = false;
      if (config.mode === "hold") {
        void this.startActive("hold");
      }
    };

    const onPointerMove = () => {
      if (pointerId === null) return;
      if (this.dragController?.isDragging) dragThresholdExceeded = true;
    };

    const endGesture = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (config.mode === "hold") {
        void this.stopActive();
        return;
      }
      // Toggle: only a real tap (no drag) flips recording state.
      if (!dragThresholdExceeded) {
        if (this.activeSessionId) {
          void this.stopActive();
        } else {
          void this.startActive("toggle");
        }
      }
    };

    this.pillEl.addEventListener("pointerdown", onPointerDown);
    this.pillEl.addEventListener("pointermove", onPointerMove);
    this.pillEl.addEventListener("pointerup", endGesture);
    this.pillEl.addEventListener("pointercancel", endGesture);
    this.pillEl.addEventListener("lostpointercapture", endGesture as EventListener);

    window.addEventListener("blur", this.handleWindowBlur);
  }

  /**
   * `driver: "host"` pointer wiring: never starts/stops a session (the
   * host owns that) — only dispatches `"voxis-overlay-press"` so a host
   * that wants hold-to-talk driven by this pill can wire its own
   * start/stop off it, and leaves drag arming to `wireDrag`'s own
   * `pointerdown` listener on the same element. No `window` "blur"
   * listener is added here (nothing is started on this side, so there's
   * nothing to stop on blur) — `disconnectedCallback` therefore has
   * nothing session-related to unwind for this driver either.
   */
  private wirePointerHandlingHostDriven(): void {
    const dispatchPress = (phase: "down" | "up") => {
      this.dispatchEvent(new CustomEvent("voxis-overlay-press", { detail: { phase } }));
    };
    this.pillEl.addEventListener("pointerdown", () => dispatchPress("down"));
    this.pillEl.addEventListener("pointerup", () => dispatchPress("up"));
    this.pillEl.addEventListener("pointercancel", () => dispatchPress("up"));
    this.pillEl.addEventListener("lostpointercapture", () => dispatchPress("up"));
  }

  private handleWindowBlur = (): void => {
    if (this.config?.mode === "hold" && this.activeSessionId) {
      void this.stopActive();
    }
  };

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

    void client.onState((state) => this.applyState(state)).then((fn) => {
      this.unlistenState = fn;
    });

    void client.onLevel((level) => this.applyLevel(level)).then((fn) => {
      this.unlistenLevel = fn;
    });

    void client.onResult((result) => this.applyResult(result)).then((fn) => {
      this.unlistenResult = fn;
    });
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
      this.clearActiveSession();
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
    this.clearActiveSession();
  }

  /** Drops the tracked session id/lease without calling `stop()`/`cancel()` — for when the plugin has already ended the session itself. */
  private clearActiveSession(): void {
    this.activeSessionId = null;
    this.lease?.stop();
    this.lease = null;
  }

  private updateIndicator(): void {
    const recording = this.currentState === "recording";
    this.dotEl.classList.toggle("visible", recording);
    this.liveEl.textContent = recording ? "Recording" : "";
    this.applyLifecycleClasses();
  }

  /**
   * Session-controlling — `driver: "host"` never reaches this (pointer
   * handling and window blur are no-ops for sessions in that mode, see
   * `wirePointerHandlingHostDriven`/`handleWindowBlur`), but the theme's
   * own `cancel` action (`mountThemeInstance`) routes through
   * `stopActive` too, so both methods guard defensively rather than
   * relying solely on their only current caller never calling them in
   * that mode.
   */
  private async startActive(mode: Mode): Promise<void> {
    if (!this.config || this.config.driver === "host" || !this.config.client || this.activeSessionId) return;
    const client = this.config.client;
    this.stopRequested = false;
    try {
      const id = await client.start(mode);
      this.activeSessionId = id;
      if (mode === "hold") {
        this.lease = startHoldLease({
          sendHeartbeat: () => client.holdLease(id),
          onError: () => {
            // Server-side lease loss already stopped the session; drop
            // our reference so a stray stop() doesn't double-call.
            this.activeSessionId = null;
          },
        });
      }
      if (this.stopRequested) {
        await this.stopActive();
      }
    } catch {
      this.activeSessionId = null;
    }
  }

  private async stopActive(): Promise<void> {
    if (!this.config || this.config.driver === "host" || !this.config.client) return;
    const id = this.activeSessionId;
    if (!id) {
      this.stopRequested = true;
      return;
    }
    this.clearActiveSession();
    try {
      await this.config.client.stop(id);
    } catch {
      // Best-effort — the plugin's own cleanup (RecFile drop, session
      // guard) runs regardless of whether this call round-trips.
    }
  }

  /** Result of the *current or most recently active* session, if any is still tracked — mainly for tests/harness introspection. */
  get activeSession(): SessionId | null {
    return this.activeSessionId;
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
    // unused, since `wireClientEvents`/`startActive`/`stopActive` all
    // check `driver` before touching it.
    client: driver === "host" ? options.client : options.client ?? createClient(),
    idleTheme: options.idleTheme ?? false,
    themeModule: options.themeModule,
  });
  container.appendChild(el);
  return el;
}

export type { DictationResult };
