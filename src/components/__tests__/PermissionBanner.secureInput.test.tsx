import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PermissionBanner from "../PermissionBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${String(v)}`).join(",")})` : key,
  }),
}));
vi.mock("../../lib/commands", () => ({ restartApp: vi.fn() }));

describe("PermissionBanner — D3 Secure Input", () => {
  it("renders nothing when every permission is granted and Secure Input is off", () => {
    const { container } = render(
      <PermissionBanner permissions={[]} onRequestPermission={() => {}} secureInput={{ enabled: false, holder_pid: null, holder_name: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("names the holder while Secure Input is on, even with all permissions granted", () => {
    render(
      <PermissionBanner permissions={[]} onRequestPermission={() => {}} secureInput={{ enabled: true, holder_pid: 812, holder_name: "Terminal" }} />,
    );
    const banner = screen.getByTestId("secure-input-banner");
    expect(banner.textContent).toContain("permissions.secureInputTitle");
    expect(banner.textContent).toContain("permissions.secureInputHolder(name=Terminal,pid=812)");
    expect(banner.textContent).toContain("permissions.secureInputDesc");
    expect(banner.querySelector("button")).toBeNull();
  });

  it("says the holder is unknown when the OS reports the state without a pid", () => {
    render(<PermissionBanner permissions={[]} onRequestPermission={() => {}} secureInput={{ enabled: true, holder_pid: null, holder_name: null }} />);
    expect(screen.getByTestId("secure-input-banner").textContent).toContain("permissions.secureInputHolderUnknown");
  });
});
