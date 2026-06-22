import type { CellParams } from "../types";
import { seedDiatoms, updateDiatoms, drawDiatoms } from "./diatoms";
import { seedEuglena, updateEuglena, drawEuglena } from "./euglena";
import { aquariumParamsView } from "./params";
import type {
  AquariumFrame,
  AquariumLayerState,
  AquariumParamsView,
  DiatomState,
  EuglenaState,
  VorticellaState,
} from "./types";
import { seedVorticella, updateVorticella, drawVorticella } from "./vorticella";

export type Species = "diatom" | "euglena" | "vorticella";

export interface SceneInstance {
  species: Species;
  count: number;
  cfg?: unknown;
}

export interface SceneSpec {
  seed: number;
  instances: SceneInstance[];
}

export type AquariumStateSlot = {
  [K in keyof AquariumLayerState]: AquariumLayerState[K] extends readonly unknown[] ? K : never;
}[keyof AquariumLayerState];

export interface OrganismRegistryEntry<State, Slot extends AquariumStateSlot> {
  salt: number;
  z: number;
  slot: Slot;
  seed: (count: number, seed: number, frame: AquariumFrame, cfg: unknown) => readonly State[];
  update: (states: readonly State[], frame: AquariumFrame, cfg: unknown) => readonly State[];
  draw: (
    ctx: CanvasRenderingContext2D,
    states: readonly State[],
    frame: AquariumFrame,
    cfg: unknown,
  ) => void;
}

interface RegistryStateMap {
  diatom: DiatomState;
  euglena: EuglenaState;
  vorticella: VorticellaState;
}

interface RegistrySlotMap {
  diatom: "diatoms";
  euglena: "euglena";
  vorticella: "vorticella";
}

type AquariumRegistry = { [K in Species]: OrganismRegistryEntry<RegistryStateMap[K], RegistrySlotMap[K]> };

type AquariumLayerCfg = Pick<AquariumParamsView, "activityBoost" | "seed"> & { readonly aquariumAlpha: number };
type DiatomCfg = AquariumParamsView["diatoms"] & AquariumLayerCfg;
type EuglenaCfg = AquariumParamsView["euglena"] & AquariumLayerCfg & Pick<AquariumParamsView, "medium">;
type VorticellaCfg = AquariumParamsView["vorticella"] & AquariumLayerCfg;

function viewForDiatom(cfg: DiatomCfg): AquariumParamsView {
  return {
    enabled: true,
    seed: cfg.seed,
    alpha: cfg.aquariumAlpha,
    activityBoost: cfg.activityBoost,
    diatoms: cfg,
    euglena: { count: 0, speed: 0, speedActive: 0, scale: 1, hueOffset: 42 },
    vorticella: { count: 0, contractRate: 0, scale: 1, alongFrac: 0.5 },
  };
}

function viewForEuglena(cfg: EuglenaCfg): AquariumParamsView {
  return {
    enabled: true,
    seed: cfg.seed,
    alpha: cfg.aquariumAlpha,
    activityBoost: cfg.activityBoost,
    medium: cfg.medium,
    diatoms: { count: 0, alpha: 0, driftSpeed: 0 },
    euglena: cfg,
    vorticella: { count: 0, contractRate: 0, scale: 1, alongFrac: 0.5 },
  };
}

function viewForVorticella(cfg: VorticellaCfg): AquariumParamsView {
  return {
    enabled: true,
    seed: cfg.seed,
    alpha: cfg.aquariumAlpha,
    activityBoost: cfg.activityBoost,
    diatoms: { count: 0, alpha: 0, driftSpeed: 0 },
    euglena: { count: 0, speed: 0, speedActive: 0, scale: 1, hueOffset: 42 },
    vorticella: cfg,
  };
}

export const REGISTRY: AquariumRegistry = {
  diatom: {
    salt: 0x0d1a70cd,
    z: 0,
    slot: "diatoms",
    seed: (count, seed, frame) => seedDiatoms(count, seed, frame),
    update: (states, frame, cfg) => updateDiatoms(states, frame, viewForDiatom(cfg as DiatomCfg)),
    draw: (ctx, states, frame, cfg) => drawDiatoms(ctx, states, frame, viewForDiatom(cfg as DiatomCfg)),
  },
  euglena: {
    salt: 0x0e091eaa,
    z: 1,
    slot: "euglena",
    seed: (count, seed, frame) => seedEuglena(count, seed, frame),
    update: (states, frame, cfg) => updateEuglena(states, frame, viewForEuglena(cfg as EuglenaCfg)),
    draw: (ctx, states, frame, cfg) => drawEuglena(ctx, states, frame, viewForEuglena(cfg as EuglenaCfg)),
  },
  vorticella: {
    salt: 0x070271ca,
    z: 2,
    slot: "vorticella",
    seed: (count, seed, frame, cfg) => seedVorticella(count, seed, frame, (cfg as AquariumParamsView["vorticella"]).alongFrac),
    update: (states, frame, cfg) => updateVorticella(states, frame, viewForVorticella(cfg as VorticellaCfg)),
    draw: (ctx, states, frame, cfg) => drawVorticella(ctx, states, frame, viewForVorticella(cfg as VorticellaCfg)),
  },
};

export function sceneFromParams(params: CellParams): SceneSpec {
  const view = aquariumParamsView(params);
  const instances: SceneInstance[] = [];

  if (!view.enabled) return { seed: view.seed | 0, instances };

  if (view.diatoms.count > 0) {
    instances.push({
      species: "diatom",
      count: view.diatoms.count,
      cfg: { ...view.diatoms, seed: view.seed, aquariumAlpha: view.alpha, activityBoost: view.activityBoost },
    });
  }
  if (view.euglena.count > 0) {
    instances.push({
      species: "euglena",
      count: view.euglena.count,
      cfg: {
        ...view.euglena,
        medium: view.medium,
        seed: view.seed,
        aquariumAlpha: view.alpha,
        activityBoost: view.activityBoost,
      },
    });
  }
  if (view.vorticella.count > 0) {
    instances.push({
      species: "vorticella",
      count: view.vorticella.count,
      cfg: { ...view.vorticella, seed: view.seed, aquariumAlpha: view.alpha, activityBoost: view.activityBoost },
    });
  }

  return { seed: view.seed | 0, instances };
}
