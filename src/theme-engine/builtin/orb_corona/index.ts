// orb_corona — A raymarched SDF shell with volumetric godrays: the space between a sine-warped sphere and a plain one, lit only by light accumulated along each ray as it passes through the hollow
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-31`
// ("Corona") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, sweepRate) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define AA 1
#define MAX_STEPS 256

mat3 transpose3(mat3 m) {
  return mat3(
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2]
  );
}

// An artistic tumble, not an orthonormal rotation — the axes shear against each
// other so the shell never repeats a clean spin.
mat3 coronaRot(float a) {
  return mat3(
    cos(a), sin(a / 2.0) * sin(a), sin(a) * cos(a / 2.0),
    0.0, cos(a / 2.0), -sin(a / 2.0),
    -sin(a), sin(a / 2.0) * cos(a), cos(a / 2.0) * cos(a)
  );
}

mat3 globalRot;
mat3 globalInvRot;

// Volume-reactive values, resolved once per fragment in main().
float shellRadius;
float warpAmount;
float rayGain;
float warpFreqNow;
float smoothKNow;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float coronaSDF(vec3 p) {
  vec3 p1 = p;
  p1.zyx += sin(p.xzy * warpFreqNow) / max(warpAmount, 0.001);
  return -smin(length(p1) - shellRadius, shellRadius - length(p), smoothKNow);
}

vec3 shellColor(vec3 p) {
  float eps = 0.001;
  vec3 normal = globalInvRot * normalize(vec3(
    coronaSDF(p + vec3(eps, 0.0, 0.0)) - coronaSDF(p - vec3(eps, 0.0, 0.0)),
    coronaSDF(p + vec3(0.0, eps, 0.0)) - coronaSDF(p - vec3(0.0, eps, 0.0)),
    coronaSDF(p + vec3(0.0, 0.0, eps)) - coronaSDF(p - vec3(0.0, 0.0, eps))
  ));

  vec3 next = 1.0 - (normal * 0.5 + 0.5);
  next = vec3(dot(next, vec3(1.0)) / 3.0);
  return 1.025 - next * next;
}

vec4 coronaRender(vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - uRes) / min(uRes.x, uRes.y);

  vec3 ro = vec3(0.0, 0.0, -uP_camDist);
  vec3 rd = normalize(vec3(uv, uP_fov));

  ro = globalRot * ro;
  rd = globalRot * rd;

  vec3 p = ro;
  float d = 1.0;
  float t = 0.0;
  float godrays = 0.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (d <= 0.005 || t >= uP_maxDist) break;
    p = ro + rd * t;
    d = coronaSDF(p) / max(uP_stepScale, 0.5);

    // Gate the accumulation on the shell so light bleeds out of the hollow
    // instead of glowing uniformly through empty space.
    float fog = length(p) > shellRadius
      ? smoothstep(0.0, 0.5, coronaSDF(normalize(p) * shellRadius))
      : 1.0;
    godrays += (rayGain / (1.0 + dot(p, p) * uP_rayFalloff)) * fog;

    t += d;
  }

  vec3 col = vec3(uP_ambient);
  if (t < uP_maxDist) col = shellColor(p) * uP_surfaceLit;
  col += godrays;

  return vec4(col, 1.0);
}

void main() {
  float animTime = uP_speed; // integrated clock
  globalRot = coronaRot(animTime);
  globalInvRot = transpose3(coronaRot(animTime));

  /*
    One shared BACK-AND-FORTH phase for the swept values. sin() of an
    integrated clock is a true round trip — it eases through both ends
    instead of snapping at a wrap, which fract() or mod() would do.

    Every swept value is resolved HERE, once per fragment, and never read
    straight from its uniform inside coronaSDF: the normal estimate calls
    that SDF six more times, and a value that moved between those calls
    would corrupt the finite difference and pit the shading.

    uP_sweepRate is its own integrated clock, so the breathing rate tunes
    without jumping the phase, and it only ever enters through sin() —
    safe for an unbounded clock. All three swings share the phase, so the
    shell breathes as one motion rather than three unrelated wobbles.
  */
  float sweepPhase = sin(uP_sweepRate);

  // Louder agent output pushes the godrays; user input roughens the shell and
  // swells it slightly, so the silhouette breathes with speech.
  shellRadius = uP_radius + uP_swell * uInput;
  warpAmount = (uP_warp + uP_warpSwing * sweepPhase) * (1.0 - 0.25 * uInput - 0.15 * uOutput);
  warpAmount = max(warpAmount, 0.05);
  rayGain = uP_rayGain * (0.7 + 0.8 * uOutput + 0.3 * uInput);

  warpFreqNow = max(uP_warpFreq + uP_freqSwing * sweepPhase, 0.05);

  /*
    smoothK reaches EXACTLY zero at the bottom of the speaking sweep
    (0.25 +/- 0.25), and smin() divides by it — an unguarded zero is a
    NaN across the whole SDF. The floor keeps the blend hard but finite.
  */
  smoothKNow = max(uP_smoothK + uP_smoothSwing * sweepPhase, 0.005);

  vec4 acc = vec4(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += coronaRender(gl_FragCoord.xy + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = coronaRender(gl_FragCoord.xy);
#endif

  // Luminance becomes alpha so the orb composites onto the page instead of
  // painting an opaque square.
  //
  // The colour is emitted light, so it is already premultiplied: rgb is what
  // the orb adds, alpha is only how much background it hides. Multiplying rgb
  // by alpha again (the usual move for a lit surface) would darken the glow
  // quadratically and wash the godrays out.
  vec3 col = clamp(acc.rgb, 0.0, 1.0);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float a = clamp(lum * uP_alphaGain, 0.0, 1.0);

  // The godrays are volumetric, so they reach the frame boundary and would
  // otherwise show the canvas as a hard-edged glowing square. Taper radially to
  // let the halo fall off into the page instead — colour as well as alpha,
  // since premultiplied output would otherwise keep emitting at full brightness
  // right up to the cutoff and leave a visible rim.
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, length(orbUV()));
  col *= fade;
  a *= fade;

  gl_FragColor = vec4(col, a);
}
`;

const DEFAULTS = { speed: 1, sweepRate: 0.5, radius: 2.6, swell: 0.18, warp: 0.9, warpFreq: 5.25, warpSwing: 0, freqSwing: 0, smoothSwing: 0, smoothK: 0.42, rayGain: 0.8, rayFalloff: 10.5, surfaceLit: 0.105, ambient: 0, alphaGain: 3, edgeFade: 0.45, camDist: 12, fov: 3.5, stepScale: 9, maxDist: 22 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_corona",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "sweepRate"],
  colors: {  },
  presets: {
    idle: {
      speed: 1,
      swell: 0.18,
      warp: 0.9,
      warpFreq: 5.25,
      smoothK: 0.42,
      rayGain: 0.8,
      rayFalloff: 10.5,
      alphaGain: 3,
      warpSwing: 0,
      freqSwing: 0,
      smoothSwing: 0,
    },
    recording: {
      speed: 0.9,
      swell: 0.66,
      warp: 3.75,
      warpSwing: 2.25,
      warpFreq: 19.5,
      freqSwing: 4.5,
      smoothK: 0.25,
      smoothSwing: 0.25,
      sweepRate: 0.8,
      rayGain: 0.52,
      rayFalloff: 8,
      alphaGain: 1.8,
    },
    transcribing: {
      speed: 0.9,
      swell: 0.66,
      warp: 1,
      warpFreq: 7,
      smoothK: 0.58,
      rayGain: 0.52,
      rayFalloff: 8,
      alphaGain: 1.8,
      sweepRate: 0.5,
      freqSwing: 2,
      warpSwing: 0,
      smoothSwing: 0,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
