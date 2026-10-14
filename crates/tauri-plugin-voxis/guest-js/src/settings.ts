// crates/tauri-plugin-voxis/guest-js/src/settings.ts
/**
 * Plugin settings manifest — schema v1 (guest-js 0.9.0).
 *
 * A plugin describes its own settings as plain JSON (no code): sections of
 * fields, each with a kind, en/ru labels, and declarative rules. A host
 * (naked) renders ONE settings tab per plugin from it with a generic
 * wrapper and holds no plugin-specific settings UI.
 *
 * ## Storage (`store`)
 * - `"plugin"` — read via the plugin's `settings_get() -> { values, status }`,
 *   written via `settings_set(values) -> { values, status }` (a partial
 *   patch). Errors are `{ kind: "invalid", field, message }` — render
 *   `message` under the field whose `key === field`.
 * - `"host"` — the host's own preference about the plugin; persisted by the
 *   host (naked: `plugins.<pluginId>.<key>`), applied immediately, never
 *   part of a `settings_set` draft. `default` is the host's initial value.
 *
 * ## Field kinds
 * - `toggle` — boolean.
 * - `select` — static `options`, or `optionsFrom` a query path holding
 *   either `string[]` (value = label) or `{ value, label }[]`
 *   (`DynamicSelectOption`: `label` is `{ en, ru }` like a static option's,
 *   or a plain string shown as-is). The referenced `status`/`host` path must
 *   be declared with type `"string[]"` or `"options"`. A current value
 *   missing from the options must still be shown as selected.
 * - `text` — string (`inputType: "url"` for URLs).
 * - `secret` — write-only: never read back; the input starts empty
 *   («leave empty to keep»), `setStatus` says set/unset. Send it in
 *   `settings_set` only when the user typed something.
 * - `number` — `min`/`max`/`step`, optional `unit`.
 * - `status` — a read-only line: `label` + the value at `source` (mapped
 *   through `valueLabels` when the value is a boolean/string key there).
 *   No `source` = a static note (only `label`).
 * - `action` — a button invoking `plugin:<pluginId>|<command>` with static
 *   `args`; afterwards the host re-reads `settings_get`.
 * - `file-import` — pick a file (`accept`), optionally ask a passphrase,
 *   then invoke `command` with `args`, where `{ "$input": "bytes" }` is
 *   replaced by the file's bytes (`number[]`) and `{ "$input": "passphrase" }`
 *   by the typed passphrase. Then re-read `settings_get`.
 *
 * `errorMessages` (action/file-import/any field) map a rejection's `kind`
 * (`notFound`, `alreadyRecording`, ...) to text; otherwise show `message`.
 *
 * ## Behaviour (conditions — a tiny closed language, no code)
 * `{ query, path, equals | notEquals | truthy }`, combinable with
 * `{ all: [...] }` / `{ any: [...] }`. `query`:
 * - `"status"` — the `status` object from `settings_get` (paths declared in
 *   the manifest's `status` map);
 * - `"values"` — the current (draft) value of the field with that `key`;
 * - `"host"` — facts the host supplies (declared in the manifest's `host` map).
 * `truthy: true` holds for a truthy value, `truthy: false` for a falsy one.
 *
 * - `visibleWhen` (section or field) — false: not rendered.
 * - `enabledWhen` — false: rendered disabled (aria-disabled) with
 *   `disabledReason` under it.
 * - `required: true` + `requiredStatus` — while the status value is falsy
 *   the field renders in the danger style with `hint`.
 *
 * Labels, help, hints, placeholders, reasons and messages are all
 * `{ en, ru }`.
 */
import voxisSettingsManifestJson from "./voxis-settings-manifest.json";

export interface LocalizedText {
  en: string;
  ru: string;
}

export type SettingsQuery = "status" | "values" | "host";
export type JsonPrimitive = string | number | boolean | null;

/** A pointer into one of the three data sources. */
export interface SettingsRef {
  query: SettingsQuery;
  path: string;
}

/** A pointer into `settings_get().status`. */
export interface StatusRef {
  query: "status";
  path: string;
}

export type SettingsLeafCondition =
  | (SettingsRef & { equals: JsonPrimitive })
  | (SettingsRef & { notEquals: JsonPrimitive })
  | (SettingsRef & { truthy: boolean });

export type SettingsCondition =
  | SettingsLeafCondition
  | { all: SettingsCondition[] }
  | { any: SettingsCondition[] };

export type SettingsStore = "plugin" | "host";

export const SETTINGS_FIELD_KINDS = [
  "toggle",
  "select",
  "text",
  "secret",
  "number",
  "status",
  "action",
  "file-import",
] as const;
export type SettingsFieldKind = (typeof SETTINGS_FIELD_KINDS)[number];

export interface SettingsFieldBase {
  /** Unique within the manifest; the `settings_set`/host-pref key for input kinds. */
  key: string;
  kind: SettingsFieldKind;
  store: SettingsStore;
  label: LocalizedText;
  help?: LocalizedText;
  /** Shown (danger style) while `required` is unmet. */
  hint?: LocalizedText;
  visibleWhen?: SettingsCondition;
  enabledWhen?: SettingsCondition;
  disabledReason?: LocalizedText;
  required?: boolean;
  requiredStatus?: StatusRef;
  /** Rejection `kind` -> message. */
  errorMessages?: Record<string, LocalizedText>;
  /** Initial value for `store: "host"` fields. */
  default?: JsonPrimitive;
}

export interface SelectOption {
  value: string;
  label: LocalizedText;
}

/**
 * One item of an `optionsFrom` list that is not a bare string. `label` is
 * `{ en, ru }` (as in `SelectOption`; Voxis's `status.themes`) or a plain
 * string rendered as-is (host-supplied lists may use either).
 */
export interface DynamicSelectOption {
  value: string;
  label: LocalizedText | string;
}

/** Display text of an `optionsFrom` item (`string` | `DynamicSelectOption`). */
export function dynamicOptionLabel(item: string | DynamicSelectOption, lang: keyof LocalizedText): string {
  if (typeof item === "string") return item;
  if (typeof item.label === "string") return item.label;
  return item.label[lang] || item.label.en || item.value;
}

export interface ToggleField extends SettingsFieldBase {
  kind: "toggle";
}
export interface SelectField extends SettingsFieldBase {
  kind: "select";
  options?: SelectOption[];
  optionsFrom?: SettingsRef;
}
export interface TextField extends SettingsFieldBase {
  kind: "text";
  inputType?: "text" | "url";
  placeholder?: LocalizedText;
}
export interface SecretField extends SettingsFieldBase {
  kind: "secret";
  placeholder?: LocalizedText;
  /** Truthy when a value is stored (the wrapper shows set/unset). */
  setStatus: StatusRef;
}
export interface NumberField extends SettingsFieldBase {
  kind: "number";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}
export interface StatusField extends SettingsFieldBase {
  kind: "status";
  source?: SettingsRef;
  /** Value (stringified: `"true"`, `"false"`, `"idle"`…) -> text. */
  valueLabels?: Record<string, LocalizedText>;
  tone?: "neutral" | "warning" | "danger";
  monospace?: boolean;
}
export interface ActionField extends SettingsFieldBase {
  kind: "action";
  command: string;
  args?: Record<string, unknown>;
  successMessage?: LocalizedText;
}
export interface FileImportField extends SettingsFieldBase {
  kind: "file-import";
  command: string;
  accept: string[];
  passphrase?: { label: LocalizedText; submit?: LocalizedText };
  /** `{ "$input": "bytes" | "passphrase" }` placeholders are substituted. */
  args: Record<string, unknown>;
  successMessage?: LocalizedText;
}

export type SettingsField =
  | ToggleField
  | SelectField
  | TextField
  | SecretField
  | NumberField
  | StatusField
  | ActionField
  | FileImportField;

export interface SettingsSection {
  id: string;
  title: LocalizedText;
  visibleWhen?: SettingsCondition;
  fields: SettingsField[];
}

export interface SettingsPathDecl {
  type: "boolean" | "string" | "number" | "string[]" | "options";
  description: string;
}

export interface SettingsManifest {
  schemaVersion: 1;
  pluginId: string;
  title: LocalizedText;
  /** Every `{ query: "status", path }` the manifest may reference. */
  status: Record<string, SettingsPathDecl>;
  /** Every `{ query: "host", path }` the host must supply. */
  host?: Record<string, SettingsPathDecl>;
  sections: SettingsSection[];
}

/** `settings_get`/`settings_set` result. */
export interface SettingsSnapshot<V = Record<string, unknown>, S = Record<string, unknown>> {
  values: V;
  status: S;
}

/** Field kinds that hold a value (as opposed to status/action/file-import). */
export const INPUT_FIELD_KINDS: readonly SettingsFieldKind[] = ["toggle", "select", "text", "secret", "number"];

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isLocalized(v: unknown): v is LocalizedText {
  return isObject(v) && typeof v.en === "string" && v.en.trim() !== "" && typeof v.ru === "string" && v.ru.trim() !== "";
}

const LOCALIZED_FIELD_PROPS = ["label", "help", "hint", "disabledReason", "placeholder", "successMessage"] as const;

/**
 * Structural check of a manifest against schema v1. Returns a list of
 * problems (empty = valid). Hosts should refuse to render an invalid one.
 */
export function validateSettingsManifest(input: unknown): string[] {
  const errors: string[] = [];
  const err = (where: string, what: string): void => {
    errors.push(`${where}: ${what}`);
  };
  if (!isObject(input)) return ["manifest: not an object"];
  const m = input;
  if (m.schemaVersion !== 1) err("manifest", "schemaVersion must be 1");
  if (typeof m.pluginId !== "string" || m.pluginId === "") err("manifest", "pluginId missing");
  if (!isLocalized(m.title)) err("manifest", "title must be { en, ru }");
  const status = isObject(m.status) ? m.status : (err("manifest", "status map missing"), {});
  const host = m.host === undefined ? {} : isObject(m.host) ? m.host : (err("manifest", "host must be a map"), {});
  for (const [name, decls] of [["status", status], ["host", host]] as const) {
    for (const [path, decl] of Object.entries(decls)) {
      if (!isObject(decl) || !["boolean", "string", "number", "string[]", "options"].includes(decl.type as string)) {
        err(`${name}.${path}`, "needs a type");
      }
    }
  }
  if (!Array.isArray(m.sections) || m.sections.length === 0) {
    err("manifest", "sections must be a non-empty array");
    return errors;
  }

  const fieldKinds = new Map<string, string>();
  for (const s of m.sections) {
    if (!isObject(s) || !Array.isArray(s.fields)) continue;
    for (const f of s.fields) {
      if (isObject(f) && typeof f.key === "string") {
        if (fieldKinds.has(f.key)) err(`field ${f.key}`, "duplicate key");
        fieldKinds.set(f.key, String(f.kind));
      }
    }
  }
  const valueKeys = new Set([...fieldKinds].filter(([, k]) => (INPUT_FIELD_KINDS as readonly string[]).includes(k)).map(([key]) => key));

  const checkRef = (where: string, ref: unknown, onlyStatus = false) => {
    if (!isObject(ref) || typeof ref.path !== "string") return err(where, "ref needs { query, path }");
    if (onlyStatus && ref.query !== "status") return err(where, "must reference query \"status\"");
    if (ref.query === "status") {
      if (!(ref.path in status)) err(where, `status path "${ref.path}" is not declared`);
    } else if (ref.query === "host") {
      if (!(ref.path in host)) err(where, `host path "${ref.path}" is not declared`);
    } else if (ref.query === "values") {
      if (!valueKeys.has(ref.path)) err(where, `values path "${ref.path}" is not an input field key`);
    } else {
      err(where, `unknown query ${JSON.stringify(ref.query)}`);
    }
  };
  const checkCondition = (where: string, c: unknown): void => {
    if (!isObject(c)) return err(where, "condition must be an object");
    if ("all" in c || "any" in c) {
      const list = c.all ?? c.any;
      if (!Array.isArray(list) || list.length === 0) return err(where, "all/any needs a non-empty array");
      list.forEach((sub, i) => checkCondition(`${where}[${i}]`, sub));
      return;
    }
    checkRef(where, c);
    const ops = ["equals", "notEquals", "truthy"].filter((op) => op in c);
    if (ops.length !== 1) err(where, "needs exactly one of equals | notEquals | truthy");
    if ("truthy" in c && typeof c.truthy !== "boolean") err(where, "truthy must be a boolean");
  };

  m.sections.forEach((s, si) => {
    const sw = `section[${si}]`;
    if (!isObject(s)) return err(sw, "not an object");
    if (typeof s.id !== "string" || s.id === "") err(sw, "id missing");
    if (!isLocalized(s.title)) err(sw, "title must be { en, ru }");
    if (s.visibleWhen !== undefined) checkCondition(`${sw}.visibleWhen`, s.visibleWhen);
    if (!Array.isArray(s.fields) || s.fields.length === 0) return err(sw, "fields must be a non-empty array");
    for (const f of s.fields) {
      const fw = `field ${isObject(f) ? String(f.key) : "?"}`;
      if (!isObject(f)) {
        err(fw, "not an object");
        continue;
      }
      if (typeof f.key !== "string" || f.key === "") err(fw, "key missing");
      if (!(SETTINGS_FIELD_KINDS as readonly string[]).includes(f.kind as string)) err(fw, `unknown kind ${JSON.stringify(f.kind)}`);
      if (f.store !== "plugin" && f.store !== "host") err(fw, "store must be \"plugin\" or \"host\"");
      if (!isLocalized(f.label)) err(fw, "label must be { en, ru }");
      for (const prop of LOCALIZED_FIELD_PROPS) {
        if (f[prop] !== undefined && !isLocalized(f[prop])) err(fw, `${prop} must be { en, ru }`);
      }
      if (f.visibleWhen !== undefined) checkCondition(`${fw}.visibleWhen`, f.visibleWhen);
      if (f.enabledWhen !== undefined) {
        checkCondition(`${fw}.enabledWhen`, f.enabledWhen);
        if (!isLocalized(f.disabledReason)) err(fw, "enabledWhen needs a disabledReason { en, ru }");
      }
      if (f.required !== undefined) {
        if (f.required !== true) err(fw, "required must be true when present");
        checkRef(`${fw}.requiredStatus`, f.requiredStatus, true);
        if (!isLocalized(f.hint)) err(fw, "required needs a hint { en, ru }");
      }
      if (f.errorMessages !== undefined) {
        if (!isObject(f.errorMessages)) err(fw, "errorMessages must be a map");
        else for (const [kind, text] of Object.entries(f.errorMessages)) if (!isLocalized(text)) err(fw, `errorMessages.${kind} must be { en, ru }`);
      }
      switch (f.kind) {
        case "select": {
          const hasOptions = f.options !== undefined;
          const hasFrom = f.optionsFrom !== undefined;
          if (hasOptions === hasFrom) err(fw, "select needs exactly one of options | optionsFrom");
          if (hasOptions) {
            if (!Array.isArray(f.options) || f.options.length === 0) err(fw, "options must be a non-empty array");
            else
              f.options.forEach((o, i) => {
                if (!isObject(o) || typeof o.value !== "string" || !isLocalized(o.label)) err(`${fw}.options[${i}]`, "needs { value, label: { en, ru } }");
              });
          }
          if (hasFrom) {
            checkRef(`${fw}.optionsFrom`, f.optionsFrom);
            const ref = f.optionsFrom;
            if (isObject(ref) && typeof ref.path === "string" && (ref.query === "status" || ref.query === "host")) {
              const decl = (ref.query === "status" ? status : host)[ref.path];
              if (isObject(decl) && decl.type !== "string[]" && decl.type !== "options") {
                err(`${fw}.optionsFrom`, `${ref.query} path "${ref.path}" must be declared "string[]" or "options"`);
              }
            }
          }
          break;
        }
        case "secret":
          if (f.store !== "plugin") err(fw, "secret fields must be store \"plugin\"");
          checkRef(`${fw}.setStatus`, f.setStatus, true);
          break;
        case "number":
          for (const p of ["min", "max", "step"] as const) if (f[p] !== undefined && typeof f[p] !== "number") err(fw, `${p} must be a number`);
          if (typeof f.min === "number" && typeof f.max === "number" && f.min > f.max) err(fw, "min > max");
          break;
        case "status":
          if (f.source !== undefined) checkRef(`${fw}.source`, f.source);
          if (f.valueLabels !== undefined) {
            if (!isObject(f.valueLabels)) err(fw, "valueLabels must be a map");
            else for (const [v, text] of Object.entries(f.valueLabels)) if (!isLocalized(text)) err(fw, `valueLabels.${v} must be { en, ru }`);
          }
          break;
        case "action":
          if (typeof f.command !== "string" || f.command === "") err(fw, "action needs a command");
          if (f.args !== undefined && !isObject(f.args)) err(fw, "args must be an object");
          break;
        case "file-import":
          if (typeof f.command !== "string" || f.command === "") err(fw, "file-import needs a command");
          if (!Array.isArray(f.accept) || f.accept.some((a) => typeof a !== "string")) err(fw, "accept must be string[]");
          if (!isObject(f.args)) err(fw, "file-import needs args");
          if (f.passphrase !== undefined && (!isObject(f.passphrase) || !isLocalized(f.passphrase.label))) err(fw, "passphrase.label must be { en, ru }");
          if (isObject(f.passphrase) && f.passphrase.submit !== undefined && !isLocalized(f.passphrase.submit)) err(fw, "passphrase.submit must be { en, ru }");
          break;
      }
    }
  });
  return errors;
}

/** Every condition in the manifest (sections + fields), flattened to leaves. */
export function collectSettingsConditions(manifest: SettingsManifest): SettingsLeafCondition[] {
  const out: SettingsLeafCondition[] = [];
  const walk = (c: SettingsCondition | undefined) => {
    if (!c) return;
    if ("all" in c) c.all.forEach(walk);
    else if ("any" in c) c.any.forEach(walk);
    else out.push(c);
  };
  for (const s of manifest.sections) {
    walk(s.visibleWhen);
    for (const f of s.fields) {
      walk(f.visibleWhen);
      walk(f.enabledWhen);
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Voxis's own manifest + wire types
// ---------------------------------------------------------------------

/** Voxis's settings manifest (`voxis-settings-manifest.json`, schema v1). */
export const voxisSettingsManifest: SettingsManifest = voxisSettingsManifestJson as unknown as SettingsManifest;

/** The plugin's settings manifest (a fresh deep copy — safe to mutate). */
export function settingsManifest(): SettingsManifest {
  return JSON.parse(JSON.stringify(voxisSettingsManifest)) as SettingsManifest;
}

/** `settings_get().values` — `apiKey` is write-only and never present. */
export interface VoxisSettingsValues {
  provider: "groq" | "selfHosted";
  /** `""` for Groq. */
  apiUrlOverride: string;
  model: string;
  hotkey: string;
  theme: string;
}

/** `settings_set` patch: any subset; `apiKey` absent/`null`/`""` keeps the stored key. */
export type VoxisSettingsPatch = Partial<VoxisSettingsValues> & { apiKey?: string | null };

/** `settings_get().status` — mirrors `SettingsStatus` in `src/settings.rs`. */
export interface VoxisSettingsStatus {
  hasApiKey: boolean;
  provider: "groq" | "selfHosted";
  providerLabel: string;
  providerHost: string;
  platform: string;
  desktop: boolean;
  hotkeySupported: boolean;
  dictationSupported: boolean;
  unsupportedReason: string | null;
  state: "idle" | "recording" | "transcribing" | "error";
  /** Theme ids; kept for compatibility — the theme select reads `themes`. */
  themeIds: string[];
  /** 0.9.2: the same themes with their names (`ru` = `en`: proper names). */
  themes: Array<{ value: string; label: LocalizedText }>;
  pluginVersion: string;
  diagnostics: string;
}

export type VoxisSettingsSnapshot = SettingsSnapshot<VoxisSettingsValues, VoxisSettingsStatus>;

/** `settings_set` validation rejection. */
export interface SettingsInvalidError {
  kind: "invalid";
  field: string;
  message: string;
}
