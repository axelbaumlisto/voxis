/**
 * Priority-weighted steering + interaction model for the euglena. Each weight
 * is the PRIORITY of a behaviour; the heading eases toward the weighted sum of
 * the behaviours' direction vectors. Tune these to manage behaviour:
 *  - forward:   momentum / minimal-reverse bias (turns the short way, rarely flips back).
 *  - wall:      avoid the impassable tank walls — highest priority.
 *  - hero:      constant bias toward the hero (>0 keep clear / AVOID, <0 PURSUE).
 *               NOTE: pursue (<0) is a generic engine knob — it is NOT biological
 *               for Euglena→Paramecium (a phototroph does not hunt a ciliate);
 *               use it only for genuine predator pairs.
 *  - loiter:    EMERGENT standoff — a weak near-field hydrodynamic attraction
 *               balanced against the contact-avoidance below, so the cell hovers
 *               at the distance where the two cancel (not a teleological target).
 *  - wake:      near-field hydrodynamic entrainment — a brief advective tug (px/s)
 *               along the hero's heading while the euglena trails in its wake.
 *  - separation: same-species soft spacing; default 0 so multi-euglena scenes
 *               stay byte-identical until a theme explicitly opts in.
 *  - startleAway/startleDart: escape REORIENTATION (away-turn, beat-switch tumble)
 *               + small speed bump when contact is too close.
 *
 * Behaviour recipes: AVOID = {hero:+, loiter:0}; PURSUE = {hero:negative,
 * loiter:0} (predator pairs only); LOITER/hover = {hero:0, loiter:+} (default).
 * Default = mutual non-predation (Euglena exceeds Paramecium's cytostome gape:
 * a size refuge), the euglena carrying the contact-avoidance for the display.
 */
export interface EuglenaSteer {
  forward: number;
  wall: number;
  hero: number;
  loiter: number;
  wake: number;
  separation: number;
  startleAway: number;
  startleDart: number;
  gravitaxis: number;
  phototaxis: number;
  obstacle: number;
}

export const EUGLENA_STEER: EuglenaSteer = {
  forward: 1.0,
  wall: 2.0,
  hero: 0.0,
  loiter: 1.1,
  wake: 10,
  separation: 0,
  startleAway: 3.0,
  startleDart: 1.0,
  gravitaxis: 0,
  phototaxis: 0,
  obstacle: 1.8,
};

/**
 * Medium (fluid) properties. `viscosity` is relative to water (1.0); a denser /
 * more viscous medium damps reorientation and entrainment flows so the cell
 * banks and drifts more sluggishly. Physically low-Reynolds: angular velocity and
 * advection scale ~ 1/viscosity. Raise it for thick/syrupy water, lower for thin.
 */
export interface Medium {
  viscosity: number;
  rotDiffusion: number;
  translationDrag: number;
}

export const MEDIUM: Medium = {
  viscosity: 1.6,
  rotDiffusion: 0,
  translationDrag: 1,
};

// Interaction geometry/timing (q = sqrt(heroQd): normalized elliptical distance,
// q=1 on the exclusion boundary).
export const HERO_LOITER_Q = 1.30;        // emergent hover distance (attraction == avoidance)
export const HERO_INTEREST_RANGE = 2.2;   // beyond this q the hero is ignored
export const HERO_WAKE_RANGE = 1.5;       // entrainment is NEAR-FIELD only (~one half-width)
export const STARTLE_TRIGGER_Q = 1.12;    // contact this close -> startle escape
export const STARTLE_TAU = 0.6;           // s; escape decay time-constant
export const SEPARATION_RANGE_BODY_LENGTHS = 1.6; // soft steer only; no hard push / no overlap clamp
export const DIDINIUM_HAZARD_WEIGHT = 0.55; // neutral moving hazard: soft steer only, no panic/predation
