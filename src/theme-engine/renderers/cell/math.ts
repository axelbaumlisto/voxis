// Pure math/sanitization helpers for the cell renderer.

// ---------------------------------------------------------------------------
// M15: NaN-poison guards
// ---------------------------------------------------------------------------
// External frame state (audioLevel, spectrum bins) and persistent form-memory
// (integrated deform, growth, baseline) are all sanitised at the tick boundary.
// A single NaN/Inf frame must NOT permanently poison form-memory: once a value
// becomes non-finite, every subsequent EMA/integration step would stay NaN
// forever (NaN propagates through +,*, and Math.min/max). These pure helpers
// keep the state finite and identical for normal in-range input.

/** Clamp to [0,1]; NaN/Inf -> 0. Identity for finite in-range input. */
export function sanitizeUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Pass finite values through unchanged; non-finite -> `fallback`. */
export function sanitizeFinite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

/** Clamp each bin to [0,1]; bad/missing bins -> 0. Returns a new array. */
export function sanitizeBins(bins: number[] | undefined | null): number[] {
  if (!bins || bins.length === 0) return [];
  const out = new Array<number>(bins.length);
  for (let i = 0; i < bins.length; i++) out[i] = sanitizeUnit(bins[i]);
  return out;
}
