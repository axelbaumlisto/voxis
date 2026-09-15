// crates/tauri-plugin-voxis/guest-js/src/themes/registry.ts
/**
 * `ThemeRegistry` — the plugin's *entire* theme-loading mechanism.
 *
 * `[R1-Safety S3 / R2-Coherence F2]` Deliberately **not** built on
 * `src/theme-engine/loader.ts`/`fetchModule.ts` (Blob/data-URL
 * `import()` of a manifest-referenced script fetched at runtime) —
 * that's how the desktop app loads *user* themes from disk, and it is
 * exactly what a CSP of `default-src 'self'; script-src 'self'` (naked's
 * CSP, which this plugin must run under) blocks: a `Blob:`/`data:`
 * URL is not `'self'`. Instead every builtin theme this package ships is
 * imported **statically**, by literal specifier, at module-eval time —
 * from `themes/generated/<id>/theme.js`, this package's own
 * `scripts/build-themes.ts` output (a second target added alongside the
 * existing `src-tauri/themes` one — see that script's doc comment), not
 * `src/theme-engine/builtin/**` (relative-import TS sources that assume
 * a different build graph). A static `import` is a same-origin, bundled
 * module reference the CSP has no reason to block (the whole point of
 * `script-src 'self'`); nothing here ever constructs a URL string and
 * hands it to a dynamic `import()`.
 *
 * Unknown/missing theme id -> `resolveTheme` falls back to `"default"`
 * and `console.warn`s, per plan Task 5 acceptance ("unknown id ->
 * default + warn").
 */
import type { ThemeModule } from "../types/theme-api";

// Each of these is this package's own build output
// (`themes/generated/<id>/theme.js`, produced by `bun run build`/`test`'s
// `build-themes.ts` step before either tsc or vitest runs), a
// self-contained ESM module with no relative imports of its own —
// `Bun.build({format: "esm", target: "browser"})` already inlined
// everything `src/theme-engine/builtin/<id>/index.ts` depended on
// (renderers, contract types erased). `allowJs`/`checkJs:false` in this
// package's tsconfig.json means TS resolves but does not type-check
// these — they're plain JS, not part of this package's own source.
import * as allAquarium from "./generated/all_aquarium/theme.js";
import * as defaultTheme from "./generated/default/theme.js";
import * as didiniumDrift from "./generated/didinium_drift/theme.js";
import * as driftingContour from "./generated/drifting_contour/theme.js";
import * as duoAquarium from "./generated/duo_aquarium/theme.js";
import * as euglenaDrift from "./generated/euglena_drift/theme.js";
import * as handyPill from "./generated/handy_pill/theme.js";
import * as lavalamp from "./generated/lavalamp/theme.js";
import * as livingReed from "./generated/living_reed/theme.js";
import * as metaballs from "./generated/metaballs/theme.js";
import * as metaballs25d from "./generated/metaballs25d/theme.js";
import * as metaballs3d from "./generated/metaballs3d/theme.js";
import * as neon from "./generated/neon/theme.js";
import * as parameciumSolo from "./generated/paramecium_solo/theme.js";
import * as quietReed from "./generated/quiet_reed/theme.js";
import * as radiolarian from "./generated/radiolarian/theme.js";
import * as vorticellaBloom from "./generated/vorticella_bloom/theme.js";
import * as winampClassic from "./generated/winamp_classic/theme.js";

/** The theme id every embedding host gets when its requested/profile theme id is unknown. */
export const DEFAULT_THEME_ID = "default";

/** Static id -> module map. The *only* place theme ids are enumerated. */
export const ThemeRegistry: Record<string, ThemeModule> = {
  all_aquarium: allAquarium as unknown as ThemeModule,
  default: defaultTheme as unknown as ThemeModule,
  didinium_drift: didiniumDrift as unknown as ThemeModule,
  drifting_contour: driftingContour as unknown as ThemeModule,
  duo_aquarium: duoAquarium as unknown as ThemeModule,
  euglena_drift: euglenaDrift as unknown as ThemeModule,
  handy_pill: handyPill as unknown as ThemeModule,
  lavalamp: lavalamp as unknown as ThemeModule,
  living_reed: livingReed as unknown as ThemeModule,
  metaballs: metaballs as unknown as ThemeModule,
  metaballs25d: metaballs25d as unknown as ThemeModule,
  metaballs3d: metaballs3d as unknown as ThemeModule,
  neon: neon as unknown as ThemeModule,
  paramecium_solo: parameciumSolo as unknown as ThemeModule,
  quiet_reed: quietReed as unknown as ThemeModule,
  radiolarian: radiolarian as unknown as ThemeModule,
  vorticella_bloom: vorticellaBloom as unknown as ThemeModule,
  winamp_classic: winampClassic as unknown as ThemeModule,
};

/**
 * Resolves a theme id to a `ThemeModule`, falling back to
 * `DEFAULT_THEME_ID` (and warning) for anything not in `ThemeRegistry` —
 * including `undefined`/empty string, so callers can pass a profile's
 * `theme` field straight through without a separate null-check.
 */
export function resolveTheme(id: string | undefined): ThemeModule {
  const key = id && id.length > 0 ? id : DEFAULT_THEME_ID;
  const found = ThemeRegistry[key];
  if (found) return found;
  console.warn(`[voxis-overlay] unknown theme id "${id}", falling back to "${DEFAULT_THEME_ID}"`);
  const fallback = ThemeRegistry[DEFAULT_THEME_ID];
  if (!fallback) {
    throw new Error(`[voxis-overlay] ThemeRegistry has no "${DEFAULT_THEME_ID}" entry — build-themes.ts output missing?`);
  }
  return fallback;
}
