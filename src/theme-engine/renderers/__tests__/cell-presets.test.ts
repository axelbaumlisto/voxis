import { describe, expect, it } from "vitest";
import { CELL_DEFAULTS, resolveCellPreset } from "../cell";
import type { CellParams, CellPreset } from "../cell";

function frozenParams(overrides: Partial<CellParams> = {}): CellParams {
  return Object.freeze({ ...CELL_DEFAULTS, ...overrides });
}

describe("resolveCellPreset", () => {
  it("uses warm amber baseHue by default when preset renderer baseHue is absent", () => {
    expect(resolveCellPreset(CELL_DEFAULTS).baseHue).toBe(34);
    expect(resolveCellPreset(CELL_DEFAULTS, {
      id: "no-renderer-hue",
      label: "No renderer hue",
      params: {},
    }).baseHue).toBe(34);
  });

  it("lets preset renderer baseHue override the default hue", () => {
    const result = resolveCellPreset(CELL_DEFAULTS, {
      id: "dic",
      label: "DIC",
      renderer: { baseHue: 50 },
      params: {},
    });

    expect(result.baseHue).toBe(50);
  });

  it("merges params with precedence defaults < preset.params < user", () => {
    const defaults = frozenParams({ membraneAmplitude: 0.1, ciliaCount: 18, foodVacuoleCount: 7 });
    const preset: CellPreset = {
      id: "preset",
      label: "Preset",
      params: Object.freeze({ membraneAmplitude: 0.2, ciliaCount: 104 }),
    };
    const user = Object.freeze({ ciliaCount: 42 });

    const result = resolveCellPreset(defaults, preset, user);

    expect(result.params.membraneAmplitude).toBe(0.2);
    expect(result.params.foodVacuoleCount).toBe(7);
    expect(result.params.ciliaCount).toBe(42);
  });

  it("does not mutate defaults or preset params and returns a fresh params object", () => {
    const defaults = frozenParams({ membraneAmplitude: 0.1, ciliaCount: 18 });
    const presetParams = Object.freeze({ membraneAmplitude: 0.2 });
    const preset: CellPreset = Object.freeze({
      id: "immutable",
      label: "Immutable",
      params: presetParams,
    });
    const defaultsBefore = { ...defaults };
    const presetParamsBefore = { ...presetParams };

    const result = resolveCellPreset(defaults, preset, { ciliaCount: 42 });

    expect(result.params).not.toBe(defaults);
    expect(result.params).not.toBe(preset.params);
    expect(defaults).toEqual(defaultsBefore);
    expect(preset.params).toEqual(presetParamsBefore);
    expect(result.params).toMatchObject({ membraneAmplitude: 0.2, ciliaCount: 42 });
  });
});
