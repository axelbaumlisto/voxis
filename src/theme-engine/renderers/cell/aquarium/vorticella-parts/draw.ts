import type { AquariumFrame, AquariumParamsView, VorticellaState } from "../types";
import { seededUnit, noise2D } from "../seeds";
import { TAU, clamp, clamp01, finite, finiteOr, smoothstep, wrapUnit } from "../util";
import { vorticellaBellMetrics, vorticellaGeometry } from "./geometry";
import type { AquariumPoint } from "./geometry";

const T_HOLD = 0.05; // keep in sync with the Vorticella contraction hold leg used by update.

function drawPolyline(ctx: CanvasRenderingContext2D, points: readonly AquariumPoint[], close: boolean): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

export function drawVorticella(
  ctx: CanvasRenderingContext2D,
  vorticella: readonly VorticellaState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): void {
  if (!view.enabled || vorticella.length === 0 || view.vorticella.count <= 0) return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.85));
  if (alpha <= 0) return;
  const scale = Math.max(0.1, finite(view.vorticella.scale, 1));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const cell of vorticella) {
    const s = clamp01(finite(cell.contractPhase, 0));
    const baseDir = finite(cell.directionAngle, -Math.PI / 2);
    // idle sway: the slender stalk flexes gently so the zooid is alive at rest;
    // sway eases out as it contracts (the coiled spasmoneme is short and stiff).
    const attach = clamp01(finiteOr(cell.attach, 1)); // 1=anchored, 0=free telotroch
    const sway = 0.07 * (1 - 0.8 * s) * attach * Math.sin(TAU * wrapUnit(finiteOr(cell.swayPhase, 0)));
    // post-arrest recoil: a fast under-damped bell tilt right after the ballistic
    // collapse arrests (during HOLD + early re-extension), decaying to 0.
    const vleg = Math.floor(finiteOr(cell.contractLeg, 0));
    const arrestT = vleg === 2 ? Math.max(0, finiteOr(cell.contractTimer, 0))
      : vleg === 3 ? T_HOLD + Math.max(0, finiteOr(cell.contractTimer, 0)) : -1;
    // damped recoil: zero-start envelope (sin, not cos) so the bell tilt begins at 0
    // displacement with peak velocity (math-review fix: cos jumped to 0.10rad instantly).
    const wobble = arrestT >= 0 && arrestT < 0.7
      ? 0.10 * Math.exp(-0.45 * TAU * 6 * arrestT) * Math.sin(TAU * 6 * 0.8932 * arrestT)
      : 0;
    // seeded per-cell asymmetry + continuous-life params (deterministic, birth-stable).
    // Every motion term is a pure function of frame.t -> byte-stable at fixed t, fps-free.
    const tt = finite(frame.t, 0);
    const aSeed = (Math.round(finite(cell.restLength, 10) * 1024) ^ 0x3af1c5) >>> 0;
    const asymA = (seededUnit(aSeed, 0, 0x11) - 0.5) * 0.24;   // +/-12% left/right wall imbalance
    const skewAmt = (seededUnit(aSeed, 7, 0x88) - 0.5) * 0.22 * (1 - 0.6 * s);  // gentle lateral axis curve, DAMPED in contraction so the contracted zooid is a smooth near-spherical ovoid (not a sheared two-lobed mass)
    const periOff = (seededUnit(aSeed, 1, 0x22) - 0.5) * 0.12; // +/-6% D peristome lateral offset
    const lean = (seededUnit(aSeed, 2, 0x33) - 0.5) * 0.11;    // ~+/-3deg fixed body lean vs the stalk
    const bp0 = seededUnit(aSeed, 3, 0x44) * TAU, bp1 = seededUnit(aSeed, 4, 0x55) * TAU;
    const lobePhase = seededUnit(aSeed, 5, 0x66) * TAU;
    // secondary bell nod (slow, smaller than sway, incommensurate freq) -> alive, not rigid
    const nod = 0.035 * Math.sin(TAU * 0.06 * tt + seededUnit(aSeed, 6, 0x77) * TAU);
    // gentle asymmetric peristaltic breathing of the wall (<=6% width, <=0.12Hz, Nyquist-safe)
    const breathMod = (u: number): number => 1
      + 0.035 * Math.sin(TAU * 0.075 * tt + bp0 + 2.4 * u)
      + 0.025 * Math.sin(TAU * 0.115 * tt + bp1);
    // RECORDING feeding-posture envelope (smooth, set in updateVorticella): eases the
    // peristome wider, brightens the wreath/body, and adds a little sway while recording.
    const vEnv = clamp01(finiteOr(cell.voiceEnv, 0));
    const glow = 1 + 0.45 * vEnv; // body + crown brighten while recording (darkfield scatter swell)
    const dir = baseDir + lean + sway * (1 + 0.7 * vEnv) + wobble + nod;
    const ux = Math.cos(dir), uy = Math.sin(dir);
    const nx = -uy, ny = ux;
    const anchorX = finite(cell.anchorX, 0);
    const anchorY = finite(cell.anchorY, 0);

    // --- modest bell + a longer stalk so it reads as a stalked, leggy zooid ---
    const { D, bellHeight, restStalk } = vorticellaBellMetrics(cell, scale, frame.height);
    // the fired zooid BALLS UP: shorten the bell axially on contraction (real Vorticella
    // retracts toward a sphere) instead of ballooning the width into an oblate disc.
    const drawBellH = bellHeight * (1 - 0.25 * s);
    // stalk shrinks to nothing as the zooid detaches into a free-swimming telotroch
    const restLength = restStalk * attach;

    const geom = vorticellaGeometry(s, {
      anchorX, anchorY, restLength, directionAngle: dir,
      minLengthFrac: 0.32, coilSampleCount: 40, coilTurnsContracted: 6.5, coilRadius: D * 0.4,
    });
    const neck = geom.bellCenter;           // base of the bell (top of stalk)
    const rimC = { x: neck.x + ux * drawBellH + nx * (periOff + skewAmt) * D, y: neck.y + uy * drawBellH + ny * (periOff + skewAmt) * D }; // peristome centre, off-axis + follows the body skew
    // peristome closes as it contracts; while recording it eases a little WIDER (feeding).
    const open = (1 - 0.7 * s) * (1 + 0.22 * vEnv);
    // everted collar: a rolled rim only slightly wider than the shoulder (~1.28D body-max
    // 1.16D -> ~10% overhang) so it reads CONTINUOUS with the bell, not a floating saucer.
    const Rrim = 0.80 * D * open; // everted peristomial collar clearly overhangs the body shoulder
    // smooth furl of the feeding crown as it closes — fade out over the last bit of
    // contraction instead of a hard on/off pop at full contraction (anti-flicker).
    const crownFade = smoothstep(clamp01((open - 0.30) / 0.18));

    // Subtle sessile feeding-current cue: real Vorticella uses the oral crown to
    // entrain water toward the peristome. Keep it faint so it reads as darkfield
    // flow, not UI particles.
    if (crownFade > 0.05 && s < 0.35) {
      ctx.save();
      ctx.lineCap = "round";
      const flowAlpha = alpha * crownFade * (0.08 + 0.06 * vEnv);
      for (let k = 0; k < 6; k++) {
        const lane = (k - 2.5) / 2.5;
        const phase = TAU * wrapUnit(tt * (0.10 + k * 0.011) + seededUnit(aSeed, k, 0x4f10cafe));
        const reach = D * (1.35 + 0.18 * k);
        const wob = Math.sin(phase) * D * 0.08;
        const start = {
          x: rimC.x + ux * reach + nx * (lane * D * 0.42 + wob),
          y: rimC.y + uy * reach + ny * (lane * D * 0.42 + wob),
        };
        const mid = {
          x: rimC.x + ux * reach * 0.48 + nx * (lane * D * 0.24 - wob * 0.35),
          y: rimC.y + uy * reach * 0.48 + ny * (lane * D * 0.24 - wob * 0.35),
        };
        const end = {
          x: rimC.x + nx * lane * D * 0.10,
          y: rimC.y + ny * lane * D * 0.10,
        };
        ctx.strokeStyle = `hsla(198, 35%, 88%, ${flowAlpha * (0.55 + 0.45 * (1 - Math.abs(lane)))})`;
        ctx.lineWidth = Math.max(0.35, D * 0.018);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(mid.x, mid.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    const bodyPoint = (along: number, lateral: number): AquariumPoint => {
      // body axis curves laterally toward the top (per-cell) so the bell is visibly
      // lopsided/distorted like a real cell, not a clean Paint-traced mirror.
      const cl = skewAmt * D * smoothstep(clamp01(along / Math.max(1, drawBellH)));
      return {
        x: neck.x + ux * along + nx * (lateral + cl),
        y: neck.y + uy * along + ny * (lateral + cl),
      };
    };
    // convex urn/bell silhouette: narrow neck, bulges to widest just below the
    // everted peristomial lip, then eases in slightly to the rim (NOT a straight cone).
    // campanulate bell: FULL neck (not a needle), convex bulging shoulders,
    // widest just below the everted lip, easing in slightly to the rim.
    const halfW = (u: number): number => {
      // CRITIC FIX (morphology F1): the widest point sits BELOW the everted rim (a convex
      // campanulate shoulder); above it the wall eases IN to a narrower rim so the
      // peristomial collar (Rrim) clearly overhangs the body margin; fuller rounded heel.
      // extended: narrow scopula heel (w0 0.16); CONTRACTED: the posterior rounds out
      // (w0 -> ~0.5) so the fired zooid balls into a near-spherical blob, not a tapered urn.
      const um = 0.66, w0 = 0.16 + 0.34 * s, wMax = 0.66, wRim = 0.42;
      const base = u <= um
        ? w0 + (wMax - w0) * Math.pow(smoothstep(u / um), 0.6) // convex bulge up to the widest shoulder
        : wMax - (wMax - wRim) * smoothstep((u - um) / (1 - um)); // ease IN above widest -> collar overhangs
      // everted-lip taper as a SMOOTH gate over u in [0.82,1] (math-review fix: was a
      // hard C0 -31% step at u=0.9 when contracted).
      const lipGate = 1 - (1 - (0.55 + 0.45 * open)) * smoothstep((u - 0.82) / 0.18);
      // CRITIC FIX (contraction rounding): the bell fattens/rounds toward a sphere as it
      // contracts (s->1), instead of keeping a fixed urn aspect.
      return D * base * lipGate; // contraction rounding is done by shortening the AXIS (drawBellH), not widening
    };

    // === STALK (spasmoneme) — straight at rest, tight HELIX when contracted ===
    // base pass (back side / whole path), dim
    drawPolyline(ctx, geom.stalkPath, false);
    ctx.strokeStyle = `hsla(202, 26%, 80%, ${alpha * 0.34})`;
    ctx.lineWidth = Math.max(0.6, D * 0.07);
    ctx.stroke();
    // depth-shaded near-side turns: brighter/thicker where the coil faces the
    // viewer (cos>0) so the contracted stalk reads as a 3-D helical SPRING,
    // not a flat zigzag. (Only meaningful once coiled; negligible when straight.)
    if (s > 0.05 && geom.stalkPath.length > 2) {
      const n = geom.stalkPath.length;
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        const near = Math.cos(t * geom.coilTurns * TAU); // +1 near, -1 far
        drawPolyline(ctx, [geom.stalkPath[i - 1], geom.stalkPath[i]], false);
        if (near > 0) {
          ctx.strokeStyle = `hsla(204, 32%, 90%, ${alpha * (0.18 + 0.34 * near) * s})`;
          ctx.lineWidth = Math.max(0.4, D * (0.05 + 0.05 * near));
        } else {
          ctx.strokeStyle = `hsla(204, 24%, 64%, ${alpha * 0.12 * s})`; // far turns: faint, continuous
          ctx.lineWidth = Math.max(0.75, D * 0.03);
        }
        ctx.stroke();
      }
    }
    // faint inner spasmoneme line
    drawPolyline(ctx, geom.stalkPath, false);
    ctx.strokeStyle = `hsla(204, 30%, 70%, ${alpha * 0.3})`;
    ctx.lineWidth = Math.max(0.75, D * 0.03);
    ctx.stroke();
    // floor holdfast (only while anchored)
    if (attach > 0.5) {
      ctx.beginPath();
      ctx.arc(anchorX, anchorY, Math.max(0.8, D * 0.16), 0, TAU);
      ctx.fillStyle = `hsla(202, 24%, 76%, ${alpha * 0.4 * attach})`;
      ctx.fill();
    }
    // telotroch: an aboral ring of locomotor cilia at the bell base while detached
    if (attach < 0.7) {
      const band = (1 - attach) * (1 - attach);
      const ringR = halfW(0.06) * 1.05;
      const M = Math.max(8, Math.round(D * 1.0));
      const beatBase = wrapUnit(finiteOr(cell.oralWreathPhase, 0));
      ctx.strokeStyle = `hsla(196, 30%, 92%, ${alpha * 0.55 * band})`;
      ctx.lineWidth = Math.max(0.75, D * 0.025);
      for (let i = 0; i < M; i++) {
        const a = i / M;
        const lateral = Math.cos(a * TAU) * ringR;
        const baseP = bodyPoint(-D * 0.04, lateral);
        const beat = Math.sin((a * 3 - beatBase) * TAU);
        const len = D * (0.12 + 0.025 * beat); // softer per-cilium swing (anti-strobe)
        const tip = { x: baseP.x - ux * len + nx * beat * D * 0.02, y: baseP.y - uy * len + ny * beat * D * 0.02 };
        drawPolyline(ctx, [baseP, tip], false);
        ctx.stroke();
      }
    }

    // === BELL BODY (hyaline) ===
    const SAMP = 32; // smoother outline (fewer visible facets on the contracted wall)
    const left: AquariumPoint[] = [];
    const right: AquariumPoint[] = [];
    for (let i = 0; i <= SAMP; i++) {
      const u = i / SAMP;
      const hwB = halfW(u) * breathMod(u);
      // INDEPENDENT irregular lobing per side (different freq/phase) so left != right
      const lobeL = 1 + 0.06 * Math.sin(Math.PI * u * 1.7 + lobePhase);
      const lobeR = 1 + 0.06 * Math.sin(Math.PI * u * 1.3 + lobePhase + 2.1);
      left.push(bodyPoint(drawBellH * u, -hwB * lobeL * (1 - asymA)));
      right.push(bodyPoint(drawBellH * u, hwB * lobeR * (1 + asymA)));
    }
    const outline = [...left, ...right.reverse()];
    // RECORDING AURA: a soft cool halo blooms behind the bell while recording (the clearest
    // glance-legible "recording is on" tell). Smooth via voiceEnv -> no pop. Drawn first so
    // the organism sits on top of it.
    if (vEnv > 0.01) {
      const bellMid = bodyPoint(drawBellH * 0.5, 0);
      const haloR = drawBellH * (0.95 + 0.35 * vEnv);
      const halo = ctx.createRadialGradient(bellMid.x, bellMid.y, drawBellH * 0.2, bellMid.x, bellMid.y, haloR);
      halo.addColorStop(0, `hsla(196, 60%, 86%, ${alpha * 0.42 * vEnv})`);
      halo.addColorStop(0.5, `hsla(198, 55%, 80%, ${alpha * 0.20 * vEnv})`);
      halo.addColorStop(1, `hsla(200, 50%, 78%, 0)`);
      ctx.beginPath();
      ctx.arc(bellMid.x, bellMid.y, haloR, 0, TAU);
      ctx.fillStyle = halo;
      ctx.fill();
    }
    drawPolyline(ctx, outline, true);
    // living cytoplasm: a vertical gradient (denser/greener endoplasm toward the neck,
    // paler hyaline ectoplasm toward the rim) instead of a flat gray fill.
    // hyaline (near-colorless) cytoplasm: pale grey-blue ectoplasm at the rim, a touch
    // denser/warmer granular endoplasm toward the neck — NOT a saturated teal wash.
    const cyto = ctx.createLinearGradient(rimC.x, rimC.y, neck.x, neck.y);
    // DARKFIELD (real micrograph): Vorticella's endoplasm is DENSELY GRANULAR -> it
    // scatters strongly -> the whole zooid GLOWS cool blue-white edge-to-edge (NOT a black
    // hollow shell). The body fill is a luminous cool glow; granules add bright texture.
    cyto.addColorStop(0, `hsla(200, 16%, 94%, ${alpha * 0.62 * glow})`);
    cyto.addColorStop(1, `hsla(200, 20%, 86%, ${alpha * 0.74 * glow})`);
    ctx.fillStyle = cyto;
    ctx.fill();
    // granular endoplasm + soft DIC-style relief, CLIPPED to the bell, so the body reads
    // as a wet refractile microscopy cell rather than a flat coloured sticker.
    ctx.save();
    drawPolyline(ctx, outline, true);
    ctx.clip();
    // (DIC shaded-relief pass removed: darkfield has no oblique light/shadow modeling.)
    // refractile granule stipple (seeded from a birth-stable field, dt-free -> byte-stable)
    const gSeed = (Math.round(finite(cell.restLength, 10) * 8192) ^ 0x6e3a) >>> 0;
    const gCount = Math.round(clamp(D * 5.0, 44, 150)); // dense granule-packed endoplasm -> glows edge-to-edge
    for (let k = 0; k < gCount; k++) {
      // density biased toward the posterior base (oil-droplet pooling); higher contrast
      // CYCLOSIS: granules shear slowly on the same wall-tangent gyre (slower than the
      // vacuoles) so the whole endoplasm streams rather than sitting as painted dots.
      const gphi = seededUnit(gSeed, k, 0x3d1f77) * TAU;
      const gamp = 0.96 * Math.sqrt(seededUnit(gSeed, k, 0x1b3a7d)); // area-uniform: granules fill the endoplasm edge-to-edge incl. the centre
      const gph = (TAU / 46) * tt + gphi + 0.5 * noise2D(gSeed, gphi * 3.3 + k, tt * 0.045); // constant ~46s, NOT audio-driven, aperiodic
      const gu = 0.46 + 0.44 * gamp * Math.sin(gph);
      const glat = gamp * Math.cos(gph) * 0.72 * halfW(gu) * breathMod(gu);
      const gp = bodyPoint(drawBellH * gu, glat);
      const gr = 0.4 + seededUnit(gSeed, k, 0x77c1a3) * 0.9;
      ctx.beginPath();
      ctx.arc(gp.x, gp.y, gr, 0, TAU);
      ctx.fillStyle = seededUnit(gSeed, k, 0x9d11ef) > 0.5
        ? `hsla(196, 18%, 97%, ${alpha * 0.46})`   // bright cool refractile scatter (interior is the brightest region)
        : `hsla(200, 16%, 90%, ${alpha * 0.36})`;  // mid cool scatter (still luminous, never dark)
      ctx.fill();
    }
    // second, FINER micro-grain layer filling between the coarse granules so the
    // endoplasm reads foamy edge-to-edge (tiny, very faint, slow independent drift).
    const gCount2 = Math.round(clamp(D * 3.0, 24, 96));
    for (let k = 0; k < gCount2; k++) {
      const p2 = seededUnit(gSeed, k, 0x55aa3b) * TAU;
      const a2 = 0.96 * Math.sqrt(seededUnit(gSeed, k, 0x2c7f91)); // area-uniform fine grain
      const ph2 = (TAU / 60) * tt + p2 + 0.4 * noise2D(gSeed, p2 * 2.7 + k, tt * 0.04); // constant ~60s, aperiodic
      const u2 = 0.46 + 0.46 * a2 * Math.sin(ph2);
      const l2 = a2 * Math.cos(ph2) * 0.72 * halfW(u2) * breathMod(u2);
      const fp = bodyPoint(drawBellH * u2, l2);
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, 0.3 + seededUnit(gSeed, k, 0x6b1d2f) * 0.4, 0, TAU);
      ctx.fillStyle = seededUnit(gSeed, k, 0x9911cd) > 0.5
        ? `hsla(196, 16%, 95%, ${alpha * 0.16})`
        : `hsla(200, 14%, 80%, ${alpha * 0.13})`;
      ctx.fill();
    }
    // (dark basal pooling removed: darkfield has no absorbing dark masses; dense regions
    // simply stop scattering and fade to background, never a painted grey shadow.)
    ctx.restore();
    // soft translucent pellicle + a brighter refractile rim-light (the membrane edge
    // catches light in every micrograph) — no bold cartoon contour.
    drawPolyline(ctx, outline, true);
    ctx.strokeStyle = `hsla(205, 12%, 70%, ${alpha * 0.22})`;
    ctx.lineWidth = Math.max(0.5, D * 0.03);
    ctx.stroke();
    drawPolyline(ctx, outline, true);
    ctx.strokeStyle = `hsla(200, 16%, 88%, ${alpha * 0.30})`; // soft edge (must NOT outshine the luminous granular interior)
    ctx.lineWidth = Math.max(0.5, D * 0.018);
    ctx.stroke();

    // === INTERIOR (subtle, hyaline) — CLIPPED to the bell so organelles never poke
    // outside the (asymmetric, breathing) wall ===
    ctx.save();
    drawPolyline(ctx, outline, true);
    ctx.clip();
    // macronucleus: curved C / horseshoe band lying along the body
    const macPts: AquariumPoint[] = [];
    const macAlong = drawBellH * 0.50;
    const macR = D * 0.44; // large folded horseshoe band filling much of the body
    for (let i = 0; i <= 14; i++) {
      const th = Math.PI * (0.32 + (i / 14) * 1.08);
      // elongate the C ALONG the body axis (long worm-like horseshoe), not a transverse ring
      macPts.push(bodyPoint(macAlong - macR * 1.35 * Math.cos(th), macR * 0.95 * Math.sin(th)));
    }
    // long low-contrast translucent horseshoe seen THROUGH the cytoplasm: a soft wide
    // underglow + a thin near-neutral core (never a dark muddy blob or a bright logo).
    drawPolyline(ctx, macPts, false);
    ctx.strokeStyle = `hsla(205, 9%, 54%, ${alpha * 0.28})`;
    ctx.lineWidth = Math.max(1.6, D * 0.24);
    ctx.stroke();
    drawPolyline(ctx, macPts, false);
    ctx.strokeStyle = `hsla(200, 14%, 86%, ${alpha * 0.5})`; // darkfield: a dense nucleus SCATTERS -> a bright cool C-band, not a dark brightfield stroke
    ctx.lineWidth = Math.max(1.0, D * 0.12);
    ctx.stroke();
    // micronucleus: a tiny dot docked against the OUTER edge of one nuclear arm
    if (D >= 11) {
      const mic = bodyPoint(macAlong - macR * 0.9, macR * 0.5);
      ctx.beginPath();
      ctx.arc(mic.x, mic.y, Math.max(0.4, D * 0.045), 0, TAU);
      ctx.fillStyle = `hsla(200, 12%, 66%, ${alpha * 0.46})`;
      ctx.fill();
    }

    // contractile vacuole: a crisp refractile clear bubble (pale fill + brighter rim +
    // a small specular highlight), pulsing on its slow rhythm, off-axis in the upper body.
    if (D >= 10) {
      // CV cycle = the cell's CV clock period (~9-16s, within the real several-second
      // range), ASYMMETRIC: slow diastole fill (~82% of cycle) then fast systole empty
      // (~18%). (Was a symmetric cosine at DOUBLE the period = far too slow/static.)
      const cvPhase = wrapUnit(finite(cell.contractCyclePhase, 0));
      const cvPulse = cvPhase < 0.82 ? smoothstep(cvPhase / 0.82) : 1 - smoothstep((cvPhase - 0.82) / 0.18);
      // beside the vestibule (oral pole), on the side CLEAR of the macronucleus C so
      // the refractile bubble is not occluded; visibly fills then collapses at systole.
      const cv = bodyPoint(drawBellH * 0.70, -D * 0.24);
      const cvR = Math.max(0.8, D * (0.03 + 0.15 * cvPulse));
      ctx.beginPath();
      ctx.arc(cv.x, cv.y, cvR, 0, TAU);
      // refractile water bubble: bright watery core -> thin dark refractile ring -> feather,
      // + a lit specular toward the light (radial gradient = a 3-D bubble, not a flat disc).
      const cgx = cv.x - nx * cvR * 0.4 - ux * cvR * 0.4, cgy = cv.y - ny * cvR * 0.4 - uy * cvR * 0.4;
      const cg = ctx.createRadialGradient(cgx, cgy, cvR * 0.1, cv.x, cv.y, cvR * 1.12);
      cg.addColorStop(0, `hsla(200, 14%, 98%, ${alpha * 0.34})`);
      cg.addColorStop(0.7, `hsla(200, 12%, 93%, ${alpha * 0.2})`);
      cg.addColorStop(0.88, `hsla(196, 26%, 95%, ${alpha * 0.5})`); // bright cool scattering rim (darkfield), not a dark Becke ring
      cg.addColorStop(1, `hsla(196, 30%, 96%, 0)`);
      ctx.beginPath();
      ctx.arc(cv.x, cv.y, cvR * 1.12, 0, TAU);
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cgx, cgy, Math.max(0.4, cvR * 0.3), 0, TAU);
      ctx.fillStyle = `hsla(196, 20%, 96%, ${alpha * 0.4})`; // faint cool scatter, not a pure-white CG specular hotspot
      ctx.fill();
    }

    // food vacuoles: a few faint round inclusions mid/lower body
    if (D >= 12) {
      // seed from a BIRTH-stable field (restLength), never the live anchorX, so the
      // inclusions do not teleport while the zooid migrates as a telotroch.
      const fvSeed = (Math.round(finite(cell.restLength, 10) * 4096) ^ 0x9e37) >>> 0;
      const fvCount = 8; // scattered inclusions that must NOT outshine the macronucleus
      for (let j = 0; j < fvCount; j++) {
        // spread across the lower-mid granular endoplasm so they read as DISCRETE
        // spheres (not a clump): wide axial range, tighter lateral, smaller radii.
        // CYCLOSIS: each vacuole rides a divergence-free wall-tangent gyre psi=(1-ua^2)(1-sv^2),
        // phase from frame.t -> streams in life, byte-stable at a fixed t. Period 40s idle.
        // CONSTANT realistic cyclosis (~34-48s loop ~= a few um/s); NOT coupled to audio.
        const cycT = 34 + seededUnit(fvSeed, j, 0x13b7) * 14;
        const phi0 = seededUnit(fvSeed, j, 0x51bd0e77) * TAU;
        const amp = 0.96 * Math.sqrt(seededUnit(fvSeed, j, 0x2cd9a14b)); // area-uniform radial fill (no floor) -> no hollow donut centre
        // + slow aperiodic noise so the loop never repeats byte-for-byte (alive, not a screensaver)
        const ph = (TAU / cycT) * tt + phi0 + 0.6 * noise2D(fvSeed, phi0 * 5.1 + j, tt * 0.05);
        const u = 0.46 + 0.42 * amp * Math.sin(ph); // gyre centred slightly toward the base (posterior oil-droplet bias)
        const lat = amp * Math.cos(ph) * 0.72 * halfW(u) * breathMod(u);
        const fv = bodyPoint(drawBellH * u, lat);
        const fr = Math.max(0.7, D * (0.028 + seededUnit(fvSeed, j, 0x7e3a5d91) * 0.075)); // wide size spread
        // refractile ingested-prey sphere: lit cap -> body -> dark Becke rim -> feather,
        // + specular (radial gradient = a 3-D bead, not a flat polka-dot with a hard ring).
        const warm = j === 0; // reserve a faint warm tint for one ingested-prey vacuole
        // DARKFIELD refractile vacuole = a bright cool scattering ANNULUS (bright rim, dim
        // centre), NOT a CG glass marble with a directional specular cap.
        const fg = ctx.createRadialGradient(fv.x, fv.y, fr * 0.1, fv.x, fv.y, fr * 1.12);
        fg.addColorStop(0, `hsla(200, 14%, 80%, ${alpha * 0.14})`);
        fg.addColorStop(0.55, `hsla(198, 16%, 86%, ${alpha * 0.2})`);
        fg.addColorStop(0.84, warm ? `hsla(42, 26%, 92%, ${alpha * 0.46})` : `hsla(196, 24%, 96%, ${alpha * 0.52})`);
        fg.addColorStop(1, `hsla(196, 30%, 96%, 0)`);
        ctx.beginPath();
        ctx.arc(fv.x, fv.y, fr * 1.12, 0, TAU);
        ctx.fillStyle = fg;
        ctx.fill();
      }
    }
    ctx.restore(); // end interior clip

    // === PERISTOME lip + oral ciliary wreath (the feeding crown) ===
    // raised lip: a thin band at the rim, outer Rrim, drawn as an ellipse seen 3/4
    const lipRy = Math.max(0.5, Rrim * 0.24); // shallow rolled rim, not a deep flat plate
    // amorphous everted rim + peristomial disc (slightly IRREGULAR, not machined
    // concentric ellipses): wobble each ring with low-frequency seeded noise.
    const ringPath = (rl: number, rd: number, wob: number): AquariumPoint[] => {
      const pts: AquariumPoint[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * TAU;
        const w = 1 + wob * (0.6 * Math.sin(a * 3 + lobePhase) + 0.4 * Math.sin(a * 2 - bp0));
        const lateral = Math.cos(a) * rl * w;
        const depth = Math.sin(a) * rd * w;
        pts.push({ x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth });
      }
      return pts;
    };
    drawPolyline(ctx, ringPath(Rrim, lipRy, 0.05), true);
    ctx.fillStyle = `hsla(186, 36%, 88%, ${alpha * 0.22 * open})`;
    ctx.fill();
    ctx.strokeStyle = `hsla(186, 50%, 90%, ${alpha * 0.55 * open})`;
    ctx.lineWidth = Math.max(0.75, D * 0.05);
    ctx.stroke();
    // convex peristomial disc capping the bell mouth (amorphous, slightly domed)
    drawPolyline(ctx, ringPath(Rrim * 0.9, lipRy * 0.9, 0.07), true);
    ctx.fillStyle = `hsla(200, 12%, 84%, ${alpha * 0.26 * open})`;
    ctx.fill();

    // adoral zone of membranelles (AZM): a CCW spiral on the peristomal disc
    // funnelling to the cytostome — the feeding vortex.
    if (crownFade > 0.02 && D >= 9) {
      const turns = 1.6, N = 30;
      const cytLat = Rrim * 0.30, cytDep = lipRy * 0.30;
      const spiral: AquariumPoint[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const rr = 1 - t;
        const a = -t * turns * TAU; // CCW inward
        const lateral = Math.cos(a) * Rrim * rr + cytLat * t;
        const depth = Math.sin(a) * lipRy * rr + cytDep * t;
        spiral.push({ x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth });
      }
      drawPolyline(ctx, spiral, false);
      ctx.strokeStyle = `hsla(198, 18%, 94%, ${alpha * 0.48 * crownFade * glow})`; // beating ciliary wreath = among the brightest darkfield features
      ctx.lineWidth = Math.max(0.75, D * 0.03);
      ctx.stroke();
      // second, inner membranelle row (phase-offset) so the AZM reads as a
      // layered band driving a feeding vortex, not a single circlet.
      const spiral2: AquariumPoint[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const rr = (1 - t) * 0.7;
        const a = -t * turns * TAU + 0.6;
        const lateral = Math.cos(a) * Rrim * rr + cytLat * t;
        const depth = Math.sin(a) * lipRy * rr + cytDep * t;
        spiral2.push({ x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth });
      }
      drawPolyline(ctx, spiral2, false);
      ctx.strokeStyle = `hsla(198, 18%, 92%, ${alpha * 0.34 * crownFade * glow})`;
      ctx.lineWidth = Math.max(0.75, D * 0.022);
      ctx.stroke();
      const cyt = { x: rimC.x + nx * cytLat + ux * cytDep, y: rimC.y + ny * cytLat + uy * cytDep };
      ctx.beginPath();
      ctx.arc(cyt.x, cyt.y, Math.max(0.4, D * 0.05), 0, TAU);
      ctx.fillStyle = `hsla(200, 16%, 64%, ${alpha * 0.42 * crownFade})`;
      ctx.fill();
    }

    // oral wreath: short cilia tufts around the rim, metachronal traveling wave
    if (crownFade > 0.02) {
      const oral = wrapUnit(finite(cell.oralWreathPhase, 0));
      // soft blurred wreath band: implies the beating ciliary circlet as a haze, NOT teeth
      const bandPts: AquariumPoint[] = [];
      for (let i = 0; i <= 36; i++) {
        const a = i / 36;
        const lateral = Math.cos(a * TAU) * Rrim;
        const depth = Math.sin(a * TAU) * lipRy;
        bandPts.push({ x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth });
      }
      drawPolyline(ctx, bandPts, true);
      ctx.strokeStyle = `hsla(198, 16%, 93%, ${alpha * 0.26 * crownFade * glow})`;
      ctx.lineWidth = Math.max(1.0, D * 0.11);
      ctx.stroke();
      // fine, faint individual cilia splayed OUTWARD over the everted lip (not a vertical comb)
      const M = Math.max(8, Math.round(D * 0.7));
      ctx.strokeStyle = `hsla(198, 16%, 93%, ${alpha * 0.30 * crownFade * glow})`;
      ctx.lineWidth = Math.max(0.5, D * 0.018);
      const cilS = (Math.round(finite(cell.restLength, 10) * 2048) ^ 0x51a3) >>> 0;
      for (let i = 0; i < M; i++) {
        const a = (i / M);
        const ca = Math.cos(a * TAU);
        const lateral = ca * Rrim;
        const depth = Math.sin(a * TAU) * lipRy;
        const base = { x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth };
        const beat = Math.sin((a * 2 - oral) * TAU);
        const lv = 0.7 + seededUnit(cilS, i, 0x2b9d) * 0.6; // varied length, not a uniform comb
        const len = D * (0.10 + 0.025 * beat) * lv;
        // splay outward (lateral, sign by side) + a little up (along axis)
        const outx = nx * (ca >= 0 ? 0.5 : -0.5) + ux;
        const outy = ny * (ca >= 0 ? 0.5 : -0.5) + uy;
        const tip = { x: base.x + outx * len + nx * beat * D * 0.02, y: base.y + outy * len + ny * beat * D * 0.02 };
        drawPolyline(ctx, [base, tip], false);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
