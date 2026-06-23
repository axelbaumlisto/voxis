import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";
import { buildField, sourceId } from "./interaction";
import type { FieldContribution, InteractionField } from "./interaction";
import { REGISTRY, sceneFromParams } from "./registry";
import type { AquariumFrame, AquariumLayerState } from "./types";
import { euglenaContribute } from "./euglena";
import { vorticellaContribute } from "./vorticella";
import { didiniumContribute, didiniumDisplayLength } from "./didinium";

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

/**
 * Foreground overlays that must appear ABOVE the paramecium hero. Normal aquarium
 * bodies are drawn behind the hero; predator contact cues need to remain visible
 * at the prey surface, otherwise the Didinium latch reads as a kiss/occlusion.
 */
export function drawAquariumForeground(
  ctx: CanvasRenderingContext2D,
  aquarium: AquariumLayerState,
  _frame: AquariumFrame,
  params: CellParams,
): void {
  const view = aquariumParamsView(params);
  if (!view.enabled || view.didinium.count <= 0) return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.9));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of aquarium.didinium) {
    const contact = Math.max(0, d.contactTimer ?? 0);
    if (contact <= 0) continue;
    const L = didiniumDisplayLength(d.size, view.didinium.scale);
    const heading = d.phase;
    const ux = Math.cos(heading), uy = Math.sin(heading);
    const snoutX = d.x + ux * L * 0.52;
    const snoutY = d.y + uy * L * 0.52;
    const env = Math.min(1, contact / 0.35);

    // Didinium toxicyst / attachment filaments: short, cool darkfield glints.
    ctx.strokeStyle = `hsla(198, 36%, 94%, ${alpha * 0.42 * env})`;
    ctx.lineWidth = Math.max(0.45, L * 0.018);
    for (let k = -1; k <= 1; k++) {
      const side = k * L * 0.035;
      const sx = snoutX - uy * side;
      const sy = snoutY + ux * side;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + ux * Math.min(8, L * 0.16), sy + uy * Math.min(8, L * 0.16));
      ctx.stroke();
    }

    // Paramecium defensive trichocyst sparkle at contact: warm, tiny, decays fast.
    const fanAlpha = alpha * 0.38 * env;
    ctx.strokeStyle = `hsla(42, 38%, 92%, ${fanAlpha})`;
    ctx.lineWidth = 0.55;
    for (let k = 0; k < 9; k++) {
      const a = heading + Math.PI + (k - 4) * 0.16;
      const len = 2.5 + (k % 3) * 1.1;
      ctx.beginPath();
      ctx.moveTo(snoutX, snoutY);
      ctx.lineTo(snoutX + Math.cos(a) * len, snoutY + Math.sin(a) * len);
      ctx.stroke();
    }

    ctx.fillStyle = `hsla(44, 40%, 94%, ${alpha * 0.35 * env})`;
    ctx.beginPath();
    ctx.arc(snoutX, snoutY, Math.max(1, L * 0.045), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
