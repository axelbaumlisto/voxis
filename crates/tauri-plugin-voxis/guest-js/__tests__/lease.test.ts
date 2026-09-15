// crates/tauri-plugin-voxis/guest-js/__tests__/lease.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHoldLease } from "../src/lease";

describe("startHoldLease", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls sendHeartbeat once per interval (1000ms default)", async () => {
    const sendHeartbeat = vi.fn().mockResolvedValue(undefined);
    const lease = startHoldLease({ sendHeartbeat });

    await vi.advanceTimersByTimeAsync(3000);

    expect(sendHeartbeat).toHaveBeenCalledTimes(3);
    lease.stop();
  });

  it("stop() clears the interval — no further ticks", async () => {
    const sendHeartbeat = vi.fn().mockResolvedValue(undefined);
    const lease = startHoldLease({ sendHeartbeat });

    await vi.advanceTimersByTimeAsync(2000);
    expect(sendHeartbeat).toHaveBeenCalledTimes(2);

    lease.stop();
    expect(lease.isActive).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendHeartbeat).toHaveBeenCalledTimes(2); // unchanged
  });

  it("a rejected heartbeat stops the lease and reports the error", async () => {
    const error = new Error("session gone");
    const sendHeartbeat = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const lease = startHoldLease({ sendHeartbeat, onError });

    await vi.advanceTimersByTimeAsync(1000);

    expect(onError).toHaveBeenCalledWith(error);
    expect(lease.isActive).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendHeartbeat).toHaveBeenCalledTimes(1); // did not keep ticking after the error
  });

  it("respects a custom intervalMs", async () => {
    const sendHeartbeat = vi.fn().mockResolvedValue(undefined);
    const lease = startHoldLease({ sendHeartbeat, intervalMs: 250 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(sendHeartbeat).toHaveBeenCalledTimes(4);
    lease.stop();
  });

  it("pagehide stops the lease", async () => {
    const sendHeartbeat = vi.fn().mockResolvedValue(undefined);
    const lease = startHoldLease({ sendHeartbeat });

    await vi.advanceTimersByTimeAsync(1000);
    expect(sendHeartbeat).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pagehide"));
    expect(lease.isActive).toBe(false);

    await vi.advanceTimersByTimeAsync(3000);
    expect(sendHeartbeat).toHaveBeenCalledTimes(1);
  });
});
