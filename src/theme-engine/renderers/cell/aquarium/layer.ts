import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";
import { seedDiatoms, updateDiatoms, drawDiatoms } from "./diatoms";
import { seedEuglena, updateEuglena, drawEuglena } from "./euglena";
import { seedVorticella, updateVorticella, drawVorticella } from "./vorticella";
import type { AquariumFrame, AquariumLayerState } from "./types";

export function seedAquarium(frame: AquariumFrame, params: CellParams): AquariumLayerState {
  const view = aquariumParamsView(params);
  const seed = view.seed | 0;
  return {
    seed,
    diatoms: seedDiatoms(view.diatoms.count, seed, frame),
    euglena: seedEuglena(view.euglena.count, seed, frame),
    vorticella: seedVorticella(view.vorticella.count, seed, frame),
  };
}

export function updateAquarium(
  aquarium: AquariumLayerState,
  frame: AquariumFrame,
  params: CellParams,
): AquariumLayerState {
  const view = aquariumParamsView(params);
  if (!view.enabled) return aquarium;
  const diatoms = view.diatoms.count > 0 ? updateDiatoms(aquarium.diatoms, frame, view) : aquarium.diatoms;
  const euglena = view.euglena.count > 0 ? updateEuglena(aquarium.euglena, frame, view) : aquarium.euglena;
  const vorticella = view.vorticella.count > 0 ? updateVorticella(aquarium.vorticella, frame, view) : aquarium.vorticella;
  return diatoms === aquarium.diatoms && euglena === aquarium.euglena && vorticella === aquarium.vorticella
    ? aquarium
    : { ...aquarium, diatoms, euglena, vorticella };
}

export function drawAquariumBackground(
  ctx: CanvasRenderingContext2D,
  aquarium: AquariumLayerState,
  frame: AquariumFrame,
  params: CellParams,
): void {
  const view = aquariumParamsView(params);
  if (!view.enabled) return;
  drawDiatoms(ctx, aquarium.diatoms, frame, view);
  drawEuglena(ctx, aquarium.euglena, frame, view);
  drawVorticella(ctx, aquarium.vorticella, frame, view);
}
