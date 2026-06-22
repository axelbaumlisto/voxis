import type { CellParams } from "../types";
import { aquariumParamsView } from "./params";

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

export const REGISTRY: Record<Species, { salt: number; z: number }> = {
  diatom: { salt: 0x0d1a70cd, z: 0 },
  euglena: { salt: 0x0e091eaa, z: 1 },
  vorticella: { salt: 0x070271ca, z: 2 },
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
