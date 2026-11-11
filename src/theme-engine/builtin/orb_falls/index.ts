// orb_falls — A water film rushing down the ball, fountain-style: vertically squashed cos-octave turbulence scrolls at nine times the clock for the fall rush, a foam blend keeps only a third of the displacement, and the original's sigmoid cliff face is swapped for the sphere's own shell with a traveling ripple
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-20`
// ("Falls") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, flow) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define STEPS 50
#define TURB 5
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float fallsFoam;
float fallsExposure;

mat2 fallsRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 fallsRender(vec2 fragCoord) {
  float animTime = uP_speed; // integrated clock: ripple phase
  float flow = uP_flow;      // integrated clock: the 9t rush, tunable

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float rShell = uP_envRadius * 0.92;

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — near foam veils far foam
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 c = ro + rd * z;

    // a slight static tilt of the flow axis
    c.yz = fallsRot(uP_tilt) * c.yz;

    /*
      The fall grain: squash the vertical axis, then the five octaves with
      the rush phase on the first component — cos(p.yzx*f + ...) writes
      that component to x, so height and time drive the sideways waves,
      exactly the original's x*t construction.
    */
    vec3 p = c;
    p.y *= uP_stretch;
    for (int j = 0; j < TURB; j++) {
      float fj = float(j) + 1.3;
      p += cos(p.yzx * fj + float(it) + z + vec3(flow, 0.0, 0.0)) / fj;
    }

    // the foam blend — most of the displacement is thrown away, leaving a
    // film of detail over a coherent surface
    vec3 pm = mix(c, p, fallsFoam);

    /*
      The surface, swapped from the sigmoid cliff to the ball's own shell:
      distance to the sphere (sharpened by uP_wall) plus the original's
      traveling ripple. f can still reach zero exactly — the guard feeds
      both the division and the march step.
    */
    float f = uP_stepScale * (abs(length(pm) - rShell) * uP_wall
      + sin(pm.x - pm.z + animTime * 2.0) + 1.0);
    f = max(f, 1e-3);
    z += f;

    /*
      Vertical hue sheets from the listing, bright where the march grazes
      the film. The CLAMP is load-bearing, as in every accumulator here —
      one f-null step would own the whole 50-step sum.
    */
    vec3 w = (cos(pm.x * uP_hueScale + f + vec3(6.0, 1.0, 2.0)) + 2.0) / f / max(z, 1.0);
    w = min(w, vec3(uP_stepClamp));

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(ro + rd * z));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  fallsFoam = uP_foam * (1.0 + 0.5 * uInput);
  fallsExposure = uP_exposure * (1.0 - 0.35 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += fallsRender(gl_FragCoord.xy + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = fallsRender(gl_FragCoord.xy);
#endif

  // tanh tone map per channel — the golfed /3e1 knee is a tunable here
  vec3 col = tanh3(acc / max(fallsExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue sheet
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

const DEFAULTS = { speed: 0.5, flow: 3, camDist: 7, focal: 2.25, tilt: 0.15, stretch: 0.3, foam: 0.3, wall: 3, stepScale: 0.2, hueScale: 0.85, envRadius: 2.6, envCore: 1, fill: 0.4, stepClamp: 20, scatter: 0.01, exposure: 22, contrast: 1.15, saturation: 1.55, alphaGain: 2, edge: 1, edgeFade: 0.98 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_falls",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "flow"],
  colors: { tint: "#ffffff" },
  presets: {
    idle: {
      speed: 0.5,
      flow: 3,
      foam: 0.3,
      exposure: 22,
      scatter: 0.01,
      alphaGain: 2,
    },
    recording: {
      speed: 1,
      flow: 5.5,
      foam: 0.45,
      exposure: 16,
      scatter: 0.0075,
      alphaGain: 2.5,
    },
    transcribing: {
      speed: 0.6,
      flow: 3.3,
      foam: 0.33,
      exposure: 21,
      scatter: 0.0095,
      alphaGain: 2.1,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
