// Public cell renderer API manifest.
// Keep explicit re-exports here so the top-level facade can safely export from
// "./cell/index" without self-resolution through "./cell".
export { noise2D, fbm, catmullRom, catmullRomOpen, lowpassRadii, integrateDeformation, TAU, smoothstep } from "../shared";
export { sanitizeUnit, sanitizeFinite, sanitizeBins } from "./math";
export { cellEnergy, smoothEnergy, cellActivity, effectiveCyclosisPeriod } from "./activity";
export { advanceAxialSpinPhase, advanceCyclosisPhase, advanceCiliaBeatCycles } from "./phases";
export { membraneMaxRadius, resolveBaseRadius, perimeterCiliaCount, cellReach } from "./sizing";
export { startleOffset, startleHeadingKick, startleBurstSpeed } from "./startle";
export { swimSpeed, driftActivation, cellDrift, wanderStep, wallReorientHeading, rotationalBrownianStep, sedimentationBias } from "./locomotion";
export type { WanderState } from "./locomotion";
export { bodyHeadingStep, prolateAspect, helicalOffset, axialSpin } from "./body-motion";
export {
  bodyHalfWidth, bodyProfilePoint, bodyProfileArea, bodyProfileAreaScale,
  interpProfileRadius, bodyProfileDeform, applyOralGroove, buildProfilePts, profileCDFInv,
} from "./profile";
export { serializeCellState, parseCellState, restoreSeed, cellPersistKey, wanderPoseFromState } from "./persistence";
export type { CellPersistState } from "./persistence";
export {
  cellRadius, pseudopodOffset, idleMorph, sampleBinLevel,
  saturateTargetDeform, normalizeAreaDeform, integrateDeformPipeline,
  affineSqueezePoints, buildTargetDeformation, buildCellContour, bandLimitDeform,
} from "./contour";
export {
  ciliaEndpoints, ciliaBeatPhase, ciliaBeatPhaseAtCycle,
  strokeAxisStrength, metachronalIndex, ciliaStrokeAngle,
  somaticCiliaParams, ciliaStructureMod, ciliaPath,
} from "./cilia";
export type { Cilium, CiliaMotion, CiliumPath } from "./cilia";
export {
  interiorPoint, seedInteriorGranules, cyclosisLoopPoint, cyclosisLoopPointAtPhase,
} from "./interior";
export type { InteriorCtx } from "./interior";
export {
  nucleusTransform, contractileVacuole, contractileVacuolePair,
  foodVacuoleSize, seedFoodVacuoles, seedInteriorFoodVacuoles,
  advectFoodVacuole, micronucleusTransform,
} from "./organelles";
export {
  dipoleFlowAt, advectMote, seedMotes,
  cyclosisField, seedGranules, advectGranule,
} from "./flow";
export type { CellParams, CellOptions } from "./types";
export { CELL_DEFAULTS } from "./defaults";
export { createCellRenderer, ciliaBeatHzEff, iridescentHue } from "./renderer";
