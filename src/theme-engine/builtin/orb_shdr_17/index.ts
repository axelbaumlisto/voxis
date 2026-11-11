// orb_shdr_17 — A grainy, many-coloured storm raging on the ball: two-level domain-warped fbm on a stereographic wrap of a rotating dome, jovian band shear flowing latitude rings past each other, a four-stop palette with an iridescent cosine rainbow multiplied over it, hashed lightning strikes that strobe while the agent speaks, and two taps of animated white noise — one dithering the gradient into speckle, one as plain film grain
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-17`
// ("SHDR-17") — MIT.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, spin) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
const float PI = 3.14159265359;

// Animated white noise, one tap per grain cell per grain frame. The seed
// decorrelates the two taps so field grain and film grain never line up.
float grainNoise(vec2 gpix, float frame, float seed) {
  return hash(gpix + vec2(frame * 13.71 + seed, frame * 7.37 - seed));
}

void main() {
  // Volume coupling: user input churns the warp harder, agent output
  // brightens the field — the lightning gate opens separately below.
  float warpNow = uP_warp * (1.0 + 0.55 * uInput);
  float gainNow = uP_gain * (0.85 + 0.45 * uOutput);

  vec2 uv = orbUV();
  float rd = length(uv);
  float R = uP_radius;
  float mask = smoothstep(0.012, -0.012, rd - R);

  // The storm below costs five fbm evaluations per fragment — skip all of it
  // outside the silhouette instead of computing weather for transparent sky.
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 pl = uv / R;
  float r2 = dot(pl, pl);
  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(pl, z);

  // roll the dome about Y on its own integrated clock
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);

  float t = uP_speed; // integrated clock

  // stereographic wrap: the weather travels around the ball and compresses
  // toward the limb instead of sliding across a flat disc
  vec2 st = sp.xy / (1.3 + sp.z) * uP_scale;

  /*
    Jovian band flow: a uniform stream plus a BOUNDED traveling wave of
    shear, so latitude rings appear to slip past each other. The obvious
    construction — t * sin(latitude) — accumulates the differential forever
    and rakes the field into hairline streaks within seconds of the random
    mount phase; the wave form keeps the shear amplitude fixed while its
    phase travels. sp.y is untouched by the Y-roll, so the bands hold
    horizontal while the dome turns underneath them.
  */
  st.x -= t * 0.3;
  st.x += uP_shear * sin(sp.y * uP_bands - t * 0.45);

  // two-level domain warp, the storm-cloud construction: q says where to
  // look, w says where q said to look, the field reads there
  vec2 q = vec2(
    fbm(st + vec2(0.0, t * 0.35)),
    fbm(st + vec2(5.2, 1.3) - vec2(t * 0.28, 0.0))
  );
  vec2 w = vec2(
    fbm(st + warpNow * q + vec2(1.7, 9.2) + vec2(t * 0.12, 0.0)),
    fbm(st + warpNow * q + vec2(8.3, 2.8) - vec2(0.0, t * 0.1))
  );
  float f = fbm(st + uP_churn * w);

  /*
    Grain tap 1: speckle folded into the FIELD itself, before the gradient,
    so the colour stops below dither into grain instead of smooth bands.
    Refreshed on the ambient clock — the flicker rate stays constant across
    states on purpose (see the header note).
  */
  vec2 gpix = floor(gl_FragCoord.xy / max(uP_grainSize, 1.0));
  float frame = floor(uTime * 48.0);
  float g1 = grainNoise(gpix, frame, 3.1);
  f += (g1 - 0.5) * uP_grain;

  f = pow(clamp(f * gainNow, 0.0, 1.0), uP_contrast);

  // four-stop palette climbing the storm field
  vec3 col = mix(uC_deep, uC_low, smoothstep(0.05, 0.35, f));
  col = mix(col, uC_mid, smoothstep(0.35, 0.62, f));
  col = mix(col, uC_hot, smoothstep(0.62, 0.88, f));

  // iridescent shimmer: a cosine rainbow keyed to the field AND to the warp
  // vector — q varies at storm-cell scale, so the rainbow lands as coherent
  // coloured weather cells instead of hue noise that optically averages to
  // grey — multiplied in so it bends hues without erasing the palette
  vec3 shimmer = 0.5 + 0.5 * cos(2.0 * PI * (f * 0.9 + q.x * 1.1 + t * 0.06 + vec3(0.0, 0.33, 0.67)));
  col = mix(col, col * (0.35 + 1.9 * shimmer), uP_rainbow);

  /*
    Lightning: one hashed gate per flash interval with an exponential decay,
    so most intervals stay dark and some strike. Agent output opens the gate
    — an idle orb flickers occasionally, a speaking one strobes. The strike
    lands hardest on the high-pressure cells of the field.
  */
  float ft = t * uP_flashRate;
  float gate = step(1.0 - (0.1 + 0.5 * uOutput), hash(vec2(floor(ft), 7.7)));
  float flashEnv = gate * exp(-fract(ft) * 6.0);
  // squared so the strike stays inside the storm cells — a linear weight
  // tints the whole ball and reads as the canvas strobing, not as weather
  float high = smoothstep(0.55, 0.95, f);
  col += uC_flash * (flashEnv * uP_flash) * (0.06 + 0.94 * high * high);

  // dome shading keeps the ball a ball under the weather
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  col *= 0.35 + uP_light * lambert;
  float fres = pow(1.0 - z, 2.5);
  col += uC_flash * uP_rim * fres * (0.4 + 0.35 * flashEnv);

  // grain tap 2: plain film grain over the final colour
  float g2 = grainNoise(gpix, frame, 27.9);
  col *= 1.0 + (g2 - 0.5) * uP_filmGrain;

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

const DEFAULTS = { speed: 0.9, spin: 0.12, radius: 0.9, scale: 2.4, bands: 6, shear: 1.1, warp: 2.2, churn: 1.4, gain: 1.15, contrast: 1.35, grain: 0.4, filmGrain: 0.35, grainSize: 2, rainbow: 0.65, flashRate: 1.6, flash: 1.2, light: 0.85, rim: 0.5 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_17",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { deep: "#2a0f4e", low: "#0fd0c3", mid: "#ff5e9d", hot: "#ffd166", flash: "#eaf4ff" },
  presets: {
    idle: {
      speed: 0.9,
      shear: 1.1,
      warp: 2.2,
      churn: 1.4,
      flash: 0.7,
      gain: 1.15,
      contrast: 1.35,
    },
    recording: {
      speed: 1.6,
      shear: 2.2,
      warp: 2.6,
      churn: 1.6,
      flash: 2.6,
      gain: 1.45,
      contrast: 1.2,
    },
    transcribing: {
      speed: 2.2,
      shear: 0.6,
      warp: 3.4,
      churn: 2.1,
      flash: 0.6,
      gain: 1.05,
      contrast: 1.5,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
