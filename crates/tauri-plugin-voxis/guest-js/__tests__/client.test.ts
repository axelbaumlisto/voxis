// crates/tauri-plugin-voxis/guest-js/__tests__/client.test.ts
/**
 * `[REJECT-FIX L4]` `dictate()` used to attach its `voxis://result`
 * listener *after* `start()` resolved (a race: a result racing ahead of
 * the `.then()` chain that attaches the listener would be missed
 * forever) and never settled at all if the session ended without ever
 * producing a result (an out-of-band `cancel()`, or a capture/
 * transcription failure that only emits `voxis://state: "error"`).
 * These tests exercise both fixes against a fully fake `{invoke,
 * listen}` pair — no `@tauri-apps/api`/Tauri runtime involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type EventEnvelope, type InvokeFn, type ListenFn, type UnlistenFn } from "../src/client";
import type { DictationResult, PluginState } from "../src/types/contract";

function createFakeIpc() {
  const listeners = new Map<string, Set<(e: EventEnvelope<unknown>) => void>>();
  const callOrder: string[] = [];

  const invoke: InvokeFn = vi.fn(async (cmd: string) => {
    callOrder.push(`invoke:${cmd}`);
    if (cmd === "plugin:voxis|start") return "session-1" as never;
    return undefined as never;
  });

  const listen: ListenFn = vi.fn(async (event: string, handler: (e: EventEnvelope<unknown>) => void) => {
    callOrder.push(`listen:${event}`);
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(handler);
    const unlisten: UnlistenFn = () => set!.delete(handler);
    return unlisten;
  });

  function emit<T>(event: string, payload: T): void {
    for (const cb of listeners.get(event) ?? []) cb({ event, id: 0, payload });
  }

  return { invoke, listen, emit, callOrder };
}

describe("createClient().dictate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("attaches both the result and state listeners before calling start() [REJECT-FIX L4]", async () => {
    const ipc = createFakeIpc();
    const client = createClient({ invoke: ipc.invoke, listen: ipc.listen });

    const promise = client.dictate({ mode: "hold" });
    await Promise.resolve();
    await Promise.resolve();
    ipc.emit<DictationResult>("voxis://result", {
      text: "hi",
      language: null,
      durationMs: 10,
      guardOutcome: "finalized",
    });
    await promise;

    const startIndex = ipc.callOrder.indexOf("invoke:plugin:voxis|start");
    const listenResultIndex = ipc.callOrder.indexOf("listen:voxis://result");
    const listenStateIndex = ipc.callOrder.indexOf("listen:voxis://state");
    expect(startIndex).toBeGreaterThan(-1);
    expect(listenResultIndex).toBeGreaterThan(-1);
    expect(listenStateIndex).toBeGreaterThan(-1);
    expect(listenResultIndex).toBeLessThan(startIndex);
    expect(listenStateIndex).toBeLessThan(startIndex);
  });

  it("resolves with the voxis://result payload", async () => {
    const ipc = createFakeIpc();
    const client = createClient({ invoke: ipc.invoke, listen: ipc.listen });

    const promise = client.dictate({ mode: "toggle" });
    await Promise.resolve();
    await Promise.resolve();
    const result: DictationResult = { text: "hello", language: "en", durationMs: 500, guardOutcome: "finalized" };
    ipc.emit("voxis://result", result);

    await expect(promise).resolves.toEqual(result);
  });

  it("rejects immediately when voxis://state turns \"error\" with no result [REJECT-FIX L4]", async () => {
    const ipc = createFakeIpc();
    const client = createClient({ invoke: ipc.invoke, listen: ipc.listen });

    const promise = client.dictate({ mode: "hold" });
    promise.catch(() => {}); // avoid a spurious unhandledRejection between the reject() below and this file's own `.rejects` assertion attaching its handler
    await Promise.resolve();
    await Promise.resolve();
    ipc.emit<PluginState>("voxis://state", "error");

    await expect(promise).rejects.toThrow(/error/i);
  });

  it("rejects if voxis://state returns to \"idle\" with no result within the grace window (e.g. an out-of-band cancel()) [REJECT-FIX L4]", async () => {
    vi.useFakeTimers();
    const ipc = createFakeIpc();
    const client = createClient({ invoke: ipc.invoke, listen: ipc.listen });

    const promise = client.dictate({ mode: "hold" });
    promise.catch(() => {}); // avoid a spurious unhandledRejection between the reject() below and this file's own `.rejects` assertion attaching its handler
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    ipc.emit<PluginState>("voxis://state", "idle");

    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).rejects.toThrow(/idle/i);
  });

  it("does not reject if a result arrives shortly after idle, within the grace window", async () => {
    vi.useFakeTimers();
    const ipc = createFakeIpc();
    const client = createClient({ invoke: ipc.invoke, listen: ipc.listen });

    const promise = client.dictate({ mode: "hold" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    ipc.emit<PluginState>("voxis://state", "idle");
    const result: DictationResult = { text: "", language: null, durationMs: 10, guardOutcome: "cancelled" };
    ipc.emit("voxis://result", result);

    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toEqual(result);
  });
});
