import { didiniumDisplayLength } from "./didinium";
import { heroSurfacePoint } from "./hero";
import type { AquariumFrame, AquariumLayerState, AquariumParamsView, DidiniumState } from "./types";

const CONTACT_ATTACK_SECONDS = 0.25;
const CONTACT_SIDE_ATTACHMENT_DELAY_SECONDS = 0.25;
const CONTACT_SIDE_ATTACHMENT_SECONDS = 0.35;
const CONTACT_FAN_DELAY_SECONDS = 1.20;
const CONTACT_FAN_SECONDS = 0.45;

export interface DidiniumContactPhase {
  readonly contact: number;
  readonly duration: number;
  readonly elapsed: number;
  readonly env: number;
  readonly sideEnv: number;
  readonly fanEnv: number;
}

export interface DidiniumParameciumContactPoint {
  readonly heading: number;
  readonly ux: number;
  readonly uy: number;
  readonly snoutX: number;
  readonly snoutY: number;
  readonly px: number;
  readonly py: number;
}

export function didiniumContactPhase(didinium: DidiniumState): DidiniumContactPhase {
  const contact = Math.max(0, didinium.contactTimer ?? 0);
  const duration = Math.max(0.001, didinium.contactDuration ?? contact);
  const elapsed = Math.max(0, duration - contact);
  const env = Math.min(1, Math.min(elapsed / CONTACT_ATTACK_SECONDS, contact / CONTACT_ATTACK_SECONDS));
  const sideEnv = Math.min(1, Math.max(0, (elapsed - CONTACT_SIDE_ATTACHMENT_DELAY_SECONDS) / CONTACT_SIDE_ATTACHMENT_SECONDS));
  const fanEnv = Math.min(1, Math.max(0, (elapsed - CONTACT_FAN_DELAY_SECONDS) / CONTACT_FAN_SECONDS));
  return { contact, duration, elapsed, env, sideEnv, fanEnv };
}

export function didiniumParameciumContactPoint(
  didinium: DidiniumState,
  frame: AquariumFrame,
  length: number,
): DidiniumParameciumContactPoint {
  const heading = didinium.phase;
  const ux = Math.cos(heading), uy = Math.sin(heading);
  const snoutX = didinium.x + ux * length * 0.52;
  const snoutY = didinium.y + uy * length * 0.52;
  let px = snoutX + ux * Math.min(18, Math.max(14, length * 0.42));
  let py = snoutY + uy * Math.min(18, Math.max(14, length * 0.42));
  if (frame.hero) {
    const surface = heroSurfacePoint(frame.hero, { x: snoutX, y: snoutY });
    px = surface.x;
    py = surface.y;
  }
  return { heading, ux, uy, snoutX, snoutY, px, py };
}

export function drawDidiniumParameciumContact(
  ctx: CanvasRenderingContext2D,
  aquarium: AquariumLayerState,
  frame: AquariumFrame,
  view: AquariumParamsView,
): void {
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.9));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of aquarium.didinium) {
    const phase = didiniumContactPhase(d);
    if (phase.contact <= 0) continue;
    const L = didiniumDisplayLength(d.size, view.didinium.scale);
    const contact = didiniumParameciumContactPoint(d, frame, L);
    const { heading, ux, uy, snoutX, snoutY, px, py } = contact;
    const { env, sideEnv, fanEnv } = phase;

    // Foreground Didinium silhouette cue: a faint barrel outline + two girdle marks
    // above the hero so the predator remains a distinct cell during latch, not a
    // grey patch on the Paramecium flank.
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(heading);
    ctx.strokeStyle = `hsla(226, 48%, 96%, ${alpha * 0.96 * env})`;
    ctx.lineWidth = Math.max(0.9, L * 0.030);
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.50, L * 0.22, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `hsla(214, 54%, 98%, ${alpha * 0.92 * env})`;
    ctx.lineWidth = Math.max(0.9, L * 0.028);
    for (const gx of [L * 0.18, -L * 0.12]) {
      ctx.beginPath();
      ctx.moveTo(gx, -L * 0.20);
      ctx.lineTo(gx, L * 0.20);
      ctx.stroke();
    }
    ctx.restore();

    // Dark puncture/dent first: a tiny shadow + crescent under the contact glow.
    ctx.fillStyle = `hsla(205, 18%, 15%, ${alpha * 0.55 * env})`;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1.3, L * 0.065), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `hsla(210, 14%, 10%, ${alpha * 0.42 * env})`;
    ctx.lineWidth = Math.max(1.0, L * 0.035);
    ctx.beginPath();
    ctx.arc(px - ux * 1.5, py - uy * 1.5, Math.max(3.0, L * 0.16), heading + Math.PI * 0.62, heading + Math.PI * 1.38);
    ctx.stroke();

    // Didinium toxicyst / attachment filaments: one dominant central piercing
    // line plus two fainter side attachment lines (not a moustache).
    for (const [side, aMul, wMul] of [[-L * 0.055, 0.55 * sideEnv, 0.8], [0, 1.0, 1.25], [L * 0.055, 0.55 * sideEnv, 0.8]] as const) {
      const sx = snoutX - uy * side;
      const sy = snoutY + ux * side;
      ctx.strokeStyle = `hsla(198, 52%, 98%, ${alpha * 0.95 * env * aMul})`;
      ctx.lineWidth = Math.max(0.75, L * 0.026) * wMul;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(px, py);
      ctx.stroke();
    }

    // Paramecium defensive trichocyst burst: asymmetric fan AWAY from predator,
    // not a regular radial UI sparkle.
    const fanAlpha = alpha * 0.22 * env * fanEnv;
    ctx.lineWidth = 0.75;
    for (let k = 0; k < 7; k++) {
      if (k % 5 === 1) continue; // irregular gaps: biological, not UI starburst
      const jitter = Math.sin((k + 1) * 12.9898) * 0.07;
      const a = heading + Math.PI + (k - 3) * 0.16 + jitter;
      const len = 4.8 + ((k * 5) % 4) * 0.7;
      const aJ = 0.75 + 0.25 * Math.abs(Math.sin((k + 3) * 4.17));
      ctx.strokeStyle = `hsla(42, 46%, 95%, ${fanAlpha * aJ})`;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      ctx.stroke();
    }

    ctx.fillStyle = `hsla(44, 52%, 97%, ${alpha * 0.86 * env})`;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1.0, L * 0.04), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
