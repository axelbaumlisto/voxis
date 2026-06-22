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
  update: (states: readonly State[], frame: AquariumFrame, view: AquariumParamsView) => readonly State[];
  draw: (
    ctx: CanvasRenderingContext2D,
    states: readonly State[],
    frame: AquariumFrame,
    view: AquariumParamsView,
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

export const REGISTRY: AquariumRegistry = {
  diatom: {
    salt: 0x0d1a70cd,
    z: 0,
    slot: "diatoms",
    seed: (count, seed, frame) => seedDiatoms(count, seed, frame),
    update: updateDiatoms,
    draw: drawDiatoms,
  },
  euglena: {
    salt: 0x0e091eaa,
    z: 1,
    slot: "euglena",
    seed: (count, seed, frame) => seedEuglena(count, seed, frame),
    update: updateEuglena,
    draw: drawEuglena,
  },
  vorticella: {
    salt: 0x070271ca,
    z: 2,
    slot: "vorticella",
    seed: (count, seed, frame, cfg) => seedVorticella(count, seed, frame, (cfg as AquariumParamsView["vorticella"]).alongFrac),
    update: updateVorticella,
    draw: drawVorticella,
  },
};

export function sceneFromParams(params: CellParams): SceneSpec {
  const view = aquariumParamsView(params);
  const instances: SceneInstance[] = [];

  if (!view.enabled) return { seed: view.seed | 0, instances };

  if (view.diatoms.count > 0) {
    instances.push({ species: "diatom", count: view.diatoms.count, cfg: view.diatoms });
  }
  if (view.euglena.count > 0) {
    instances.push({ species: "euglena", count: view.euglena.count, cfg: { ...view.euglena, medium: view.medium } });
  }
  if (view.vorticella.count > 0) {
    instances.push({ species: "vorticella", count: view.vorticella.count, cfg: view.vorticella });
  }

  return { seed: view.seed | 0, instances };
}
