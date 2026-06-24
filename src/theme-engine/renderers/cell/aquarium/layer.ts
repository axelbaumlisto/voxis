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
      heading: hero.heading ?? 0,
      radius: Math.max(hero.halfWid ?? hero.radius, (hero.halfLen ?? hero.radius) * 0.35),
      speed: 0,
      role: "prey",
      strength: 1,
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
    const env = Math.min(1, contact / 0.55);

    // Foreground Didinium silhouette cue: a faint barrel outline + two girdle marks
    // above the hero so the predator remains a distinct cell during latch, not a
    // grey patch on the Paramecium flank.
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(heading);
    ctx.strokeStyle = `hsla(226, 48%, 96%, ${alpha * 0.96 * env})`;
    ctx.lineWidth = Math.max(0.9, L * 0.030);
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.50, L * 0.22, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `hsla(214, 54%, 98%, ${alpha * 0.92 * env})`;
    ctx.lineWidth = Math.max(0.9, L * 0.028);
    for (const gx of [L * 0.18, -L * 0.12]) {
      ctx.beginPath();
      ctx.moveTo(gx, -L * 0.20);
      ctx.lineTo(gx, L * 0.20);
      ctx.stroke();
    }
    ctx.restore();

    // Directional attack point: push the luminous contact slightly INTO the prey
    // surface so the cue reads as piercing/attachment, not a centered kiss.
    const pierceLen = Math.min(18, Math.max(14, L * 0.42));
    const px = snoutX + ux * pierceLen;
    const py = snoutY + uy * pierceLen;

    // Dark puncture/dent first: a tiny shadow + crescent under the contact glow.
    ctx.fillStyle = `hsla(205, 18%, 15%, ${alpha * 0.55 * env})`;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1.3, L * 0.065), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `hsla(210, 14%, 10%, ${alpha * 0.42 * env})`;
    ctx.lineWidth = Math.max(1.0, L * 0.035);
    ctx.beginPath();
    ctx.arc(px - ux * 1.5, py - uy * 1.5, Math.max(3.0, L * 0.16), heading + Math.PI * 0.62, heading + Math.PI * 1.38);
    ctx.stroke();

    // Didinium toxicyst / attachment filaments: one dominant central piercing
    // line plus two fainter side attachment lines (not a moustache).
    for (const [side, aMul, wMul] of [[-L * 0.055, 0.55, 0.8], [0, 1.0, 1.25], [L * 0.055, 0.55, 0.8]] as const) {
      const sx = snoutX - uy * side;
      const sy = snoutY + ux * side;
      ctx.strokeStyle = `hsla(198, 52%, 98%, ${alpha * 0.95 * env * aMul})`;
      ctx.lineWidth = Math.max(0.75, L * 0.026) * wMul;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(px, py);
      ctx.stroke();
    }

    // Paramecium defensive trichocyst burst: asymmetric fan AWAY from predator,
    // not a regular radial UI sparkle.
    const fanAlpha = alpha * 0.38 * env;
    ctx.lineWidth = 0.8;
    for (let k = 0; k < 9; k++) {
      if (k % 5 === 1) continue; // irregular gaps: biological, not UI starburst
      const jitter = Math.sin((k + 1) * 12.9898) * 0.08;
      const a = heading + Math.PI + (k - 4) * 0.15 + jitter;
      const len = 5.5 + ((k * 5) % 5) * 0.75;
      const aJ = 0.75 + 0.25 * Math.abs(Math.sin((k + 3) * 4.17));
      ctx.strokeStyle = `hsla(42, 46%, 95%, ${fanAlpha * aJ})`;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      ctx.stroke();
    }

    ctx.fillStyle = `hsla(44, 52%, 97%, ${alpha * 0.86 * env})`;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1.2, L * 0.055), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
