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

describe("createClient() profile commands [REJECT-FIX F1]", () => {
  it("importProfileFromQr(payload, code) invokes import_profile_from_qr with both args", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const invoke: InvokeFn = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return undefined as never;
    });
    const client = createClient({ invoke });

    await client.importProfileFromQr("qr-payload-json", "123456");

    expect(calls).toEqual([
      { cmd: "plugin:voxis|import_profile_from_qr", args: { payload: "qr-payload-json", code: "123456" } },
    ]);
  });

  it("importProfileFromDesktop() invokes import_profile_from_desktop with no args", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const invoke: InvokeFn = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return undefined as never;
    });
    const client = createClient({ invoke });

    await client.importProfileFromDesktop();

    expect(calls).toEqual([{ cmd: "plugin:voxis|import_profile_from_desktop", args: undefined }]);
  });

  it("setProvider(opts) invokes set_provider with the flat camelCase apiKey/apiUrlOverride/model args", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const invoke: InvokeFn = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return undefined as never;
    });
    const client = createClient({ invoke });

    await client.setProvider({ apiKey: "gsk_manual", apiUrlOverride: "https://self.hosted/v1", model: "whisper-1" });

    expect(calls).toEqual([
      {
        cmd: "plugin:voxis|set_provider",
        args: { apiKey: "gsk_manual", apiUrlOverride: "https://self.hosted/v1", model: "whisper-1" },
      },
    ]);
  });

  it("setProvider(opts) forwards nulls as-is (keep key / Groq default URL / unchanged model)", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const invoke: InvokeFn = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return undefined as never;
    });
    const client = createClient({ invoke });

    await client.setProvider({ apiKey: null, apiUrlOverride: null, model: null });

    expect(calls).toEqual([
      { cmd: "plugin:voxis|set_provider", args: { apiKey: null, apiUrlOverride: null, model: null } },
    ]);
  });
});

/** Advances the microtask queue enough ticks for `dictate()`'s own
 * `start()` promise chain to resolve and record `sessionId` — more
 * robust than counting exact tick counts by hand (`[fixed per
 * REJECT-FIX F2]` added one more `.then()` link to that chain). */
async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe("createClient().dictate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("attaches both the result and state listeners before calling start() [REJECT-FIX L4]", async () => {
    const ipc = createFakeIpc();
    const client = createClient({ invoke: ipc.invoke, listen: ipc.listen });

    const promise = client.dictate({ mode: "hold" });
    await flushMicrotasks();
    ipc.emit<DictationResult>("voxis://result", {
      sessionId: "session-1",
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
    await flushMicrotasks();
    const result: DictationResult = {
      sessionId: "session-1",
      text: "hello",
      language: "en",
      durationMs: 500,
      guardOutcome: "finalized",
    };
    ipc.emit("voxis://result", result);

    await expect(promise).resolves.toEqual(result);
  });

  it("ignores a voxis://result event carrying a foreign session id [F2]", async () => {
    const ipc = createFakeIpc();
    const client = createClient({ invoke: ipc.invoke, listen: ipc.listen });

    const promise = client.dictate({ mode: "toggle" });
    await flushMicrotasks();

    // A leftover result from some other (earlier or racing) session --
    // `voxis://result` now fires after the plugin's slot is freed, so
    // this can arrive for a foreign id in the same window as this call's
    // own (review finding F2) -- must not resolve this dictate() call.
    const foreign: DictationResult = {
      sessionId: "session-0-not-mine",
      text: "someone else's result",
      language: null,
      durationMs: 999,
      guardOutcome: "finalized",
    };
    ipc.emit("voxis://result", foreign);

    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    const mine: DictationResult = { sessionId: "session-1", text: "mine", language: null, durationMs: 10, guardOutcome: "finalized" };
    ipc.emit("voxis://result", mine);

    await expect(promise).resolves.toEqual(mine);
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
    await vi.advanceTimersByTimeAsync(0);
    ipc.emit<PluginState>("voxis://state", "idle");
    const result: DictationResult = {
      sessionId: "session-1",
      text: "",
      language: null,
      durationMs: 10,
      guardOutcome: "cancelled",
    };
    ipc.emit("voxis://result", result);

    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toEqual(result);
  });
});

describe("createClient().onIntent [T11b]", () => {
  it("delivers a voxis://intent start payload to the host and starts nothing itself", async () => {
    const ipc = createFakeIpc();
    const client = createClient({ invoke: ipc.invoke, listen: ipc.listen });
    const seen: unknown[] = [];
    await client.onIntent((intent) => seen.push(intent));

    ipc.emit("voxis://intent", { action: "start" });

    expect(seen).toEqual([{ action: "start" }]);
    expect(ipc.callOrder.filter((c) => c.startsWith("invoke:"))).toEqual([]);
  });

  it("drops an unknown intent action instead of guessing", async () => {
    const ipc = createFakeIpc();
    const client = createClient({ invoke: ipc.invoke, listen: ipc.listen });
    const seen: unknown[] = [];
    await client.onIntent((intent) => seen.push(intent));

    ipc.emit("voxis://intent", { action: "toggle" });
    ipc.emit("voxis://intent", "start");

    expect(seen).toEqual([]);
  });
});
