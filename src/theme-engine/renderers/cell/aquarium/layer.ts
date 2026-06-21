import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";
import { seedPoints } from "./seeds";
import type { AquariumFrame, AquariumLayerState } from "./types";

export function seedAquarium(frame: AquariumFrame, params: CellParams): AquariumLayerState {
  const view = aquariumParamsView(params);
  const seed = view.seed | 0;
  return {
    seed,
    diatoms: seedPoints(view.diatoms.count, seed, frame, 0x0d1a70cd),
    euglena: seedPoints(view.euglena.count, seed, frame, 0x0e091eaa),
    vorticella: seedPoints(view.vorticella.count, seed, frame, 0x070271ca),
  };
}

export function updateAquarium(
  aquarium: AquariumLayerState,
  _frame: AquariumFrame,
  _params: CellParams,
): AquariumLayerState {
  return aquarium;
}

export function drawAquariumBackground(
  _ctx: CanvasRenderingContext2D,
  _aquarium: AquariumLayerState,
  _frame: AquariumFrame,
  _params: CellParams,
): void {
  // Phase 1 seam only: no visible companion drawing yet.
}
