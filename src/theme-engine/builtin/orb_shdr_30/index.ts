// orb_shdr_30 — A flower meadow folding into itself, falling forever toward a blue vanishing point: the log of the Chebyshev norm turns nested square frames into a continuous index, so every fragment maps back into one base picture and that picture contains itself. Sky, cloud, canopy, water and hashed flowers are painted in base-frame coordinates so the same weather repeats at every scale, the wall smear falls out of sampling the land noise on distance-around-the-frame against frame index, and aerial haze keyed to the screen radius makes the middle read as far away rather than merely small
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-30`
// ("SHDR-30") — MIT.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (fall, drift) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float drosteHaze;
float drosteCloud;
float drosteBloom;

/*
  Arc length around the unit square, in [0,8), counter-clockwise from the
  bottom-right corner — two units per face. Continuous everywhere except
  its single wrap, which lands on a corner.
*/
float squareArc(vec2 q) {
  if (abs(q.x) >= abs(q.y)) {
    if (q.x > 0.0) return q.y + 1.0;
    return 5.0 - q.y;
  }
  if (q.y > 0.0) return 3.0 - q.x;
  return 7.0 + q.x;
}

/*
  Flower colour by hash: mostly white daisies, then the planted warm, then
  the cornflower blues — which reuse the SKY colour rather than adding a
  sixth stop, because that is what keeps them reading as part of the same
  picture instead of as confetti thrown over it.
*/
vec3 drosteFlower(float h) {
  vec3 c = uC_cloud;
  c = mix(c, uC_bloom, step(0.52, h));
  c = mix(c, uC_sky, step(0.86, h));
  return c;
}

vec3 drosteRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  float fall = uP_fall;   // integrated clock: the flight inward
  float drift = uP_drift; // integrated clock: weather

  /*
    The frame tilt is a STATIC angle, not an integrated clock like the roll
    every other orb here gets. Those clocks seed at a random phase per
    mount, which is exactly right for a field with no preferred direction
    and exactly wrong for a picture: it lands the sky down one side of the
    ball and the meadow up the other. This one has an up.
  */
  float sw = uP_tilt;

  // stereographic wrap — the tunnel is inside the ball, and compresses
  // toward the limb the way a texture on a sphere does
  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;

  /*
    The Chebyshev norm makes the level sets SQUARES. The floor on it is
    what keeps the logarithm finite at the dead centre; the haze below
    covers that last pixel anyway.
  */
  float m = max(max(abs(p.x), abs(p.y)), 0.002);

  float K = max(uP_ratio, 1.05);
  float L = log2(m) / log2(K) + fall;

  vec2 q = p / m;                 // direction, on the unit square boundary
  float sm = pow(K, fract(L));    // this fragment's radius in base-frame units
  vec2 P = q * sm;                // where it lands in the base picture

  float Yn = P.y / K;             // picture height, about -1 at the bottom edge
  float arc = squareArc(q);       // distance around the frame

  // ---- sky -----------------------------------------------------------
  vec3 col = mix(uC_sky * 0.72, uC_sky, clamp(Yn * 1.3, 0.0, 1.0));

  /*
    Cloud and land are both read in BASE-PICTURE coordinates, so every
    frame carries the same weather at its own scale — which is the whole
    point of a picture that contains itself.
  */
  float skyMask = smoothstep(uP_horizon - 0.3, uP_horizon + 0.2, Yn);
  float cl = fbm(P * uP_cloudScale + vec2(drift, drift * 0.3));
  cl = smoothstep(drosteCloud, drosteCloud + 0.16, cl);
  col = mix(col, uC_cloud, cl * (0.2 + 0.8 * skyMask));

  // ---- land ----------------------------------------------------------
  /*
    The smear. Sampled on (distance around the frame, frame index) with a
    low frequency on the second axis, so features run LONG in the
    direction the recursion stretches them — the streaked walls of the
    reference, straight out of the geometry.
  */
  float streak = fbm(vec2(arc * uP_streakFreq, L * uP_streakRad));

  vec3 land = mix(uC_canopy, uC_meadow, smoothstep(0.02, -0.62, Yn));
  land *= 0.42 + 1.25 * streak;

  // water: the low ground holds it where the streak field pools
  float water = smoothstep(0.42, 0.16, streak) * smoothstep(0.05, -0.3, Yn);
  land = mix(land, uC_water, water * uP_water);

  /*
    Flowers, hashed one to a cell on the same (around, index) grid, jittered
    inside it. Densest low in the picture and gone by the horizon.
  */
  vec2 fg = vec2(arc * uP_flowerScale, L * uP_flowerScale * 0.3);
  vec2 fc = floor(fg);
  vec2 ff = fract(fg) - 0.5;
  vec2 dcv = ff - (vec2(hash(fc + 3.7), hash(fc + 19.1)) - 0.5) * 0.6;
  float petal = smoothstep(uP_flowerSize, uP_flowerSize * 0.35, length(dcv));
  float present = step(1.0 - drosteBloom, hash(fc + 51.3));
  float meadow = smoothstep(0.13, -0.38, Yn);
  land = mix(land, drosteFlower(hash(fc + 7.9)), petal * present * meadow);

  float landMask = 1.0 - smoothstep(uP_horizon - 0.12, uP_horizon + 0.16, Yn);
  col = mix(col, land, landMask);

  /*
    The picture's own edge. Darkening across the frame and resetting hard
    at its boundary is not an artefact to smooth away — it draws the
    nested borders the reference is built out of.
  */
  col *= mix(1.0, uP_frameShade, fract(L));

  /*
    Aerial perspective, from the SCREEN radius. Every frame has the same
    fractional part, so depth cannot come from inside a frame — it has to
    come from how far in the fragment sits. This is what makes the middle
    read as far away instead of merely small.
  */
  float deep = 1.0 - smoothstep(0.0, uP_hazeRange, m);
  col = mix(col, uC_sky, deep * drosteHaze);

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast)) * uP_gain;

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);

  // dome shading, kept light — this is a window, not a lit surface
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.72 + uP_light * lambert;

  // the glass: a strong fresnel is what turns a picture into a sphere
  // with a world inside it
  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice thickens the weather, the agent's
  // clears the haze and brings the meadow into flower.
  drosteCloud = clamp(uP_cloudCover - 0.12 * uInput, 0.02, 0.98);
  drosteHaze = uP_haze * (1.0 - 0.25 * uOutput);
  drosteBloom = clamp(uP_flowerDensity * (1.0 + 0.5 * uOutput), 0.0, 1.0);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Two fbm evaluations and a flower grid per sample — none of it worth
  // paying for outside the silhouette.
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += drosteRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = drosteRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

const DEFAULTS = { fall: 0.12, tilt: 0, drift: 0.2, radius: 0.9, scale: 4.5, bulge: 0.25, ratio: 1.8, horizon: 0.14, cloudScale: 1.6, cloudCover: 0.46, streakFreq: 5, streakRad: 0.5, water: 0.7, flowerScale: 44, flowerDensity: 0.55, flowerSize: 0.26, frameShade: 0.62, haze: 0.85, hazeRange: 0.09, gain: 1.05, contrast: 1.05, saturation: 1.1, light: 0.35, rim: 0.55 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_30",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["fall", "drift"],
  colors: { sky: "#4a92e0", cloud: "#f7fbff", canopy: "#12401f", meadow: "#5aa63a", water: "#156f6a", bloom: "#ff6a3a", sheen: "#cfe6ff" },
  presets: {
    idle: {
      fall: 0.12,
      drift: 0.2,
      bulge: 0.2,
      ratio: 3.06,
      horizon: -0.11,
      cloudScale: 1.2,
      cloudCover: 0.42,
      streakFreq: 2.9,
      streakRad: 0.54,
      water: 0,
      flowerScale: 24,
      flowerDensity: 0.27,
      flowerSize: 0.43,
      haze: 0.8,
      hazeRange: 0.09,
      gain: 1.38,
      saturation: 1.56,
      light: 0.345,
      rim: 0.555,
    },
    recording: {
      fall: 1.47,
      tilt: 0.03,
      drift: 1.54,
      scale: 8.7,
      horizon: 0.03,
      cloudScale: 3.65,
      cloudCover: 0.44,
      streakFreq: 11,
      streakRad: 1.48,
      flowerScale: 32,
      flowerDensity: 0.95,
      haze: 0.38,
      hazeRange: 0.315,
      gain: 1.36,
      contrast: 1.45,
      saturation: 2.32,
      light: 0.57,
    },
    transcribing: {
      fall: 0.6,
      drift: 0.5,
      haze: 1,
      hazeRange: 0.3,
      cloudCover: 0.3,
      flowerDensity: 0.28,
      gain: 1.42,
      contrast: 1.45,
      saturation: 2,
      light: 0.96,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
