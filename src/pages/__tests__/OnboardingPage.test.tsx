import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const listDevicesMock = vi.fn();
const markCompleteMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../bindings", () => ({
  commands: {
    listAudioDevices: (...a: unknown[]) => listDevicesMock(...a),
    markFirstRunComplete: (...a: unknown[]) => markCompleteMock(...a),
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...(actual as object),
    useNavigate: () => navigateMock,
  };
});

import OnboardingPage from "../OnboardingPage";

const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });

beforeEach(() => {
  listDevicesMock.mockReset();
  markCompleteMock.mockReset();
  navigateMock.mockReset();
  listDevicesMock.mockReturnValue(ok([{ name: "Built-in", id: "default" }]));
  markCompleteMock.mockReturnValue(ok(undefined));
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <OnboardingPage />
    </MemoryRouter>,
  );

describe("OnboardingPage", () => {
  it("renders 3 step indicators", () => {
    renderPage();
    expect(screen.getByTestId("onboarding-step-indicator-0")).toBeTruthy();
    expect(screen.getByTestId("onboarding-step-indicator-1")).toBeTruthy();
    expect(screen.getByTestId("onboarding-step-indicator-2")).toBeTruthy();
  });

  it("starts on step 1 (microphone)", () => {
    renderPage();
    expect(screen.getByTestId("onboarding-step-mic")).toBeTruthy();
  });

  it("'Test microphone' calls listAudioDevices and shows success", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("onboarding-test-mic"));
    await waitFor(() =>
      expect(screen.getByTestId("onboarding-mic-status").textContent).toContain("granted"),
    );
    expect(listDevicesMock).toHaveBeenCalled();
  });

  it("can navigate forward through all 3 steps to the Done button", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("onboarding-next-0"));
    expect(screen.getByTestId("onboarding-step-hotkey")).toBeTruthy();
    fireEvent.click(screen.getByTestId("onboarding-next-1"));
    expect(screen.getByTestId("onboarding-step-try")).toBeTruthy();
    expect(screen.getByTestId("onboarding-done")).toBeTruthy();
  });

  it("clicking Done calls markFirstRunComplete and navigates to /", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("onboarding-next-0"));
    fireEvent.click(screen.getByTestId("onboarding-next-1"));
    fireEvent.click(screen.getByTestId("onboarding-done"));
    await waitFor(() => expect(markCompleteMock).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith("/");
  });

  it("Back button on step 2 returns to step 1", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("onboarding-next-0"));
    fireEvent.click(screen.getByTestId("onboarding-back-1"));
    expect(screen.getByTestId("onboarding-step-mic")).toBeTruthy();
  });
});
