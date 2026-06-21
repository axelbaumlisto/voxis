import type { CellParams } from "./types";

export interface CellPreset {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly renderer?: { readonly baseHue?: number };
  readonly params: Readonly<Partial<CellParams>>;
}

export function resolveCellPreset(
  defaults: CellParams,
  preset?: CellPreset,
  user?: Partial<CellParams>,
): { baseHue: number; params: CellParams } {
  return {
    baseHue: preset?.renderer?.baseHue ?? 34,
    params: { ...defaults, ...(preset?.params ?? {}), ...(user ?? {}) },
  };
}
