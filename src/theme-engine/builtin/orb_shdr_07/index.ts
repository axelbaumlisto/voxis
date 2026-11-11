// orb_shdr_07 — A twist wave travelling out through the ball, wound around a lit polar column: an exact Rodrigues rotation whose angle is the sample's own radius minus the clock, so every spherical shell is wound by a different amount and the winding travels outward — torsion in the literal sense, twist per unit radius. The density is measured from the twist axis rather than from the centre, so the step collapses along the pole and the axis burns as a spine, and the march colour-codes itself with green by depth and blue by step index
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-07`
// ("SHDR-07") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, wave, spin) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define STEPS 50
#define TURB 9
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float torsionTurb;
float torsionTwist;
float torsionExposure;

// GLSL ES 1.0 has no round() — it arrived in ES 3.0. The listing quantizes
// with it, so it ships here. Halves round up rather than to even, which is
// what a lattice quantizer wants anyway.
vec3 roundv(vec3 x) { return floor(x + 0.5); }

vec3 torsionRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float shimmer = uP_speed; // integrated clock: cell flicker
  float wave = uP_wave;     // integrated clock: the travelling twist
  float spin = uP_spin;     // integrated clock: roll about the axis

  // the axis lean and the roll, applied to the SAMPLE rather than to the
  // axis — see the header
  float ct = cos(uP_tilt);
  float st = sin(uP_tilt);
  float cs = cos(spin);
  float ss = sin(spin);

  // the twist axis, unit by construction, which is what makes the
  // Rodrigues rotation below exact
  vec3 axis = vec3(0.0, 1.0, 0.0);

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — near shells veil far ones
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 world = ro + rd * z;

    // into the axis frame: lean about X, then roll about Y
    vec3 p = vec3(world.x, world.y * ct + world.z * st, -world.y * st + world.z * ct);
    p = vec3(p.x * cs - p.z * ss, p.y, p.x * ss + p.z * cs);

    /*
      The travelling twist. h is the sample's radius (scaled by the twist
      knob) minus the wave clock, and the line below is an exact rotation
      about the axis by 90 degrees - h. Because h depends only on radius,
      the winding is constant on spheres: the ball's own shells are the
      structure, and raising uP_twist puts more turns between the core and
      the surface.
    */
    float h = length(p) * torsionTwist - wave;
    vec3 a = mix(dot(axis, p) * axis, p, sin(h)) + cos(h) * cross(axis, p);

    // cell-quantized turbulence: every lattice cell flickers on its own
    // phase, the same construction shdr-22 uses
    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 1.0;
      a += torsionTurb * sin(roundv(a * dj) - shimmer).zxy / dj;
    }

    /*
      The axial density. At uP_column 0 this is the listing's
      length(a.xz) — distance from the twist axis, so the step collapses
      along the pole and the axis burns as a column. At 1 it is the plain
      radial length and the column dissolves into shells.
    */
    float d = uP_stepScale * mix(length(a.xz), length(a), uP_column);
    d = max(d, uP_envRadius * 0.003);

    /*
      The march's own colour code, from the listing: red constant, green
      by DEPTH into the ball, blue by STEP INDEX — the opposite assignment
      from shdr-22, and the reason this orb runs cyan-blue where that
      one runs red-green. Blue gets twice the clamp headroom: its ramp
      runs to STEPS (50) where red is fixed at 3, and an equal clamp would
      crush the step gradient first.
    */
    vec3 w = vec3(3.0, (z - uP_camDist + uP_envRadius) * uP_hueDepth, float(it) * uP_hueStep) / d;
    w = min(w, vec3(uP_stepClamp) * vec3(1.0, 1.0, 2.0));

    /*
      Normalize the clamped weight back to family units, exactly as in
      shdr-22: without this line the clamp value leaks into total
      energy and Exposure, Body fill and Diffusion all change meaning
      whenever the clamp moves.
    */
    w *= 20.0 / max(uP_stepClamp, 1.0);

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(world));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  torsionTurb = uP_turb * (1.0 + 0.5 * uInput);
  torsionExposure = uP_exposure * (1.0 - 0.35 * uOutput);
  // the ball winds tighter while the agent speaks
  torsionTwist = uP_twist * (1.0 + 0.4 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      acc += torsionRender(gl_FragCoord.xy + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = torsionRender(gl_FragCoord.xy);
#endif

  // tanh tone map per channel — the envelope and transmittance change the
  // accumulator's scale, so the golfed /1e4 knee is a tunable here
  vec3 col = tanh3(acc / max(torsionExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue tail
  // has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  gl_FragColor = vec4(col, a);
}
`;

const DEFAULTS = { speed: 0.5, wave: 0.7, twist: 1, spin: 0.1, tilt: 0.3, camDist: 7, focal: 2.25, turb: 1, column: 0, stepScale: 0.1, hueDepth: 0.75, hueStep: 0.45, envRadius: 2.6, envCore: 0.88, fill: 0.15, stepClamp: 400, scatter: 0.01, exposure: 60, contrast: 1.3, saturation: 1.15, alphaGain: 2, edge: 1, edgeFade: 0.98 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_07",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "wave", "spin"],
  colors: { tint: "#ffffff" },
  presets: {
    idle: {
      speed: 0.5,
      wave: 0.7,
      twist: 1,
      turb: 1,
      column: 0,
      exposure: 60,
      scatter: 0.01,
      alphaGain: 2,
    },
    recording: {
      speed: 0.9,
      wave: 3.2,
      twist: 0.35,
      turb: 0.85,
      column: 0.45,
      exposure: 26,
      scatter: 0.006,
      alphaGain: 2.7,
    },
    transcribing: {
      speed: 1.5,
      wave: 0.15,
      twist: 3.6,
      turb: 1.35,
      column: 0,
      exposure: 88,
      scatter: 0.011,
      alphaGain: 2,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
