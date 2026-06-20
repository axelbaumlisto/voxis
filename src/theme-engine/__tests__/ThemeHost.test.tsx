// src/theme-engine/__tests__/ThemeHost.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import ThemeHost from "../ThemeHost";
import type { ThemeModule, ThemeState } from "../contract";

const state: ThemeState = { mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) };

function makeModule(log: string[]): ThemeModule {
  return {
    mount(container, api) {
      log.push("mount");
      container.dataset.mounted = "yes";
      api.onState(() => log.push("state"));
      return { unmount: () => log.push("unmount") };
    },
  };
}

/** Module that records the canvas size it was mounted with. */
function makeSizeModule(sizes: Array<{ width: number; height: number }>): ThemeModule {
  return {
    mount(_container, api) {
      sizes.push({ width: api.size.width, height: api.size.height });
      return { unmount: () => {} };
    },
  };
}

describe("ThemeHost", () => {
  it("mounts the loaded theme and pushes initial state", async () => {
    const log: string[] = [];
    const mod = makeModule(log);
    const { container } = render(
      <ThemeHost
        themeId="t1"
        state={state}
        fetchModule={async () => mod}
        fallbackModule={mod}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => expect(log).toContain("mount"));
    expect(log).toContain("state"); // onState fires immediately
    expect(container.querySelector("[data-mounted='yes']")).toBeTruthy();
  });

  it("falls back to fallbackModule when fetchModule rejects", async () => {
    const log: string[] = [];
    const fallback = makeModule(log);
    render(
      <ThemeHost
        themeId="broken"
        state={state}
        fetchModule={async () => { throw new Error("boom"); }}
        fallbackModule={fallback}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => expect(log).toContain("mount"));
  });

  it("falls back when mount throws", async () => {
    const log: string[] = [];
    const bad: ThemeModule = { mount() { throw new Error("mount-boom"); } };
    const fallback = makeModule(log);
    render(
      <ThemeHost themeId="t" state={state} fetchModule={async () => bad}
        fallbackModule={fallback} onCancel={() => {}} />,
    );
    await waitFor(() => expect(log).toContain("mount"));
  });

  it("unmounts old theme when themeId changes", async () => {
    const log: string[] = [];
    const mod = makeModule(log);
    const { rerender } = render(
      <ThemeHost themeId="a" state={state} fetchModule={async () => mod}
        fallbackModule={mod} onCancel={() => {}} />,
    );
    await waitFor(() => expect(log).toContain("mount"));
    rerender(
      <ThemeHost themeId="b" state={state} fetchModule={async () => mod}
        fallbackModule={mod} onCancel={() => {}} />,
    );
    await waitFor(() => expect(log).toContain("unmount"));
  });

  it("remounts with the new canvas size when width/height change", async () => {
    // Regression: organic themes fix canvas.width/height at mount. When the
    // OS window resizes (e.g. 172x36 pill -> 160x160 square for cell/ring
    // themes), ThemeHost must remount so the renderer rebuilds its canvas at
    // the new size instead of CSS-stretching the old geometry (flat lines).
    const sizes: Array<{ width: number; height: number }> = [];
    const mod = makeSizeModule(sizes);
    const { rerender } = render(
      <ThemeHost themeId="a" state={state} fetchModule={async () => mod}
        fallbackModule={mod} onCancel={() => {}} width={172} height={36} />,
    );
    await waitFor(() => expect(sizes.length).toBe(1));
    expect(sizes[0]).toEqual({ width: 172, height: 36 });
    act(() => {
      rerender(
        <ThemeHost themeId="a" state={state} fetchModule={async () => mod}
          fallbackModule={mod} onCancel={() => {}} width={160} height={160} />,
      );
    });
    await waitFor(() => expect(sizes.length).toBe(2));
    expect(sizes[1]).toEqual({ width: 160, height: 160 });
  });

  it("does NOT remount when params change by REFERENCE but not by VALUE", async () => {
    // Regression (overlay blink): overlay.tsx loads the manifest async and
    // calls setParams(null) then setParams(obj). Each render passed a fresh
    // object/null reference, so a params-in-deps effect remounted the theme
    // 2–3× on every show — the cell visibly blinked and lost its accumulated
    // motion state. ThemeHost must key remounts on params VALUE, not identity.
    const log: string[] = [];
    const mod = makeModule(log);
    const { rerender } = render(
      <ThemeHost themeId="a" state={state} fetchModule={async () => mod}
        fallbackModule={mod} onCancel={() => {}} params={{ a: 1 }} />,
    );
    await waitFor(() => expect(log).toContain("mount"));
    const mounts = log.filter((l) => l === "mount").length;
    act(() => {
      rerender(
        <ThemeHost themeId="a" state={state} fetchModule={async () => mod}
          fallbackModule={mod} onCancel={() => {}} params={{ a: 1 }} />, // same value, new ref
      );
    });
    // give any erroneous remount a chance to happen
    await new Promise((r) => setTimeout(r, 50));
    expect(log.filter((l) => l === "mount").length).toBe(mounts);
  });

  it("DOES remount when params change by value", async () => {
    const log: string[] = [];
    const mod = makeModule(log);
    const { rerender } = render(
      <ThemeHost themeId="a" state={state} fetchModule={async () => mod}
        fallbackModule={mod} onCancel={() => {}} params={{ a: 1 }} />,
    );
    await waitFor(() => expect(log).toContain("mount"));
    const mounts = log.filter((l) => l === "mount").length;
    act(() => {
      rerender(
        <ThemeHost themeId="a" state={state} fetchModule={async () => mod}
          fallbackModule={mod} onCancel={() => {}} params={{ a: 2 }} />,
      );
    });
    await waitFor(() => expect(log.filter((l) => l === "mount").length).toBe(mounts + 1));
  });

  it("pushes new state to subscribed themes without remounting", async () => {
    const log: string[] = [];
    const mod = makeModule(log);
    const { rerender } = render(
      <ThemeHost themeId="a" state={state} fetchModule={async () => mod}
        fallbackModule={mod} onCancel={() => {}} />,
    );
    await waitFor(() => expect(log).toContain("mount"));
    const mounts = log.filter((l) => l === "mount").length;
    act(() => {
      rerender(
        <ThemeHost themeId="a" state={{ ...state, mode: "recording" }}
          fetchModule={async () => mod} fallbackModule={mod} onCancel={() => {}} />,
      );
    });
    await waitFor(() =>
      expect(log.filter((l) => l === "state").length).toBeGreaterThanOrEqual(2),
    );
    expect(log.filter((l) => l === "mount").length).toBe(mounts); // no remount
  });
});
