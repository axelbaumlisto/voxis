import { describe, it, expect } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

/**
 * i18n locale parity guard.
 *
 * Flattens both locale JSON trees to dotted key paths and asserts the key sets
 * are identical. This catches any key added to one locale but not the other
 * (onboarding.*, nav.hide, settings.options.*, aria labels, everything) —
 * the settingsRegistry test only walks SETTINGS_REGISTRY, not the JSON files,
 * so this is the single source-of-truth parity gate for ALL keys.
 */
function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flatten(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe("i18n locale parity (en <-> ru)", () => {
  const enKeys = new Set(flatten(en as Record<string, unknown>));
  const ruKeys = new Set(flatten(ru as Record<string, unknown>));

  it("has no keys present only in en.json", () => {
    const enOnly = [...enKeys].filter((k) => !ruKeys.has(k)).sort();
    expect(enOnly, `en-only keys: ${enOnly.join(", ")}`).toEqual([]);
  });

  it("has no keys present only in ru.json", () => {
    const ruOnly = [...ruKeys].filter((k) => !enKeys.has(k)).sort();
    expect(ruOnly, `ru-only keys: ${ruOnly.join(", ")}`).toEqual([]);
  });

  it("has identical key sets in both locales", () => {
    expect([...enKeys].sort()).toEqual([...ruKeys].sort());
  });
});
