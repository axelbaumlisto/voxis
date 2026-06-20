// src/theme-engine/ThemeHost.tsx
/**
 * ThemeHost — thin React host for code themes.
 * SRP: load module → mount into a div → push state → unmount on change.
 * DIP: module fetching and cancel action are injected via props.
 * Error policy: any load/mount failure → fallbackModule (never blank overlay).
 */
import { useEffect, useMemo, useRef } from "react";
import {
  THEME_API_VERSION,
  type ThemeApi,
  type ThemeInstance,
  type ThemeModule,
  type ThemeState,
} from "./contract";

export interface ThemeHostProps {
  themeId: string;
  state: ThemeState;
  /** Resolve themeId → module (Tauri readThemeScript + loader in production). */
  fetchModule: (themeId: string) => Promise<ThemeModule>;
  /** Statically-imported safe default theme. */
  fallbackModule: ThemeModule;
  onCancel: () => void;
  width?: number;
  height?: number;
  /** Manifest params for the active theme (free-form JSON). */
  params?: unknown;
}

type Listener = (s: ThemeState) => void;

export default function ThemeHost({
  themeId,
  state,
  fetchModule,
  fallbackModule,
  onCancel,
  width = 172,
  height = 36,
  params,
}: ThemeHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());
  const stateRef = useRef<ThemeState>(state);
  const instanceRef = useRef<ThemeInstance | null>(null);

  // Stabilize params by VALUE, not identity. The overlay loads the manifest
  // async and passes a fresh object/null on each render (setParams(null) then
  // setParams(obj)); without this the mount effect below would remount the
  // theme 2–3× on every show — a visible blink that also resets accumulated
  // motion state (wander/growth/deform). Keying on the serialized value means
  // we only remount when params actually change.
  const paramsKey = useMemo(() => {
    try {
      return JSON.stringify(params ?? null);
    } catch {
      return String(params);
    }
  }, [params]);

  // Push state to mounted theme (no remount).
  stateRef.current = state;
  useEffect(() => {
    for (const cb of listenersRef.current) {
      try {
        cb(state);
      } catch (err) {
        console.error("[ThemeHost] theme onState callback threw:", err);
      }
    }
  }, [state]);

  // (Re)mount on themeId change.
  useEffect(() => {
    let cancelled = false;
    const listeners = listenersRef.current;

    const mountModule = (mod: ThemeModule) => {
      const container = containerRef.current;
      if (!container || cancelled) return;
      container.innerHTML = "";
      const api: ThemeApi = {
        apiVersion: THEME_API_VERSION,
        params: params ?? null,
        size: { width, height },
        onState(cb) {
          listeners.add(cb);
          try {
            cb(stateRef.current);
          } catch (err) {
            console.error("[ThemeHost] initial onState push threw:", err);
          }
          return () => listeners.delete(cb);
        },
        actions: { cancel: onCancel },
      };
      instanceRef.current = mod.mount(container, api);
    };

    void (async () => {
      try {
        const mod = await fetchModule(themeId);
        mountModule(mod);
      } catch (err) {
        console.error(`[ThemeHost] theme '${themeId}' failed, using fallback:`, err);
        try {
          mountModule(fallbackModule);
        } catch (err2) {
          console.error("[ThemeHost] fallback theme failed too:", err2);
        }
      }
    })();

    return () => {
      cancelled = true;
      listeners.clear();
      try {
        instanceRef.current?.unmount();
      } catch (err) {
        console.error("[ThemeHost] unmount threw:", err);
      }
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, paramsKey, width, height]);

  return <div ref={containerRef} style={{ width, height }} data-testid="theme-host" />;
}
