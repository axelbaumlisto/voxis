// orb_shdr_27 — A weather-radar mosaic on the ball: the sphere is twisted by hashed vortices, each a rotation about the axis through it with a Gaussian falloff, and two scales of 3D noise are read through the twist and multiplied, so storm systems wind into spirals with concentric legend rings and drift on the clock. The dome is cut into a pixel grid that never rolls, each cell centre is inverse-projected onto the sphere and read once, so every dot is one flat colour from a seven-class radar legend — grey, blue, cyan, green, red, yellow, magenta — with the class boundaries dithered by a per-cell hash and the quiet areas thinned to a sparse twinkling scatter on cream paper
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-27`
// ("SHDR-27") — MIT.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, spin) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define VORTICES 6
#define FBM3_OCT 4

// Volume-reactive values, resolved once per fragment in main().
float radarLoNow;
float radarDensityNow;

/*
  3D value noise. The prelude's noise is 2D, and a 2D field wrapped onto
  the ball has to be projected — and every projection either distorts
  somewhere or seams somewhere, which is exactly what the roll dragged
  into view. Evaluating the field ON the sphere's own points needs
  nothing projected: the roll is just a rotation of the sample point.
*/
float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < FBM3_OCT; i++) {
    v += a * noise3(p);
    p = p * 2.03 + vec3(11.7, 7.3, 3.1);
    a *= 0.5;
  }
  return v;
}

// rotate v about the unit axis k by angle a (Rodrigues)
vec3 rotateAbout(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

// the precipitation intensity, 0..1, at a point of the unit sphere
float intensity(vec3 sp, float t) {
  vec3 q = sp;
  /*
    The vortices: hashed points on the sphere, each twisting the space
    around itself — a rotation about the axis through it, by an angle
    that falls off with the angular distance, alternating in sense. The
    centres wander slowly so no spiral sits still.
  */
  for (int k = 0; k < VORTICES; k++) {
    float fk = float(k);
    vec3 c = normalize(vec3(
      hash(vec2(fk * 3.7, 1.1)) - 0.5,
      hash(vec2(fk * 5.9, 2.3)) - 0.5,
      hash(vec2(fk * 7.1, 4.9)) - 0.5
    ));
    c = rotateAbout(c, vec3(0.0, 1.0, 0.0), sin(t * 0.09 + fk * 1.7) * 0.25);
    float ang = acos(clamp(dot(q, c), -1.0, 1.0));
    float fall = exp(-ang * ang / (uP_vortex * uP_vortex));
    float a = uP_swirl * fall * (mod(fk, 2.0) < 0.5 ? 1.0 : -1.0);
    q = rotateAbout(q, c, a);
  }

  // bend, then drift the noise through the twisted space
  vec3 w = vec3(noise3(q * 1.3 + 2.1), noise3(q * 1.3 + 7.3), noise3(q * 1.3 + 4.4)) - 0.5;
  q += w * uP_warp;
  vec3 pq = q * uP_freq + vec3(t * 0.22, -t * 0.13, t * 0.07);

  /*
    Two scales multiplied, not added: a broad mask decides WHERE the storms
    are, a finer field gives each one a core and ragged edges. Adding them
    fills the whole sphere with mid-tones; multiplying leaves the calm
    between systems genuinely empty and puts the peaks inside the cells,
    which is what draws the concentric class rings.
  */
  float big = clamp((fbm3(pq) - 0.5) * 3.0 + 0.5, 0.0, 1.0);
  float fine = clamp((fbm3(pq * 2.6 + 4.7) - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  float f = big * (0.55 + 0.45 * fine);

  f = clamp((f - radarLoNow) / max(uP_hi - radarLoNow, 0.01), 0.0, 1.0);
  // a response curve: the top classes are the rare peaks of a real map
  return pow(f, uP_curve);
}

void main() {
  // input lowers the window (more of the field reads as weather), output
  // fills the dots in
  radarLoNow = uP_lo - 0.08 * uInput;
  radarDensityNow = uP_density * (1.0 + 0.5 * uOutput);

  vec2 uv = orbUV();
  float rd = length(uv);
  float R = uP_radius;
  float mask = smoothstep(0.012, -0.012, rd - R);

  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 pl = uv / R;
  float r2 = dot(pl, pl);
  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock: the weather drifts

  /*
    The pixel grid lives on the UNROLLED dome: a stereographic wrap of the
    front hemisphere as it faces the viewer, which compresses gently toward
    the limb and never changes. The picture rolls underneath it — the
    pixels are the screen, the weather is what is on it. Laying the grid on
    the rolled dome instead put the projection's blow-up (the far side of
    the ball) wherever the roll had turned it, and the cells smeared into
    streaks there.
  */
  vec2 st = n.xy / (1.3 + n.z) * uP_scale;
  vec2 g = st * uP_cells;
  vec2 cell = floor(g);
  vec2 fr = fract(g) - 0.5;

  // the cell centre, back on the dome: invert the wrap, then roll it and
  // read the field there — once per cell, so every dot is one flat colour
  vec2 v = (cell + 0.5) / uP_cells / uP_scale;
  float vv = dot(v, v);
  float A = vv + 1.0;
  float B = 2.6 * vv;
  float C = 1.69 * vv - 1.0;
  float zc = (-B + sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
  vec3 nc = vec3(v * (1.3 + zc), zc);
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  vec3 spc = vec3(nc.x * cr - nc.z * sr, nc.y, nc.x * sr + nc.z * cr);

  float f = intensity(spc, t);

  // dither the class boundaries with a per-cell hash, then quantize into
  // the legend's seven classes. The bands are NOT even: red is broad and
  // green thin, as on the reference, and magenta is the rare peak.
  float h = hash(cell + 11.7);
  float fd = clamp(f + (h - 0.5) * uP_dither, 0.0, 1.0);
  float cls = 0.0;
  cls += step(0.10, fd);
  cls += step(0.26, fd);
  cls += step(0.38, fd);
  cls += step(0.46, fd);
  cls += step(0.78, fd);
  cls += step(0.94, fd);

  // dropout: density rises with the intensity; the hash re-rolls slowly
  float frame = floor(uTime * uP_twinkle);
  float roll = hash(cell + vec2(frame * 3.7, -frame * 1.3));
  float density = mix(uP_sparse, 1.0, smoothstep(0.0, 0.6, f)) * radarDensityNow;
  float keep = step(roll, density);

  // the dot: a square inset in its cell
  float dsq = max(abs(fr.x), abs(fr.y));
  float dotMask = 1.0 - smoothstep(uP_dot - 0.06, uP_dot + 0.06, dsq);

  // the class palette
  vec3 ink = uC_c0;
  ink = cls > 0.5 && cls < 1.5 ? uC_c1 : ink;
  ink = cls > 1.5 && cls < 2.5 ? uC_c2 : ink;
  ink = cls > 2.5 && cls < 3.5 ? uC_c3 : ink;
  ink = cls > 3.5 && cls < 4.5 ? uC_c4 : ink;
  ink = cls > 4.5 && cls < 5.5 ? uC_c5 : ink;
  ink = cls > 5.5 ? uC_c6 : ink;

  vec3 col = mix(uC_paper, ink, dotMask * keep);

  // paper grain, so the flats are not dead
  col *= 1.0 + (hash(floor(gl_FragCoord.xy / 2.0) + frame) - 0.5) * uP_grain;

  // dome shading keeps the ball a ball under the mosaic
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  col *= 1.0 - uP_light * (1.0 - lambert);
  float fres = pow(1.0 - z, 3.0);
  col = mix(col, uC_c0, fres * uP_rim);

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

const DEFAULTS = { speed: 0.6, spin: 0.04, radius: 0.9, scale: 2.4, cells: 34, dot: 0.36, swirl: 1.5, vortex: 0.45, freq: 1.6, warp: 0.5, lo: 0.12, hi: 0.82, curve: 1.4, dither: 0.12, sparse: 0.16, density: 1, twinkle: 3, grain: 0.1, light: 0.18, rim: 0.35 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_27",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { paper: "#efe9dc", c0: "#a9a9a6", c1: "#2e5df0", c2: "#38d9ec", c3: "#22c35c", c4: "#e8322a", c5: "#f5d020", c6: "#e030c0" },
  presets: {
    idle: {
      speed: 1,
      spin: 0.27,
      lo: 0.12,
      hi: 0.82,
      curve: 1.4,
      sparse: 0.16,
      density: 1,
      twinkle: 3,
      warp: 0.5,
      swirl: 1.5,
      dither: 0.12,
    },
    recording: {
      speed: 6.5,
      spin: 0.51,
      lo: 0,
      hi: 0.8,
      curve: 1.3,
      sparse: 0.22,
      density: 1.15,
      twinkle: 5,
      warp: 0.45,
      swirl: 2,
      grain: 0.35,
      dither: 0.1,
    },
    transcribing: {
      speed: 2.4,
      spin: 0.51,
      lo: 0,
      hi: 0.545,
      curve: 1.7,
      sparse: 0.22,
      density: 0.9,
      twinkle: 12,
      freq: 5.2,
      warp: 1.06,
      swirl: 4,
      dither: 0.18,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
