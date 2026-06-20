// src/theme-engine/builtin/drifting_contour/index.ts
/**
 * Living Cell — organic membrane visualization.
 *
 * The cell deforms with multi-octave FBM noise for a lumpy, biological
 * outline; amoeboid pseudopods protrude in slowly drifting directions that
 * intensify with voice activity; an iridescent hue shimmer travels around
 * the contour over a warm amber base (#d9a865, hue ≈ 34°).
 *
 * The membrane has a translucent filled cytoplasm and a brighter stroked
 * outline rendered with a closed Catmull-Rom spline for smoothness.
 *
 * During silence the cell breathes subtly (idle energy). During recording
 * it becomes visibly active with larger deformations and stronger shimmer.
 */
import { createCellRenderer } from "../../renderers/cell";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const userParams = (api.params && typeof api.params === "object" ? api.params : {}) as Record<string, unknown>;

  const renderer = createCellRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: 34, // warm amber #d9a865
    params: {
      noiseScale: 0.9,
      octaves: 4,
      lacunarity: 2.3,
      gain: 0.55,
      timeScale: 0.3,
      membraneAmplitude: 0.35,
      energyDrive: 0.8,
      push: 3.0,
      sharpness: 4,
      intentDrift: 0.08,
      idle: 0.10,
      levelGain: 0.7,
      hueSpread: 40,
      shimmerSpeed: 0.5,
      hueBoost: 20,
      fillAlpha: 0.18,
      tension: 0.15,
      // cilia ("усы"), startle ("шарахается"), growth ("растёт как живая")
      ciliaCount: 18,
      ciliaLength: 0.4,
      ciliaGrowthBoost: 0.55,
      ciliaWave: 0.5,
      ciliaWaveSpeed: 1.6,
      growthAttack: 0.05,
      growthRelease: 0.012,
      baseRadiusPx: 17,
      driftSpeed: 0.03,
      driftMargin: 30,
      idleMorphAmplitude: 0.16,
      idleMorphSpeed: 0.22,
      idleMorphPeriod: 7,
      idleMorphFloor: 0.3,
      growthSwell: 0.2,
      startleSensitivity: 2.2,
      startleDecay: 0.86,
      startleMaxPx: 4,
      startleBaselineRate: 0.08,
      // === TEMP PREVIEW (v3.2 A/B) — mex + rigid spindle, NOT a default flip. ===
      // Remove this block to restore the shipped FBM crown look.
      enableSomaticCilia: true,      // short dense somatic cilia (Commit 22)
      enableCiliaOnContour: true,    // anchor on the real contour (Commit 21)
      enableRigidMembrane: true,     // smooth firm contour, no FBM wobble (Commit 29)
      enableBodyProfile: true,       // authentic asymmetric slipper (Commit 31)
      bodyProfileType: "egg",        // biology-validated egg (not piriform teardrop)
      bodyProfileTaper: 0.27,        // widest ~mid-body, rounded blunt poles
      bodyAspect: 3,                 // ~3:1 aurelia slipper
      enableAffine: true,            // forced k=1 when profile on (no double-elongate)
      ...userParams,
    },
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return {
    unmount() {
      unsubscribe();
      renderer.destroy();
    },
  };
}
