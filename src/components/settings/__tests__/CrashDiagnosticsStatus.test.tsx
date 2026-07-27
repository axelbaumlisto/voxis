import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CrashDiagnosticsStatus from "../CrashDiagnosticsStatus";
import { getCrashDiagnostics } from "../../../lib/commands";

vi.mock("../../../lib/commands", () => ({
  getCrashDiagnostics: vi.fn(),
}));

const getCrashDiagnosticsMock = vi.mocked(getCrashDiagnostics);

describe("CrashDiagnosticsStatus", () => {
  beforeEach(() => {
    getCrashDiagnosticsMock.mockReset();
  });

  it("renders nothing when crash evidence does not warrant a Settings notice", async () => {
    getCrashDiagnosticsMock.mockResolvedValueOnce({
      severity: "ok",
      headline: "Crash diagnostics: no urgent evidence",
      details: ["no crashes recorded"],
      hints: [],
      settings_notice: null,
      last_crash_report: null,
      previous_run_ended_uncleanly: false,
      previous_run_last_state: null,
      heartbeat_freshness: null,
      fatal_handler_install_error: null,
    });

    const { container } = render(
      <CrashDiagnosticsStatus label="Crash Diagnostics" description="Local only" />
    );

    await waitFor(() => expect(getCrashDiagnosticsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("crash-diagnostics-status")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a status line when previous-run or crash-loop evidence warrants it", async () => {
    getCrashDiagnosticsMock.mockResolvedValueOnce({
      severity: "warn",
      headline: "Crash diagnostics need attention",
      details: ["previous run ended uncleanly; captured last state: uptime=42s"],
      hints: [],
      settings_notice: "previous run ended uncleanly; captured last state: uptime=42s",
      last_crash_report: null,
      previous_run_ended_uncleanly: true,
      previous_run_last_state: "uptime=42s",
      heartbeat_freshness: "fresh age=5s (fresh<=30s)",
      fatal_handler_install_error: null,
    });

    render(<CrashDiagnosticsStatus label="Crash Diagnostics" description="Local only" />);

    const status = await screen.findByTestId("crash-diagnostics-status");
    expect(status).toHaveTextContent("Crash evidence found");
    expect(status).toHaveTextContent("previous run ended uncleanly");
    expect(status).toHaveTextContent("uptime=42s");
  });

  it("hides if the query fails", async () => {
    getCrashDiagnosticsMock.mockRejectedValueOnce(new Error("not available"));

    const { container } = render(
      <CrashDiagnosticsStatus label="Crash Diagnostics" description="Local only" />
    );

    await waitFor(() => expect(getCrashDiagnosticsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("crash-diagnostics-status")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
