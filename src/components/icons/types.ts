/**
 * Shared props for SVG icon components.
 *
 * SRP: each icon owns only its own paths; styling is composable via these
 * props. DRY: every icon imports IconProps from here instead of redeclaring.
 */
export interface IconProps {
  width?: number;
  height?: number;
  /** Fill color for the icon paths (CSS color string). */
  color?: string;
  className?: string;
}

export const DEFAULT_ICON_SIZE = 24;
export const DEFAULT_ICON_COLOR = "#FAA2CA";
