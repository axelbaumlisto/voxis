import type { AquariumFrame, AquariumParamsView, VorticellaState } from "./types";
import { KIND_ID, sourceId } from "./interaction";
import type { FieldContribution, FieldKind, Motile } from "./interaction";
import { seededUnit } from "./seeds";
import { clamp, clamp01, finite, finiteOr, smoothstep, wrapUnit } from "./util";
import { vorticellaObstacle } from "./vorticella-parts/geometry";
export { vorticellaGeometry, vorticellaObstacle } from "./vorticella-parts/geometry";
export type { AquariumPoint, VorticellaGeometry, VorticellaGeometryOptions } from "./vorticella-parts/geometry";
export { drawVorticella } from "./vorticella-parts/draw";

// Asymmetric, mostly-extended duty: a FAST ease-out contraction, a brief hold,
// a SLOW sigmoid re-extension, then a long extended/feeding dwell (s=0). This
// matches the real spasmoneme (ballistic <10ms collapse, ~seconds reload) while
// staying a deterministic, dt-integrated function of one cycle phase.
const VC_CONTRACT = 0.02; // ballistic collapse window (snap)
const VC_HOLD = 0.02;     // contracted hold
const VC_RELAX = 0.33;    // slow re-extension window

// Absolute-time spasmoneme clocks (seconds) — the collapse is power-limited and
// cadence-INDEPENDENT, so it runs on real dt, decoupled from how often it fires.
const T_C = 0.033;   // near one-frame snap at 60fps; real <10ms, floored for visibility
const T_HOLD = 0.05; // contracted hold
const T_E = 2.6;     // slow Ca-reload re-extension

function vorticellaCellSeed(anchorX: number): number {
  return (Math.round(anchorX * 7) ^ 0x070271ca) >>> 0;
}

const MIG_DETACH = 0.6; // s to retract stalk & lift off
const MIG_SWIM = 16;    // telotroch swim speed (px/s)
const MIG_ATTACH = 0.7; // s to regrow the stalk at the new spot

/** Deterministic rare interval (s) a zooid stays anchored before migrating as a telotroch. */
function drawMigrateInterval(cellSeed: number, migrateCount: number): number {
  // a settled zooid only rarely detaches and swims off (no real disturbance in this scene).
  // ~45x rarer than before: mean ~900s, range ~10-40 min, so it mostly just sits and feeds.
  const u = Math.max(1e-4, seededUnit(cellSeed, migrateCount, 0x6d2b79f5));
  return clamp(-Math.log(u) * 900, 540, 2400);
}

/** Contraction amount s in [0,1] from the absolute-time leg/timer state. */
function vorticellaLegAmount(leg: number, timer: number): number {
  if (leg === 1) {
    // Real collapse is sub-frame; keep an 80ms readable window but put most of
    // the shortening in the first ~35ms so a sampled sheet sees the snap.
    const fast = clamp01(timer / 0.016);
    const tail = clamp01((timer - 0.016) / Math.max(1e-6, T_C - 0.016));
    return 0.9 * (1 - Math.pow(1 - fast, 3)) + 0.1 * (1 - Math.pow(1 - tail, 3));
  } // ballistic ease-out
  if (leg === 2) return 1;                                                          // hold
  // stretched-exp, normalized so the tail reaches EXACTLY 0 at u=1 (was 0.086 -> a
  // per-cycle pop as it snapped to the leg-0 value 0). e0 = exp(-1.9^1.4).
  if (leg === 3) { const u = clamp01(timer / T_E); const e0 = Math.exp(-Math.pow(1.9, 1.4)); return (Math.exp(-Math.pow(u * 1.9, 1.4)) - e0) / (1 - e0); }
  return 0;                                                                          // extended / feeding
}

export function vorticellaContractPhase(cyclePhase: number): number {
  const phase = wrapUnit(cyclePhase);
  if (phase < VC_CONTRACT) {
    const q = phase / VC_CONTRACT;
    return 1 - Math.pow(1 - q, 3); // ease-out: fast launch, soft arrest
  }
  if (phase < VC_CONTRACT + VC_HOLD) return 1;
  if (phase < VC_CONTRACT + VC_HOLD + VC_RELAX) {
    const q = (phase - VC_CONTRACT - VC_HOLD) / VC_RELAX;
    return 1 - smoothstep(q); // slow sigmoid unfurl 1 → 0
  }
  return 0; // extended, feeding (the cell spends most of the cycle here)
}

export const VORTICELLA_RELEVANT_FIELDS: ReadonlySet<FieldKind> = new Set(["motile"]);

function motileKindId(motile: Motile): number {
  return Math.floor(Math.max(0, finiteOr(motile.sourceId, 0)) / (1 << 20));
}

function vorticellaTriggerRadius(obsRadius: number, motile: Motile): number {
  const radius = Math.max(0, finiteOr(motile.radius, 0));
  const hasMetadata = radius > 0 || motile.strength !== undefined || motile.role !== undefined;
  if (!hasMetadata) return obsRadius * 1.25; // point-only legacy fallback

  const kind = motileKindId(motile);
  const strengthFallback = kind === KIND_ID.hero ? 1
    : kind === KIND_ID.didinium ? 0.75
      : kind === KIND_ID.euglena ? 0.35
        : 0.5;
  const strength = clamp(finiteOr(motile.strength, strengthFallback), 0.15, 1.5);
  const baseMul = kind === KIND_ID.euglena ? 1.30 : 1.55;
  const bodyMul = kind === KIND_ID.hero ? 0.95
    : kind === KIND_ID.didinium ? 0.9
      : kind === KIND_ID.euglena ? 0.5
        : 0.65;

  return obsRadius * baseMul + radius * bodyMul * strength;
}

export function vorticellaContribute(
  cell: VorticellaState,
  scale: number,
  frameHeight: number,
  idx: number,
): FieldContribution[] {
  const obstacle = vorticellaObstacle(cell, scale, frameHeight);
  return [{
    kind: "obstacle",
    shape: "circle",
    x: obstacle.x,
    y: obstacle.y,
    radius: obstacle.radius,
    sourceId: sourceId("vorticella", idx),
  }, {
    kind: "wake",
    x: obstacle.x,
    y: obstacle.y,
    heading: finite(cell.directionAngle, -Math.PI / 2),
    sourceId: sourceId("vorticella", idx),
  }];
}

export function seedVorticella(count: number, seed: number, frame: AquariumFrame, alongFrac = 0.5, salt = 0x070271ca): VorticellaState[] {
  if (count <= 0) return [];
  const vorticella: VorticellaState[] = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  const inset = 0.5;
  for (let i = 0; i < count; i++) {
    // Vorticella is sessile on the substrate → anchor along the FLOOR, stalk up.
    // A single hero uses the configured placement; companions spread across the floor.
    const along = count === 1 ? clamp01(alongFrac) : seededUnit(seed, i, salt ^ 0x4563d29f);
    const anchorX = along * safeWidth;
    const anchorY = safeHeight - inset;
    const lean = clamp((0.5 - along) * 1.2, -0.35, 0.35);
    const directionAngle = -Math.PI / 2 + lean; // angled feeding posture away from nearest side wall
    const restLength = 7.5 + seededUnit(seed, i, salt ^ 0x02e5be93) * 3.5;
    const cycle = seededUnit(seed, i, salt ^ 0x61097f2d);
    vorticella.push({
      x: anchorX,
      y: anchorY,
      phase: cycle,
      size: 0.5 + seededUnit(seed, i, salt ^ 0x7281d4c7),
      anchorX,
      anchorY,
      directionAngle,
      restLength,
      contractPhase: vorticellaContractPhase(cycle),
      contractCyclePhase: cycle,
      oralWreathPhase: seededUnit(seed, i, salt ^ 0x68bc21eb),
      contractRate: 0.06 + seededUnit(seed, i, salt ^ 0x2fda92a1) * 0.05,
      oralRate: 0.42 + seededUnit(seed, i, salt ^ 0x14c8af21) * 0.18,
      swayPhase: seededUnit(seed, i, salt ^ 0x3b91ce07),
      swayRate: 0.10 + seededUnit(seed, i, salt ^ 0x5a2f81b3) * 0.07, // ~0.10-0.17 Hz gentle sway
      // absolute-time contraction machine: start mid-dwell but FAR from a
      // contraction boundary (timer < 1.5 < min interval) so dt-partition stays exact
      contractLeg: 0,
      contractTimer: seededUnit(seed, i, salt ^ 0x29ab7f15) * 1.5,
      voiceEnv: 0,
      migrateState: 0,
      attach: 1,
      migrateTimer: seededUnit(seed, i, salt ^ 0x71fa9c3d) * 6, // staggered start
      migrateInterval: drawMigrateInterval(vorticellaCellSeed(anchorX), 0),
      migrateTargetX: anchorX,
      migrateCount: 0,
    });
  }
  return vorticella;
}

export function updateVorticella(
  vorticella: readonly VorticellaState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): readonly VorticellaState[] {
  if (vorticella.length === 0) return vorticella;
  const dt = Math.max(0, finite(frame.dt, 0));
  // adoral membranelle shimmer: constant ~5Hz (Nyquist-safe stylization), NOT audio-driven
  const oralHz = 5;
  const swayMul = 1;
  return vorticella.map((cell, idx) => {
    // CV pulses on its own slow rhythm, independent of contraction events
    const cvClock = wrapUnit(finite(cell.contractCyclePhase, 0) + Math.max(0, finite(cell.contractRate, 0)) * dt);
    const cellSeed = vorticellaCellSeed(finite(cell.anchorX, 0));
    // absolute-time contraction state machine (real dt; legs advance with carry)
    let leg = Math.max(0, Math.min(3, Math.floor(finiteOr(cell.contractLeg, 0))));
    let timer = Math.max(0, finiteOr(cell.contractTimer, 0)) + dt;
    // RECORDING = a gentle "feeding current", NOT a startle. Experts (protistology + UX)
    // rejected the discrete voice-contraction as a jerky/annoying twitch. Instead the zooid
    // eases into an ACTIVE FEEDING POSTURE while recording — a smooth attack/release
    // envelope `voiceEnv` that the draw uses to (slightly) open the peristome wider,
    // brighten the oral wreath + body glow, and sway a touch more. Continuous, no jerk.
    // A baseline floor (0.4) means recording reads as "on" even if audio metering is silent;
    // louder voice eases it higher. Metabolic cyclosis & cilia beat stay decoupled.
    let voiceEnv = clamp01(finiteOr(cell.voiceEnv, 0));
    const loud = clamp01(Math.max(finite(frame.audioLevel, 0), finite(frame.activity, 0)));
    const voiceTarget = frame.mode === "recording" ? Math.max(0.4, loud) : 0;
    const voiceTau = voiceTarget > voiceEnv ? 0.30 : 1.4; // ease in ~0.3s, ease out ~1.4s -> no flicker
    voiceEnv = clamp01(voiceEnv + (voiceTarget - voiceEnv) * (1 - Math.exp(-dt / voiceTau)));
    // MECHANOSENSITIVE reflex: a motile cell passing close to the bell triggers a
    // contraction (the iconic Vorticella startle). Only while extended and past a
    // short refractory, so a lingering cell does not cause a spasm storm.
    const motiles = frame.interaction?.motiles.filter((motile) => motile.sourceId !== sourceId("vorticella", idx));
    if (motiles && motiles.length > 0 && leg === 0 && timer > 1.0) {
      const obs = vorticellaObstacle(cell, view.vorticella.scale, frame.height);
      for (let mi = 0; mi < motiles.length; mi++) {
        const motile = motiles[mi];
        const trigR = vorticellaTriggerRadius(obs.radius, motile);
        const mdx = finite(motile.x, 0) - obs.x;
        const mdy = finite(motile.y, 0) - obs.y;
        if (mdx * mdx + mdy * mdy < trigR * trigR) { leg = 1; timer = 0; break; }
      }
    }
    // advance the contraction legs (1=collapse,2=hold,3=re-extend); leg 0 (extended) only
    // leaves via a stimulus above (voice / passing cell), never spontaneously.
    for (let guard = 0; guard < 128; guard++) {
      if (leg === 1) { if (timer >= T_C) { timer -= T_C; leg = 2; } else break; }
      else if (leg === 2) { if (timer >= T_HOLD) { timer -= T_HOLD; leg = 3; } else break; }
      else if (leg === 3) { if (timer >= T_E) { timer -= T_E; leg = 0; } else break; }
      else break; // leg 0: wait for a stimulus
    }

    // --- telotroch migration (rare): a sessile zooid occasionally detaches into a
    // free-swimming telotroch, glides to a new floor spot, and re-anchors there. ---
    let migrateState = Math.max(0, Math.min(3, Math.floor(finiteOr(cell.migrateState, 0))));
    let attach = clamp01(finiteOr(cell.attach, 1));
    let migrateTimer = Math.max(0, finiteOr(cell.migrateTimer, 0));
    let migrateInterval = Math.max(8, finiteOr(cell.migrateInterval, 900));
    let migrateTargetX = finiteOr(cell.migrateTargetX, finite(cell.anchorX, 0));
    let migrateCount = Math.max(0, Math.floor(finiteOr(cell.migrateCount, 0)));
    let anchorX = finite(cell.anchorX, 0);
    const safeWidth = Math.max(1, finite(frame.width, 0));
    const inset2 = Math.max(8, safeWidth * 0.08);
    if (migrateState === 0) {
      migrateTimer += dt; // only migrate when calm (fully extended, not mid-contraction)
      if (migrateTimer >= migrateInterval && leg === 0) {
        migrateState = 1;
        migrateCount += 1;
        const u = seededUnit(cellSeed, migrateCount, 0x9e3779b1);
        const nx = inset2 + u * (safeWidth - 2 * inset2);
        migrateTargetX = Math.abs(nx - anchorX) >= safeWidth * 0.2 ? nx
          : anchorX < safeWidth / 2 ? Math.min(safeWidth - inset2, anchorX + safeWidth * 0.3)
          : Math.max(inset2, anchorX - safeWidth * 0.3);
      }
    } else if (migrateState === 1) {
      attach = Math.max(0, attach - dt / MIG_DETACH);
      if (attach <= 0) { attach = 0; migrateState = 2; }
    } else if (migrateState === 2) {
      const dx = migrateTargetX - anchorX;
      const step = MIG_SWIM * dt;
      if (Math.abs(dx) <= step) { anchorX = migrateTargetX; migrateState = 3; }
      else anchorX += Math.sign(dx) * step;
    } else {
      attach = Math.min(1, attach + dt / MIG_ATTACH);
      if (attach >= 1) { attach = 1; migrateState = 0; migrateTimer = 0; migrateInterval = drawMigrateInterval(cellSeed, migrateCount); }
    }

    return {
      ...cell,
      x: anchorX,
      y: cell.anchorY,
      anchorX,
      phase: cvClock,
      contractCyclePhase: cvClock,
      contractPhase: clamp01(vorticellaLegAmount(leg, timer)),
      contractLeg: leg,
      contractTimer: timer,
      voiceEnv,
      oralWreathPhase: wrapUnit(cell.oralWreathPhase + oralHz * dt),
      swayPhase: wrapUnit(finiteOr(cell.swayPhase, 0) + Math.max(0, finiteOr(cell.swayRate, 0.12)) * swayMul * dt),
      migrateState,
      attach,
      migrateTimer,
      migrateInterval,
      migrateTargetX,
      migrateCount,
    };
  });
}
