// src/theme-engine/builtin/paramecium_solo/index.ts
/**
 * Paramecium Solo — the detailed ciliate hero (hero 1) on its own.
 *
 * Identical cell configuration to `drifting_contour` (the biology-approved
 * authentic Paramecium look), but WITHOUT the aquarium companions — just the
 * slipper animalcule swimming alone. The euglena lives in `euglena_drift` and
 * the vorticella in `vorticella_bloom`; this is the paramecium's solo theme.
 */
import { createCellRenderer } from "../../renderers/cell";
import type { ThemeApi, ThemeInstance } from "../../contract";
import { PARAMECIUM_BASE_HUE, PARAMECIUM_CELL_PARAMS } from "../_shared/paramecium";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const userParams = (api.params && typeof api.params === "object" ? api.params : {}) as Record<string, unknown>;

  const renderer = createCellRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: PARAMECIUM_BASE_HUE,
    params: {
      ...PARAMECIUM_CELL_PARAMS,
      enableAquarium: false,
      ...userParams,
    },
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return {
    unmount() {
      unsubscribe();
      renderer.destroy();
    },
  };
}
