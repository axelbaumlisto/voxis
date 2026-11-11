// orb_bitdumb — Nested binary grids shuttering on a tumbling bit-sphere: a twenty-level power-of-two zoom wrapped onto the ball through a stereographic projection, cell edges drawn with an analytic pixel footprint instead of fwidth, and an animated per-cell shutter that lets each grid level occlude the ones beneath
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-28`
// ("Bitdumb") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, spin) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define LEVELS 20

// Volume-reactive values, resolved once per fragment in main().
float bitdumbGain;
float bitdumbBody;

mat2 bdRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  bitdumbGain = uP_gain * (1.0 + 0.6 * uInput);
  bitdumbBody = uP_body * (1.0 + 0.8 * uOutput);

  vec2 uv = orbUV() / uP_radius;
  float r2 = dot(uv, uv);

  // analytic disc silhouette — this orb is parameterised on the dome, so
  // the exact edge is just the unit circle, with the same tunable band as
  // the raymarched orbs
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(1.0 - band, 1.005, length(uv));

  // front dome point and its normal (view space)
  float zc = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, zc);

  // tumble the sphere point with real rotations, then project. abs() on z
  // mirror-wraps the hemisphere the tumble turns away, avoiding the
  // stereographic pole blow-up.
  vec3 sp = n;
  sp.yz = bdRot(uP_tilt) * sp.yz;
  sp.xz = bdRot(uP_spin) * sp.xz; // integrated clock
  vec2 p = sp.xy / (abs(sp.z) + 1.0) * uP_gridScale;

  /*
    Analytic pixel footprint in grid space, in place of fwidth(): one
    screen pixel in uv units, through the radius scale, the dome stretch
    (grids compress toward the rim, so a pixel covers more of them there),
    and the grid scale. Doubled alongside p every level.
  */
  float px = (2.0 / min(uRes.x, uRes.y)) / uP_radius / max(zc, 0.2) * uP_gridScale;

  vec4 acc = vec4(0.0);
  float phase = uP_speed * 0.2; // integrated clock, additive phase

  for (int i = 0; i < LEVELS; i++) {
    float fi = float(i) + 1.0;
    if (fi > uP_levels) break;

    // the listing's engine, kept verbatim: binary zoom
    p += p;
    px += px;

    vec2 v = ceil(p);
    vec2 f = fract(p);

    // distance to the nearest cell line, against this level's footprint —
    // the extension-free fwidth. Deep levels saturate to solid planes,
    // exactly like the original's aliasing.
    vec2 e2 = 1.0 - smoothstep(vec2(0.0), vec2(px * uP_lineW), min(f, 1.0 - f));

    // x-lines and y-lines separately tintable — the original's .xyy
    vec3 edgeCol = uC_lineA * e2.x + uC_lineB * e2.y;

    // the per-cell shutter value, and the under-compositing that makes
    // level i occlude level i+1 — both straight from the listing
    float aBit = fract(length(v) / fi - phase) * uP_shutter;
    acc += vec4(edgeCol, aBit) * (1.0 - acc.a);

    if (acc.a > 0.996) break;
  }

  vec3 col = acc.rgb * bitdumbGain;

  // the ball body: a lambert-shaded base under the lattice, so the orb
  // reads as a solid object rather than lines floating on nothing
  vec3 L = normalize(vec3(-0.4, 0.5, 0.75));
  float shade = 0.25 + 0.75 * clamp(dot(n, L), 0.0, 1.0);
  col += uC_base * shade * bitdumbBody;

  // fresnel rim to sell the sphere
  col += uC_rim * pow(1.0 - zc, uP_rimPow) * uP_rim;

  col = pow(max(col, 0.0), vec3(uP_contrast));

  // coverage alpha; safety taper fades colour AND alpha, as always
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, length(orbUV()));
  float a = mask * fade;

  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply —
  // the opposite of the emissive orbs (see the note in shdr-31).
  gl_FragColor = vec4(col * a, a);
}
`;

const DEFAULTS = { speed: 0.5, spin: 0.15, tilt: 0.5, radius: 0.9, gridScale: 2, levels: 12, lineW: 2, shutter: 1, gain: 1, body: 1, rim: 0.6, rimPow: 3, contrast: 1, edge: 1, edgeFade: 0.98 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_bitdumb",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { lineA: "#ff5a4d", lineB: "#59d8ff", base: "#101528", rim: "#bcd8ff" },
  presets: {
    idle: {
      speed: 1,
      spin: 0.1,
      levels: 10,
      lineW: 2.5,
      shutter: 1.02,
      gain: 1,
      body: 0.9,
      rim: 0.6,
      rimPow: 5.2,
      contrast: 1.2,
    },
    recording: {
      speed: 3,
      spin: 1.1,
      gridScale: 10.3,
      levels: 17,
      shutter: 1.2,
      gain: 0.95,
      body: 0.27,
      rim: 1.53,
      rimPow: 10,
      contrast: 1.45,
    },
    transcribing: {
      speed: 2.4,
      spin: 0.81,
      lineW: 2.9,
      shutter: 0.94,
      gain: 1.2,
      body: 0.85,
      rim: 0.7,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
