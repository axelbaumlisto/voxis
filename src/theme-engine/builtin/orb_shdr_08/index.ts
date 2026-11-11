// orb_shdr_08 — Mother-of-pearl wrapped around the ball: a ten-octave feedback warp whose octaves each boil at their own multiple of the clock, banded by the cotangent of the warped coordinate so crests saturate flat and valleys floor to black, with the layers sampled through a stereographic projection of the dome so they compress toward the limb. Every band carries its own hue from a cosine palette keyed to the band coordinate, rotated further by the viewing angle the way thin-film interference actually behaves, and the golfed listing's uneven per-channel phase breaks each band edge into a warm shoulder and a deep blue one
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-08`
// ("SHDR-08") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, flow, swirl) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define OCTAVES 10
#define AA 2

const float TAU = 6.28318530718;

// The listing's +r, minus the resolution dependence (see the header).
const vec2 SEED = vec2(4.7, 2.3);

// Volume-reactive values, resolved once per fragment in main().
float nacreWarp;
float nacreThick;
float nacreGain;

/*
  The listing's entire tone map: o = tanh(.2 / tan(x)); o *= o.

  The square folds the sign, so abs() on the denominator is not an
  approximation here — it is exact, and it removes the branch.
*/
vec3 cotBands(vec3 x, float k) {
  vec3 b = tanh3(k * cos(x) / max(abs(sin(x)), vec3(1e-4)));
  return b * b;
}

vec3 nacreRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock: the boil

  /*
    Stereographic projection, on the UNROTATED dome. Equal steps in screen
    space map to ever-larger steps in pattern space toward the rim, which
    is the foreshortening that sells a flat field as wrapped geometry.
    uP_bulge softens the divisor — higher flattens the shell back toward a
    disc, lower crowds the layers into the limb.
  */
  vec2 p = n.xy / (n.z + 1.0 + uP_bulge) * uP_scale;

  // projection-safe 2D motion, in place of a dome spin: the plane turns,
  // and the bands travel across themselves
  float sw = uP_swirl; // integrated clock
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p.y -= uP_flow;      // integrated clock

  /*
    The ten-octave feedback warp. q is fed back into itself with the
    components swapped, so each octave curls what the last one drew.
  */
  vec2 q = p;
  for (int j = 0; j < OCTAVES; j++) {
    float i = float(j) + 1.0;
    q += nacreWarp * sin(q.yx * i + i * i + t * i + SEED) / i;
  }

  // the bands, with the listing's uneven per-channel phase kept as a ratio
  // so one slider widens the whole split
  vec3 band = cotBands(vec3(q.y) + vec3(0.0, 1.0, 3.0) * uP_split, nacreThick);
  float lev = dot(band, vec3(1.0 / 3.0));

  /*
    A dark body colour under the bands, so the valleys read as the shell
    itself rather than as holes punched through the ball. The band term
    stays PER-CHANNEL through the palette multiply — that is what carries
    the colour fringing; collapsing it to lev first would throw away the
    only thing the vec4 phase was for.
  */
  vec3 col = uC_deep * uP_floor;
  col += band * mix(uC_low, uC_crest, smoothstep(0.1, 0.9, lev)) * nacreGain;

  /*
    Thin-film interference. The cosine palette is keyed to the band
    coordinate, so every layer carries its own hue — the inside of a shell
    — and uP_view rotates that hue with the viewing angle through 1 - z,
    which means the sphere's curvature is doing the colouring. Multiplied
    in rather than mixed to, so it bends hues without erasing the palette.
  */
  vec3 irid = 0.5 + 0.5 * cos(TAU * (q.y * uP_irisScale + (1.0 - z) * uP_view + t * 0.03 + vec3(0.0, 0.33, 0.67)));
  col = mix(col, col * (0.25 + 1.9 * irid), uP_iris);

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));

  // dome shading keeps the ball a ball under the pattern
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.35 + uP_light * lambert;

  // fresnel sheen: the wet gloss of a shell, and the thing that keeps the
  // limb reading as a surface where the bands have compressed to a blur
  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  /*
    The BEAT: warp driven between 0.6 and 1.8 on a slow, unbroken cycle —
    one full swing every second and a third — with nothing held at either
    end. Warp is the amplitude of the octave loop that folds the bands, so
    sweeping it three to one makes the whole field draw in and open again
    rather than change colour or brightness — a swell, not a flash.

    Absolute bounds, so the range is exactly the range; that is why the mix
    sits outside the volume term below. At beat zero nothing here applies
    and the dialled warp stands, so a state that does not ask for it is
    untouched.

    Well under 3Hz, which matters: above that a full-field oscillation is
    in the band photosensitivity guidance warns about, and this one covers
    the whole ball. The rate is the constant below — raising it much past
    18 walks back into that range.
  */
  float beat = 0.5 - 0.5 * cos(uAnim * 5.0);

  // Volume coupling: the user's voice churns the warp harder, the agent's
  // widens the crests and brightens them.
  nacreWarp = mix(uP_warp * (1.0 + 0.45 * uInput), mix(0.6, 1.8, beat), uP_beat);
  nacreThick = uP_thick * (1.0 + 0.6 * uOutput);
  nacreGain = uP_gain * (0.85 + 0.4 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Nothing outside the silhouette is ever visible, so skip AA * AA warps
  // for it rather than shading transparent sky.
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += nacreRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = nacreRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

const DEFAULTS = { speed: 0.35, flow: 0.25, swirl: 0.06, radius: 0.9, scale: 5.5, bulge: 0.3, warp: 1, beat: 0, thick: 0.2, split: 0.1, iris: 0.7, irisScale: 0.315, view: 1.34, floor: 0.8, gain: 1.1, contrast: 1.15, light: 0.75, rim: 0.5 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_08",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "flow", "swirl"],
  colors: { deep: "#0d1430", low: "#2fb8c6", crest: "#fff1de", sheen: "#bfe4ff" },
  presets: {
    idle: {
      speed: 0.37,
      flow: 0.24,
      swirl: 0.06,
      bulge: 0.8,
      warp: 0.96,
      thick: 0.54,
      split: 0.1,
      iris: 1.02,
      floor: 0.57,
      gain: 2.45,
      contrast: 1.65,
      rim: 0.495,
    },
    recording: {
      speed: 2,
      flow: 2.49,
      swirl: 0.18,
      warp: 1.84,
      beat: 1,
      thick: 0.27,
      split: 0.3,
      iris: 0.45,
      gain: 1.75,
      contrast: 0.78,
    },
    transcribing: {
      speed: 1.61,
      flow: 0.06,
      swirl: 0.015,
      warp: 1.56,
      thick: 0.54,
      split: 0.3,
      iris: 1.89,
      irisScale: 0.26,
      view: 1.21,
      floor: 0.77,
      gain: 0.85,
      contrast: 1.65,
      rim: 0.495,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
