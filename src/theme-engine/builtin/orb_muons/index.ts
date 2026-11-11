// orb_muons — An iridescent particle-track web worn as the ball's skin: ten micro-layers anchored analytically to the sphere's entry point, a minus-90-degree Rodrigues rotation whose axis jitters per layer through field-magnitude feedback, and a march that sticks on concentric field shells where 1/d blows up into bright threads
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-15`
// ("Muons") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, wander) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define STEPS 10
#define TURB 8
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float muonsTurb;
float muonsExposure;

vec3 muonsRender(vec2 fragCoord) {
  float animTime = uP_speed; // integrated clock: weave + hue phase
  float wander = uP_wander;  // integrated clock: axis drift

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  /*
    Anchor the micro-slab to the ball: intersect the ray with the shell
    analytically and start the ten steps AT the entry point, so the slab
    hugs the sphere's curve. Rays that miss fall back to their closest
    approach — the envelope and silhouette cut them anyway.
  */
  float proj = dot(-ro, rd);
  float b2 = dot(ro, ro) - proj * proj;
  float R = uP_envRadius * 0.96;
  float entry = proj - sqrt(max(R * R - b2, 0.0));

  vec3 acc = vec3(0.0);
  float T = 1.0;
  float z = entry;
  float s = 0.0;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    // shell points scaled into field space — the original worked around
    // magnitude 9, and the ring density rides on that magnitude
    vec3 q = p * uP_fieldScale;

    // the per-layer axis, with the original's s feedback — each of the
    // ten layers takes a differently jittered axis
    vec3 axis = normalize(cos(vec3(7.0, 1.0, 0.0) + wander - s));

    // the minus-90-degree Rodrigues twin of shdr-22
    vec3 a = axis * dot(axis, q) - cross(axis, q);

    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 2.0;
      a += muonsTurb * sin(a * dj + animTime).yzx / dj;
    }

    // the shells: the march sticks where the field magnitude sits on a
    // multiple of pi, and 1/d blows up — that is the web
    s = length(a);
    float d = uP_stepScale * abs(sin(s));
    d = max(d, 1e-5);
    z += d;

    /*
      Layer-cycled palette, with the depth measured from the ENTRY point
      so the banding follows the ball's skin. Clamp then normalize to
      family units, as in shdr-22 — the raw spikes run to 1/1e-5.
    */
    vec3 w = (cos((z - entry) / max(uP_stepScale, 1e-3) + animTime + vec3(0.0, 2.0, 3.0) * uP_disperse) + 1.0)
      / d / max(s, 0.5);
    w = min(w, vec3(uP_stepClamp));
    w *= 20.0 / max(uP_stepClamp, 1.0);

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    if (T < 0.004) break;
  }

  return acc;
}

void main() {
  muonsTurb = uP_turb * (1.0 + 0.5 * uInput);
  muonsExposure = uP_exposure * (1.0 - 0.35 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += muonsRender(gl_FragCoord.xy + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = muonsRender(gl_FragCoord.xy);
#endif

  // tanh tone map per channel — the golfed /3e3 knee is a tunable here
  vec3 col = tanh3(acc / max(muonsExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a saturated violet
  // thread has low luminance but must not go transparent
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

const DEFAULTS = { speed: 0.5, wander: 0.15, camDist: 7, focal: 2.25, fieldScale: 2.4, turb: 0.8, stepScale: 0.015, disperse: 1, envRadius: 2.6, envCore: 1, fill: 0.3, stepClamp: 150, scatter: 0.01, exposure: 50, contrast: 1.35, saturation: 1.35, alphaGain: 2, edge: 1, edgeFade: 0.98 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_muons",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "wander"],
  colors: { tint: "#ffffff" },
  presets: {
    idle: {
      speed: 0.4,
      wander: 0.12,
      turb: 0.75,
      disperse: 1,
      exposure: 72,
      scatter: 0.01,
      alphaGain: 2,
    },
    recording: {
      speed: 2,
      wander: 0.3,
      turb: 1.1,
      disperse: 1.6,
      exposure: 46,
      scatter: 0.0075,
      alphaGain: 2.5,
    },
    transcribing: {
      speed: 1,
      wander: 0.7,
      turb: 0.95,
      disperse: 0.8,
      exposure: 66,
      scatter: 0.0095,
      alphaGain: 2.1,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
