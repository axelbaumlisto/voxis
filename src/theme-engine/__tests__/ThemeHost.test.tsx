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
