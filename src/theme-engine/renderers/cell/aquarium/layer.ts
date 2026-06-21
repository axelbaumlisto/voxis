import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";
import { seedDiatoms, updateDiatoms, drawDiatoms } from "./diatoms";
import { seedPoints } from "./seeds";
import type { AquariumFrame, AquariumLayerState } from "./types";

export function seedAquarium(frame: AquariumFrame, params: CellParams): AquariumLayerState {
  const view = aquariumParamsView(params);
  const seed = view.seed | 0;
  return {
    seed,
    diatoms: seedDiatoms(view.diatoms.count, seed, frame),
    euglena: seedPoints(view.euglena.count, seed, frame, 0x0e091eaa),
    vorticella: seedPoints(view.vorticella.count, seed, frame, 0x070271ca),
  };
}

export function updateAquarium(
  aquarium: AquariumLayerState,
  frame: AquariumFrame,
  params: CellParams,
): AquariumLayerState {
  const view = aquariumParamsView(params);
  if (!view.enabled || aquarium.diatoms.length === 0 || view.diatoms.count <= 0) return aquarium;
  const diatoms = updateDiatoms(aquarium.diatoms, frame, view);
  return diatoms === aquarium.diatoms ? aquarium : { ...aquarium, diatoms };
}

export function drawAquariumBackground(
  ctx: CanvasRenderingContext2D,
  aquarium: AquariumLayerState,
  frame: AquariumFrame,
  params: CellParams,
): void {
  const view = aquariumParamsView(params);
  if (!view.enabled || aquarium.diatoms.length === 0 || view.diatoms.count <= 0) return;
  drawDiatoms(ctx, aquarium.diatoms, frame, view);
}
