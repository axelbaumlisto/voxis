# Cell Bio-Accuracy Review — Aspect 1: Cilia Count, Placement & Density

Scope: how many cilia, their angular placement, relative spacing, and whether
density should scale with membrane circumference/perimeter or energy. Read-only;
no code edits applied.

Files inspected: `src/theme-engine/renderers/cell.ts`,
`src/theme-engine/renderers/shared.ts`,
`src/theme-engine/renderers/__tests__/cell.test.ts`, `docs/CELL_MATH.md`.

All claims below were verified by re-implementing the exact `noise2D` table and
the placement formula in a standalone Node script and measuring gaps, ordering,
autocorrelation, and distinctness.

---

## Review

### Correct (verified, no change needed)

- **Even-grid base + bounded jitter is sound at defaults.** `cell.ts:478`
  `gap = TAU / n` and `cell.ts:492-493`
  `angOff = noise2D(k*12.9898, 7.2) * angleJit * gap * 0.5; baseAngle = k*gap + angOff`.
  At the default `ciliaAngleJitter = 0.55` (`cell.ts:205`) and `n ∈ {18,32,64}`
  the crown never reorders and never overlaps:

  | n | gap (rad) | min adjacent gap | max adjacent gap | min gap > 0 |
  |---|-----------|------------------|------------------|-------------|
  | 18 | 0.3491 | 0.1941 | 0.4736 | ✅ |
  | 32 | 0.1963 | 0.1092 | 0.2664 | ✅ |
  | 64 | 0.0982 | 0.0546 | 0.1332 | ✅ |

  Min gap stays well above zero → the test
  `"angular spacing is IRREGULAR (aperiodic crown...)"` (cell.test.ts) passes and
  the placement is genuinely aperiodic without crossings.

- **Seed quality of `noise2D(k*12.9898, 7.2)` is adequate for realistic counts.**
  The `12.9898` step jumps ~13 lattice cells per `k`, so consecutive offsets are
  effectively decorrelated: measured **lag-1 autocorrelation = 0.030**, **64/64
  distinct** offsets for `k = 0..63`, range `[-0.814, 0.874]`. No visible
  banding/aliasing for `n ≤ 64`.

### Blocker — `ciliaAngleJitter` has no upper clamp → reordering & overlap

- **Location:** `cell.ts:474`
  ```ts
  const angleJit = Math.max(0, params.ciliaAngleJitter ?? 0.55);
  ```
- **Bug:** `angleJit` is floored at 0 but **never capped**, unlike the sibling
  `lenVar` one line above (`cell.ts:473`,
  `Math.max(0, Math.min(0.95, params.ciliaLengthVar ?? 0.5))`). The code comment
  at `cell.ts:489-491` asserts "Kept < half-gap so hairs never cross order," but
  that invariant only holds for small `angleJit`. Because `noise2D` reaches
  `≈ ±0.87`, the per-hair offset is `±0.87·angleJit·gap·0.5`, and two adjacent
  hairs can differ by up to `0.87·angleJit·gap` (≈1.74·angleJit·half-gap). They
  **cross order once `angleJit ≳ 1.15`**. Measured for `n = 18`:

  | angleJit | min adjacent gap | raw order breaks |
  |----------|------------------|------------------|
  | 0.95 | 0.0813 | 0 |
  | 1.0  | 0.0672 | 0 |
  | 1.5  | — | **3** |
  | 3.0  | — | **4** |

  When hairs reorder, the **metachronal wave** (indexed by `k`, `cell.ts:526`
  via `ciliaBeatPhase(..., k, ...)`) no longer travels around the crown in
  spatial order, and bases visually overlap/swap. Since `CellParams` is
  caller-overridable by spread (`createCellRenderer`, `params: {...}`) and tuned
  live in the harness, an out-of-range value is reachable.
- **Corrected formula (cap to preserve ordering for any noise value):**
  ```ts
  // |noise| ≤ 1, adjacent difference ≤ 2·angleJit·gap·0.5·1 = angleJit·gap.
  // Require angleJit·gap < gap with margin → cap at e.g. 0.9.
  const angleJit = Math.max(0, Math.min(0.9, params.ciliaAngleJitter ?? 0.55));
  ```
  (Mirror the existing `lenVar` clamp for consistency.)
- **TDD-able property:**
  ```ts
  it("placement preserves angular order for any ciliaAngleJitter", () => {
    for (const jit of [0, 0.5, 0.9, 1.5, 5, 100]) {
      const angles = ciliaPath(80, 80, 16, 1.0, 0.5, 0.5,
        { ...CELL_DEFAULTS, ciliaAngleJitter: jit })
        .map(h => Math.atan2(h.points[0][1] - 80, h.points[0][0] - 80));
      // unwrap to [0,TAU) by base index and assert strictly increasing gaps>0
      const sorted = [...angles].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(0);
      // and: no two bases within < 0.2*gap (no overlap)
      const gap = (Math.PI * 2) / angles.length;
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(0.2 * gap);
    }
  });
  ```

### Note — density (hairs per unit perimeter) is NOT held constant across cell sizes

- **Location:** `cell.ts:470` `const n = Math.max(1, params.ciliaCount)` — count
  is a fixed param (default `18`, `cell.ts:194`), independent of `baseR`.
- **Issue:** Biologically, ciliary spacing (inter-basal-body distance) is roughly
  constant for a given cell type; the *number* of cilia scales with surface
  area/circumference, not the other way round. Here the **count is fixed and the
  spacing floats**. Measured linear spacing along the base circle:

  | baseR (px) | perimeter (px) | px spacing @ n=18 |
  |------------|----------------|-------------------|
  | 12.24 (growth 0) | 76.91 | 4.27 |
  | 14.93 (growth=1, swell 0.22) | 93.81 | 5.21 |

  Two effects:
  1. **Growth swell** (`resolveBaseRadius`, `growthSwell` 0.22) stretches spacing
     ~22% while count is frozen. Defensible biologically (membrane stretches,
     basal bodies spread apart) — *not* a bug, but worth documenting.
  2. **Configuration mismatch** is the real concern: a `baseRadiusPx = 16`
     overlay cell and a `radiusFraction`-derived `≈54 px` cell (160×160) both get
     **18 hairs**, i.e. spacing differs ~3.4×. The same `ciliaCount` produces a
     sparse fringe on a big cell and a dense fur on a small one — the *density*,
     the biologically meaningful quantity, is not preserved.
- **Recommended formula (density-driven count, derive count from perimeter):**
  ```ts
  // ciliaSpacingPx: target inter-cilium arc length on the base circle (px).
  // Keeps hairs-per-unit-perimeter ≈ constant across cell sizes & growth.
  const n = Math.max(1, Math.round((TAU * baseR) / params.ciliaSpacingPx));
  ```
  Keep `ciliaCount` only as a hard cap / fallback. Note this trades determinism
  of a fixed `n` for size-invariant density; persisted/per-hair noise seeds
  (`k`) remain stable so the look is still reproducible.
- **TDD-able property:**
  ```ts
  it("cilia density (hairs per unit perimeter) is ~constant across baseR", () => {
    const dens = (baseR: number) => {
      const n = ciliaPath(80, 80, baseR, 1, 0.5, 0.5, P).length;
      return n / (2 * Math.PI * baseR);
    };
    const d1 = dens(16), d2 = dens(48);
    expect(Math.abs(d1 - d2) / d1).toBeLessThan(0.15); // within 15%
  });
  ```
  (This test will FAIL against the current fixed-count code — by design, it
  encodes the desired behaviour.)

### Note — density should NOT scale with energy/audio; only length should

- **Location:** `cell.ts:485-486` `lenMean = baseR·(ciliaLength + growth·
  ciliaGrowthBoost)·(0.55 + 0.45·energy)`.
- **Observation:** Energy/growth correctly drives **length**, not count — this is
  biologically right (a cell does not grow new cilia when it gets louder; existing
  cilia beat harder / the body swells). Confirm this stays an explicit invariant
  so nobody later couples count to audio.
- **TDD-able property:**
  ```ts
  it("cilia COUNT is independent of energy and growth", () => {
    const n = (e: number, g: number) => ciliaPath(80,80,16,1,e,g,P).length;
    expect(n(0,0)).toBe(n(1,1));
    expect(n(0.3,0.7)).toBe(P.ciliaCount);
  });
  ```

### Note — large-count seed aliasing (low priority, not reachable at defaults)

- **Location:** `cell.ts:492`, seed `noise2D(k*12.9898, 7.2)`.
- **Observation:** `Math.floor(k*12.9898) & 255` revisits lattice columns for
  large `k` (145 collisions over `k = 0..399`, 255 distinct of 256). For
  realistic `n` (≤64) all 400 raw offsets remain distinct and decorrelated, so
  this is **not** a present bug. But if count ever becomes perimeter-driven and a
  large cell yields `n > ~150`, the fixed `y = 7.2` row plus modular column reuse
  could reintroduce faint periodicity. If/when count grows, add a second
  dimension to the seed, e.g. `noise2D(k*12.9898, 7.2 + k*0.123)`, so samples
  walk a 2-D path instead of one row.
- **TDD-able property:**
  ```ts
  it("placement jitter stays decorrelated for large counts", () => {
    const offs = Array.from({length: 200}, (_, k) => noise2D(k*12.9898, 7.2));
    const m = offs.reduce((s,v)=>s+v,0)/offs.length;
    let v=0,c=0; for(let i=0;i<offs.length;i++) v+=(offs[i]-m)**2;
    for(let i=1;i<offs.length;i++) c+=(offs[i]-m)*(offs[i-1]-m);
    expect(Math.abs(c/v)).toBeLessThan(0.2);
    expect(new Set(offs.map(x=>x.toFixed(6))).size).toBe(offs.length);
  });
  ```

### Note — comment at `cell.ts:489-491` overstates the ordering guarantee

- The comment claims jitter is "Kept < half-gap so hairs never cross order." The
  true safe bound is on the **adjacent difference** (`≤ angleJit·gap`), not on
  each offset, and it only holds while `angleJit` is bounded (see Blocker). Once
  the clamp from the Blocker fix is added, the comment becomes accurate; until
  then it is misleading.

---

## Summary

| Severity | Finding | Location |
|----------|---------|----------|
| Blocker | `ciliaAngleJitter` unclamped → reorder/overlap at `≳1.15` | `cell.ts:474` |
| Note | Density not size-invariant; count fixed while perimeter varies | `cell.ts:470,194` |
| Note | Confirm count stays independent of energy/audio (currently correct) | `cell.ts:485` |
| Note | Large-count seed aliasing latent (fine at n≤64) | `cell.ts:492` |
| Note | Misleading "< half-gap" comment | `cell.ts:489-491` |

The single concrete **math/robustness bug** is the missing upper clamp on
`ciliaAngleJitter` (one-line fix mirroring `lenVar`). The **biological-accuracy
gap** is that "density" is not a constant in the model — count is fixed and
spacing floats with `baseR`; deriving count from perimeter (`n ≈ TAU·baseR /
spacing`) makes hairs-per-unit-perimeter the invariant, which is the
biologically meaningful quantity for aspect 1.
