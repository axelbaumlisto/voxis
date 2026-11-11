// orb_dither — A lit plasma dome quantized to chunky two-tone pixels: lambert light, drifting fbm plasma and a fresnel rim collapse into one luminance, and an 8x8 ordered Bayer matrix — generated procedurally, since GLSL ES 1.0 has neither array initializers nor bitwise ops — snaps it onto a short ink-to-paper tone ladder. Two steps is the classic 1-bit look
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-14`
// ("Dither") — MIT.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, spin) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
// 2x2 Bayer base: floor/fract only. (0,0)=0, (1,0)=.5, (0,1)=.75, (1,1)=.25
// — the 0,2,3,1 ordering over 4.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}

// 8x8 by recursion: M8 = M2(a/4)/16 + M2(a/2)/4 + M2(a). No arrays, no
// bitwise — neither exists in GLSL ES 1.0.
float bayer8(vec2 a) {
  return bayer2(a * 0.25) * 0.0625 + bayer2(a * 0.5) * 0.25 + bayer2(a);
}

void main() {
  // Volume coupling: user input deepens the waves, agent output brightens
  // the whole tone ladder — the dot field visibly blooms while it speaks.
  float plasmaAmt = uP_plasma * (1.0 + 0.4 * uInput);
  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);

  /*
    Chunky pixel grid, RESOLUTION-RELATIVE: uP_cells is how many cells span
    the canvas, so a 190px gallery card and a 420px playground orb show the
    same composition — the same wave resolved by the same number of dots.
    Sized in device pixels instead, small canvases collapse to a few dozen
    blotches. All content below samples at the cell centre so every dot is
    one flat square.
  */
  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 1.0);
  vec2 pix = floor(gl_FragCoord.xy / cellPx);
  vec2 cellCentre = (pix + 0.5) * cellPx;

  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);
  vec2 uv = suv / uP_radius;
  float r2 = dot(uv, uv);

  // blocky silhouette — cut on the cell grid, deliberately not smoothed
  float mask = 1.0 - step(1.0, r2);

  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, z);

  /*
    The plasma is evaluated in a ROTATING frame: the dome point spins about
    Y on its own integrated clock, so the wavefronts roll around the ball
    instead of sliding across a flat disc. The light stays screen-fixed —
    the form shading holds still while the pattern travels over it.
  */
  float rot = uP_spin; // integrated clock
  float cr = cos(rot);
  float sr = sin(rot);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);

  float t = uP_speed; // integrated clock

  // the classic demoscene plasma: three interfering sine waves, each on its
  // own direction and rate
  float f = uP_scale;
  float v = sin(sp.x * f * 3.1 + t)
    + sin((sp.y * 0.85 + sp.z * 0.4) * f * 3.6 - t * 1.3)
    + sin((sp.x + sp.y + sp.z) * f * 2.2 + t * 0.7);

  // a ripple source orbiting the dome — expanding rings pushed through the
  // interference; the clock enters only as additive phase
  vec2 src = 0.55 * vec2(cos(t * 0.5), sin(t * 0.5));
  v += sin(length(uv - src) * f * 5.0 - t * 2.2);
  v *= 0.25; // four unit waves back to -1..1

  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float fres = pow(1.0 - z, 2.0);

  // waves modulated by the dome shading, so the ball stays a ball under
  // the rolling pattern; everything collapses into one luminance
  float lum = (0.5 + 0.5 * v * plasmaAmt) * (0.3 + uP_light * lambert)
    + uP_rim * fres;
  lum = pow(clamp(lum * gainNow, 0.0, 1.0), uP_contrast);

  // ordered dither onto the tone ladder — levels 2 is the classic 1-bit
  // look, higher values keep the grain but add mid-tones
  float steps = max(uP_levels - 1.0, 1.0);
  float q = clamp(floor(lum * steps + bayer8(pix)) / steps, 0.0, 1.0);

  vec3 col = mix(uC_ink, uC_paper, q);

  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply —
  // the opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(col * a, a);
}
`;

const DEFAULTS = { speed: 0.5, spin: 0.15, radius: 0.9, cells: 140, levels: 3, scale: 1.5, plasma: 0.9, light: 0.9, rim: 0.35, gain: 1, contrast: 1.1 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_dither",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { ink: "#101426", paper: "#cfe6ff" },
  presets: {
    idle: {
      speed: 0.5,
      spin: 0.15,
      plasma: 0.9,
      gain: 1,
      contrast: 1.1,
    },
    recording: {
      speed: 1.3,
      spin: 0.8,
      plasma: 1,
      gain: 1.3,
      contrast: 1.05,
    },
    transcribing: {
      speed: 1.6,
      spin: 0.05,
      plasma: 1.15,
      gain: 0.95,
      contrast: 1.15,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
