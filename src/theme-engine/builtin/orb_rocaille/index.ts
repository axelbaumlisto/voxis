// orb_rocaille — Ornate scrollwork wrapped onto a sphere: ten colour layers, each folded by a nine-step feedback warp, sampled through a stereographic projection of the orb's dome so the filigree compresses toward the rim
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-02`
// ("Rocaille") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define LAYERS 10
#define WARP 9

void main() {
  vec2 uv = orbUV();
  float R = uP_radius + uP_swell * uInput;
  float r2d = length(uv);
  float mask = smoothstep(0.012, -0.012, r2d - R);
  float nr = clamp(r2d / max(R, 0.001), 0.0, 1.0);
  float z = sqrt(max(1.0 - nr * nr, 0.0));

  float animTime = uP_speed; // integrated clock

  vec3 sp = vec3(uv / max(R, 0.001), z);

  /*
    Stereographic projection: sphere → plane. Equal steps in screen space map to
    ever-larger steps in pattern space as the rim is approached, which is exactly
    the foreshortening that sells a flat field as wrapped geometry. uP_bulge
    softens the divisor — higher flattens it back toward a disc.

    DO NOT rotate sp in 3D before this. Spinning the dome about Y mixes sp.x
    into sp.z, so near the rim the divisor collapses toward zero, p explodes,
    length(v) goes huge, and 1/length(v) leaves most of the sphere black. That
    is what hollowed the orb out. The projection needs sp.z to stay the
    view-facing component.

    Motion comes from animTime inside the warp below instead, which changes the
    scrollwork without ever touching the projection. If you want the pattern to
    travel, rotate or translate p here in 2D — that is projection-safe.
  */
  vec2 p = sp.xy / (sp.z + 1.0 + uP_bulge) * uP_zoom;

  // projection-safe 2D drift, in place of a dome spin
  float sw = animTime * uP_swirl;
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;

  // input volume tightens the warp; output volume brightens the layers
  float warpFreq = uP_warpFreq * (1.0 + 0.35 * uInput);
  float gain = uP_gain * (0.75 + 0.7 * uOutput);

  vec4 acc = vec4(0.0);
  for (int i = 1; i <= LAYERS; i++) {
    float fi = float(i);
    vec2 v = p;
    for (int j = 1; j <= WARP; j++) {
      float f = float(j);
      v += sin(v.yx * f * warpFreq + fi + animTime) / f;
    }
    // uP_coreClamp guards the divide and doubles as the flare size — the
    // original has no guard and relies on length(v) never hitting zero.
    //
    // uP_falloff is the FILL control. The original's plain 1/length(v) decays
    // fast, so only the knots where the warp lands near the origin light up and
    // the rest of the sphere stays near black. An exponent below 1 flattens the
    // tail — at length(v)=10 a 0.6 power is ~4x brighter than 1/x — which lifts
    // the filigree between the knots without blowing the knots themselves out.
    float rad = pow(max(length(v), uP_coreClamp), uP_falloff);
    acc += (cos(fi + vec4(0.0, 1.0, 2.0, 3.0) + uP_hueShift) + 1.0) / 6.0 / rad;
  }

  // the original squares before tone-mapping, which is what crushes the dim
  // filigree and leaves the bright scrollwork
  vec3 col = tanh3(acc.rgb * acc.rgb * gain);

  // rim light, so the silhouette reads as a ball rather than a cut-out
  float fresnel = pow(1.0 - z, uP_rimPow);
  col += vec3(fresnel) * uP_rim;

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float visibility = clamp(lum * uP_alphaGain + uP_baseVis + fresnel * 0.25, 0.0, 1.0);

  // Surface-lit and mask-bounded, so alpha is coverage: premultiply normally.
  // (Unlike Corona and Nimbus, which are emissive and must not be.)
  float a = mask * visibility;
  gl_FragColor = vec4(col * a, a);
}
`;

const DEFAULTS = { speed: 0.5, swirl: 0.06, radius: 0.9, swell: 0.06, zoom: 4.4, bulge: 0.35, warpFreq: 1.5, hueShift: 0, coreClamp: 0.12, falloff: 1, gain: 0.55, rim: 0.12, rimPow: 2.2, alphaGain: 2.4, baseVis: 0.08 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_rocaille",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed"],
  colors: {  },
  presets: {
    idle: {
      speed: 0.5,
      zoom: 4.4,
      warpFreq: 1.5,
      coreClamp: 0.12,
      falloff: 1,
      gain: 0.55,
      rim: 0.12,
      alphaGain: 2.4,
    },
    recording: {
      speed: 3,
      zoom: 4.4,
      warpFreq: 1.2,
      coreClamp: 0.07,
      falloff: 1.1,
      gain: 0.85,
      rim: 0.2,
      alphaGain: 3,
    },
    transcribing: {
      speed: 0.65,
      zoom: 4.6,
      warpFreq: 1.6,
      coreClamp: 0.11,
      falloff: 0.96,
      gain: 0.6,
      rim: 0.13,
      alphaGain: 2.5,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
