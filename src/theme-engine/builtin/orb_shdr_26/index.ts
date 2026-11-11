// orb_shdr_26 — A crazed web of coloured threads knotted to a cell grid: a nine-octave feedback warp carrying a lattice pole term, so the field flows through cell interiors and tears itself around every cell corner, banded by an exponential ridge function that draws a thin bright thread every PI over a lit floor. The per-channel phase is a large fraction of a thread that narrow, so each one separates into three coloured filaments running in parallel, and a fourth-power read of the same ridge lays a white-hot core inside them
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-26`
// ("SHDR-26") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, swirl, drift) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define OCTAVES 9
#define AA 3

const float TAU = 6.28318530718;

// Volume-reactive values, resolved once per fragment in main().
float latticePole;
float latticeSharp;
float latticeGain;

vec3 latticeRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock

  /*
    Stereographic projection of the UNROTATED dome.

    This orb was built on the abs(sp.z) form first — the one shdr-28
    and shdr-29 use, which survives a 3D roll because the divisor can
    only fall TO zero at the terminator, never through it. It renders, but
    every quarter turn it makes the visible hemisphere an EXACT mirror
    image about the view axis: at a roll of 90 degrees sp becomes
    (-n.z, n.y, n.x), so the projected coordinate depends on n.z and on
    abs(n.x), and both of those are even in screen x. A cellular grid
    hides that. A web of long threads does not — the ball turns into a
    Rorschach blot for a quarter of every revolution.

    So the dome stays put, as in shdr-08, and all the motion below is
    projection-safe 2D.
  */
  vec2 p = n.xy / (n.z + 1.0 + uP_bulge) * uP_scale;

  // the plane turns while the lattice drifts across it, so the crazing
  // migrates over the glaze instead of sitting welded to it
  float sw = uP_swirl; // integrated clock
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p.x += uP_drift;     // integrated clock

  /*
    A fractional offset off the pattern origin. The listing carries the
    resolution here; it cancels out of the pole term exactly (see the
    header) but it does keep the lattice off centre, and without something
    in its place a cell corner sits pinned at the dead middle of the ball.
  */
  p += vec2(0.37, 0.21);

  // the cell the sample starts in, fixed before the warp — everything the
  // pole term does is relative to THIS corner, not to wherever c wanders
  vec2 cell = floor(p);

  /*
    Each cell knots on its own hashed phase, so the grid breathes instead
    of pulsing as one sheet. The rate is a constant, not a slider: this
    multiplies the integrated clock, and a slider there would jump the
    phase of every cell on a state change.
  */
  float breathe = 1.0 + uP_pulse * sin(TAU * hash(cell) + t * 0.35);

  vec2 c = p;
  for (int j = 0; j < OCTAVES; j++) {
    float i = float(j) + 1.0;

    /*
      The lattice pole, softened. d/(d*d+g) tracks 1/d away from the cell
      corner and rolls over to a finite peak at it, so the phase stays
      band-limited and the knot has a SIZE — uP_poleSoft is that size, and
      it is the difference between crisp cell knots and a corner full of
      aliased noise.
    */
    vec2 d = cell - c;
    vec2 pole = latticePole * breathe * d / (d * d + vec2(uP_poleSoft));

    c += uP_warp * cos(i * c.yx + pole + t) / i;
  }

  /*
    The listing's tone map: a thin ridge every PI with an exponential
    falloff. The per-channel offsets are kept as their original ratio
    (0, 2, 1) so one slider widens the whole split, and against a ridge
    this thin they separate the thread into three coloured filaments.
  */
  vec3 x = vec3(c.y) + vec3(0.0, 2.0, 1.0) * uP_split;
  vec3 thread = exp(-latticeSharp * abs(sin(x)));

  float lev = dot(thread, vec3(1.0 / 3.0));

  /*
    The exp() floor never reaches zero, so the shell is lit between the
    threads by construction — the body colour is added under it rather
    than filling a hole. The thread term stays PER-CHANNEL through the
    palette multiply; collapsing it to lev first would throw away the
    filament split, which is the only thing the vec4 phase was for.
  */
  vec3 col = uC_deep * uP_floor;
  /*
    The ramp between the two thread colours runs nearly the whole range of
    lev deliberately. Started at 0.35 it reached uC_hot — which is near-white in
    every state — across most of the visible web, and the state palettes,
    which ride on uC_line, never got to the eye at all.

    The other half of that fix is in the presets: the chromatic split makes
    the three channels independent, so at a wide split THREAD sets the hue
    and no palette can. It is staged with the rest — widest while
    searching, nearly closed while answering, which is when the warm
    palette has to carry.
  */
  col += thread * mix(uC_line, uC_hot, smoothstep(0.12, 1.0, lev)) * latticeGain;

  /*
    A tight second read of the same ridge, added on top: raising a value
    that is already exp(-k*|sin|) to a high power is the same ridge at a
    fraction of the width, which lands as a hot core inside each thread.
    Taken from lev — the MEAN of the three channels — deliberately, so the
    core is achromatic and lands only where all three filaments coincide.
    Read per-channel it would just be a fourth colour-separated ridge, and
    the web would stay a scatter of green and magenta flecks instead of
    resolving into white threads with coloured shoulders. Squared twice
    rather than pow() — pow is undefined for a negative base and this is
    cheaper anyway (see the README).
  */
  float core = lev * lev;
  core = core * core;
  col += uC_hot * core * uP_core;

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));

  // dome shading keeps the ball a ball under the web
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.35 + uP_light * lambert;

  // fresnel sheen: the glaze the threads are crazed into, and the thing
  // that keeps the limb reading as a surface where the cells have
  // compressed past resolving
  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice tightens the knots, the agent's
  // thickens the threads and brightens them.
  latticePole = uP_pole * (1.0 + 0.8 * uInput);
  latticeSharp = uP_sharp * (1.0 - 0.25 * uOutput);
  latticeGain = uP_gain * (0.85 + 0.4 * uOutput);

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
      col += latticeRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = latticeRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

const DEFAULTS = { speed: 0.4, swirl: 0.07, drift: 0.18, radius: 0.9, scale: 9, bulge: 0.25, warp: 0.85, pole: 0.25, poleSoft: 0.012, pulse: 0.35, sharp: 4.5, split: 0.045, core: 0.45, floor: 0.9, gain: 1, contrast: 1.35, light: 0.7, rim: 0.45 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_26",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "swirl", "drift"],
  colors: { deep: "#111a2e", line: "#3fd2ff", hot: "#fff4d6", sheen: "#a9d8ff" },
  presets: {
    recording: {
      speed: 6.45,
      swirl: 0.555,
      drift: 1.74,
      scale: 11,
      bulge: 0.78,
      warp: 0.76,
      pole: 0.195,
      poleSoft: 0.001,
      pulse: 1.39,
      sharp: 2.1,
      split: 0.045,
      core: 1.08,
      floor: 0.48,
      gain: 1.3,
      contrast: 1.95,
    },
    transcribing: {
      speed: 1,
      swirl: 0.3,
      drift: 0.51,
      pole: 0.18,
      pulse: 0.22,
      sharp: 3.6,
      split: 0.03,
      floor: 0.28,
      contrast: 1.6,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
