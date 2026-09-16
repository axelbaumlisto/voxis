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
import type { ThemeModule, ThemeSize } from "../types/theme-api";

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

// Manifest JSON, statically imported the same way (and from the same
// `build-themes.ts` output directory) as each `theme.js` above — a
// `resolveJsonModule` import is just as CSP-safe as the static ESM
// imports above (still no Blob:/data: URL, and no dynamic runtime
// import call at all, see `__tests__/csp-bundle.test.ts`), and gives
// `resolveThemeSize` below a
// manifest-accurate `overlay_width`/`overlay_height` per theme (A6 —
// full theme support: a 120x120 WebGL theme like lavalamp must not be
// squashed into a 64x64 pill).
import allAquariumManifest from "./generated/all_aquarium/theme.json";
import defaultManifest from "./generated/default/theme.json";
import didiniumDriftManifest from "./generated/didinium_drift/theme.json";
import driftingContourManifest from "./generated/drifting_contour/theme.json";
import duoAquariumManifest from "./generated/duo_aquarium/theme.json";
import euglenaDriftManifest from "./generated/euglena_drift/theme.json";
import handyPillManifest from "./generated/handy_pill/theme.json";
import lavalampManifest from "./generated/lavalamp/theme.json";
import livingReedManifest from "./generated/living_reed/theme.json";
import metaballsManifest from "./generated/metaballs/theme.json";
import metaballs25dManifest from "./generated/metaballs25d/theme.json";
import metaballs3dManifest from "./generated/metaballs3d/theme.json";
import neonManifest from "./generated/neon/theme.json";
import parameciumSoloManifest from "./generated/paramecium_solo/theme.json";
import quietReedManifest from "./generated/quiet_reed/theme.json";
import radiolarianManifest from "./generated/radiolarian/theme.json";
import vorticellaBloomManifest from "./generated/vorticella_bloom/theme.json";
import winampClassicManifest from "./generated/winamp_classic/theme.json";

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

/**
 * The size an overlay hosting a theme with no `overlay_width`/
 * `overlay_height` in its manifest gets (`default`/`handy_pill`/`neon`/
 * `winamp_classic` today — see `manifest.rs`'s `Option<u32>`, absent
 * meaning "no opinion"). Same value `<voxis-overlay>`'s pill has always
 * used pre-A6, so those four themes render unchanged; only themes that
 * *do* declare a manifest size (e.g. lavalamp's 120×120 WebGL scene) now
 * get their own overlay size instead of being squashed into this one.
 */
export const FALLBACK_THEME_SIZE: ThemeSize = { width: 64, height: 64 };

/**
 * The manifest fields `sizeFromManifest` reads — the rest of
 * `ThemeManifest` (name/description/params/...) is irrelevant to sizing.
 * `entry` is required (every manifest has one) purely so this interface
 * isn't a TS "weak type" (all-optional-properties) that would otherwise
 * make every manifest object literal below fail TS2559's "has no
 * properties in common" check.
 */
interface ManifestSizeFields {
  entry: string;
  overlay_width?: number;
  overlay_height?: number;
}

function sizeFromManifest(manifest: ManifestSizeFields): ThemeSize {
  if (typeof manifest.overlay_width === "number" && typeof manifest.overlay_height === "number") {
    return { width: manifest.overlay_width, height: manifest.overlay_height };
  }
  return FALLBACK_THEME_SIZE;
}

/** Static id -> manifest overlay size map, mirroring `ThemeRegistry`'s id -> module map. The *only* place manifest sizes are read. */
const ThemeSizes: Record<string, ThemeSize> = {
  all_aquarium: sizeFromManifest(allAquariumManifest),
  default: sizeFromManifest(defaultManifest),
  didinium_drift: sizeFromManifest(didiniumDriftManifest),
  drifting_contour: sizeFromManifest(driftingContourManifest),
  duo_aquarium: sizeFromManifest(duoAquariumManifest),
  euglena_drift: sizeFromManifest(euglenaDriftManifest),
  handy_pill: sizeFromManifest(handyPillManifest),
  lavalamp: sizeFromManifest(lavalampManifest),
  living_reed: sizeFromManifest(livingReedManifest),
  metaballs: sizeFromManifest(metaballsManifest),
  metaballs25d: sizeFromManifest(metaballs25dManifest),
  metaballs3d: sizeFromManifest(metaballs3dManifest),
  neon: sizeFromManifest(neonManifest),
  paramecium_solo: sizeFromManifest(parameciumSoloManifest),
  quiet_reed: sizeFromManifest(quietReedManifest),
  radiolarian: sizeFromManifest(radiolarianManifest),
  vorticella_bloom: sizeFromManifest(vorticellaBloomManifest),
  winamp_classic: sizeFromManifest(winampClassicManifest),
};

/**
 * The overlay size a theme's manifest declares (A6 plan step 1) —
 * `FALLBACK_THEME_SIZE` (64×64, this element's original fixed pill size)
 * for an unknown id or a manifest with no `overlay_width`/
 * `overlay_height`. Mirrors `resolveTheme`'s id normalization
 * (`undefined`/empty -> `DEFAULT_THEME_ID`) so a caller resolving both a
 * module and a size for the same requested id always gets a consistent
 * pair.
 */
export function resolveThemeSize(id: string | undefined): ThemeSize {
  const key = id && id.length > 0 ? id : DEFAULT_THEME_ID;
  return ThemeSizes[key] ?? FALLBACK_THEME_SIZE;
}
