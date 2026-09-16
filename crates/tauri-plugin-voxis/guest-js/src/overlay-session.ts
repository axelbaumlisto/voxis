// crates/tauri-plugin-voxis/guest-js/src/overlay-session.ts
/**
 * Client-driver session control for `<voxis-overlay>` — the half of the
 * element that owns a `VoxisClient` session (`start`/`stop`/`holdLease`),
 * its pointer gesture, its hold lease, and the "stop arrived while start()
 * awaits the mic prompt" pending-start race. `overlay.ts`'s element
 * instantiates exactly one of these ONLY when `driver === "client"`; in
 * `driver: "host"` mode nothing here is constructed (the host owns the
 * session and drives press from its own container handlers — see
 * `overlay.ts`'s module doc comment's "Driver model" section).
 *
 * The four-release-paths safety rule lives here, in ONE place: a hold is
 * ended by `pointerup`, `pointercancel`, `lostpointercapture`, OR window
 * `blur` — never a stuck recording, regardless of *how* the gesture ends.
 * All four funnel into `stopActive()`.
 */
import type { VoxisClient } from "./client";
import { startHoldLease, type Lease } from "./lease";
import type { Mode, SessionId } from "./types/contract";

export interface OverlaySessionControllerOptions {
  /** The shadow-DOM pill button the pointer gesture is wired onto. */
  pill: HTMLElement;
  /** `"hold"` (press = start, any release = stop) or `"toggle"` (tap flips). */
  mode: Mode;
  /** The session-owning client — `start`/`stop`/`holdLease`. */
  client: VoxisClient;
  /** Whether the drag controller currently considers the gesture a drag (a real drag never toggles). */
  isDragging(): boolean;
  /** Injectable for tests; defaults to the global `window` (for the `blur` release path). */
  window?: Window;
}

/**
 * Owns a single client-driven overlay session. Wires its own pointer +
 * window-blur listeners in the constructor; `destroy()` removes them and
 * stops any live lease. The element's `applyState`/`applyResult` call
 * `clearActiveSession()` when the plugin ends the session itself, and the
 * theme's own `cancel` action routes through `cancel()`.
 */
export class OverlaySessionController {
  private readonly pill: HTMLElement;
  private readonly mode: Mode;
  private readonly client: VoxisClient;
  private readonly isDragging: () => boolean;
  private readonly win: Window;

  private activeId: SessionId | null = null;
  private lease: Lease | null = null;
  private stopRequested = false;
  private pointerId: number | null = null;
  private dragThresholdExceeded = false;

  constructor(opts: OverlaySessionControllerOptions) {
    this.pill = opts.pill;
    this.mode = opts.mode;
    this.client = opts.client;
    this.isDragging = opts.isDragging;
    this.win = opts.window ?? window;

    this.pill.addEventListener("pointerdown", this.onPointerDown);
    this.pill.addEventListener("pointermove", this.onPointerMove);
    this.pill.addEventListener("pointerup", this.onPointerEnd);
    this.pill.addEventListener("pointercancel", this.onPointerEnd);
    this.pill.addEventListener("lostpointercapture", this.onPointerEnd as EventListener);
    this.win.addEventListener("blur", this.onBlur);
  }

  /** Removes every listener and stops any live lease — called from the element's `disconnectedCallback`. */
  destroy(): void {
    this.pill.removeEventListener("pointerdown", this.onPointerDown);
    this.pill.removeEventListener("pointermove", this.onPointerMove);
    this.pill.removeEventListener("pointerup", this.onPointerEnd);
    this.pill.removeEventListener("pointercancel", this.onPointerEnd);
    this.pill.removeEventListener("lostpointercapture", this.onPointerEnd as EventListener);
    this.win.removeEventListener("blur", this.onBlur);
    this.lease?.stop();
    this.lease = null;
  }

  /** The current or most recently active session id, if still tracked. */
  get activeSession(): SessionId | null {
    return this.activeId;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.dragThresholdExceeded = false;
    if (this.mode === "hold") {
      void this.startActive();
    }
  };

  private onPointerMove = (): void => {
    if (this.pointerId === null) return;
    if (this.isDragging()) this.dragThresholdExceeded = true;
  };

  private onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (this.mode === "hold") {
      void this.stopActive();
      return;
    }
    // Toggle: only a real tap (no drag) flips recording state.
    if (!this.dragThresholdExceeded) {
      if (this.activeId) {
        void this.stopActive();
      } else {
        void this.startActive();
      }
    }
  };

  private onBlur = (): void => {
    if (this.mode === "hold" && this.activeId) {
      void this.stopActive();
    }
  };

  /**
   * Starts a session (a no-op if one is already active). In `"hold"`
   * mode also starts the 1 Hz lease heartbeat. Handles the pending-start
   * race: if `stopActive()` arrived while `client.start()` was still
   * awaiting (e.g. the mic-permission prompt), `stopRequested` is set and
   * this stops the just-started session immediately.
   */
  async startActive(): Promise<void> {
    if (this.activeId) return;
    this.stopRequested = false;
    try {
      const id = await this.client.start(this.mode);
      this.activeId = id;
      if (this.mode === "hold") {
        this.lease = startHoldLease({
          sendHeartbeat: () => this.client.holdLease(id),
          onError: () => {
            // Server-side lease loss already stopped the session; drop
            // our reference so a stray stop() doesn't double-call.
            this.activeId = null;
          },
        });
      }
      if (this.stopRequested) {
        await this.stopActive();
      }
    } catch {
      this.activeId = null;
    }
  }

  /** Stops the active session (best-effort). If none is tracked yet, records the intent (`stopRequested`) for `startActive` to honour once `start()` resolves. */
  async stopActive(): Promise<void> {
    const id = this.activeId;
    if (!id) {
      this.stopRequested = true;
      return;
    }
    this.clearActiveSession();
    try {
      await this.client.stop(id);
    } catch {
      // Best-effort — the plugin's own cleanup (RecFile drop, session
      // guard) runs regardless of whether this call round-trips.
    }
  }

  /** Drops the tracked session id/lease without calling `stop()`/`cancel()` — for when the plugin has already ended the session itself. */
  clearActiveSession(): void {
    this.activeId = null;
    this.lease?.stop();
    this.lease = null;
  }

  /** The theme's own `cancel` action — stops the active session if there is one. */
  cancel(): void {
    if (this.activeId) void this.stopActive();
  }
}
