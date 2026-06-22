import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";
import { seedDiatoms, updateDiatoms, drawDiatoms } from "./diatoms";
import { seedEuglena, updateEuglena, drawEuglena } from "./euglena";
import { seedVorticella, updateVorticella, drawVorticella, vorticellaObstacle } from "./vorticella";
import type { AquariumFrame, AquariumLayerState } from "./types";

export function seedAquarium(frame: AquariumFrame, params: CellParams): AquariumLayerState {
  const view = aquariumParamsView(params);
  const seed = view.seed | 0;
  return {
    seed,
    diatoms: seedDiatoms(view.diatoms.count, seed, frame),
    euglena: seedEuglena(view.euglena.count, seed, frame),
    vorticella: seedVorticella(view.vorticella.count, seed, frame, view.vorticella.alongFrac),
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
  // sessile vorticella act as static obstacles the euglena must swim around
  const obstacles = view.vorticella.count > 0 && aquarium.vorticella.length > 0
    ? aquarium.vorticella.map((v) => vorticellaObstacle(v, view.vorticella.scale, frame.height))
    : undefined;
  const euglenaFrame = obstacles ? { ...frame, obstacles } : frame;
  const euglena = view.euglena.count > 0 ? updateEuglena(aquarium.euglena, euglenaFrame, view) : aquarium.euglena;
  // motile cells (hero + euglena) can mechanically disturb a sessile vorticella
  let vorticella = aquarium.vorticella;
  if (view.vorticella.count > 0) {
    const motiles: { x: number; y: number }[] = [];
    if (frame.hero) motiles.push({ x: frame.hero.x, y: frame.hero.y });
    for (const e of euglena) motiles.push({ x: e.x, y: e.y });
    vorticella = updateVorticella(aquarium.vorticella, motiles.length > 0 ? { ...frame, motiles } : frame, view);
  }
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
