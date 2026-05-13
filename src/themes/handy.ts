/**
 * HandyPillTheme — schema, resolver, and CSS-vars / BarMath helpers.
 *
 * The Handy pill (172×36 overlay) is parameterised by:
 *   - 6 palette colours  → CSS variables on :root
 *   - 12 animation params → 9 timings as CSS variables (`ms` suffix) +
 *                          3 coefficients consumed by useSmoothBars/HandyBars
 *
 * SOLID notes:
 *  - SRP: this module owns only schema + pure mapping functions; nothing
 *    here touches the DOM or Tauri.
 *  - OCP: new theme fields are added by extending the interfaces and the
 *    corresponding `DEFAULT_*` constants. No call-sites need to change.
 *  - DIP: consumers depend on the TypeScript interfaces, not on the JSON
 *    payload shape — `resolveHandyTheme()` is the single normalisation
 *    boundary.
 *
 * KISS: no zod / io-ts. Hand-written guards keep the bundle small and
 *       reading order linear.
 */

/** Six palette tokens drive every coloured pixel in the pill UI. */
export interface HandyPillPalette {
  /** TranscriptionIcon / MicrophoneIcon / CancelIcon fill. */
  icon_color: string;
  /** HandyBars background. */
  bar_color: string;
  /** HandyBars box-shadow glow. */
  bar_glow: string;
  /** drop-shadow under icons + bars (for legibility on light wallpapers). */
  shadow: string;
  /** `.transcribing-text` color. */
  transcribing_text: string;
  /** `.cancel-button:hover` background. */
  cancel_hover_bg: string;
}

/**
 * Twelve animation knobs. Nine of them surface as CSS variables (`ms`
 * timings or unitless gain/min values). Three drive JS math:
 *  - `smoothing_alpha` → useSmoothBars exponential moving average factor
 *  - `power_curve`     → HandyBars `pow(v, n)` exponent
 *  - `peak_decay`      → useSmoothBars peak tracker decay rate
 */
export interface HandyPillAnimation {
  smoothing_alpha: number;
  power_curve: number;
  peak_decay: number;
  bar_min_height_px: number;
  bar_min_opacity: number;
  bar_opacity_gain: number;
  bar_height_ms: number;
  bar_opacity_ms: number;
  pill_fade_ms: number;
  transcribing_pulse_ms: number;
  /** 0 disables idle breathing; 0.3 is the upper visual bound. */
  idle_breathing_amplitude: number;
  idle_breathing_period_ms: number;
  cancel_hover_ms: number;
}

export interface HandyPillTheme {
  palette: HandyPillPalette;
  animation: HandyPillAnimation;
}

/** Math hand-off for useSmoothBars / HandyBars. */
export interface BarMath {
  smoothing_alpha: number;
  power_curve: number;
  peak_decay: number;
}

const DEFAULT_PALETTE: HandyPillPalette = {
  icon_color: "#FAA2CA",
  bar_color: "#ffe5ee",
  bar_glow: "#FAA2CA",
  shadow: "rgba(0, 0, 0, 0.45)",
  transcribing_text: "#ffffff",
  cancel_hover_bg: "rgba(250, 162, 202, 0.2)",
};

const DEFAULT_ANIMATION: HandyPillAnimation = {
  smoothing_alpha: 0.3,
  power_curve: 0.7,
  peak_decay: 0.85,
  bar_min_height_px: 4,
  bar_min_opacity: 0.2,
  bar_opacity_gain: 1.7,
  bar_height_ms: 60,
  bar_opacity_ms: 120,
  pill_fade_ms: 300,
  transcribing_pulse_ms: 1500,
  idle_breathing_amplitude: 0,
  idle_breathing_period_ms: 3000,
  cancel_hover_ms: 150,
};

export const DEFAULT_HANDY_THEME: HandyPillTheme = {
  palette: { ...DEFAULT_PALETTE },
  animation: { ...DEFAULT_ANIMATION },
};

const MIN_MS = 1;

/** Clamp helper — keeps the call-site readable. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** Coerce to a finite number or return `fallback`. */
function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Coerce to a non-empty string or return `fallback`. */
function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function resolvePalette(input: unknown): HandyPillPalette {
  const src = (input ?? {}) as Partial<HandyPillPalette>;
  return {
    icon_color: asString(src.icon_color, DEFAULT_PALETTE.icon_color),
    bar_color: asString(src.bar_color, DEFAULT_PALETTE.bar_color),
    bar_glow: asString(src.bar_glow, DEFAULT_PALETTE.bar_glow),
    shadow: asString(src.shadow, DEFAULT_PALETTE.shadow),
    transcribing_text: asString(
      src.transcribing_text,
      DEFAULT_PALETTE.transcribing_text,
    ),
    cancel_hover_bg: asString(
      src.cancel_hover_bg,
      DEFAULT_PALETTE.cancel_hover_bg,
    ),
  };
}

function resolveAnimation(input: unknown): HandyPillAnimation {
  const src = (input ?? {}) as Partial<HandyPillAnimation>;
  return {
    smoothing_alpha: clamp(
      asNumber(src.smoothing_alpha, DEFAULT_ANIMATION.smoothing_alpha),
      0.05,
      1.0,
    ),
    power_curve: clamp(
      asNumber(src.power_curve, DEFAULT_ANIMATION.power_curve),
      0.05,
      4.0,
    ),
    peak_decay: clamp(
      asNumber(src.peak_decay, DEFAULT_ANIMATION.peak_decay),
      0.1,
      1.0,
    ),
    bar_min_height_px: Math.max(
      0,
      asNumber(src.bar_min_height_px, DEFAULT_ANIMATION.bar_min_height_px),
    ),
    bar_min_opacity: clamp(
      asNumber(src.bar_min_opacity, DEFAULT_ANIMATION.bar_min_opacity),
      0,
      1,
    ),
    bar_opacity_gain: Math.max(
      0,
      asNumber(src.bar_opacity_gain, DEFAULT_ANIMATION.bar_opacity_gain),
    ),
    bar_height_ms: Math.max(
      MIN_MS,
      asNumber(src.bar_height_ms, DEFAULT_ANIMATION.bar_height_ms),
    ),
    bar_opacity_ms: Math.max(
      MIN_MS,
      asNumber(src.bar_opacity_ms, DEFAULT_ANIMATION.bar_opacity_ms),
    ),
    pill_fade_ms: Math.max(
      MIN_MS,
      asNumber(src.pill_fade_ms, DEFAULT_ANIMATION.pill_fade_ms),
    ),
    transcribing_pulse_ms: Math.max(
      MIN_MS,
      asNumber(
        src.transcribing_pulse_ms,
        DEFAULT_ANIMATION.transcribing_pulse_ms,
      ),
    ),
    idle_breathing_amplitude: clamp(
      asNumber(
        src.idle_breathing_amplitude,
        DEFAULT_ANIMATION.idle_breathing_amplitude,
      ),
      0,
      0.3,
    ),
    idle_breathing_period_ms: Math.max(
      MIN_MS,
      asNumber(
        src.idle_breathing_period_ms,
        DEFAULT_ANIMATION.idle_breathing_period_ms,
      ),
    ),
    cancel_hover_ms: Math.max(
      MIN_MS,
      asNumber(src.cancel_hover_ms, DEFAULT_ANIMATION.cancel_hover_ms),
    ),
  };
}

/**
 * Normalise an arbitrary JSON payload into a fully-populated
 * {@link HandyPillTheme}. Falls back to {@link DEFAULT_HANDY_THEME}
 * for any missing or invalid field — never throws.
 *
 * Accepts:
 *   - `null` / `undefined`         → DEFAULT
 *   - object without `handy_pill`  → DEFAULT
 *   - object with partial blocks   → fields merged with defaults
 *   - object with full blocks      → exact payload (after clamping)
 */
export function resolveHandyTheme(input: unknown): HandyPillTheme {
  if (input == null || typeof input !== "object") {
    return { ...DEFAULT_HANDY_THEME, palette: { ...DEFAULT_PALETTE },
             animation: { ...DEFAULT_ANIMATION } };
  }
  const root = input as { handy_pill?: unknown };
  if (root.handy_pill == null || typeof root.handy_pill !== "object") {
    return { palette: { ...DEFAULT_PALETTE },
             animation: { ...DEFAULT_ANIMATION } };
  }
  const hp = root.handy_pill as { palette?: unknown; animation?: unknown };
  return {
    palette: resolvePalette(hp.palette),
    animation: resolveAnimation(hp.animation),
  };
}

/**
 * Lower-case-with-underscores → `--hp-with-dashes`.
 *
 * Examples:
 *   "icon_color"                → "--hp-icon"           (special-cased)
 *   "bar_glow"                  → "--hp-bar-glow"
 *   "idle_breathing_amplitude"  → "--hp-breathing-amplitude" (drop "idle_")
 *   "bar_height_ms"             → "--hp-bar-height-ms"
 */
const PALETTE_VAR_NAMES: Record<keyof HandyPillPalette, string> = {
  icon_color: "--hp-icon",
  bar_color: "--hp-bar",
  bar_glow: "--hp-bar-glow",
  shadow: "--hp-shadow",
  transcribing_text: "--hp-transcribing-text",
  cancel_hover_bg: "--hp-cancel-hover-bg",
};

const ANIMATION_VAR_NAMES: Record<keyof HandyPillAnimation, string> = {
  smoothing_alpha: "--hp-smoothing-alpha",
  power_curve: "--hp-power-curve",
  peak_decay: "--hp-peak-decay",
  bar_min_height_px: "--hp-bar-min-height-px",
  bar_min_opacity: "--hp-bar-min-opacity",
  bar_opacity_gain: "--hp-bar-opacity-gain",
  bar_height_ms: "--hp-bar-height-ms",
  bar_opacity_ms: "--hp-bar-opacity-ms",
  pill_fade_ms: "--hp-pill-fade-ms",
  transcribing_pulse_ms: "--hp-transcribing-pulse-ms",
  idle_breathing_amplitude: "--hp-breathing-amplitude",
  idle_breathing_period_ms: "--hp-breathing-period-ms",
  cancel_hover_ms: "--hp-cancel-hover-ms",
};

/** Fields whose values are durations (ms) when written into CSS vars. */
const MS_FIELDS = new Set<keyof HandyPillAnimation>([
  "bar_height_ms",
  "bar_opacity_ms",
  "pill_fade_ms",
  "transcribing_pulse_ms",
  "idle_breathing_period_ms",
  "cancel_hover_ms",
]);

/** Stringify a number without trailing zeroes ("0.3", "60"). */
function fmt(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toString();
}

/**
 * Flatten a {@link HandyPillTheme} into a `--hp-*`-keyed record suitable
 * for `style.setProperty()` on `:root`. ms-fields receive a `"ms"`
 * suffix; all other numbers are stringified untouched; palette strings
 * pass through unchanged.
 *
 * Total of exactly 18 keys (6 palette + 12 animation).
 */
export function themeToCssVars(theme: HandyPillTheme): Record<string, string> {
  const out: Record<string, string> = {};
  // palette
  (Object.keys(PALETTE_VAR_NAMES) as Array<keyof HandyPillPalette>).forEach(
    (key) => {
      out[PALETTE_VAR_NAMES[key]] = theme.palette[key];
    },
  );
  // animation
  (Object.keys(ANIMATION_VAR_NAMES) as Array<keyof HandyPillAnimation>).forEach(
    (key) => {
      const value = theme.animation[key];
      out[ANIMATION_VAR_NAMES[key]] = MS_FIELDS.has(key)
        ? `${fmt(value)}ms`
        : fmt(value);
    },
  );
  return out;
}

/** Extract the three JS-driven coefficients for bar math. */
export function themeBarMath(theme: HandyPillTheme): BarMath {
  return {
    smoothing_alpha: theme.animation.smoothing_alpha,
    power_curve: theme.animation.power_curve,
    peak_decay: theme.animation.peak_decay,
  };
}
