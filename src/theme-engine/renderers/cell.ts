// src/theme-engine/renderers/cell.ts
/**
 * Living Cell renderer — organic membrane visualization with FBM noise,
 * amoeboid pseudopod protrusions, and iridescent hue shimmer.
 *
 * SRP: All math lives in pure exported functions (deterministic, testable).
 *      The renderer factory only handles DOM/canvas/RAF lifecycle.
 * KISS: Compact inline value-noise (no external imports) so the bundled
 *       theme.js is fully self-contained.
 * OCP: Tunables live in CellParams with defaults; callers override via spread.
 */

// Backward-compat re-exports: existing imports of these from "./cell" keep working.
export { noise2D, fbm, catmullRom, catmullRomOpen, lowpassRadii, integrateDeformation, TAU, smoothstep } from "./shared";
export { sanitizeUnit, sanitizeFinite, sanitizeBins } from "./cell/math";
export { cellEnergy, smoothEnergy, cellActivity, effectiveCyclosisPeriod } from "./cell/activity";
export { advanceAxialSpinPhase, advanceCyclosisPhase, advanceCiliaBeatCycles } from "./cell/phases";
export { membraneMaxRadius, resolveBaseRadius, perimeterCiliaCount, cellReach } from "./cell/sizing";
export { startleOffset, startleHeadingKick, startleBurstSpeed } from "./cell/startle";
export { swimSpeed, driftActivation, cellDrift, wanderStep, wallReorientHeading, rotationalBrownianStep, sedimentationBias } from "./cell/locomotion";
export type { WanderState } from "./cell/locomotion";
export { bodyHeadingStep, prolateAspect, helicalOffset, axialSpin } from "./cell/body-motion";
export {
  bodyHalfWidth, bodyProfilePoint, bodyProfileArea, bodyProfileAreaScale,
  interpProfileRadius, bodyProfileDeform, applyOralGroove, buildProfilePts, profileCDFInv,
} from "./cell/profile";
export { serializeCellState, parseCellState, restoreSeed, cellPersistKey, wanderPoseFromState } from "./cell/persistence";
export type { CellPersistState } from "./cell/persistence";
export {
  cellRadius, pseudopodOffset, idleMorph, sampleBinLevel,
  saturateTargetDeform, normalizeAreaDeform, integrateDeformPipeline,
  affineSqueezePoints, buildTargetDeformation, buildCellContour, bandLimitDeform,
} from "./cell/contour";
export {
  ciliaEndpoints, ciliaBeatPhase, ciliaBeatPhaseAtCycle,
  strokeAxisStrength, metachronalIndex, ciliaStrokeAngle,
  somaticCiliaParams, ciliaStructureMod, ciliaPath,
} from "./cell/cilia";
export type { Cilium, CiliaMotion, CiliumPath } from "./cell/cilia";
export {
  interiorPoint, seedInteriorGranules, cyclosisLoopPoint, cyclosisLoopPointAtPhase,
} from "./cell/interior";
export type { InteriorCtx } from "./cell/interior";
export {
  nucleusTransform, contractileVacuole, contractileVacuolePair,
  foodVacuoleSize, seedFoodVacuoles, seedInteriorFoodVacuoles,
  advectFoodVacuole, micronucleusTransform,
} from "./cell/organelles";
export {
  dipoleFlowAt, advectMote, seedMotes,
  cyclosisField, seedGranules, advectGranule,
} from "./cell/flow";



// ---------------------------------------------------------------------------
// Cell parameters
// ---------------------------------------------------------------------------

export type { CellParams, CellOptions } from "./cell/types";
export { CELL_DEFAULTS } from "./cell/defaults";
export { createCellRenderer, ciliaBeatHzEff, iridescentHue } from "./cell/renderer";
