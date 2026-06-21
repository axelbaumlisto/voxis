import type { CellParams } from "./types";

export type CellPaletteView = Readonly<{
  cvHue: number;
  foodVacuoleHue: number;
  foodVacuoleSat: number;
}>;

/**
 * Internal read-only grouped view over the already-merged flat CellParams.
 * This is not a defaults source and must not become a user-facing params shape.
 */
export function cellPaletteView(params: CellParams, baseHue: number): CellPaletteView {
  return {
    cvHue: params.cvHue ?? (baseHue + 20),
    foodVacuoleHue: params.foodVacuoleHue ?? (baseHue - 30),
    foodVacuoleSat: params.foodVacuoleSat ?? 0.4,
  };
}
