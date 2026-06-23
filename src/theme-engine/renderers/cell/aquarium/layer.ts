import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";
import { buildField, sourceId } from "./interaction";
import type { FieldContribution, InteractionField } from "./interaction";
import { REGISTRY, sceneFromParams } from "./registry";
import type { AquariumFrame, AquariumLayerState } from "./types";
import { euglenaContribute } from "./euglena";
import { vorticellaContribute } from "./vorticella";
import { didiniumContribute } from "./didinium";

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

export function buildAquariumInteractionField(
  euglena: readonly AquariumLayerState["euglena"][number][] | undefined,
  vorticella: readonly AquariumLayerState["vorticella"][number][] | undefined,
  hero: AquariumFrame["hero"],
  vorticellaScale: number,
  frameHeight: number,
  didinium?: readonly AquariumLayerState["didinium"][number][] | undefined,
): InteractionField {
  const contribs: FieldContribution[] = [];
  if (vorticella) {
    for (let i = 0; i < vorticella.length; i++) {
      contribs.push(...vorticellaContribute(vorticella[i], vorticellaScale, frameHeight, i));
    }
  }
  if (euglena) {
    for (let i = 0; i < euglena.length; i++) {
      contribs.push(...euglenaContribute(euglena[i], i));
    }
  }
  if (didinium) {
    for (let i = 0; i < didinium.length; i++) {
      contribs.push(...didiniumContribute(didinium[i], i));
    }
  }
  contribs.push(...heroContribute(hero));
  return buildField(contribs);
}

export function seedAquarium(frame: AquariumFrame, params: CellParams): AquariumLayerState {
  const scene = sceneFromParams(params);
  const state: MutableAquariumLayerState = { seed: scene.seed, diatoms: [], euglena: [], vorticella: [], didinium: [] };

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
  const preUpdateEuglena = view.euglena.count > 0 && aquarium.euglena.length > 0 ? aquarium.euglena : undefined;
  const preUpdateVorticella = view.vorticella.count > 0 && aquarium.vorticella.length > 0 ? aquarium.vorticella : undefined;
  const preUpdateDidinium = view.didinium.count > 0 && aquarium.didinium.length > 0 ? aquarium.didinium : undefined;
  const interaction = buildAquariumInteractionField(preUpdateEuglena, preUpdateVorticella, frame.hero, view.vorticella.scale, frame.height, preUpdateDidinium);
  const interactionFrame = { ...frame, interaction };
  const euglena = view.euglena.count > 0 ? REGISTRY.euglena.update(aquarium.euglena, interactionFrame, cfgBySpecies.euglena) : aquarium.euglena;
  const vorticella = view.vorticella.count > 0
    ? REGISTRY.vorticella.update(aquarium.vorticella, interactionFrame, cfgBySpecies.vorticella)
    : aquarium.vorticella;
  const didinium = view.didinium.count > 0
    ? REGISTRY.didinium.update(aquarium.didinium, interactionFrame, cfgBySpecies.didinium)
    : aquarium.didinium;
  return diatoms === aquarium.diatoms && euglena === aquarium.euglena && vorticella === aquarium.vorticella && didinium === aquarium.didinium
    ? aquarium
    : { ...aquarium, diatoms, euglena, vorticella, didinium };
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
