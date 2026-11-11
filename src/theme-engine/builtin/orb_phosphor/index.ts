// orb_phosphor — An ASCII glyph matrix in CRT green, wrapped on the ball: a resolution-relative grid of woven dash characters whose lit-row count quantizes a streaming fbm field — exactly how ASCII art shades — with blocky dropouts eaten out of the matrix on a coarser super-grid, a stereographic wrap that rolls the weave around the sphere, and a phosphor ramp from deep green to hot glow
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-23`
// ("Phosphor") — MIT.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (drift, scroll, speed, spin) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
void main() {
  // Volume coupling: user input densifies the glyphs, agent output turns
  // the phosphor up — the matrix visibly burns brighter while it speaks.
  float densBias = uP_density + 0.2 * uInput;
  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);

  // resolution-relative glyph grid — same character count at every size
  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 4.0);
  vec2 cellIdx = floor(gl_FragCoord.xy / cellPx);
  vec2 cellCentre = (cellIdx + 0.5) * cellPx;
  vec2 g = fract(gl_FragCoord.xy / cellPx); // 0..1 inside the cell

  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);
  vec2 uv = suv / uP_radius;
  float r2 = dot(uv, uv);

  // blocky silhouette, cut on the cell grid like the rest of the matrix
  float mask = 1.0 - step(1.0, r2);

  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, z);

  // rotating dome, stereographic projection — the weave compresses toward
  // the rim and rolls around the ball as the dome turns
  float rot = uP_spin; // integrated clock
  float cr = cos(rot);
  float sr = sin(rot);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);
  vec2 p2 = sp.xy / (abs(sp.z) + 1.2) * uP_scale * 3.0;

  /*
    Three motions, one per state, each on its OWN integrated clock so a
    state change morphs the movement instead of jumping it:

      DRIFT   diagonal lava-flow streaming        (idle)
      SCROLL  vertical paging, terminal-style     (thinking)
      PULSE   radial waves radiating from centre  (speaking)

    The clocks are rates in the presets — a rate gliding to zero freezes
    that motion in place, phase intact. The pulse's amplitude is a separate
    non-integrated param, so idle carries no static rings.
  */
  float driftT = uP_drift;   // integrated clock: diagonal stream
  float scrollT = uP_scroll; // integrated clock: vertical paging
  float t = uP_speed;        // integrated clock: pulse phase
  vec2 flow = vec2(driftT * 0.6, -driftT * 0.45 - scrollT);

  float field = fbm(p2 + flow);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float dens = clamp((field - 0.5) * 1.8 + densBias + 0.4 * uP_light * lambert
    + uP_pulse * 0.35 * sin(length(uv) * 5.5 - t * 2.4), 0.0, 1.0);

  /*
    The glyph: four dash rows split by three stripe gaps. Rows light from
    the bottom as density rises — the step() against the row index IS the
    ASCII quantizer, so a cell is always a whole character.
  */
  float rowI = floor(g.y * 4.0);
  float bar = step(0.22, fract(g.y * 4.0)) * step(fract(g.y * 4.0), 0.9);
  float stripe = step(0.18, fract(g.x * 3.0));
  float lit = step(rowI + 0.5, dens * 4.0 * gainNow);
  float glyph = bar * stripe * lit;

  /*
    Blocky dropouts: the same field, resampled on a 2x2 super-grid and
    thresholded. Because whole super-cells fail together, the dark zones
    become hard rectangular holes instead of dim characters.
  */
  vec2 superCentre = (floor(cellIdx / 2.0) * 2.0 + 1.0) * cellPx;
  vec2 sSuv = (2.0 * superCentre - uRes) / min(uRes.x, uRes.y);
  vec2 sUv2 = sSuv / uP_radius;
  float sz = sqrt(max(1.0 - dot(sUv2, sUv2), 0.0));
  vec3 ssp = vec3(sUv2.x * cr - sz * sr, sUv2.y, sUv2.x * sr + sz * cr);
  float superField = fbm(ssp.xy / (abs(ssp.z) + 1.2) * uP_scale * 3.0 + flow);
  float keep = step(uP_dropout, superField + 0.15 * uOutput);
  glyph *= keep;

  // phosphor ramp: deep green floor to hot glow, whitening at the top end
  vec3 glyphCol = mix(uC_deep, uC_glow, dens);
  glyphCol += vec3(0.7, 1.0, 0.9) * pow(dens, 3.0) * 0.35;

  // a dark body under the matrix plus a glow-coloured fresnel rim, so the
  // orb reads as a solid ball and not loose characters
  float fres = pow(1.0 - z, 2.2);
  vec3 col = uC_deep * 0.22 + glyphCol * glyph + uC_glow * fres * uP_rim;

  col = pow(max(col, 0.0), vec3(uP_contrast));

  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply —
  // the opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(col * a, a);
}
`;

const DEFAULTS = { drift: 0.55, scroll: 0.05, speed: 0.5, pulse: 0, spin: 0.12, radius: 0.9, cells: 40, scale: 1.6, density: 0.48, dropout: 0.48, light: 0.6, rim: 0.45, gain: 1, contrast: 1 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_phosphor",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["drift", "scroll", "speed", "spin"],
  colors: { glow: "#57ffc9", deep: "#0b3b2d" },
  presets: {
    idle: {
      drift: 0.55,
      scroll: 0.05,
      pulse: 0,
      speed: 0.52,
      spin: 0.12,
      cells: 68,
      scale: 5.1,
      density: 0.31,
      dropout: 0.24,
      light: 1.11,
      rim: 0.66,
      gain: 0.9,
    },
    recording: {
      drift: 0.4,
      scroll: 0.1,
      pulse: 1.27,
      speed: 2.85,
      spin: 1.05,
      cells: 120,
      scale: 7.2,
      density: 0.56,
      dropout: 0.59,
      light: 0.39,
      rim: 0.51,
      gain: 2.95,
    },
    transcribing: {
      drift: 3.05,
      scroll: 0.65,
      pulse: 0.58,
      speed: 0.45,
      spin: 0.04,
      cells: 86,
      density: 0.33,
      dropout: 0.13,
      light: 0.855,
      rim: 0.51,
      contrast: 1.3,
      gain: 0.95,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
