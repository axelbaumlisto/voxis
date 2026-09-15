// crates/tauri-plugin-voxis/guest-js/__tests__/contract.test.ts
/**
 * Loads every `contract/fixtures/*.json` this package mirrors and runs it
 * through the hand-written runtime guards in `src/types/contract.ts` — a
 * Rust-side field/case rename that isn't mirrored here fails one of
 * these, not just `tsc`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  COMMAND_NAMES,
  ContractError,
  LEVEL_EVENT,
  parseCommandNames,
  parseDictationResult,
  parseEvents,
  parseVoxisProfile,
  RESULT_EVENT,
  STATE_EVENT,
} from "../src/types/contract";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "..", "..", "contract", "fixtures");

function loadFixture(name: string): unknown {
  const raw = readFileSync(join(FIXTURES_DIR, name), "utf-8");
  return JSON.parse(raw);
}

describe("contract fixtures", () => {
  it("commands.json parses to exactly COMMAND_NAMES, in order", () => {
    const parsed = parseCommandNames(loadFixture("commands.json"));
    expect(parsed).toEqual([...COMMAND_NAMES]);
  });

  it("commands.json rejects an unknown command name", () => {
    expect(() => parseCommandNames(["start", "not_a_real_command"])).toThrow(ContractError);
  });

  it("events.json parses to the voxis:// event name constants", () => {
    const parsed = parseEvents(loadFixture("events.json"));
    expect(parsed).toEqual({ state: STATE_EVENT, level: LEVEL_EVENT, result: RESULT_EVENT });
  });

  it("dictation-result.json parses to a DictationResult", () => {
    const parsed = parseDictationResult(loadFixture("dictation-result.json"));
    expect(parsed).toEqual({
      text: "hello world",
      language: "en",
      durationMs: 1500,
      guardOutcome: "finalized",
    });
  });

  it("dictation-result.json's guardOutcome must be a known GuardOutcome variant", () => {
    expect(() => parseDictationResult({ text: "", language: null, durationMs: 0, guardOutcome: "bogus" })).toThrow(
      ContractError
    );
  });

  it("profile-v1.json parses to a VoxisProfileDto", () => {
    const parsed = parseVoxisProfile(loadFixture("profile-v1.json"));
    expect(parsed.version).toBe(1);
    expect(parsed.config.provider).toBe("groq");
    expect(parsed.config.silenceTimeoutMs).toBe(60000);
    expect(parsed.dictionary).toEqual([
      ["солид", "SOLID"],
      ["докер", "Docker"],
    ]);
    expect(parsed.theme).toBe("waveform");
    expect(parsed.hotkey).toBe("alt_r");
  });

  it("profile-v1.json's nested LlmProvider keeps snake_case field names (api_url, default_model, builtin)", () => {
    const parsed = parseVoxisProfile(loadFixture("profile-v1.json"));
    const provider = parsed.llm.providers[0];
    expect(provider).toBeDefined();
    expect(provider?.api_url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(provider?.default_model).toBe("whisper-large-v3");
    expect(provider?.builtin).toBe(true);
  });

  it("profile-v1.json's LlmPrompt fields parse (id/name/prompt)", () => {
    const parsed = parseVoxisProfile(loadFixture("profile-v1.json"));
    expect(parsed.llm.prompts).toEqual([
      { id: "fix_grammar", name: "Fix grammar", prompt: "Fix grammar and punctuation in transcribed speech." },
    ]);
    expect(parsed.llm.activePromptId).toBe("fix_grammar");
  });

  it("a profile missing a required field fails to parse instead of silently coercing", () => {
    const broken = loadFixture("profile-v1.json") as Record<string, unknown>;
    const { version: _version, ...withoutVersion } = broken;
    expect(() => parseVoxisProfile(withoutVersion)).toThrow(ContractError);
  });
});
