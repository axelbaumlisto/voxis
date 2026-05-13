/**
 * HandyThemeProvider — single source of truth for the active pill theme.
 *
 * Architecture (SOLID/DRY/KISS):
 *  - SRP: this component owns ONE side-effect — publishing the resolved
 *    {@link HandyPillTheme} to the document as `--hp-*` CSS variables
 *    on `:root`. It does NOT load themes, does NOT subscribe to events,
 *    does NOT decide what theme is "current".
 *  - OCP: callers swap palettes by passing a different `theme` prop;
 *    the schema can grow new fields without touching this file (the
 *    side-effect just iterates `themeToCssVars()` output).
 *  - DIP: consumers depend on `useHandyTheme()` / `useHandyBarMath()`
 *    hooks, never on the JSON payload or storage layer.
 *  - DRY: var name flattening lives in `src/themes/handy.ts` —
 *    this file just iterates the resulting record.
 *  - KISS: classic context.Provider + useEffect with cleanup. No
 *    portals, no global state, no zustand.
 *
 * Why CSS vars on `:root` and not on the Provider's host element:
 *  the pill is rendered into an isolated webview (#root sits inside
 *  body); inheriting custom properties from the documentElement
 *  guarantees they reach every descendant including future
 *  HandyPill instances mounted in dialogs / previews.
 */
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
} from "react";
import {
  DEFAULT_HANDY_THEME,
  themeBarMath,
  themeToCssVars,
  type BarMath,
  type HandyPillTheme,
} from "./handy";

const HandyThemeContext = createContext<HandyPillTheme | null>(null);

export interface HandyThemeProviderProps {
  theme: HandyPillTheme;
}

export function HandyThemeProvider({
  theme,
  children,
}: PropsWithChildren<HandyThemeProviderProps>) {
  // Recompute CSS-vars only when the theme reference changes.
  const vars = useMemo(() => themeToCssVars(theme), [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const previous: Record<string, string> = {};
    for (const [name, value] of Object.entries(vars)) {
      previous[name] = root.style.getPropertyValue(name);
      root.style.setProperty(name, value);
    }
    return () => {
      for (const name of Object.keys(vars)) {
        const before = previous[name];
        if (before) {
          root.style.setProperty(name, before);
        } else {
          root.style.removeProperty(name);
        }
      }
    };
  }, [vars]);

  return (
    <HandyThemeContext.Provider value={theme}>
      {children}
    </HandyThemeContext.Provider>
  );
}

function readContextOrThrow(consumer: string): HandyPillTheme {
  const ctx = useContext(HandyThemeContext);
  if (ctx == null) {
    throw new Error(
      `${consumer} must be called inside <HandyThemeProvider>; ` +
        "wrap the consumer tree with `<HandyThemeProvider theme={...}>`.",
    );
  }
  return ctx;
}

/** Full {@link HandyPillTheme} from the active Provider. */
export function useHandyTheme(): HandyPillTheme {
  return readContextOrThrow("useHandyTheme");
}

/**
 * Just the three JS-driven coefficients used by `useSmoothBars` /
 * `HandyBars`. Hook-level subset for ISP (callers that only need
 * math don't need to depend on the palette).
 */
export function useHandyBarMath(): BarMath {
  const theme = readContextOrThrow("useHandyBarMath");
  return themeBarMath(theme);
}

/** Re-export for convenience so callers don't have to import handy.ts. */
export { DEFAULT_HANDY_THEME };
