import type { AquariumFrame, AquariumParamsView, DidiniumState } from "../types";
import { seededUnit } from "../seeds";
import { TAU, clamp, clamp01, finite, finiteOr, smoothstep, wrapUnit } from "../util";
import {
  DIDINIUM_ASPECT,
  DIDINIUM_BRUSH_ROWS,
  DIDINIUM_GIRDLE_A_U,
  DIDINIUM_GIRDLE_P_U,
  DIDINIUM_SHOULDER_U,
  didiniumDisplayLength,
  didiniumNormHalfWidth,
} from "./geometry";

function didiniumModeAlphaMul(mode: AquariumFrame["mode"]): number {
  switch (mode) {
    case "recording":
      return 1.08;
    case "transcribing":
      return 0.8;
    case "error":
      return 0.55;
    case "idle":
    default:
      return 1.0;
  }
}

function transform(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  along: number,
  lateral: number,
): { x: number; y: number } {
  const nx = -uy;
  const ny = ux;
  return { x: cx + ux * along + nx * lateral, y: cy + uy * along + ny * lateral };
}

function drawPolyline(ctx: CanvasRenderingContext2D, points: readonly { x: number; y: number }[], close: boolean): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

export function drawDidinium(
  ctx: CanvasRenderingContext2D,
  didinium: readonly DidiniumState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): void {
  if (!view.enabled || didinium.length === 0 || view.didinium.count <= 0) return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.9 * didiniumModeAlphaMul(frame.mode)));
  if (alpha <= 0) return;
  const scale = Math.max(0.1, finite(view.didinium.scale, 1));
  // darkfield: cool blue-white luminous; girdles + nucleus + CV are the bright cues.
  const hue = 200 + finite(view.didinium.hueOffset, 0);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  didinium.forEach((cell) => {
    const L = didiniumDisplayLength(finite(cell.size, 1), scale);
    const halfLength = L / 2;
    const wMax = (L / DIDINIUM_ASPECT) / 2; // half of body width
    // orient the body along the TRAVEL heading (phase) so the snout always leads
    // the actual motion (no sideways crab); falls back to heading at seed.
    const heading = finiteOr(cell.phase, finite(cell.heading, 0));
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const cx = finite(cell.x, 0);
    const cy = finite(cell.y, 0);
    const roll = wrapUnit(finite(cell.rollPhase, 0));
    const rollAng = roll * TAU;
    const rollCos = Math.cos(rollAng);
    // near-constant silhouette: a barrel spinning about its long axis keeps a
    // round cross-section, so only a slight (8%) breathing — the roll is carried
    // by the depth-shaded girdle ticks, NOT by squashing the whole body (which
    // read as a non-physical fat wobble). (math critic S4)
    const widthMul = 0.96 + 0.04 * Math.abs(rollCos);

    const halfWidthAt = (u: number): number => wMax * widthMul * didiniumNormHalfWidth(u);

    // ── body outline (closed barrel + cone snout), cosine-clustered samples ──
    const SAMP = 64; // higher → smooth rounded silhouette (no faceting)
    const upper: { x: number; y: number }[] = [];
    const lower: { x: number; y: number }[] = [];
    for (let i = 0; i <= SAMP; i++) {
      const u = -Math.cos((Math.PI * i) / SAMP); // clusters toward poles
      const hw = halfWidthAt(u);
      upper.push(transform(cx, cy, ux, uy, halfLength * u, hw));
      lower.push(transform(cx, cy, ux, uy, halfLength * u, -hw));
    }
    const outline = [...upper, ...lower.reverse()];

    // ── body: LUMINOUS cool blue-white granule-scattering glow (darkfield) ──
    // A radial gradient inside the clipped outline makes the whole zooid glow
    // edge-to-edge instead of a flat grey card. Brightest mid-body, easing out.
    ctx.save();
    drawPolyline(ctx, outline, true);
    ctx.clip();
    const glowR = Math.max(1, halfLength * 1.05);
    const grad = ctx.createRadialGradient(cx, cy, glowR * 0.1, cx, cy, glowR);
    grad.addColorStop(0, `hsla(${hue}, 26%, 92%, ${alpha * 0.66})`);
    grad.addColorStop(0.62, `hsla(${hue + 2}, 30%, 84%, ${alpha * 0.5})`);
    grad.addColorStop(1, `hsla(${hue + 4}, 34%, 74%, ${alpha * 0.16})`);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

    // dense two-layer granular endoplasm stipple (coarse + fine), birth-stable,
    // so the body scatters like packed cytoplasm (clipped to the outline).
    const gSeed = finiteOr(cell.noiseSeed, 0) | 0;
    const gCount = Math.round(clamp(L * 6, 60, 220)); // denser packed endoplasm (real cytoplasm is crowded)
    for (let g = 0; g < gCount; g++) {
      const gu = (seededUnit(gSeed, g, 0x51bd0e77) * 2 - 1) * 0.9;
      const gs = (seededUnit(gSeed, g, 0x9a1f2b3c) * 2 - 1) * 0.92;
      const hw = halfWidthAt(gu);
      const p = transform(cx, cy, ux, uy, halfLength * gu, gs * hw);
      const r = 0.5 + seededUnit(gSeed, g, 0x2cd9a14b) * 0.9;
      // Leave a very subtle lower-contrast lane at the two pectinelle latitudes so
      // the ciliary bands separate from endoplasm stipple without drawing chords.
      const nearGirdle = Math.min(Math.abs(gu - DIDINIUM_GIRDLE_A_U), Math.abs(gu - DIDINIUM_GIRDLE_P_U));
      const lane = smoothstep(clamp01(1 - nearGirdle / 0.075));
      ctx.fillStyle = `hsla(${hue}, 22%, ${90 - 8 * lane}%, ${alpha * (0.34 - 0.12 * lane)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }
    const gCount2 = Math.round(clamp(L * 4, 40, 150));
    for (let g = 0; g < gCount2; g++) {
      const gu = (seededUnit(gSeed, g, 0x3da17c45) * 2 - 1) * 0.9;
      const gs = (seededUnit(gSeed, g, 0x59e2b7a3) * 2 - 1) * 0.92;
      const hw = halfWidthAt(gu);
      const p = transform(cx, cy, ux, uy, halfLength * gu, gs * hw);
      const r = 0.3 + seededUnit(gSeed, g, 0x14c8af21) * 0.5;
      const nearGirdle = Math.min(Math.abs(gu - DIDINIUM_GIRDLE_A_U), Math.abs(gu - DIDINIUM_GIRDLE_P_U));
      const lane = smoothstep(clamp01(1 - nearGirdle / 0.075));
      ctx.fillStyle = `hsla(${hue + 4}, 18%, ${94 - 6 * lane}%, ${alpha * (0.16 - 0.07 * lane)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // feathered scattering rim (no hard ink line): brighter on the flanks, dim at
    // the poles — darkfield bands are fuzzy, not geometric construction lines.
    for (let i = 0; i < upper.length - 1; i++) {
      const u = -Math.cos((Math.PI * i) / SAMP);
      const flank = 1 - Math.abs(u); // bright mid-body flanks, dim toward poles
      const a = alpha * (0.1 + 0.18 * flank * flank); // dimmer, squared falloff (rim < interior)
      ctx.strokeStyle = `hsla(${hue + 2}, 32%, 92%, ${a})`;
      ctx.lineWidth = Math.max(0.5, wMax * 0.07);
      ctx.beginPath();
      ctx.moveTo(upper[i].x, upper[i].y);
      ctx.lineTo(upper[i + 1].x, upper[i + 1].y);
      ctx.moveTo(lower[i].x, lower[i].y);
      ctx.lineTo(lower[i + 1].x, lower[i + 1].y);
      ctx.stroke();
    }

    // ── horseshoe / sausage macronucleus (soft cool band, fades when edge-on) ──
    {
      const muStart = -0.58;
      const muEnd = 0.4; // spans ~0.6L
      const bowDepth = 0.72 * (0.45 + 0.55 * Math.abs(rollCos)); // deeper C-bow + floor so it never collapses to a strut
      // smooth continuous horseshoe: many samples + a half-cosine along-axis arc so
      // the C stays a rounded semicircle at every roll phase (no chevron kink).
      const MN = 40;
      const side2 = rollCos >= 0 ? 1 : -1;
      const macro: { x: number; y: number }[] = [];
      for (let k = 0; k <= MN; k++) {
        const f = k / MN;
        // place samples along a true arc: the along-axis coord follows a gentle
        // cosine so endpoints curl back (horseshoe), not a straight bar.
        const u = muStart + (muEnd - muStart) * (0.5 - 0.5 * Math.cos(Math.PI * f));
        const bow = Math.sin(f * Math.PI) * bowDepth;
        const lat = bow * halfWidthAt(u) * side2;
        macro.push(transform(cx, cy, ux, uy, halfLength * u, lat));
      }
      // FILLED SAUSAGE: offset the centerline perpendicular to its local tangent
      // by a half-thickness that tapers to rounded ends, building a closed ribbon
      // — a solid worm-like macronucleus (Berdan DIC), not a hollow stroked tube.
      const halfTh = Math.max(1.2, wMax * 0.2); // half-thickness of the sausage
      const left: { x: number; y: number }[] = [];
      const right: { x: number; y: number }[] = [];
      for (let k = 0; k <= MN; k++) {
        const f = k / MN;
        const taper = Math.pow(Math.sin(Math.max(0, Math.min(1, f)) * Math.PI), 0.45); // rounded ends
        const a = macro[Math.max(0, k - 1)];
        const b = macro[Math.min(MN, k + 1)];
        let tx = b.x - a.x, ty = b.y - a.y;
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const nx2 = -ty, ny2 = tx; // perpendicular to the centerline tangent
        const th = halfTh * (0.55 + 0.45 * taper); // fuller-bodied sausage (less crescent)
        const p = macro[k];
        left.push({ x: p.x + nx2 * th, y: p.y + ny2 * th });
        right.push({ x: p.x - nx2 * th, y: p.y - ny2 * th });
      }
      const ribbon = [...left, ...right.reverse()];
      // DOMINANT SOLID filled C — the single headline DIC interior landmark.
      // No wide underglow halo (a stroke wider than the fill made a glowing RING).
      // NEUTRAL grey (very low saturation) so it reads as solid chromatin, NOT a
      // glowing cyan crescent.
      drawPolyline(ctx, ribbon, true);
      ctx.fillStyle = `hsla(${hue - 8}, 6%, 76%, ${alpha * 0.9})`;
      ctx.fill();
      // MOTTLED chromatin texture (clipped to the C): seeded darker/brighter
      // blobs along the centerline so it reads as a granular nucleus, not a flat
      // fill (Berdan DIC shows a mottled C). Deterministic from the cell seed.
      ctx.save();
      drawPolyline(ctx, ribbon, true);
      ctx.clip();
      const mnSeed = finiteOr(cell.noiseSeed, 0) | 0;
      for (let m = 0; m < MN; m += 2) {
        const c0 = macro[m];
        const u01 = seededUnit(mnSeed, m, 0x5c1d2b3f);
        const dark = u01 < 0.5;
        const jx = (seededUnit(mnSeed, m, 0x2cd9a14b) - 0.5) * halfTh * 1.2;
        const jy = (seededUnit(mnSeed, m, 0x9a1f2b3c) - 0.5) * halfTh * 1.2;
        const r = halfTh * (0.4 + 0.5 * seededUnit(mnSeed, m, 0x14c8af21));
        ctx.fillStyle = dark
          ? `hsla(${hue - 8}, 7%, 50%, ${alpha * 0.6})`
          : `hsla(${hue}, 7%, 90%, ${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(c0.x + jx, c0.y + jy, r, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      // faint brighter rim on the filled body for refractile relief
      drawPolyline(ctx, ribbon, true);
      ctx.strokeStyle = `hsla(${hue - 2}, 18%, 90%, ${alpha * 0.36})`;
      ctx.lineWidth = Math.max(0.4, wMax * 0.04);
      ctx.stroke();
    }

    // ── two TRANSVERSE pectinelle girdles = bright encircling ciliary rings ──
    // Each girdle is a full hoop (0..2π) around the body cross-section, projected
    // as a thin ellipse (wide along the body normal, foreshortened along-axis).
    // Many SHORT radial cilia ticks fringe it; depth-shaded by roll (near bright /
    // far dim) so the ring visibly sweeps as the body rotates. Metachronal wave
    // runs around the ring. NO forward sweep — ticks are radial (not blades).
    // No drawn seat-ellipse (that read as a wireframe hoop). Instead a fuzzy band
    // of short cilia ticks, with the FAR half of the ring clipped (invisible), so
    // each girdle reads as a bright scattering crescent on the near face that
    // sweeps as the body rolls. Many faint jittered ticks, metachronal wave.
    const beat = wrapUnit(finiteOr(cell.beatPhase, 0));
    const RING_TILT = 0.1; // along-axis foreshortening: low → a FLAT transverse band, not a crossing diagonal ribbon
    const gSeedR = finiteOr(cell.noiseSeed, 0) | 0;
    const drawGirdle = (gu: number, seatHue: number, gi: number) => {
      const hw = halfWidthAt(gu);
      const baseAlong = halfLength * gu;
      const NT = 104; // DENSE fine fringe (real pectinelles are numerous close-set cilia)
      // NO seat chord line: a bright polyline spanning lat=-hw..+hw read as a
      // straight construction line cutting across the body interior. The girdle is
      // now ONLY the dense comb of short ticks below — a surface fringe, not a
      // drawn hoop/chord.
      ctx.lineWidth = Math.max(0.3, wMax * 0.026); // thin fringe so it reads as a dense comb
      for (let s = 0; s < NT; s++) {
        const phi = (s / NT) * TAU;
        const depth = Math.cos(phi + rollAng); // 1 = nearest viewer
        if (depth < -0.1) continue; // clip the FAR arc → no wireframe back-side
        const front = clamp01(0.5 + 0.5 * depth);
        const jit = (seededUnit(gSeedR, s + gi * 97, 0x2cd9a14b) - 0.5) * 0.1;
        const lat = Math.cos(phi) * hw;
        const along = baseAlong + Math.sin(phi) * hw * RING_TILT;
        const wave = 0.5 + 0.5 * Math.sin(TAU * beat - phi * 3.0); // metachronal
        // VERY SHORT ticks (a fuzzy fringe), uniform along the whole near arc, so
        // the dense NT=96 set reads as one continuous transverse ciliary BAND, not
        // a few long radial urchin-spikes (long ticks + edge-gating collapsed into
        // spikes). No rim gating — length is small enough everywhere that no tick
        // ever reads as a construction line or a spur.
        const cilLen = hw * (0.042 + 0.022 * wave) * (1 + jit);
        const outLat = Math.cos(phi);
        const outAlong = Math.sin(phi) * RING_TILT;
        // Dot-band only: NO line segment. Add seeded thickness/jitter around the
        // mathematical ring so particles form a fuzzy pectinelle BELT, not an
        // unnaturally straight row of dots.
        const bandJ1 = (seededUnit(gSeedR, s + gi * 131, 0x7c2a9b11) - 0.5) * hw * 0.34;
        const bandJ2 = (seededUnit(gSeedR, s + gi * 131, 0x4e11c3a7) - 0.5) * hw * 0.34;
        const base = transform(cx, cy, ux, uy, along + bandJ1 * 0.55, lat + bandJ2);
        ctx.fillStyle = `hsla(${seatHue}, 34%, 94%, ${alpha * (0.07 + 0.22 * front)})`;
        ctx.beginPath();
        ctx.arc(base.x, base.y, Math.max(0.42, wMax * 0.052), 0, TAU);
        ctx.fill();
        if (s % 2 === 0) {
          const bandJ3 = (seededUnit(gSeedR, s + gi * 149, 0x2f7d5a91) - 0.5) * hw * 0.32;
          const bandJ4 = (seededUnit(gSeedR, s + gi * 149, 0x61b4d829) - 0.5) * hw * 0.32;
          const dust = transform(cx, cy, ux, uy, along + outAlong * cilLen * 0.35 + bandJ3 * 0.45, lat + outLat * cilLen * 0.35 + bandJ4);
          ctx.fillStyle = `hsla(${seatHue}, 36%, 96%, ${alpha * (0.05 + 0.15 * front)})`;
          ctx.beginPath();
          ctx.arc(dust.x, dust.y, Math.max(0.28, wMax * 0.03), 0, TAU);
          ctx.fill();
        }
      }
    };
    drawGirdle(DIDINIUM_GIRDLE_A_U, hue + 6, 0);
    drawGirdle(DIDINIUM_GIRDLE_P_U, hue + 6, 1);

    // ── dorsal brushes (brosse): short clavate tick rows behind each girdle, on
    // the NEAR hemisphere only (depth-gated) — a named D. nasutum diagnostic. ──
    const drawBrushes = (gu: number) => {
      const phi = rollAng; // dorsal landmark rides the near face as the body rolls
      const depth = Math.cos(phi); // near when > 0
      if (depth < 0) return; // hidden on the far hemisphere
      const front = clamp01(0.5 + 0.5 * depth);
      for (let r = 0; r < DIDINIUM_BRUSH_ROWS; r++) {
        const bu = gu - 0.06 - r * 0.035; // a few rows just behind the girdle
        const hw = halfWidthAt(bu);
        const lat = Math.cos(phi) * hw * 0.62;
        const along = halfLength * bu + Math.sin(phi) * hw * 0.34 * 0.62;
        // clavate brush dot INSIDE the silhouette (no antenna line): visible in zoom,
        // but contained and biologically reads as brosse rows behind the girdle.
        const dot = transform(cx, cy, ux, uy, along + hw * 0.028, lat + Math.sign(lat || 1) * hw * 0.028);
        ctx.fillStyle = `hsla(${hue + 8}, 34%, 92%, ${alpha * 0.48 * front})`;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, Math.max(0.28, wMax * 0.026), 0, TAU);
        ctx.fill();
      }
    };
    drawBrushes(DIDINIUM_GIRDLE_A_U);
    drawBrushes(DIDINIUM_GIRDLE_P_U);

    // ── apical cone snout (cytostome cone) detailing. The cone SILHOUETTE is
    // already drawn by the body outline (bodyShape covers u up to +1), so we do
    // NOT draw a separate filled triangle here — that duplicated geometry with a
    // different (straight) profile and read as a detached angular flap. We only
    // add interior detail: nematodesmal striae, a subtle base collar, the pip.
    {
      const coneBaseU = DIDINIUM_SHOULDER_U;
      const tip = transform(cx, cy, ux, uy, halfLength * 1.02, 0); // on-axis apex
      // nematodesmal striae: only a few dim mottled dots near the cone axis.
      // No converging line segments — those read as a triangular construction fan.
      const NS = 4;
      for (let k = 1; k < NS; k++) {
        const f = k / NS;
        const lat = (f * 2 - 1) * halfWidthAt(coneBaseU) * 0.22;
        const dot = transform(cx, cy, ux, uy, halfLength * (coneBaseU + (1.02 - coneBaseU) * 0.62), lat);
        ctx.fillStyle = `hsla(${hue + 4}, 14%, 88%, ${alpha * 0.08})`;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, Math.max(0.2, wMax * 0.018), 0, TAU);
        ctx.fill();
      }
      // collar of forward-flared cilia at the cone base — the prominent anterior
      // wreath seen in the micrographs where the snout joins the body.
      const collarHw = halfWidthAt(coneBaseU);
      ctx.lineWidth = Math.max(0.35, wMax * 0.03);
      for (let s = 0; s <= 10; s++) {
        const f = s / 10;
        const lat = (f * 2 - 1) * collarHw;
        const depth = Math.cos(rollAng); // collar rides the near face
        if (depth < -0.2) continue;
        const front = clamp01(0.5 + 0.5 * depth);
        const base = transform(cx, cy, ux, uy, halfLength * coneBaseU, lat);
        // short collar tick that stays inside the silhouette (minimal flare) so it
        // reads as a wreath, not projecting antennae.
        const tipC = transform(cx, cy, ux, uy, halfLength * (coneBaseU + 0.045), lat + Math.sign(lat || 1) * collarHw * 0.05);
        ctx.strokeStyle = `hsla(${hue + 6}, 30%, 91%, ${alpha * (0.1 + 0.28 * front)})`;
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(tipC.x, tipC.y);
        ctx.stroke();
      }
      // apical pip (closed cytostome): a SMALL soft dot, NOT a bright bead/knob on
      // a stick (that read as a non-biological terminal bead).
      ctx.fillStyle = `hsla(${hue + 4}, 18%, 88%, ${alpha * 0.17})`;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, Math.max(0.36, wMax * 0.052), 0, TAU);
      ctx.fill();
    }

    // ── terminal contractile vacuole at the aboral (posterior) pole, refractile ──
    {
      const cvPulse = 0.5 - 0.5 * Math.cos(TAU * wrapUnit(finiteOr(cell.cvPhase, 0)));
      const cvR = Math.max(0.5, wMax * (0.13 + 0.06 * cvPulse)); // small, ~0.15×
      const p = transform(cx, cy, ux, uy, -halfLength * 0.86, 0); // terminal/posterior
      ctx.fillStyle = `hsla(${hue + 2}, 22%, 90%, ${alpha * 0.22})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, cvR, 0, TAU);
      ctx.fill();
      // refractile ring (annulus), not a solid eye
      ctx.strokeStyle = `hsla(${hue + 4}, 32%, 96%, ${alpha * 0.78})`;
      ctx.lineWidth = Math.max(0.4, wMax * 0.04);
      ctx.beginPath();
      ctx.arc(p.x, p.y, cvR, 0, TAU);
      ctx.stroke();
    }
  });

  ctx.restore();
}
