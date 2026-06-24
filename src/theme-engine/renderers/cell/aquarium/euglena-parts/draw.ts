import type { AquariumFrame, AquariumParamsView, EuglenaState } from "../types";
import { TAU, clamp, finite, finiteOr, wrapUnit } from "../util";
import { euglenaDisplayLength, euglenaPose } from "./pose";
import type { AquariumPoint } from "./pose";

interface EuglenaDrawModeView {
  readonly alphaMul: number;
}

function euglenaDrawModeView(mode: AquariumFrame["mode"]): EuglenaDrawModeView {
  switch (mode) {
    case "recording":
      return { alphaMul: 1.08 };
    case "transcribing":
      return { alphaMul: 0.80 };
    case "error":
      return { alphaMul: 0.55 };
    case "idle":
    default:
      return { alphaMul: 1.00 };
  }
}

function drawPolyline(ctx: CanvasRenderingContext2D, points: readonly AquariumPoint[], close: boolean): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

/** Intermittent metaboly envelope from a dt-integrated burst phase (~40% duty). */
function metabolyEnvelope(burstPhase: number): number {
  const p = wrapUnit(burstPhase);
  if (p < 0.6) return 0;
  return Math.sin(((p - 0.6) / 0.4) * Math.PI);
}

export function drawEuglena(
  ctx: CanvasRenderingContext2D,
  euglena: readonly EuglenaState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): void {
  if (!view.enabled || euglena.length === 0 || view.euglena.count <= 0) return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.72 * euglenaDrawModeView(frame.mode).alphaMul));
  if (alpha <= 0) return;
  const scale = Math.max(0.1, finite(view.euglena.scale, 1));
  const hue = finite(frame.baseHue, 50) + finite(view.euglena.hueOffset, 42);
  const H = Math.max(1, finite(frame.height, 36));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  euglena.forEach((cell, idx) => {
    // Foreshorten the body through a U-turn so the long cell never rotates into
    // a clipped vertical sliver inside the short 36px strip (looks like it turns
    // toward the viewer). Full length is still used for speed/margin in update.
    const tp = finiteOr(cell.turnProgress, 2);
    const turnShrink = tp < 1 ? 0.5 + 0.5 * Math.abs(Math.cos(tp * Math.PI)) : 1;
    const fullLength = euglenaDisplayLength(finite(cell.size, 1), scale);
    const length = fullLength * turnShrink;
    // as the body foreshortens through the turn it also widens — reads as a cell
    // pivoting toward the viewer, not a thin edge-on blade.
    const turnWiden = 1 + 0.9 * (1 - turnShrink);
    const width = fullLength * 0.22 * turnWiden;
    const flagellumLength = length * 0.95; // ~1× body (real: ½–1×)
    const heading = finite(cell.heading, 0);

    // LOD ladder by display length L
    const chCount = length < 7 ? 0 : length < 14 ? 5 : length < 40 ? clamp(Math.round(length / 4), 8, 12) : clamp(Math.round(length / 4.5), 12, 20); // real 6-16 discoid chloroplasts
    const stCount = length < 7 ? 0 : length < 14 ? 2 : length < 40 ? 4 : Math.min(7, Math.round(length / 9));
    const pmCount = length < 14 ? 0 : length < 40 ? 1 : 2;
    const includeNucleus = length >= 14;
    const includeReservoir = length >= 7;
    const includeCV = length >= 14;
    const flagSegs = clamp(Math.round(length / 3), 10, 24);

    // helix lateral offset: tanh soft-clamp (C∞, no flat-topped corners)
    const roll = wrapUnit(finite(cell.rollPhase, 0));
    const aHelix = finiteOr(cell.spiralAmplitude, 0.15) * length;
    const apparentW = width * (0.85 + 0.15 * Math.abs(Math.cos(roll * TAU)));
    const lmax = Math.max(0, 0.4 * H - apparentW / 2);
    const aFit = Math.min(aHelix, 0.9 * lmax);
    const lateral = lmax > 0 ? lmax * Math.tanh((aFit * Math.sin(roll * TAU + heading)) / lmax) : 0;
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const nx = -uy;
    const ny = ux;
    const cxr = finite(cell.x, 0) + nx * lateral;
    const cyr = finite(cell.y, 0) + ny * lateral;

    // beat vigour ebbs and surges (deterministic) so the whip is never
    // metronomic. Real cruising beats are regular but show stochastic "active
    // fluctuations" (Ma/Friedrich PRL 2014) — approximated here by a sum of two
    // incommensurate slow components so there is no single clean period.
    const bp = wrapUnit(finiteOr(cell.burstPhase, 0));
    const hh = finite(cell.heading, 0);
    // discrete turning-beat flick (matches updateEuglena) surges the whip wider
    const flick = bp < 0.08 ? Math.sin((bp / 0.08) * Math.PI) : 0;
    const vigour = 0.80
      + 0.12 * Math.sin(TAU * bp + hh)
      + 0.08 * Math.sin(TAU * bp * 2.7 + hh * 1.7)
      + 0.30 * flick;
    const ampTip = clamp(length * 0.22, 2, 0.40 * H) * vigour;
    const env = metabolyEnvelope(finiteOr(cell.burstPhase, 0));

    const pose = euglenaPose(cell.rollPhase, cell.metabolyPhase, {
      centerX: cxr,
      centerY: cyr,
      length,
      baseWidth: width,
      heading,
      flagellumLength,
      flagellumPhase: cell.flagellumPhase,
      flagellumAmp: ampTip,
      maxFlagellumLateral: 0.40 * H,
      flagellumSegments: flagSegs,
      flagellumWaves: 1.5,
      metabolyEnvelope: env,
      organelleSeed: (view.seed ^ ((idx + 1) * 0x9e3779b1)) >>> 0,
      chloroplastCount: chCount,
      striaeCount: stCount,
      paramylonCount: pmCount,
      includeNucleus,
      includeReservoir,
      includeCV,
      cvPhase: cell.cvPhase,
    });

    // body fill + rim (vivid grass green)
    drawPolyline(ctx, pose.outline, true);
    ctx.fillStyle = `hsla(${hue}, 50%, 46%, ${alpha * 0.50})`;
    ctx.strokeStyle = `hsla(${hue + 6}, 42%, 64%, ${alpha * 0.62})`;
    ctx.lineWidth = Math.max(0.5, Math.min(0.9, width * 0.08));
    ctx.fill();
    ctx.stroke();

    // anterior "gullet" clearing — the reservoir/canal region is COLORLESS, not
    // green, so the cell is not uniformly green: a pale clear wash over the front.
    if (length >= 12) {
      const gx = cxr + ux * length * 0.33;
      const gy = cyr + uy * length * 0.33;
      ctx.fillStyle = `hsla(188, 16%, 84%, ${alpha * 0.20})`;
      ctx.beginPath();
      ctx.ellipse(gx, gy, length * 0.26, width * 0.40, heading, 0, TAU);
      ctx.fill();
    }

    // pellicle striae (cool sheen lines, helical)
    if (pose.pellicleStrips.length > 0) {
      ctx.strokeStyle = `hsla(${hue - 6}, 22%, 76%, ${alpha * 0.40})`;
      ctx.lineWidth = Math.max(0.35, Math.min(0.55, width * 0.06));
      for (const strip of pose.pellicleStrips) {
        drawPolyline(ctx, strip, false);
        ctx.stroke();
      }
    }

    // chloroplasts (the dense green mass; roll fades the far face)
    for (const c of pose.chloroplasts) {
      const fa = alpha * 0.74 * (0.65 + 0.35 * c.front);
      ctx.fillStyle = `hsla(${hue + c.hueShift}, 64%, ${40 + c.lightShift}%, ${fa})`;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.ry, c.angle, 0, TAU);
      ctx.fill();
    }

    // nucleus (dim olive clearing with a faint rim — not a bright bubble)
    if (pose.nucleus) {
      ctx.fillStyle = `hsla(${hue - 2}, 20%, 44%, ${alpha * 0.34})`;
      ctx.beginPath();
      ctx.ellipse(pose.nucleus.x, pose.nucleus.y, pose.nucleus.rx, pose.nucleus.ry, pose.nucleus.angle, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue - 6}, 18%, 38%, ${alpha * 0.5})`;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.ellipse(pose.nucleus.x, pose.nucleus.y, pose.nucleus.rx, pose.nucleus.ry, pose.nucleus.angle, 0, TAU);
      ctx.stroke();
    }

    // paramylon (small refractile bodies; first is a ring)
    pose.paramylon.forEach((p, j) => {
      const fa = alpha * 0.42 * (0.55 + 0.45 * p.front);
      ctx.fillStyle = `hsla(50, 12%, 74%, ${fa})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, p.angle, 0, TAU);
      ctx.fill();
      if (j === 0) {
        ctx.strokeStyle = `hsla(50, 14%, 68%, ${alpha * 0.45})`;
        ctx.lineWidth = Math.max(0.3, width * 0.05);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx, p.ry, p.angle, 0, TAU);
        ctx.stroke();
      }
    });

    // reservoir (small pale anterior pocket)
    if (pose.reservoir) {
      ctx.fillStyle = `hsla(186, 18%, 78%, ${alpha * 0.30})`;
      ctx.beginPath();
      ctx.arc(pose.reservoir.x, pose.reservoir.y, pose.reservoir.r, 0, TAU);
      ctx.fill();
    }

    // contractile vacuole (slow pulse)
    if (pose.contractileVacuole) {
      ctx.fillStyle = `hsla(190, 16%, 86%, ${alpha * 0.34})`;
      ctx.beginPath();
      ctx.arc(pose.contractileVacuole.x, pose.contractileVacuole.y, Math.max(0.4, pose.contractileVacuole.r), 0, TAU);
      ctx.fill();
    }

    // stigma / eyespot (single warm accent; dims as it rolls to the far face)
    ctx.fillStyle = `hsla(8, 88%, 49%, ${alpha * (0.45 + 0.47 * pose.eyespotFront)})`;
    ctx.beginPath();
    ctx.arc(pose.eyespot.x, pose.eyespot.y, Math.max(0.6, length * 0.03), 0, TAU);
    ctx.fill();

    // flagellum (anterior whip): ONE fused continuous path, base→tip taper via
    // three overlaid passes (underglow → thin full-length tip → thick proximal),
    // so there are no per-segment round-cap "bead" seams.
    const fp = pose.flagellumPoints;
    if (fp.length >= 2) {
      // when the euglena is tucked against the hero (its body occluded by the
      // paramecium drawn on top), fade the protruding whip so it doesn't read as
      // an orphaned line floating over the hero.
      let flagFade = 1;
      if (frame.hero) {
        const hdx = finite(cell.x, 0) - finite(frame.hero.x, 0);
        const hdy = finite(cell.y, 0) - finite(frame.hero.y, 0);
        // hide the flagellum entirely near the hero (no green may touch the
        // paramecium); ramp back in only well clear of it.
        const reach = (Math.max(finiteOr(frame.hero.halfLen, frame.hero.radius), frame.hero.radius) + flagellumLength) * 1.05;
        const hdist = Math.hypot(hdx, hdy);
        flagFade = hdist >= reach ? 1 : clamp((hdist / reach - 0.45) / 0.5, 0, 1);
      }
      // soft underglow so the thin whip separates from the dark field
      ctx.strokeStyle = `hsla(${hue + 8}, 20%, 66%, ${alpha * 0.30 * flagFade})`;
      ctx.lineWidth = Math.max(0.9, width * 0.18);
      drawPolyline(ctx, fp, false);
      ctx.stroke();
      // full-length thin tip stroke
      ctx.strokeStyle = `hsla(${hue + 8}, 34%, 70%, ${alpha * 0.90 * flagFade})`;
      ctx.lineWidth = Math.max(0.5, width * 0.10);
      drawPolyline(ctx, fp, false);
      ctx.stroke();
      // thicker proximal ~60% on top → continuous base-to-tip taper
      const nprox = Math.max(2, Math.round(fp.length * 0.6));
      ctx.lineWidth = Math.max(0.8, width * 0.16);
      drawPolyline(ctx, fp.slice(0, nprox), false);
      ctx.stroke();
    }
  });
  ctx.restore();
}
