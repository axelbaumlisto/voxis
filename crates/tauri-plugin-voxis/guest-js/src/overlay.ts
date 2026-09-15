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
 *   2.5.14, harmless (and arguably reassuring) in Hold mode too.
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
 */
import { createClient, type VoxisClient, type UnlistenFn } from "./client";
import { createThemeBridge, pluginStateToThemeMode } from "./theme-bridge";
import { resolveTheme } from "./themes/registry";
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
} from "./drag";
import { startHoldLease, type Lease } from "./lease";
import type { DictationResult, LevelEvent, Mode, PluginState, SessionId } from "./types/contract";
import type { ThemeInstance } from "./types/theme-api";

export const TAG_NAME = "voxis-overlay";

const PILL_SIZE = { width: 64, height: 64 };

export interface MountOverlayOptions {
  theme?: string;
  /** Default `true`. */
  draggable?: boolean;
  /** `localStorage` key for the persisted drag position. Default `"default"`. */
  storageKey?: string;
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
}

interface OverlayConfig {
  theme: string;
  draggable: boolean;
  storageKey: string;
  mode: Mode;
  driver: "client" | "host";
  client: VoxisClient | undefined;
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
  private dotEl!: HTMLSpanElement;
  private liveEl!: HTMLSpanElement;
  private themeInstance: ThemeInstance | null = null;
  private themeBridge: ReturnType<typeof createThemeBridge> | null = null;
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

    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .pill {
        position: fixed;
        width: ${PILL_SIZE.width}px;
        height: ${PILL_SIZE.height}px;
        border-radius: 50%;
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
      .theme-container { width: 100%; height: 100%; pointer-events: none; }
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

    this.dotEl = document.createElement("span");
    this.dotEl.className = "dot";
    this.dotEl.setAttribute("aria-hidden", "true");

    this.liveEl = document.createElement("span");
    this.liveEl.className = "sr-only";
    this.liveEl.setAttribute("aria-live", "polite");

    this.pillEl.appendChild(this.themeContainerEl);
    this.pillEl.appendChild(this.dotEl);
    shadow.appendChild(style);
    shadow.appendChild(this.pillEl);
    shadow.appendChild(this.liveEl);

    this.mountTheme(config.theme);
    this.wirePointerHandling(config);
    this.wireDrag(config);
    this.wireClientEvents(config);

    // Initial position — `env(safe-area-inset-*)` isn't computable until
    // connected (needs `document.body`); harmless default (bottom-right,
    // clamped) until the first `reposition()`.
    const initial = loadPosition(config.storageKey) ?? this.defaultPosition();
    const clamped = clampToViewport(initial, PILL_SIZE, this.safeArea(), readEffectiveViewport());
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
    this.themeInstance?.unmount();
    this.themeInstance = null;
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

  private handleViewportChange = (): void => {
    if (!this.pillEl || !this.config) return;
    const snapped = snapToNearestEdge(this.currentPillPos(), PILL_SIZE, this.safeArea(), readEffectiveViewport());
    this.pillEl.style.left = `${snapped.x}px`;
    this.pillEl.style.top = `${snapped.y}px`;
    if (this.config.draggable) {
      savePosition(this.config.storageKey, snapped);
    }
  };

  private defaultPosition() {
    const viewport = readEffectiveViewport();
    return { x: viewport.width - PILL_SIZE.width - 16, y: viewport.height - PILL_SIZE.height - 16 };
  }

  private safeArea(): SafeArea {
    try {
      return readSafeAreaInsets(document);
    } catch {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  private mountTheme(themeId: string | undefined): void {
    const themeModule = resolveTheme(themeId);
    this.themeBridge = createThemeBridge(PILL_SIZE, undefined, {
      cancel: () => {
        if (this.activeSessionId) void this.stopActive();
      },
    });
    this.themeInstance = themeModule.mount(this.themeContainerEl, this.themeBridge.api);
  }

  private wireDrag(config: OverlayConfig): void {
    if (!config.draggable) return;
    this.dragController = createDragController(this.pillEl, {
      storageKey: config.storageKey,
      getSize: () => PILL_SIZE,
      getSafeArea: () => this.safeArea(),
      getViewport: () => readEffectiveViewport(),
      onDragEnd: (pos, dragged) => {
        if (dragged) savePosition(config.storageKey, pos);
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
   * directly from its own `onState` subscription.
   */
  applyState(state: PluginState): void {
    this.currentState = state;
    this.updateIndicator();
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
  }

  /**
   * Session-controlling — `driver: "host"` never reaches this (pointer
   * handling and window blur are no-ops for sessions in that mode, see
   * `wirePointerHandlingHostDriven`/`handleWindowBlur`), but the theme's
   * own `cancel` action (`mountTheme`) routes through `stopActive` too,
   * so both methods guard defensively rather than relying solely on
   * their only current caller never calling them in that mode.
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
    mode: options.mode ?? "hold",
    driver,
    // `driver: "host"`: no client is created or required (per-task KISS
    // contract) — a host that also happens to pass one gets it stored but
    // unused, since `wireClientEvents`/`startActive`/`stopActive` all
    // check `driver` before touching it.
    client: driver === "host" ? options.client : options.client ?? createClient(),
  });
  container.appendChild(el);
  return el;
}

export type { DictationResult };
