import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";

// Mock the Tauri event API
const mockUnlisten = vi.fn();
const mockListen = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// Mock page components to simplify tests
vi.mock("../pages/SettingsPage", () => ({
  default: () => <div data-testid="settings-page">Settings Page</div>,
}));

vi.mock("../pages/HistoryPage", () => ({
  default: () => <div data-testid="history-page">History Page</div>,
}));

vi.mock("../pages/DictionaryPage", () => ({
  default: () => <div data-testid="dictionary-page">Dictionary Page</div>,
}));

vi.mock("../components/Layout", () => ({
  default: () => {
    // Must use Outlet to render child routes
    const { Outlet } = require("react-router-dom");
    return (
      <div data-testid="layout">
        <Outlet />
      </div>
    );
  },
}));

describe("App", () => {
  let capturedCallback: ((event: { payload: string }) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallback = null;
    mockListen.mockImplementation((_eventName, callback) => {
      capturedCallback = callback;
      return Promise.resolve(mockUnlisten);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to navigate event on mount", async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith("navigate", expect.any(Function));
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    unmount();

    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  it("navigates to /settings when navigate event received", async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Simulate tray menu event
    act(() => {
      capturedCallback?.({ payload: "/settings" });
    });

    await waitFor(() => {
      expect(getByTestId("settings-page")).toBeInTheDocument();
    });
  });

  it("navigates to /history when navigate event received", async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/settings"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Simulate tray menu event
    act(() => {
      capturedCallback?.({ payload: "/history" });
    });

    await waitFor(() => {
      expect(getByTestId("history-page")).toBeInTheDocument();
    });
  });

  it("navigates to /dictionary when navigate event received", async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Simulate tray menu event
    act(() => {
      capturedCallback?.({ payload: "/dictionary" });
    });

    await waitFor(() => {
      expect(getByTestId("dictionary-page")).toBeInTheDocument();
    });
  });

  it("renders routes correctly", async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    // Default route renders History (History IS the home page).
    await waitFor(() => {
      expect(getByTestId("history-page")).toBeInTheDocument();
    });
  });

  it("renders settings route", async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/settings"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getByTestId("settings-page")).toBeInTheDocument();
    });
  });

  it("renders dictionary route", async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/dictionary"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getByTestId("dictionary-page")).toBeInTheDocument();
    });
  });
});
