// crates/tauri-plugin-voxis/guest-js/src/types/contract.ts
/**
 * Hand-written TS mirror of `tauri-plugin-voxis`'s wire contract —
 * `crates/tauri-plugin-voxis/src/models.rs` (fields/enum variants) and
 * `crates/tauri-plugin-voxis/contract/fixtures/*.json` (the actual
 * bytes both sides snapshot-test against). No codegen (plan Task 3 step
 * 2 / Task 5 file list): this file *is* the guest-js source of truth,
 * kept honest by `__tests__/contract.test.ts`, which loads each fixture
 * and runs it through the runtime guards below — a Rust-side field/case
 * rename that isn't mirrored here fails that test, not silently drifts.
 *
 * serde `rename_all = "camelCase"` applies per-`struct`/`enum`, not
 * recursively — `ProfileConfig`/`LevelEvent`/`DictationResult`/etc. are
 * camelCase, but `LlmProvider`/`LlmModel`/`LlmPrompt` (defined in
 * `voxis-core::storage::providers::types` / `voxis-core::llm::prompts`,
 * with no `rename_all` attribute of their own) serialize with their
 * literal Rust field names, which happen to already be snake_case
 * (`api_url`, `default_model`, `builtin`). This file mirrors that
 * per-type split exactly — `LlmProviderDto`/`LlmModelDto`/`LlmPromptDto`
 * below use snake_case keys on purpose, everything else is camelCase.
 */

// ---------------------------------------------------------------------
// Commands / events (contract/fixtures/commands.json, events.json)
// ---------------------------------------------------------------------

/** `contract/fixtures/commands.json` — the plugin's Tauri command names, in order. */
export const COMMAND_NAMES = [
  "start",
  "stop",
  "cancel",
  "state",
  "get_profile",
  "apply_profile",
  "import_profile_from_desktop",
  "import_profile_from_qr",
  "set_provider",
  "set_hotkey",
  "set_consent",
  "hold_lease",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/** `contract/fixtures/events.json` — `voxis://*` event names. */
export const STATE_EVENT = "voxis://state" as const;
export const LEVEL_EVENT = "voxis://level" as const;
export const RESULT_EVENT = "voxis://result" as const;

// ---------------------------------------------------------------------
// models.rs mirrors
// ---------------------------------------------------------------------

/** `models::Mode`. */
export type Mode = "hold" | "toggle";

/** `models::SessionId` — `#[serde(transparent)]`, a bare JSON string. */
export type SessionId = string;

/** `models::State`. */
export type PluginState = "idle" | "recording" | "transcribing" | "error";

/** `models::LevelEvent`, `voxis://level` payload. */
export interface LevelEvent {
  /** Window peak of 10 ms sub-chunk RMS values since the previous tick, in
   * [0, 1] — "loudness of the loudest 10 ms", not a mean over the window. */
  rms: number;
  /** Currently equals `rms` on every platform (reserved for a true sample
   * peak; kept so adding it is not a wire change). */
  peak: number;
  muted: boolean;
}

/** `models::GuardOutcome`. */
export type GuardOutcome =
  | "finalized"
  | "silenceTimeout"
  | "silenceTimeoutNoSpeech"
  | "maxDuration"
  | "leaseLost"
  | "cancelled"
  | "streamDied";

/**
 * `models::DictationResult` — `stop()`'s return value / `voxis://result`
 * payload.
 *
 * `sessionId` (hardening-sweep review finding F2): the plugin emits
 * `voxis://result` *after* freeing its single-flight session slot, so a
 * second `start()` can, in principle, succeed in the small window before
 * this event actually fires. Always correlate a `voxis://result` payload
 * against a known session id via this field — never by assuming "the
 * next result event after my start()" is necessarily mine (see
 * `client.ts`'s `dictate()` doc comment).
 */
export interface DictationResult {
  sessionId: SessionId;
  text: string;
  language: string | null;
  durationMs: number;
  guardOutcome: GuardOutcome;
}

/** `models::HotkeySpec`. */
export interface HotkeySpec {
  key: string;
  mode: Mode;
}

/** `models::KeySourceDto` — `#[serde(tag = "type", rename_all = "camelCase")]`. */
export type KeySourceDto = { type: "qr"; k: string; code: string } | { type: "passphrase"; phrase: string };

/** `models::ImportSummary`. */
export interface ImportSummary {
  /** Where this profile came from — named after the transport/`KeySourceDto`
   * variant used, or `"manual"` for a key/URL typed in via `setProvider`. */
  source: "desktop" | "qr" | "passphrase" | "manual";
  dictionaryEntries: number;
  llmProviders: number;
  llmPrompts: number;
  /** Whether the imported profile carried a transcription API key -- never the key itself. */
  hasApiKey: boolean;
  theme: string;
  hotkey: string;
}

// ---------------------------------------------------------------------
// voxis-core::profile::VoxisProfile mirror (contract/fixtures/profile-v1.json)
// ---------------------------------------------------------------------

/** `voxis_core::storage::providers::types::LlmModel` — snake_case, see file doc comment. */
export interface LlmModelDto {
  id: string;
  name: string;
}

/** `voxis_core::storage::providers::types::LlmProvider` — snake_case, see file doc comment. */
export interface LlmProviderDto {
  id: string;
  name: string;
  api_url: string;
  models: LlmModelDto[];
  default_model: string;
  builtin: boolean;
}

/** `voxis_core::llm::prompts::LlmPrompt` — snake_case field names, but all
 * three (`id`/`name`/`prompt`) are single words so this looks the same
 * either way; documented here so nobody "fixes" it to camelCase later. */
export interface LlmPromptDto {
  id: string;
  name: string;
  prompt: string;
}

/** `voxis_core::profile::LlmProfile` — camelCase (its own `rename_all`), nested DTOs above are not. */
export interface LlmProfileDto {
  providers: LlmProviderDto[];
  prompts: LlmPromptDto[];
  activePromptId?: string;
}

/** `voxis_core::profile::ProfileConfig`. */
export interface ProfileConfigDto {
  provider: string;
  model: string;
  apiKeyRef?: string;
  apiUrlOverride?: string;
  /** Task 6b / `[HW-GATE finding]`: cpal input device name; `undefined` means "system default", ignored on iOS. */
  audioDevice?: string;
  language: string;
  translateToEnglish: boolean;
  minRecordingMs: number;
  silenceTimeoutMs: number;
  maxRecordingMs: number;
  hotkeyHoldMs: number;
  llmEnabled: boolean;
  llmProvider: string;
  llmApiUrl: string;
  llmApiKeyRef?: string;
  llmModel: string;
  llmPrompt: string;
}

/** `voxis_core::profile::VoxisProfile`. */
export interface VoxisProfileDto {
  version: number;
  config: ProfileConfigDto;
  /** `(source, replacement)` pairs — same shape as `DictionaryStorage::load()`. */
  dictionary: [string, string][];
  llm: LlmProfileDto;
  theme: string;
  hotkey: string;
}

// ---------------------------------------------------------------------
// Runtime guards (zod-free by design, plan Task 5 acceptance) — small,
// hand-written structural checks used by __tests__/contract.test.ts to
// parse the fixtures, and safe to reuse at the client boundary (e.g.
// `getProfile()`'s response) if a caller wants belt-and-braces
// validation of what the backend actually sent.
// ---------------------------------------------------------------------

export class ContractError extends Error {}

function fail(path: string, message: string): never {
  throw new ContractError(`${path}: ${message}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function expectString(v: unknown, path: string): string {
  if (typeof v !== "string") fail(path, `expected string, got ${typeof v}`);
  return v;
}

function expectNumber(v: unknown, path: string): number {
  if (typeof v !== "number") fail(path, `expected number, got ${typeof v}`);
  return v;
}

function expectBoolean(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") fail(path, `expected boolean, got ${typeof v}`);
  return v;
}

function expectOptionalString(v: unknown, path: string): string | undefined {
  if (v === undefined) return undefined;
  return expectString(v, path);
}

/** Parses `contract/fixtures/commands.json` — a JSON array of `CommandName` strings. */
export function parseCommandNames(value: unknown): CommandName[] {
  if (!Array.isArray(value)) fail("commands", "expected an array");
  return value.map((entry, i) => {
    const s = expectString(entry, `commands[${i}]`);
    if (!(COMMAND_NAMES as readonly string[]).includes(s)) {
      fail(`commands[${i}]`, `"${s}" is not a known command name — mirror it in COMMAND_NAMES`);
    }
    return s as CommandName;
  });
}

/** Parses `contract/fixtures/events.json` — `{state, level, result}`. */
export function parseEvents(value: unknown): { state: string; level: string; result: string } {
  if (!isRecord(value)) fail("events", "expected an object");
  const state = expectString(value.state, "events.state");
  const level = expectString(value.level, "events.level");
  const result = expectString(value.result, "events.result");
  if (state !== STATE_EVENT) fail("events.state", `expected ${STATE_EVENT}, got ${state}`);
  if (level !== LEVEL_EVENT) fail("events.level", `expected ${LEVEL_EVENT}, got ${level}`);
  if (result !== RESULT_EVENT) fail("events.result", `expected ${RESULT_EVENT}, got ${result}`);
  return { state, level, result };
}

const GUARD_OUTCOMES: readonly GuardOutcome[] = [
  "finalized",
  "silenceTimeout",
  "silenceTimeoutNoSpeech",
  "maxDuration",
  "leaseLost",
  "cancelled",
  "streamDied",
];

function expectGuardOutcome(v: unknown, path: string): GuardOutcome {
  const s = expectString(v, path);
  if (!(GUARD_OUTCOMES as readonly string[]).includes(s)) {
    fail(path, `"${s}" is not a known GuardOutcome`);
  }
  return s as GuardOutcome;
}

/** Parses `contract/fixtures/dictation-result.json` — a `DictationResult`. */
export function parseDictationResult(value: unknown): DictationResult {
  if (!isRecord(value)) fail("dictationResult", "expected an object");
  const sessionId = expectString(value.sessionId, "dictationResult.sessionId");
  const text = expectString(value.text, "dictationResult.text");
  const language =
    value.language === null || value.language === undefined
      ? null
      : expectString(value.language, "dictationResult.language");
  const durationMs = expectNumber(value.durationMs, "dictationResult.durationMs");
  const guardOutcome = expectGuardOutcome(value.guardOutcome, "dictationResult.guardOutcome");
  return { sessionId, text, language, durationMs, guardOutcome };
}

function parseLlmModel(value: unknown, path: string): LlmModelDto {
  if (!isRecord(value)) fail(path, "expected an object");
  return {
    id: expectString(value.id, `${path}.id`),
    name: expectString(value.name, `${path}.name`),
  };
}

function parseLlmProvider(value: unknown, path: string): LlmProviderDto {
  if (!isRecord(value)) fail(path, "expected an object");
  if (!Array.isArray(value.models)) fail(`${path}.models`, "expected an array");
  return {
    id: expectString(value.id, `${path}.id`),
    name: expectString(value.name, `${path}.name`),
    api_url: expectString(value.api_url, `${path}.api_url`),
    models: value.models.map((m, i) => parseLlmModel(m, `${path}.models[${i}]`)),
    default_model: expectString(value.default_model, `${path}.default_model`),
    builtin: expectBoolean(value.builtin, `${path}.builtin`),
  };
}

function parseLlmPrompt(value: unknown, path: string): LlmPromptDto {
  if (!isRecord(value)) fail(path, "expected an object");
  return {
    id: expectString(value.id, `${path}.id`),
    name: expectString(value.name, `${path}.name`),
    prompt: expectString(value.prompt, `${path}.prompt`),
  };
}

function parseProfileConfig(value: unknown, path: string): ProfileConfigDto {
  if (!isRecord(value)) fail(path, "expected an object");
  return {
    provider: expectString(value.provider, `${path}.provider`),
    model: expectString(value.model, `${path}.model`),
    apiKeyRef: expectOptionalString(value.apiKeyRef, `${path}.apiKeyRef`),
    apiUrlOverride: expectOptionalString(value.apiUrlOverride, `${path}.apiUrlOverride`),
    audioDevice: expectOptionalString(value.audioDevice, `${path}.audioDevice`),
    language: expectString(value.language, `${path}.language`),
    translateToEnglish: expectBoolean(value.translateToEnglish, `${path}.translateToEnglish`),
    minRecordingMs: expectNumber(value.minRecordingMs, `${path}.minRecordingMs`),
    silenceTimeoutMs: expectNumber(value.silenceTimeoutMs, `${path}.silenceTimeoutMs`),
    maxRecordingMs: expectNumber(value.maxRecordingMs, `${path}.maxRecordingMs`),
    hotkeyHoldMs: expectNumber(value.hotkeyHoldMs, `${path}.hotkeyHoldMs`),
    llmEnabled: expectBoolean(value.llmEnabled, `${path}.llmEnabled`),
    llmProvider: expectString(value.llmProvider, `${path}.llmProvider`),
    llmApiUrl: expectString(value.llmApiUrl, `${path}.llmApiUrl`),
    llmApiKeyRef: expectOptionalString(value.llmApiKeyRef, `${path}.llmApiKeyRef`),
    llmModel: expectString(value.llmModel, `${path}.llmModel`),
    llmPrompt: expectString(value.llmPrompt, `${path}.llmPrompt`),
  };
}

function parseLlmProfile(value: unknown, path: string): LlmProfileDto {
  if (!isRecord(value)) fail(path, "expected an object");
  if (!Array.isArray(value.providers)) fail(`${path}.providers`, "expected an array");
  if (!Array.isArray(value.prompts)) fail(`${path}.prompts`, "expected an array");
  return {
    providers: value.providers.map((p, i) => parseLlmProvider(p, `${path}.providers[${i}]`)),
    prompts: value.prompts.map((p, i) => parseLlmPrompt(p, `${path}.prompts[${i}]`)),
    activePromptId: expectOptionalString(value.activePromptId, `${path}.activePromptId`),
  };
}

/** Parses `contract/fixtures/profile-v1.json` — a `VoxisProfileDto`. */
export function parseVoxisProfile(value: unknown): VoxisProfileDto {
  if (!isRecord(value)) fail("profile", "expected an object");
  if (!Array.isArray(value.dictionary)) fail("profile.dictionary", "expected an array");
  const dictionary: [string, string][] = value.dictionary.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      fail(`profile.dictionary[${i}]`, "expected a [source, replacement] pair");
    }
    return [
      expectString(entry[0], `profile.dictionary[${i}][0]`),
      expectString(entry[1], `profile.dictionary[${i}][1]`),
    ];
  });
  return {
    version: expectNumber(value.version, "profile.version"),
    config: parseProfileConfig(value.config, "profile.config"),
    dictionary,
    llm: parseLlmProfile(value.llm, "profile.llm"),
    theme: expectString(value.theme, "profile.theme"),
    hotkey: expectString(value.hotkey, "profile.hotkey"),
  };
}
