import { describe, expect, it } from "vitest";
import { CELL_DEFAULTS } from "../cell/testing";
import { cellPaletteView } from "../cell/views";

const baseHue = 50;

describe("cell internal read-only views", () => {
  it("preserves legacy palette fallbacks for optional organelle params", () => {
    const view = cellPaletteView({ ...CELL_DEFAULTS }, baseHue);

    expect(view.cvHue).toBe(baseHue + 20);
    expect(view.foodVacuoleHue).toBe(baseHue - 30);
    expect(view.foodVacuoleSat).toBe(0.4);
  });

  it("uses representative explicit optional overrides unchanged", () => {
    const view = cellPaletteView(
      {
        ...CELL_DEFAULTS,
        cvHue: 170,
        foodVacuoleHue: 38,
        foodVacuoleSat: 0.25,
      },
      baseHue,
    );

    expect(view.cvHue).toBe(170);
    expect(view.foodVacuoleHue).toBe(38);
    expect(view.foodVacuoleSat).toBe(0.25);
  });

  it("preserves nullish-coalescing semantics for zero overrides", () => {
    const view = cellPaletteView(
      {
        ...CELL_DEFAULTS,
        cvHue: 0,
        foodVacuoleHue: 0,
        foodVacuoleSat: 0,
      },
      baseHue,
    );

    expect(view.cvHue).toBe(0);
    expect(view.foodVacuoleHue).toBe(0);
    expect(view.foodVacuoleSat).toBe(0);
  });
});
