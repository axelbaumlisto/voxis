// orb_shdr_03 — A turbulent belt of light girdling the ball, contoured in rainbow along its own distance field: the density is a sphere plus a plane added together, so only their intersection lights up — a great circle dragged out of true by eight octaves of warp. The shell term reads the raw point and the plane term reads the warped one, which is what keeps the ball a clean sphere while the belt writhes across it, and the rotation axis is steered by the previous step's density, so the belt's tilt settles as the ray closes on the surface
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-03`
// ("SHDR-03") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, wander) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define STEPS 80
#define TURB 8
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float eclipticTurb;
float eclipticPlane;
float eclipticExposure;
float eclipticWidth;

vec3 eclipticRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float animTime = uP_speed; // integrated clock: the warp
  float wander = uP_wander;  // integrated clock: the belt's tilt

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — the near belt veils the far one
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  /*
    The listing's feedback variable, explicit. On the first iteration the
    axis below reads this before anything has written it — zero is what the
    golfed version gets, so zero is what it gets here.
  */
  float d = 0.0;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    /*
      The axis, steered by the PREVIOUS step's density: the belt's tilt
      settles as the ray closes on the surface and swings away from it out
      in the open. The three phases are far enough apart that the cosines
      can never null together, so the normalize is safe without a guard.
    */
    vec3 axis = normalize(cos(wander + vec3(4.0, 2.0, 0.0) - d * uP_feedback));

    // the exact minus-90-degree rotation about that axis
    vec3 a = dot(axis, p) * axis - cross(axis, p);

    // eight octaves of plain feedback warp — no lattice quantizer here,
    // unlike its cousins shdr-22 and shdr-04
    for (int j = 0; j < TURB; j++) {
      float f = float(j) + 2.0;
      a += eclipticTurb * sin(a * f + animTime).yzx / f;
    }

    /*
      Sphere plus plane. The shell reads the RAW point so the ball stays a
      ball; the plane reads the WARPED one so the belt writhes across it.
      uP_plane at zero drops the belt and lights the whole shell, which is
      worth being able to see once.
    */
    d = uP_shellW * abs(length(p) - uP_shellR) + eclipticPlane * abs(a.y);
    d = max(d, eclipticWidth);

    /*
      Hue from the DENSITY — the belt contoured in rainbow along its own
      distance field — and the listing's z in the numerator, which burns
      the far limb hotter than the near one.
    */
    vec3 w = cos(d * uP_hue + vec3(0.0, 2.0, 4.0) * uP_spread) + 1.0;
    w *= z / d;
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
  /*
    The SURGE: tightness and warp swept together on one phase, so the belt
    gathers into a hard warped girdle and then opens back into a smooth
    shell. Two params, one gesture — swept apart they read as two unrelated
    things happening at once.

    Absolute bounds rather than a swing around what was dialled, so the range
    is exactly the range: tightness 0.1 to 0.3, warp 0.5 to 1.6. That is why
    the mix sits OUTSIDE the volume terms below — folding the surge under
    them would shave the top of both ranges by whatever the agent happened to
    be doing. At surge zero those terms are all that is left, so a state that
    does not ask for this is untouched.
  */
  float surge = 0.5 - 0.5 * cos(uAnim * 4.0);

  eclipticTurb = mix(uP_turb * (1.0 + 0.4 * uInput), mix(0.5, 1.6, surge), uP_surge);
  // the belt broadens toward a full shell while the agent speaks
  eclipticPlane = mix(uP_plane * (1.0 - 0.35 * uOutput), mix(0.1, 0.3, surge), uP_surge);
  eclipticExposure = uP_exposure * (1.0 - 0.3 * uOutput);

  /*
    The belt BREATHES. At pulse zero the width is exactly what was dialled,
    so a state that does not ask for this is untouched; at one it sweeps the
    whole way from nothing to that width and back, once every few seconds.

    It cannot truly reach zero. Belt width is the march's step floor — see
    the port note above — and a zero step stalls the ray on one point, which
    with no scatter to close the transmittance accumulates the clamp eighty
    times into a white flare. The floor is the param's own minimum, four
    times finer than what the resting belt uses, so it reads as gone.

    Off uAnim rather than a raw clock, so the breath quickens with the agent
    like every other motion in the engine.
  */
  eclipticWidth = max(uP_width * (1.0 - uP_pulse * (0.5 + 0.5 * cos(uAnim * 3.0))), 5e-4);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      acc += eclipticRender(gl_FragCoord.xy + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = eclipticRender(gl_FragCoord.xy);
#endif

  // tanh tone map per channel — the envelope and transmittance change the
  // accumulator's scale, so the golfed /1e4 knee is a tunable here
  vec3 col = tanh3(acc / max(eclipticExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue contour
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

const DEFAULTS = { speed: 0.6, wander: 0.3, feedback: 1.5, camDist: 5, focal: 1.05, shellR: 3, shellW: 0.12, plane: 0.15, turb: 0.55, width: 0.004, pulse: 0, surge: 0, hue: 25, spread: 1, envRadius: 3.3, envCore: 0.92, fill: 0.1, stepClamp: 1500, scatter: 0.0006, exposure: 1500, contrast: 1.2, saturation: 1.25, alphaGain: 2, edge: 1, edgeFade: 0.98 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_03",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "wander"],
  colors: { tint: "#ffffff" },
  presets: {
    idle: {
      speed: 0.6,
      wander: 0.3,
      feedback: 2,
      shellR: 2,
      shellW: 0.085,
      plane: 0.085,
      turb: 1.54,
      width: 0.001,
      hue: 39.8,
      spread: 0.94,
      envCore: 1.02,
      stepClamp: 1475,
      exposure: 1450,
      scatter: 0.0006,
      alphaGain: 2,
    },
    recording: {
      speed: 0.9,
      wander: 0.84,
      feedback: 0.3,
      shellR: 1.8,
      shellW: 0.19,
      plane: 0.1,
      turb: 0.14,
      width: 0.018,
      surge: 1,
      spread: 1.04,
      envRadius: 3.4,
      exposure: 650,
      scatter: 0.0003,
      alphaGain: 2.7,
    },
    transcribing: {
      speed: 2,
      wander: 1.1,
      feedback: 7.5,
      focal: 1.9,
      shellR: 1.9,
      shellW: 0.005,
      plane: 0.345,
      turb: 0.7,
      width: 0.048,
      pulse: 1,
      hue: 28.3,
      spread: 1.02,
      envRadius: 7.4,
      envCore: 0.84,
      exposure: 2300,
      scatter: 0,
      alphaGain: 2,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
