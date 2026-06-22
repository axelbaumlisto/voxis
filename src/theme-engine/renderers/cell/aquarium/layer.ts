import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";
import { buildField, sourceId } from "./interaction";
import type { FieldContribution, FieldKind, InteractionField } from "./interaction";
import { REGISTRY, sceneFromParams } from "./registry";
import type { AquariumFrame, AquariumLayerState } from "./types";
import { euglenaContribute, EUGLENA_RELEVANT_FIELDS } from "./euglena";
import { vorticellaContribute, VORTICELLA_RELEVANT_FIELDS } from "./vorticella";

type MutableAquariumLayerState = { -readonly [K in keyof AquariumLayerState]: AquariumLayerState[K] };

export function heroContribute(hero: AquariumFrame["hero"]): FieldContribution[] {
  if (!hero) return [];
  const heroId = sourceId("hero", 0);
  return [
    {
      kind: "obstacle",
      shape: "ellipse",
      x: hero.x,
      y: hero.y,
      halfLen: hero.halfLen ?? hero.radius,
      halfWid: hero.halfWid ?? hero.radius,
      heading: hero.heading ?? 0,
      social: true,
      sourceId: heroId,
    },
    {
      kind: "wake",
      x: hero.x,
      y: hero.y,
      heading: hero.heading ?? 0,
      sourceId: heroId,
    },
    {
      kind: "motile",
      x: hero.x,
      y: hero.y,
      sourceId: heroId,
    },
  ];
}

function fieldForConsumer(contribs: readonly FieldContribution[], relevantFields: ReadonlySet<FieldKind>): InteractionField {
  return buildField(contribs.filter((contrib) => relevantFields.has(contrib.kind)));
}

export function buildEuglenaInteractionField(
  vorticella: readonly AquariumLayerState["vorticella"][number][] | undefined,
  hero: AquariumFrame["hero"],
  vorticellaScale: number,
  frameHeight: number,
): InteractionField {
  const contribs: FieldContribution[] = [];
  if (vorticella) {
    for (let i = 0; i < vorticella.length; i++) {
      contribs.push(...vorticellaContribute(vorticella[i], vorticellaScale, frameHeight, i));
    }
  }
  contribs.push(...heroContribute(hero));
  return fieldForConsumer(contribs, EUGLENA_RELEVANT_FIELDS);
}

export function buildVorticellaInteractionField(
  hero: AquariumFrame["hero"],
  euglena: AquariumLayerState["euglena"],
): InteractionField {
  const contribs: FieldContribution[] = [];
  contribs.push(...heroContribute(hero));
  for (let i = 0; i < euglena.length; i++) {
    contribs.push(...euglenaContribute(euglena[i], i));
  }
  return fieldForConsumer(contribs, VORTICELLA_RELEVANT_FIELDS);
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
  const euglenaVorticella = view.vorticella.count > 0 && aquarium.vorticella.length > 0 ? aquarium.vorticella : undefined;
  const euglenaField = buildEuglenaInteractionField(euglenaVorticella, frame.hero, view.vorticella.scale, frame.height);
  const euglenaFrame = { ...frame, interaction: euglenaField };
  const euglena = view.euglena.count > 0 ? REGISTRY.euglena.update(aquarium.euglena, euglenaFrame, cfgBySpecies.euglena) : aquarium.euglena;
  let vorticella = aquarium.vorticella;
  if (view.vorticella.count > 0) {
    const vorticellaField = buildVorticellaInteractionField(frame.hero, euglena);
    vorticella = REGISTRY.vorticella.update(
      aquarium.vorticella,
      { ...frame, interaction: vorticellaField },
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
