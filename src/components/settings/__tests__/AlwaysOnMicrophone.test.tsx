import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AlwaysOnMicrophone from "../AlwaysOnMicrophone";
import en from "../../../i18n/locales/en.json";

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", {
    value: platform,
    configurable: true,
  });
}

describe("AlwaysOnMicrophone — macOS", () => {
  beforeEach(() => setPlatform("MacIntel"));
  afterEach(() => setPlatform(""));

  it("renders the toggle", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("always-on-microphone-toggle")).toBeTruthy();
  });

  it("hides the privacy warning while OFF", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("always-on-microphone-warning")).toBeNull();
  });

  it("shows the privacy warning when ON", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={true}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("always-on-microphone-warning")).toBeTruthy();
  });

  it("does not show the unsupported note", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={true}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("always-on-microphone-unsupported")).toBeNull();
  });

  it("toggling fires onChange with the new value", () => {
    const onChange = vi.fn();
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("always-on-microphone-toggle"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("AlwaysOnMicrophone — Linux", () => {
  beforeEach(() => setPlatform("Linux x86_64"));
  afterEach(() => setPlatform(""));

  it("renders the toggle", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("always-on-microphone-toggle")).toBeTruthy();
  });

  it("shows the unsupported note when OFF", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("always-on-microphone-unsupported")).toBeTruthy();
  });

  it("shows the unsupported note when ON", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={true}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("always-on-microphone-unsupported")).toBeTruthy();
  });

  it("does not show the privacy warning regardless of checkbox value", () => {
    const { rerender } = render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("always-on-microphone-warning")).toBeNull();
    rerender(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={true}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("always-on-microphone-warning")).toBeNull();
  });
});

describe("AlwaysOnMicrophone — Windows", () => {
  beforeEach(() => setPlatform("Win32"));
  afterEach(() => setPlatform(""));

  it("shows the unsupported note", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("always-on-microphone-unsupported")).toBeTruthy();
  });

  it("does not show the privacy warning", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={true}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("always-on-microphone-warning")).toBeNull();
  });
});

describe("AlwaysOnMicrophone — i18n", () => {
  beforeEach(() => setPlatform("MacIntel"));
  afterEach(() => setPlatform(""));

  it("privacy note text comes from i18n en keys", () => {
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={true}
        onChange={() => {}}
      />,
    );
    const note = screen.getByTestId("always-on-microphone-warning");
    expect(note.textContent).toContain(en.settings.alwaysOnMicrophonePrivacyTitle);
    expect(note.textContent).toContain(en.settings.alwaysOnMicrophonePrivacyBody);
    expect(note.textContent).toContain(en.settings.alwaysOnMicrophonePrivacyEmphasis);
    expect(note.textContent).toContain(en.settings.alwaysOnMicrophonePrivacyBattery);
  });

  it("unsupported note text comes from i18n en key", () => {
    setPlatform("Linux x86_64");
    render(
      <AlwaysOnMicrophone
        label="Always-on microphone"
        value={false}
        onChange={() => {}}
      />,
    );
    const note = screen.getByTestId("always-on-microphone-unsupported");
    expect(note.textContent).toContain(en.settings.alwaysOnMicrophoneUnsupported);
  });
});
