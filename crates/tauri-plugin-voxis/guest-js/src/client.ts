// crates/tauri-plugin-voxis/guest-js/src/client.ts
/**
 * Typed wrappers over `@tauri-apps/api/core`'s `invoke`/
 * `@tauri-apps/api/event`'s `listen`, using the exact command/event names
 * in `../contract/fixtures/{commands,events}.json`. `invoke`/`listen` are
 * injectable (`createClient({invoke, listen})`) so tests, `overlay.ts`,
 * and the `harness/` page all run with no Tauri runtime at all — see
 * `VoxisClientDeps`.
 *
 * Split out of `index.ts` (rather than defined there) so `overlay.ts` can
 * import `createClient`/`VoxisClient` without an index.ts <-> overlay.ts
 * import cycle (`index.ts` re-exports `mountOverlay` from `overlay.ts`).
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

import type {
  CommandName,
  DictationResult,
  HotkeySpec,
  ImportSummary,
  IntentEvent,
  KeySourceDto,
  LevelEvent,
  Mode,
  PluginState,
  SessionId,
  VoxisProfileDto,
} from "./types/contract";
import { INTENT_EVENT, LEVEL_EVENT, RESULT_EVENT, STATE_EVENT, parseIntentEvent } from "./types/contract";

/** An IPC `invoke`-shaped function — matches `@tauri-apps/api/core`'s `invoke`. */
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** An event `payload` envelope — matches `@tauri-apps/api/event`'s `Event<T>`. */
export interface EventEnvelope<T> {
  event: string;
  id: number;
  payload: T;
}

export type UnlistenFn = () => void;

/** An IPC `listen`-shaped function — matches `@tauri-apps/api/event`'s `listen`. */
export type ListenFn = <T>(event: string, handler: (event: EventEnvelope<T>) => void) => Promise<UnlistenFn>;

export interface VoxisClientDeps {
  invoke?: InvokeFn;
  listen?: ListenFn;
}

export interface VoxisClient {
  start(mode: Mode): Promise<SessionId>;
  stop(id: SessionId): Promise<DictationResult>;
  cancel(id: SessionId): Promise<void>;
  state(): Promise<PluginState>;
  getProfile(): Promise<VoxisProfileDto>;
  applyProfile(bytes: number[], keySource: KeySourceDto): Promise<ImportSummary>;
  importProfileFromDesktop(): Promise<ImportSummary>;
  importProfileFromQr(payload: string, code: string): Promise<ImportSummary>;
  /**
   * Manual provider entry for a host with no Voxis desktop to import a
   * sealed profile from: type in a Groq key / self-hosted URL directly.
   * Every argument is nullable (`null`, sent as-is over the wire):
   * - `apiKey`: `null` keeps the currently stored key, `""` clears it,
   *   any other string stores it (through the same secret store every
   *   import uses — never persisted in plaintext).
   * - `apiUrlOverride`: `null` = the Groq default; otherwise an http(s)
   *   URL (rejected by the backend if it isn't one).
   * - `model`: `null` leaves the current model unchanged.
   *
   * Rejects with `AlreadyRecording` if a session is active. Returns the
   * same `ImportSummary` shape as the import commands, with
   * `source: "manual"`.
   */
  setProvider(opts: { apiKey: string | null; apiUrlOverride: string | null; model: string | null }): Promise<ImportSummary>;
  setHotkey(spec: HotkeySpec): Promise<void>;
  setConsent(consented: boolean): Promise<void>;
  holdLease(id: SessionId): Promise<void>;
  /**
   * `start(mode)`, then resolve on the next `voxis://result` event — the
   * plan's `dictate({mode}): Promise<DictationResult>` convenience
   * wrapper. `dictate()` does not itself call `stop()`; a caller (the
   * overlay's pointer/hotkey handling, or a host driving the API
   * directly) is expected to call `stop()`/`cancel()` to end the
   * session, at which point the plugin emits `voxis://result` and this
   * promise resolves.
   *
   * `[fixed per REJECT-FIX F2]` The plugin's single-flight guarantee (a
   * second `start()` while active fails with `AlreadyRecording`) does
   * NOT by itself make "the next result event after this start()"
   * this session's result: `voxis://result` fires *after* the plugin
   * frees its session slot, so a second `start()` can, in principle,
   * succeed in the small window before a first session's own result
   * event actually arrives. `dictate()` therefore correlates explicitly
   * by `DictationResult.sessionId` (the id `start()` itself returned),
   * not by ordering — a `voxis://result` for any other session id is
   * ignored rather than mistakenly resolving this call.
   *
   * Rejects instead of hanging forever if the session ends without ever
   * producing a result: `voxis://state` turning `"error"` (a
   * capture/transcription failure — the plugin never emits
   * `voxis://result` for that path) rejects immediately;
   * `voxis://state` returning to `"idle"` with no `voxis://result`
   * following within a short grace window (an out-of-band `cancel()`
   * racing ahead of its own result event, or any other session-ended-
   * without-a-result outcome) rejects too.
   */
  dictate(opts: { mode: Mode }): Promise<DictationResult>;
  onState(cb: (state: PluginState) => void): Promise<UnlistenFn>;
  onLevel(cb: (level: LevelEvent) => void): Promise<UnlistenFn>;
  onResult(cb: (result: DictationResult) => void): Promise<UnlistenFn>;
  /**
   * `voxis://intent` (`[T11b]`): the host app's own Siri / Shortcuts /
   * Action Button intent asked for dictation. Nothing has started — the
   * host decides (typically: treat it exactly like its own pill press,
   * including consent / no-API-key handling; ignore while recording).
   * A payload with an unknown action is dropped, never guessed.
   */
  onIntent(cb: (intent: IntentEvent) => void): Promise<UnlistenFn>;
}

/**
 * `plugin:<name>|<command>` — the Tauri v2 IPC command-name convention
 * for plugin-registered commands (`Builder::new("voxis")` in `lib.rs`),
 * matching `@tauri-apps/plugin-store`/`@tauri-apps/plugin-shell`'s own
 * generated guest-js (`invoke('plugin:store|get_store', ...)` etc.).
 */
function pluginCommand(name: CommandName): string {
  return `plugin:voxis|${name}`;
}

/** See `dictate()`'s doc comment — `[fixed per REJECT-FIX L4]`. */
const DICTATE_IDLE_GRACE_MS = 50;

/**
 * Builds a `VoxisClient`. With no arguments, wraps the real
 * `@tauri-apps/api` (for use inside an actual Tauri webview); tests and
 * `harness/main.ts` pass `{invoke, listen}` mocks instead so nothing here
 * ever needs a running Tauri backend to exercise.
 */
export function createClient(deps: VoxisClientDeps = {}): VoxisClient {
  const invoke: InvokeFn = deps.invoke ?? (tauriInvoke as InvokeFn);
  const listen: ListenFn = deps.listen ?? (tauriListen as unknown as ListenFn);

  const client: VoxisClient = {
    start: (mode) => invoke<SessionId>(pluginCommand("start"), { mode }),
    stop: (id) => invoke<DictationResult>(pluginCommand("stop"), { id }),
    cancel: (id) => invoke<void>(pluginCommand("cancel"), { id }),
    state: () => invoke<PluginState>(pluginCommand("state")),
    getProfile: () => invoke<VoxisProfileDto>(pluginCommand("get_profile")),
    applyProfile: (bytes, keySource) => invoke<ImportSummary>(pluginCommand("apply_profile"), { bytes, keySource }),
    importProfileFromDesktop: () => invoke<ImportSummary>(pluginCommand("import_profile_from_desktop")),
    importProfileFromQr: (payload, code) =>
      invoke<ImportSummary>(pluginCommand("import_profile_from_qr"), { payload, code }),
    setProvider: ({ apiKey, apiUrlOverride, model }) =>
      invoke<ImportSummary>(pluginCommand("set_provider"), { apiKey, apiUrlOverride, model }),
    setHotkey: (spec: HotkeySpec) => invoke<void>(pluginCommand("set_hotkey"), { spec }),
    setConsent: (consented) => invoke<void>(pluginCommand("set_consent"), { consented }),
    holdLease: (id) => invoke<void>(pluginCommand("hold_lease"), { id }),

    // `[fixed per REJECT-FIX L4]` The result listener used to attach
    // *after* `start()` resolved, and `dictate()` never settled at all
    // if the session ended without a `voxis://result` (e.g. an
    // out-of-band `cancel()` racing ahead, or a capture/transcription
    // failure that only ever emits `voxis://state: "error"`). Now: both
    // listeners are attached and awaited *before* `start()` is called,
    // and an `"error"`/idle-without-result state settles (rejects) the
    // promise instead of leaving it pending forever.
    async dictate({ mode }) {
      return new Promise<DictationResult>((resolve, reject) => {
        let settled = false;
        // Set once `client.start(mode)` resolves — see this method's own
        // doc comment (`[fixed per REJECT-FIX F2]`): `voxis://result` is
        // correlated against this id, not against arrival order.
        let sessionId: SessionId | undefined;
        let unlistenResult: UnlistenFn | undefined;
        let unlistenState: UnlistenFn | undefined;
        let idleGraceTimer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
          unlistenResult?.();
          unlistenState?.();
          if (idleGraceTimer !== undefined) clearTimeout(idleGraceTimer);
        };
        const settleResolve = (result: DictationResult) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        };
        const settleReject = (err: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        };

        Promise.all([
          listen<DictationResult>(RESULT_EVENT, (event) => {
            // A result for a session other than the one this call started
            // (including one that arrives before `start()` itself has
            // resolved, i.e. `sessionId` isn't known yet — it necessarily
            // belongs to some earlier session in that case) must be
            // ignored, not mistaken for this call's own outcome.
            if (sessionId === undefined || event.payload.sessionId !== sessionId) return;
            settleResolve(event.payload);
          }),
          listen<PluginState>(STATE_EVENT, (event) => {
            if (settled) return;
            if (event.payload === "error") {
              settleReject(new Error('voxis://state turned "error" with no voxis://result'));
            } else if (event.payload === "idle") {
              // A result for this same transition, if any, is emitted by
              // the plugin right after (`pipeline.rs`'s `finalize()`:
              // state, then result) — give it a short grace window
              // before concluding none is coming (out-of-band `cancel()`,
              // or any other session-ended-without-a-result outcome).
              idleGraceTimer = setTimeout(() => {
                settleReject(
                  new Error(
                    'voxis://state returned to "idle" with no voxis://result (session ended without a result, e.g. cancel())'
                  )
                );
              }, DICTATE_IDLE_GRACE_MS);
            }
          }),
        ])
          .then(([resultUnlisten, stateUnlisten]) => {
            unlistenResult = resultUnlisten;
            unlistenState = stateUnlisten;
            return client.start(mode);
          })
          .then((id) => {
            sessionId = id;
          })
          .catch(settleReject);
      });
    },

    onState: (cb) => listen<PluginState>(STATE_EVENT, (event) => cb(event.payload)),
    onLevel: (cb) => listen<LevelEvent>(LEVEL_EVENT, (event) => cb(event.payload)),
    onResult: (cb) => listen<DictationResult>(RESULT_EVENT, (event) => cb(event.payload)),
    onIntent: (cb) =>
      listen<unknown>(INTENT_EVENT, (event) => {
        let intent: IntentEvent;
        try {
          intent = parseIntentEvent(event.payload);
        } catch {
          // A newer plugin's action this guest-js does not know: dropping
          // it is the whole contract (`parseIntentEvent`'s doc) — acting on
          // a guess would start dictation nobody asked for.
          return;
        }
        cb(intent);
      }),
  };

  return client;
}
