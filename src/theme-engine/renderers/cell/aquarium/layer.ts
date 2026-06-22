import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";
import { buildField, sourceId } from "./interaction";
import type { FieldContribution, InteractionField } from "./interaction";
import { REGISTRY, sceneFromParams } from "./registry";
import type { AquariumFrame, AquariumLayerState } from "./types";
import { vorticellaObstacle } from "./vorticella";

type MutableAquariumLayerState = { -readonly [K in keyof AquariumLayerState]: AquariumLayerState[K] };

type LegacyObstacle = NonNullable<AquariumFrame["obstacles"]>[number];

export function buildEuglenaInteractionField(
  obstacles: readonly LegacyObstacle[] | undefined,
  hero: AquariumFrame["hero"],
): InteractionField {
  const contribs: FieldContribution[] = [];
  if (obstacles) {
    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i];
      contribs.push({
        kind: "obstacle",
        shape: "circle",
        x: obstacle.x,
        y: obstacle.y,
        radius: obstacle.radius,
        sourceId: sourceId("vorticella", i),
      });
    }
  }
  if (hero) {
    const heroId = sourceId("hero", 0);
    contribs.push({
      kind: "obstacle",
      shape: "ellipse",
      x: hero.x,
      y: hero.y,
      halfLen: hero.halfLen ?? hero.radius,
      halfWid: hero.halfWid ?? hero.radius,
      heading: hero.heading ?? 0,
      social: true,
      sourceId: heroId,
    });
    contribs.push({
      kind: "wake",
      x: hero.x,
      y: hero.y,
      heading: hero.heading ?? 0,
      sourceId: heroId,
    });
  }
  return buildField(contribs);
}

export function buildVorticellaInteractionField(
  hero: AquariumFrame["hero"],
  euglena: AquariumLayerState["euglena"],
): InteractionField {
  const contribs: FieldContribution[] = [];
  if (hero) {
    contribs.push({
      kind: "motile",
      x: hero.x,
      y: hero.y,
      sourceId: sourceId("hero", 0),
    });
  }
  for (let i = 0; i < euglena.length; i++) {
    const cell = euglena[i];
    contribs.push({
      kind: "motile",
      x: cell.x,
      y: cell.y,
      sourceId: sourceId("euglena", i),
    });
  }
  return buildField(contribs);
}

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
  const euglenaField = buildEuglenaInteractionField(obstacles, frame.hero);
  const euglenaFrame = { ...frame, ...(obstacles ? { obstacles } : {}), interaction: euglenaField };
  const euglena = view.euglena.count > 0 ? REGISTRY.euglena.update(aquarium.euglena, euglenaFrame, cfgBySpecies.euglena) : aquarium.euglena;
  // motile cells (hero + euglena) can mechanically disturb a sessile vorticella
  let vorticella = aquarium.vorticella;
  if (view.vorticella.count > 0) {
    const motiles: { x: number; y: number }[] = [];
    if (frame.hero) motiles.push({ x: frame.hero.x, y: frame.hero.y });
    for (const e of euglena) motiles.push({ x: e.x, y: e.y });
    const vorticellaField = buildVorticellaInteractionField(frame.hero, euglena);
    vorticella = REGISTRY.vorticella.update(
      aquarium.vorticella,
      motiles.length > 0 ? { ...frame, motiles, interaction: vorticellaField } : frame,
      cfgBySpecies.vorticella,
    );
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
