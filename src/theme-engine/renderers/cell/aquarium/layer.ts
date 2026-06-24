import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";
import { buildField } from "./interaction";
import type { FieldContribution, InteractionField } from "./interaction";
import { drawDidiniumParameciumContact } from "./didinium-paramecium";
import { heroContribute } from "./hero";
import { REGISTRY, sceneFromParams } from "./registry";
import type { AquariumFrame, AquariumLayerState } from "./types";
import { euglenaContribute } from "./euglena";
import { vorticellaContribute } from "./vorticella";
import { didiniumContribute } from "./didinium";

type MutableAquariumLayerState = { -readonly [K in keyof AquariumLayerState]: AquariumLayerState[K] };

// Intentionally assembled here with explicit species loops. The pairwise
// interaction sources stay readable, and REGISTRY avoids a premature generic
// contribution/lifecycle hook until real duplication justifies it.
export function buildAquariumInteractionField(
  euglena: readonly AquariumLayerState["euglena"][number][] | undefined,
  vorticella: readonly AquariumLayerState["vorticella"][number][] | undefined,
  hero: AquariumFrame["hero"],
  vorticellaScale: number,
  frameHeight: number,
  didinium?: readonly AquariumLayerState["didinium"][number][] | undefined,
  euglenaScale = 1,
  didiniumScale = 1,
): InteractionField {
  const contribs: FieldContribution[] = [];
  if (vorticella) {
    for (let i = 0; i < vorticella.length; i++) {
      contribs.push(...vorticellaContribute(vorticella[i], vorticellaScale, frameHeight, i));
    }
  }
  if (euglena) {
    for (let i = 0; i < euglena.length; i++) {
      contribs.push(...euglenaContribute(euglena[i], i, euglenaScale));
    }
  }
  if (didinium) {
    for (let i = 0; i < didinium.length; i++) {
      contribs.push(...didiniumContribute(didinium[i], i, didiniumScale));
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
  const interaction = buildAquariumInteractionField(
    preUpdateEuglena,
    preUpdateVorticella,
    frame.hero,
    view.vorticella.scale,
    frame.height,
    preUpdateDidinium,
    view.euglena.scale,
    view.didinium.scale,
  );
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

/**
 * Foreground overlays that must appear ABOVE the paramecium hero. Normal aquarium
 * bodies are drawn behind the hero; predator contact cues need to remain visible
 * at the prey surface, otherwise the Didinium latch reads as a kiss/occlusion.
 */
export function drawAquariumForeground(
  ctx: CanvasRenderingContext2D,
  aquarium: AquariumLayerState,
  frame: AquariumFrame,
  params: CellParams,
): void {
  const view = aquariumParamsView(params);
  if (!view.enabled || view.didinium.count <= 0) return;
  drawDidiniumParameciumContact(ctx, aquarium, frame, view);
}
