// orb_shdr_16 — Sunlight through water: a caustic net crawling over the ball. Two crossed families of crest lines, their crossings added back so the foci burn hottest, read through a three-octave sine fold that refracts the net rather than scrolling it, and mapped triplanar so the ball can turn forever with no pole and no seam. The net is sampled at three moments, one per channel, so edges fringe into colour only where they move. A surge on an integrated clock lifts gain and ripple depth together. Thinking runs fast, thin and cold; speaking heaves in long gold breaths on wine-dark water
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-16`
// ("SHDR-16") — MIT.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (flow, spin, swellRate) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
// Volume- and surge-reactive values, resolved once per fragment in main().
float causticWarp;

/*
  The water. The plane is folded on its own sines three times, each octave
  at a literal frequency and on its own share of the clock, so the ripples
  refract the net rather than scroll it. Amplitude is the one control.
*/
vec2 fold(vec2 p, float t) {
  p += causticWarp        * sin(p.yx * 1.31 + vec2( t * 0.90, -t * 0.70));
  p += causticWarp * 0.60 * sin(p.yx * 2.17 + vec2(-t * 1.30,  t * 1.10));
  p += causticWarp * 0.35 * sin(p.yx * 3.73 + vec2( t * 1.90,  t * 1.60));
  return p;
}

/*
  The light. Two crossed families of crest lines, sharpened by the edge
  exponent — the base is 1 - abs(sin), always in [0, 1], so pow is defined —
  with their product added back so the crossings, where wavefronts focus,
  burn hotter than the lines between them.
*/
float net(vec2 p, float t) {
  vec2 q = fold(p, t);
  vec2 s = 1.0 - abs(sin(q));
  vec2 l = pow(s, vec2(uP_edge));
  // Normalised to [0, 1]: the sum peaks at four on a crossing, and left
  // unbounded it drove the tone knee into clipping all three channels,
  // which turns any sun colour white. Bounded, the sun colour survives
  // the knee at the foci and gain is a real brightness rather than a
  // race to white.
  return (l.x + l.y + 2.0 * l.x * l.y) * 0.25;
}

/*
  Triplanar: the plane field read on the three axis planes of the surface
  direction and blended by the fourth power of each component, so each
  plane only shows where it faces squarely. No pole and no seam — the ball
  can turn forever.
*/
float netOn(vec3 sp, float t) {
  vec3 w = sp * sp;
  w *= w;
  w /= (w.x + w.y + w.z);
  float k = uP_scale;
  return w.x * net(sp.yz * k, t) + w.y * net(sp.zx * k, t) + w.z * net(sp.xy * k, t);
}

void main() {
  vec2 uv = orbUV();
  float rd = length(uv);
  float R = uP_radius;
  float mask = smoothstep(0.012, -0.012, rd - R);
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  // the ball turns about Y on its own integrated clock
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);

  float t = uP_flow; // integrated clock: the water

  /*
    The surge: a round trip on an integrated clock through cos, so it eases
    through both ends and never wraps. It lifts the gain and deepens the
    ripple together — brighter as the water heaves — and uP_swell is how
    much of that a state takes.

    Volume coupling in the family language: the agent's voice brightens the
    light, the user's deepens the water.
  */
  float surge = 0.5 - 0.5 * cos(uP_swellRate);
  float gainNow = uP_gain * mix(1.0, 0.55 + 0.9 * surge, uP_swell) * (0.8 + 0.5 * uOutput);
  causticWarp = uP_warp * mix(1.0, 0.8 + 0.4 * surge, uP_swell) * (1.0 + 0.35 * uInput);

  /*
    Three moments of the fold, one per channel. The LIGHT is the net's
    luminance under the sun colour, so gold is gold at the foci; the
    per-channel disagreement is split off as a zero-mean residual and added
    back scaled by uP_split, so the rainbow is a fringe that rides on the
    edges where they move and vanishes where they hold — never a tint on
    the whole net. Read once with the offset baked in and once without
    would cost the same three evaluations, so the offset is constant and
    the split is a plain amplitude on the residual: safe to stage.
  */
  float ds = 0.09;
  vec3 c = vec3(netOn(sp, t + ds), netOn(sp, t), netOn(sp, t - ds));
  float cLum = dot(c, vec3(1.0 / 3.0));
  vec3 fringe = (c - cLum) * uP_split;

  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float fres = pow(1.0 - z, 2.5);

  // the floor of the pool, then the light thrown on it — dimmer round the
  // limb, where the floor tilts away from the sun
  vec3 col = uC_deep * (0.35 + 0.65 * uP_light * lambert);
  col += (uC_sun * cLum + fringe) * gainNow * (0.55 + 0.45 * lambert);
  col += uC_sheen * uP_rim * fres;

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));
  col = tanh3(col);

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

const DEFAULTS = { flow: 0.9, spin: 0.08, swellRate: 0.6, radius: 0.9, scale: 9, warp: 0.8, edge: 2.2, split: 0.6, swell: 0.15, gain: 1.6, contrast: 1.1, light: 0.9, rim: 0.6 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_16",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["flow", "spin", "swellRate"],
  colors: { deep: "#0b2f6e", sun: "#7ff6ff", sheen: "#bfe8ff" },
  presets: {
    idle: {
      flow: 0.92,
      spin: 0.09,
      swellRate: 0.6,
      warp: 0.8,
      edge: 3,
      split: 0.6,
      swell: 0.15,
      gain: 6,
      contrast: 1.3,
      light: 0.9,
      rim: 0.6,
    },
    recording: {
      flow: 1.8,
      spin: 0.7,
      swellRate: 5.4,
      warp: 1.7,
      edge: 1.7,
      split: 1.1,
      swell: 1,
      gain: 3.6,
      contrast: 0.85,
      light: 0.96,
      rim: 0.18,
    },
    transcribing: {
      flow: 3.22,
      spin: 0.03,
      swellRate: 2.4,
      warp: 1.52,
      edge: 2.8,
      split: 0.36,
      swell: 0.26,
      gain: 3.35,
      contrast: 1.15,
      light: 0.525,
      rim: 0.21,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
