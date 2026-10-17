// crates/tauri-plugin-voxis/guest-js/__tests__/settings.test.ts
/**
 * 0.9.0 settings manifest: Voxis's manifest validates against schema v1,
 * every human-readable text has en + ru, every condition/reference points
 * at a declared status/host path or an input field, and the client's
 * getSettings/setSettings hit the right commands.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createClient, type InvokeFn } from "../src/client";
import {
  collectSettingsConditions,
  dynamicOptionLabel,
  INPUT_FIELD_KINDS,
  settingsManifest,
  validateSettingsManifest,
  voxisSettingsManifest,
  type SettingsManifest,
  type VoxisSettingsPatch,
} from "../src/settings";
import { COMMAND_NAMES } from "../src/types/contract";
import * as index from "../src/index";
import { ThemeRegistry } from "../src/themes/registry";

const m = voxisSettingsManifest;
const fields = m.sections.flatMap((s) => s.fields);

function clone(): SettingsManifest {
  return settingsManifest();
}

describe("voxis settings manifest", () => {
  it("validates against schema v1", () => {
    expect(validateSettingsManifest(m)).toEqual([]);
  });

  it("is plain JSON (round-trips unchanged)", () => {
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it("every localized text has non-empty en and ru, and nothing else", () => {
    const seen: string[] = [];
    const walk = (v: unknown, at: string) => {
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
      if (typeof v !== "object" || v === null) return;
      const o = v as Record<string, unknown>;
      if ("en" in o || "ru" in o) {
        seen.push(at);
        expect(Object.keys(o).sort(), at).toEqual(["en", "ru"]);
        expect(typeof o.en === "string" && o.en.trim().length > 0, `${at}.en`).toBe(true);
        expect(typeof o.ru === "string" && o.ru.trim().length > 0, `${at}.ru`).toBe(true);
        return;
      }
      for (const [k, x] of Object.entries(o)) walk(x, `${at}.${k}`);
    };
    walk(m, "manifest");
    // Every field and section has a label/title, so there must be plenty.
    expect(seen.length).toBeGreaterThan(fields.length + m.sections.length);
    for (const f of fields) expect(f.label, f.key).toBeDefined();
  });

  it("every condition references a declared status/host path or an input field", () => {
    const valueKeys = new Set(fields.filter((f) => INPUT_FIELD_KINDS.includes(f.kind)).map((f) => f.key));
    const conditions = collectSettingsConditions(m);
    expect(conditions.length).toBeGreaterThan(0);
    for (const c of conditions) {
      if (c.query === "status") expect(Object.keys(m.status), c.path).toContain(c.path);
      else if (c.query === "host") expect(Object.keys(m.host ?? {}), c.path).toContain(c.path);
      else expect([...valueKeys], c.path).toContain(c.path);
    }
    // requiredStatus / setStatus / sources point at declared status paths too.
    for (const f of fields) {
      for (const ref of [f.requiredStatus, "setStatus" in f ? f.setStatus : undefined]) {
        if (ref) expect(Object.keys(m.status), `${f.key}`).toContain(ref.path);
      }
    }
  });

  it("encodes the owner's rules: key required, pill controls need a key, desktop-only fields", () => {
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.apiKey).toMatchObject({ kind: "secret", store: "plugin", required: true, requiredStatus: { query: "status", path: "hasApiKey" } });
    expect(byKey.apiKey!.hint?.en).toMatch(/Save.*\.vxp/);
    for (const key of ["theme", "overlayHidden", "overlayPlacement", "overlayOffsetX", "overlayOffsetY"]) {
      expect(byKey[key]!.enabledWhen, key).toEqual({ query: "status", path: "hasApiKey", truthy: true });
      expect(byKey[key]!.disabledReason?.en, key).toBe("No API key — the dictation pill is off");
    }
    expect(byKey.theme).toMatchObject({ kind: "select", optionsFrom: { query: "status", path: "themes" } });
    expect(byKey.hotkey!.visibleWhen).toEqual({ query: "status", path: "hotkeySupported", truthy: true });
    expect(byKey.importDesktop!.visibleWhen).toEqual({ query: "status", path: "desktop", truthy: true });
    expect(byKey.importFile).toMatchObject({ kind: "file-import", command: "apply_profile", accept: [".vxp"] });
    for (const key of ["enabled", "overlayHidden", "overlayPlacement", "overlayOffsetX", "overlayOffsetY", "dictationChord"]) {
      expect(byKey[key]!.store, key).toBe("host");
    }
  });

  it("the apiKey help is user copy, not implementation notes (owner 16.10)", () => {
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.apiKey!.help).toEqual({
      en: "Leave it empty to keep the saved key. To remove it, press «Forget the key».",
      ru: "Пустое поле — оставить сохранённый ключ. Чтобы удалить его, нажмите «Забыть ключ».",
    });
    // No identifiers or wire-level words in anything a person reads: the
    // field's help used to spell out «null erase» and `clearApiKey`.
    const jargon = /\bnull\b|clearApiKey|settings_set|host action|\bapiKey\b/i;
    const humanProps = ["label", "help", "hint", "placeholder", "disabledReason", "successMessage"] as const;
    const texts: Array<[string, unknown]> = [];
    const walk = (v: unknown, at: string) => {
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
      if (typeof v !== "object" || v === null) return;
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if ((humanProps as readonly string[]).includes(k)) texts.push([`${at}.${k}`, x]);
        else if (k === "errorMessages") {
          for (const [code, msg] of Object.entries(x as Record<string, unknown>)) texts.push([`${at}.errorMessages.${code}`, msg]);
        } else walk(x, `${at}.${k}`);
      }
    };
    walk(m, "manifest");
    for (const [at, text] of texts) {
      for (const lang of ["en", "ru"] as const) {
        const s = (text as Record<string, string>)[lang];
        if (typeof s === "string") expect(s, `${at}.${lang}`).not.toMatch(jargon);
      }
    }
  });

  it("hiding the pill is its own toggle, so the corner is not forgotten (owner 14.10)", () => {
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.overlayHidden).toMatchObject({ kind: "toggle", store: "host", default: false });
    expect(byKey.overlayHidden!.label).toEqual({ en: "Hide the pill (hotkey or chip only)", ru: "Не показывать пилюлю (хоткей или чип)" });
    const placement = byKey.overlayPlacement as { options?: Array<{ value: unknown }>; default?: unknown };
    expect(placement.default).toBe("bottom-right");
    expect(placement.options!.map((o) => o.value)).toEqual(["bottom-right", "bottom-left", "top-right", "top-left", "center"]);
    const notHidden = { query: "values", path: "overlayHidden", notEquals: true };
    expect(byKey.overlayPlacement!.visibleWhen).toEqual(notHidden);
    for (const key of ["overlayOffsetX", "overlayOffsetY"]) {
      expect(byKey[key]!.visibleWhen, key).toEqual({
        all: [notHidden, { query: "values", path: "overlayPlacement", notEquals: "center" }],
      });
    }
  });

  it("the theme select shows theme names, not raw ids (owner 14.10); themeIds stays declared", () => {
    expect(m.status.themes).toMatchObject({ type: "options" });
    expect(m.status.themeIds).toMatchObject({ type: "string[]" });
    const theme = fields.find((f) => f.key === "theme");
    expect(theme).toMatchObject({ kind: "select", optionsFrom: { query: "status", path: "themes" } });
    // What settings_get sends (Rust `theme_options()`), checked against the
    // themes' own theme.json names.
    const wire = Object.keys(ThemeRegistry)
      .sort()
      .map((id) => {
        const name = JSON.parse(readFileSync(resolve(__dirname, `../src/themes/generated/${id}/theme.json`), "utf8")).name as string;
        return { value: id, label: { en: name, ru: name } };
      });
    const byId = Object.fromEntries(wire.map((o) => [o.value, dynamicOptionLabel(o, "ru")]));
    expect(byId).toMatchObject({ all_aquarium: "All Aquarium", didinium_drift: "Didinium Drift", winamp_classic: "Winamp Classic" });
  });

  it("dynamicOptionLabel handles every optionsFrom item shape", () => {
    expect(dynamicOptionLabel("neon", "en")).toBe("neon");
    expect(dynamicOptionLabel({ value: "s", label: "⌘S" }, "ru")).toBe("⌘S");
    expect(dynamicOptionLabel({ value: "a", label: { en: "A", ru: "А" } }, "ru")).toBe("А");
    expect(dynamicOptionLabel({ value: "a", label: { en: "A", ru: "" } }, "ru")).toBe("A");
  });

  it("action/file-import commands are real plugin commands", () => {
    for (const f of fields) {
      if (f.kind === "action" || f.kind === "file-import") expect(COMMAND_NAMES as readonly string[]).toContain(f.command);
    }
  });

  it("settingsManifest() is a copy, and both are exported from the package root", () => {
    const copy = settingsManifest();
    copy.sections.length = 0;
    expect(voxisSettingsManifest.sections.length).toBeGreaterThan(0);
    expect(index.voxisSettingsManifest).toBe(voxisSettingsManifest);
    expect(typeof index.settingsManifest).toBe("function");
  });

  it("matches the JSON file the Rust tests read", () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, "../src/voxis-settings-manifest.json"), "utf8"));
    expect(raw).toEqual(m);
  });
});

describe("validateSettingsManifest rejects", () => {
  it("a label missing ru", () => {
    const bad = clone();
    (bad.sections[0]!.fields[0]!.label as { ru?: string }).ru = undefined;
    expect(validateSettingsManifest(bad).join("\n")).toMatch(/label must be \{ en, ru \}/);
  });

  it("a condition on an undeclared status path", () => {
    const bad = clone();
    bad.sections[0]!.fields[0]!.visibleWhen = { query: "status", path: "nope", truthy: true };
    expect(validateSettingsManifest(bad).join("\n")).toMatch(/status path "nope" is not declared/);
  });

  it("a condition with two operators, an unknown kind, a select with both option sources", () => {
    const bad = clone();
    bad.sections[0]!.fields[0]!.visibleWhen = { query: "values", path: "provider", equals: "x", truthy: true } as never;
    (bad.sections[1]!.fields[0] as { kind: string }).kind = "slider";
    const theme = bad.sections.flatMap((s) => s.fields).find((f) => f.key === "theme") as { options?: unknown[] };
    theme.options = [{ value: "a", label: { en: "a", ru: "a" } }];
    const errors = validateSettingsManifest(bad).join("\n");
    expect(errors).toMatch(/exactly one of equals \| notEquals \| truthy/);
    expect(errors).toMatch(/unknown kind "slider"/);
    expect(errors).toMatch(/exactly one of options \| optionsFrom/);
  });

  it("optionsFrom pointing at a path not declared as a list", () => {
    const bad = clone();
    const theme = bad.sections.flatMap((s) => s.fields).find((f) => f.key === "theme") as { optionsFrom?: { query: string; path: string } };
    theme.optionsFrom = { query: "status", path: "providerLabel" };
    expect(validateSettingsManifest(bad).join("\n")).toMatch(/status path "providerLabel" must be declared "string\[\]" or "options"/);
    // The pre-0.9.2 source (a plain id list) is still valid.
    theme.optionsFrom = { query: "status", path: "themeIds" };
    expect(validateSettingsManifest(bad)).toEqual([]);
  });

  it("enabledWhen without a disabledReason, required without requiredStatus", () => {
    const bad = clone();
    const f = bad.sections.flatMap((s) => s.fields).find((x) => x.key === "theme")!;
    delete f.disabledReason;
    const k = bad.sections.flatMap((s) => s.fields).find((x) => x.key === "apiKey")!;
    delete k.requiredStatus;
    const errors = validateSettingsManifest(bad).join("\n");
    expect(errors).toMatch(/enabledWhen needs a disabledReason/);
    expect(errors).toMatch(/requiredStatus: ref needs/);
  });
});

describe("client settings commands", () => {
  it("getSettings/setSettings invoke settings_get/settings_set", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const snapshot = { values: { provider: "groq" }, status: { hasApiKey: false } };
    const invoke: InvokeFn = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return snapshot as never;
    });
    const client = createClient({ invoke });
    expect(await client.getSettings()).toBe(snapshot);
    expect(await client.setSettings({ apiKey: "k", theme: "neon" })).toBe(snapshot);
    expect(calls).toEqual([
      { cmd: "plugin:voxis|settings_get", args: undefined },
      { cmd: "plugin:voxis|settings_set", args: { values: { apiKey: "k", theme: "neon" } } },
    ]);
    expect(client.settingsManifest()).toEqual(voxisSettingsManifest);
  });

  it("clearApiKey() sends settings_set with { apiKey: null } (0.9.3 explicit erase; an empty string still keeps)", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const snapshot = { values: { provider: "groq" }, status: { hasApiKey: false } };
    const invoke: InvokeFn = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return snapshot as never;
    });
    const client = createClient({ invoke });
    expect(await client.clearApiKey()).toBe(snapshot);
    expect(calls).toEqual([{ cmd: "plugin:voxis|settings_set", args: { values: { apiKey: null } } }]);
    // The patch type still accepts the three apiKey shapes the wire
    // defines: replace (string), explicit erase (null), keep ("").
    const patches: VoxisSettingsPatch[] = [{ apiKey: "gsk_new" }, { apiKey: null }, { apiKey: "" }, { theme: "neon" }];
    for (const patch of patches) await client.setSettings(patch);
    expect(calls.slice(1).map((c) => c.args)).toEqual(patches.map((values) => ({ values })));
  });
});
