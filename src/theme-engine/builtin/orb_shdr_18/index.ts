// orb_shdr_18 — A crystal folded out of one eighth of space, tumbling: an absolute value on the sample reflects all eight octants together and a component-wise max against its own rolled swizzle creases the diagonals, so the field carries the full symmetry of an octahedron without a single mirror plane being written down. Both folds happen after an exact minus-90-degree Rodrigues rotation about an axis that wanders on the clock, so the mirror planes are carried around with it and the crystal genuinely tumbles rather than being a static mandala with a moving texture. Depth along the ray paints the hue
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-18`
// ("SHDR-18") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (wander) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define STEPS 50
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float octantFold;
float octantFreq;
float octantExposure;

vec3 octantRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float wander = uP_wander; // integrated clock: the axis, and with it the
                            // mirror planes, tumble

  /*
    The wandering axis. Unit by construction, which is what makes the
    rotation below an exact one — and the three phases are far enough
    apart that the cosines can never null together, so the normalize is
    safe without a guard.
  */
  vec3 axis = normalize(cos(wander + vec3(0.0, 2.0, 4.0)));

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — near cells veil far ones
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    // the exact minus-90-degree rotation about the wandering axis
    vec3 a = dot(axis, p) * axis - cross(axis, p);

    /*
      The two folds, both blendable. uP_fold reflects the octants together
      and uP_crease creases the diagonals; at zero the crystal dissolves
      back into an ordinary periodic field, which is worth being able to
      see, because the symmetry is doing more work here than the field is.
    */
    a = mix(a, abs(a), octantFold);
    a = mix(a, max(a, a.yzx), uP_crease);

    // step and density in one quantity, as in the listing
    float d = uP_stepScale * length(cos(a * octantFreq));
    d = max(d, uP_envRadius * 0.004);

    /*
      Depth as hue, near as bright.

      The hue is keyed to depth measured from where the envelope BEGINS,
      not from the camera. The listing marches from the lens out to twenty
      units and cycles its ramp several times over that; bounded to the
      ball, the same .2 slope covers barely a quarter turn of the wheel —
      and the quarter it covers has both green and blue sitting at the
      bottom of their cosines, so the first build of this orb came out a
      flat dark red. Anchored to the ball, the ramp spans it, and moving
      the camera no longer repaints the crystal.

      No step-length weighting here, unlike orb-nova and against the
      README's usual rule — because 1/d IS this shader's density, not an
      artefact of sphere tracing. Multiply it by the step and the two
      cancel exactly, leaving a flat sum with every trace of the cell walls
      gone. The clamp does the job the step weight would have, which is
      also what shdr-22 does with the same construction.
    */
    float zRel = z - (uP_camDist - uP_envRadius);
    vec3 w = cos(uP_hue * zRel + vec3(0.0, 2.0, 3.0) * uP_spread) + 1.0;
    w /= d * max(z, 0.05);
    w = min(w, vec3(uP_stepClamp));

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  octantFold = clamp(uP_fold * (1.0 + 0.3 * uInput), 0.0, 1.0);
  octantFreq = uP_freq * (1.0 + 0.25 * uInput);
  octantExposure = uP_exposure * (1.0 - 0.35 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      acc += octantRender(gl_FragCoord.xy + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = octantRender(gl_FragCoord.xy);
#endif

  // tanh tone map per channel — the envelope and transmittance change the
  // accumulator's scale, so the golfed /1e2 knee is a tunable here
  vec3 col = tanh3(acc / max(octantExposure, 0.01));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue cell
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

const DEFAULTS = { wander: 0.5, camDist: 4, focal: 1.5, fold: 1, crease: 1, freq: 5, stepScale: 0.3, hue: 1.5, spread: 1, envRadius: 2.1, envCore: 0.9, fill: 0.02, stepClamp: 40, scatter: 0.004, exposure: 18, contrast: 1.2, saturation: 1.25, alphaGain: 2, edge: 1, edgeFade: 0.98 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_18",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["wander"],
  colors: { tint: "#ffffff" },
  presets: {
    idle: {
      wander: 0.5,
      fold: 1,
      crease: 1,
      freq: 5,
      exposure: 18,
      scatter: 0.004,
      alphaGain: 2,
    },
    recording: {
      wander: 0.7,
      fold: 1,
      crease: 1,
      freq: 6.05,
      stepScale: 0.51,
      hue: 2,
      envCore: 0.49,
      exposure: 8,
      scatter: 0.002,
      saturation: 2,
      alphaGain: 2.7,
    },
    transcribing: {
      wander: 1.08,
      focal: 2.7,
      fold: 0.91,
      crease: 1,
      freq: 4.1,
      stepClamp: 1200,
      scatter: 0.02,
      exposure: 26,
      alphaGain: 2,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
