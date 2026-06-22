import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";
import { REGISTRY, sceneFromParams } from "./registry";
import type { AquariumFrame, AquariumLayerState } from "./types";
import { vorticellaObstacle } from "./vorticella";

type MutableAquariumLayerState = { -readonly [K in keyof AquariumLayerState]: AquariumLayerState[K] };

export function seedAquarium(frame: AquariumFrame, params: CellParams): AquariumLayerState {
  const scene = sceneFromParams(params);
  const state: MutableAquariumLayerState = { seed: scene.seed, diatoms: [], euglena: [], vorticella: [] };

  for (const instance of scene.instances) {
    const entry = REGISTRY[instance.species];
    state[entry.slot] = entry.seed(instance.count, scene.seed, frame, instance.cfg) as never;
  }

  return state;
}

export function updateAquarium(
  aquarium: AquariumLayerState,
  frame: AquariumFrame,
  params: CellParams,
): AquariumLayerState {
  const view = aquariumParamsView(params);
  if (!view.enabled) return aquarium;
  const scene = sceneFromParams(params);
  const cfgBySpecies = Object.fromEntries(scene.instances.map((instance) => [instance.species, instance.cfg]));
  const diatoms = view.diatoms.count > 0 ? REGISTRY.diatom.update(aquarium.diatoms, frame, cfgBySpecies.diatom) : aquarium.diatoms;
  // sessile vorticella act as static obstacles the euglena must swim around
  const obstacles = view.vorticella.count > 0 && aquarium.vorticella.length > 0
    ? aquarium.vorticella.map((v) => vorticellaObstacle(v, view.vorticella.scale, frame.height))
    : undefined;
  const euglenaFrame = obstacles ? { ...frame, obstacles } : frame;
  const euglena = view.euglena.count > 0 ? REGISTRY.euglena.update(aquarium.euglena, euglenaFrame, cfgBySpecies.euglena) : aquarium.euglena;
  // motile cells (hero + euglena) can mechanically disturb a sessile vorticella
  let vorticella = aquarium.vorticella;
  if (view.vorticella.count > 0) {
    const motiles: { x: number; y: number }[] = [];
    if (frame.hero) motiles.push({ x: frame.hero.x, y: frame.hero.y });
    for (const e of euglena) motiles.push({ x: e.x, y: e.y });
    vorticella = REGISTRY.vorticella.update(aquarium.vorticella, motiles.length > 0 ? { ...frame, motiles } : frame, cfgBySpecies.vorticella);
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
  const scene = sceneFromParams(params);
  const instancesByZ = [...scene.instances].sort((a, b) => REGISTRY[a.species].z - REGISTRY[b.species].z);

  for (const instance of instancesByZ) {
    const entry = REGISTRY[instance.species];
    entry.draw(ctx, aquarium[entry.slot] as never, frame, instance.cfg);
  }
}
