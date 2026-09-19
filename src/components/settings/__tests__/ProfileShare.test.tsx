/**
 * Tests for ProfileShare.
 *
 * Mocks `lib/commands` (the hand-written invoke wrappers this component
 * calls directly, same convention as ExportDiagnostics/LlmPromptManager)
 * and `@tauri-apps/api/event` (used by `useTauriEvent` for the
 * `profile-share-delivered` event). Covers:
 *   - renders the interface dropdown from `listShareInterfaces`
 *   - clicking Start calls `startProfileShare` and renders the QR/code
 *   - the `profile-share-delivered` event flips status to "Delivered"
 *   - clicking Stop calls `stopProfileShare` and clears the session
 *   - unmounting while a session is waiting also calls `stopProfileShare`
 *   - "Save profile file…" with no passphrase shows the generated one once
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const listShareInterfacesMock = vi.fn();
const startProfileShareMock = vi.fn();
const stopProfileShareMock = vi.fn();
const exportProfileFileMock = vi.fn();

vi.mock("../../../lib/commands", () => ({
  listShareInterfaces: (...a: unknown[]) => listShareInterfacesMock(...a),
  startProfileShare: (...a: unknown[]) => startProfileShareMock(...a),
  stopProfileShare: (...a: unknown[]) => stopProfileShareMock(...a),
  exportProfileFile: (...a: unknown[]) => exportProfileFileMock(...a),
}));

let tauriEventHandler: ((payload: unknown) => void) | null = null;
const mockListen = vi.fn((_event: string, handler: (e: { payload: unknown }) => void) => {
  tauriEventHandler = (payload: unknown) => handler({ payload });
  return Promise.resolve(() => {});
});
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: [string, (e: { payload: unknown }) => void]) => mockListen(...args),
}));

import ProfileShare from "../ProfileShare";

const sampleInterfaces = [
  { name: "en0", ip: "192.168.1.42" },
  { name: "en1", ip: "10.0.0.5" },
];

const sampleSession = {
  qr_svg: "<svg data-testid=\"inner-svg\"></svg>",
  code: "123456",
  host: "192.168.1.42",
  port: 4217,
  expires_at_ms: Date.now() + 120_000,
};

beforeEach(() => {
  tauriEventHandler = null;
  listShareInterfacesMock.mockReset().mockResolvedValue(sampleInterfaces);
  startProfileShareMock.mockReset().mockResolvedValue(sampleSession);
  stopProfileShareMock.mockReset().mockResolvedValue(undefined);
  exportProfileFileMock.mockReset().mockResolvedValue({ passphrase: null });
  mockListen.mockClear();
});

describe("ProfileShare", () => {
  it("loads and renders the interface dropdown", async () => {
    render(<ProfileShare label="Share profile to device" />);
    // The mock resolving and React committing the list are two ticks apart
    // under load; CI runs 160/162 failed on a getByText fired between them.
    expect(await screen.findByText("en0 (192.168.1.42)")).toBeTruthy();
    expect(screen.getByText("en1 (10.0.0.5)")).toBeTruthy();
    expect(listShareInterfacesMock).toHaveBeenCalledTimes(1);
  });

  it("starting a session calls startProfileShare and renders the QR + code", async () => {
    render(<ProfileShare label="Share profile to device" />);
    await waitFor(() => expect(listShareInterfacesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("profile-share-start-button"));

    await waitFor(() => {
      expect(startProfileShareMock).toHaveBeenCalledWith(null);
    });
    expect(await screen.findByTestId("profile-share-qr")).toBeTruthy();
    expect(screen.getByTestId("profile-share-code").textContent).toBe("123456");
    expect(screen.getByTestId("profile-share-status").textContent).toMatch(/Waiting for device/);
  });

  it("the delivered event flips status to Delivered", async () => {
    render(<ProfileShare label="Share profile to device" />);
    await waitFor(() => expect(listShareInterfacesMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("profile-share-start-button"));
    await screen.findByTestId("profile-share-qr");

    await waitFor(() => expect(mockListen).toHaveBeenCalledWith(
      "profile-share-delivered",
      expect.any(Function),
    ));
    expect(tauriEventHandler).not.toBeNull();
    act(() => {
      tauriEventHandler?.(undefined);
    });

    await waitFor(() => {
      expect(screen.getByTestId("profile-share-status").textContent).toBe("Delivered");
    });
  });

  it("stopping clears the session and calls stopProfileShare", async () => {
    render(<ProfileShare label="Share profile to device" />);
    await waitFor(() => expect(listShareInterfacesMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("profile-share-start-button"));
    await screen.findByTestId("profile-share-qr");

    fireEvent.click(screen.getByTestId("profile-share-stop-button"));

    await waitFor(() => {
      expect(stopProfileShareMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("profile-share-qr")).toBeNull();
    expect(screen.getByTestId("profile-share-start-button")).toBeTruthy();
  });

  it("unmounting while a session is waiting also stops the server", async () => {
    const { unmount } = render(<ProfileShare label="Share profile to device" />);
    await waitFor(() => expect(listShareInterfacesMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("profile-share-start-button"));
    await screen.findByTestId("profile-share-qr");

    unmount();

    expect(stopProfileShareMock).toHaveBeenCalledTimes(1);
  });

  it("unmounting with no active session does not call stopProfileShare", async () => {
    const { unmount } = render(<ProfileShare label="Share profile to device" />);
    await waitFor(() => expect(listShareInterfacesMock).toHaveBeenCalled());

    unmount();

    expect(stopProfileShareMock).not.toHaveBeenCalled();
  });

  it("exporting with no passphrase reveals the generated one once", async () => {
    exportProfileFileMock.mockResolvedValue({ passphrase: "one two three four five six" });
    render(<ProfileShare label="Share profile to device" />);
    await waitFor(() => expect(listShareInterfacesMock).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId("profile-share-export-path"), {
      target: { value: "/tmp/voxis-profile.vxp" },
    });
    fireEvent.click(screen.getByTestId("profile-share-export-button"));

    await waitFor(() => {
      expect(exportProfileFileMock).toHaveBeenCalledWith("/tmp/voxis-profile.vxp", null);
    });
    expect(
      await screen.findByTestId("profile-share-export-passphrase-value"),
    ).toHaveProperty("textContent", "one two three four five six");
    expect(screen.getByTestId("profile-share-copy-passphrase")).toBeTruthy();
  });

  it("exporting with a user-supplied passphrase does not reveal anything", async () => {
    render(<ProfileShare label="Share profile to device" />);
    await waitFor(() => expect(listShareInterfacesMock).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId("profile-share-export-path"), {
      target: { value: "/tmp/voxis-profile.vxp" },
    });
    fireEvent.change(screen.getByTestId("profile-share-export-passphrase"), {
      target: { value: "my own words" },
    });
    fireEvent.click(screen.getByTestId("profile-share-export-button"));

    await waitFor(() => {
      expect(exportProfileFileMock).toHaveBeenCalledWith("/tmp/voxis-profile.vxp", "my own words");
    });
    expect(screen.queryByTestId("profile-share-export-passphrase-reveal")).toBeNull();
  });
});
