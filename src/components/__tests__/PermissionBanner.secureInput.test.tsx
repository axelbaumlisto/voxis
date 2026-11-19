import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PermissionBanner from "../PermissionBanner";
import en from "../../i18n/locales/en.json";
import ru from "../../i18n/locales/ru.json";

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

  it("names the app macOS points at while Secure Input is on, even with all permissions granted", () => {
    render(
      <PermissionBanner permissions={[]} onRequestPermission={() => {}} secureInput={{ enabled: true, holder_pid: 812, holder_name: "Terminal" }} />,
    );
    const banner = screen.getByTestId("secure-input-banner");
    expect(banner.textContent).toContain("permissions.secureInputTitle");
    // The name only: a pid means nothing to the person reading the banner.
    expect(banner.textContent).toContain("permissions.secureInputHolder(name=Terminal)");
    expect(banner.textContent).toContain("permissions.secureInputDesc");
    expect(banner.querySelector("button")).toBeNull();
  });

  it("says macOS names no app when the OS reports the state without a holder", () => {
    render(<PermissionBanner permissions={[]} onRequestPermission={() => {}} secureInput={{ enabled: true, holder_pid: null, holder_name: null }} />);
    const banner = screen.getByTestId("secure-input-banner");
    expect(banner.textContent).toContain("permissions.secureInputHolderUnknown");
    expect(banner.textContent).toContain("permissions.secureInputDesc");
  });

  it("never renders a nameless holder as '?'", () => {
    render(<PermissionBanner permissions={[]} onRequestPermission={() => {}} secureInput={{ enabled: true, holder_pid: 645, holder_name: null }} />);
    const banner = screen.getByTestId("secure-input-banner");
    expect(banner.textContent).toContain("permissions.secureInputHolderUnknown");
    expect(banner.textContent).not.toContain("permissions.secureInputHolder(");
  });

  // The component passes `name` only. A locale that still asked for another
  // variable would print the raw `{{…}}` to the user.
  it.each([["en", en], ["ru", ru]])("%s: the banner strings interpolate nothing but the app name", (_lang, locale) => {
    const p = locale.permissions;
    expect(p.secureInputHolder.match(/{{\w+}}/g)).toEqual(["{{name}}"]);
    for (const text of [p.secureInputTitle, p.secureInputHolderUnknown, p.secureInputDesc]) {
      expect(text).not.toMatch(/{{/);
    }
  });
});
