// crates/tauri-plugin-voxis/guest-js/src/lease.ts
/**
 * Hold-mode lease heartbeat (`[R1-Safety S4]`): while a `Hold` session is
 * active, the guest side must call `hold_lease` roughly once a second so
 * the Rust-side watcher (Task 3b `lease.rs`) doesn't `cancel(LeaseLost)`
 * it after 3 missed beats. This module owns only the *client-side* timer
 * half of that contract — starting it, ticking it, and guaranteeing it
 * stops on every exit path (`stop()`/`cancel()`/an error from the
 * heartbeat call itself, and the page going away via `pagehide`) so nothing
 * can leave a `setInterval` running past the session it belongs to.
 */

export interface LeaseOptions {
  /** Calls the plugin's `hold_lease` command for the active session. */
  sendHeartbeat(): Promise<void>;
  /** Default 1000 (1 Hz, per plan decision 5). */
  intervalMs?: number;
  /** A heartbeat call rejecting stops the lease and forwards the error here (e.g. the session already ended server-side). */
  onError?(err: unknown): void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  window?: Window;
}

export interface Lease {
  readonly isActive: boolean;
  stop(): void;
}

/** Starts a 1 Hz (by default) heartbeat; call `.stop()` on `stop()`/`cancel()`/any terminal state. */
export function startHoldLease(options: LeaseOptions): Lease {
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const win = options.window ?? (typeof window !== "undefined" ? window : undefined);

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  function tick(): void {
    if (inFlight) return; // never overlap heartbeats if one is slow
    inFlight = true;
    Promise.resolve()
      .then(() => options.sendHeartbeat())
      .catch((err: unknown) => {
        stop();
        options.onError?.(err);
      })
      .finally(() => {
        inFlight = false;
      });
  }

  function stop(): void {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
    win?.removeEventListener("pagehide", stop);
  }

  timer = setIntervalFn(tick, options.intervalMs ?? 1000);
  win?.addEventListener("pagehide", stop);

  return {
    get isActive() {
      return timer !== null;
    },
    stop,
  };
}
