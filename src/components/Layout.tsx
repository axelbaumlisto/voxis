import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecordingContext } from "../contexts/RecordingContext";
import SpectrumVisualizer from "./SpectrumVisualizer";
import PermissionBanner from "./PermissionBanner";
import {
  getStatusClass,
  getStatusText,
  getStatusIcon,
  RecordingState,
} from "../lib/status";
import { getFooterShortcuts } from "../lib/keyboardShortcuts";
import { useClock } from "../hooks/useClock";
import { useHotkeyDisplay } from "../hooks/useHotkeyDisplay";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import {
  checkPermissions,
  openPermissionSettings,
  requestMicrophonePermission,
  requestAccessibilityPermission,
  PermissionInfo,
} from "../lib/commands";

const navKeys = [
  { path: "/history", labelKey: "nav.history" },
  { path: "/dictionary", labelKey: "nav.dictionary" },
  { path: "/settings", labelKey: "nav.settings" },
];

function Layout() {
  const { t } = useTranslation();
  const location = useLocation();
  const { state, error, lastTranscription } = useRecordingContext();

  // Use extracted hooks (SRP)
  const currentTime = useClock();
  const { hotkey } = useHotkeyDisplay();

  // Static accent (decoupled from overlay themes — themes are opaque code now)
  const useGradient = true;

  // SRP: Keyboard handling extracted to hook
  useKeyboardShortcuts(lastTranscription);

  // Get shortcuts for footer display
  const footerShortcuts = getFooterShortcuts();

  // Permission state
  const [permissions, setPermissions] = useState<PermissionInfo[]>([]);

  // Check permissions on mount and when window gains focus
  const refreshPermissions = useCallback(async () => {
    try {
      const perms = await checkPermissions();
      setPermissions(perms);
    } catch {
      // Ignore errors - permissions UI is optional
    }
  }, []);

  useEffect(() => {
    // Check permissions on mount (wizard already requested them at startup)
    refreshPermissions();

    // Re-check when window gains focus (user may have changed settings)
    const handleFocus = () => {
      refreshPermissions();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshPermissions]);

  // Handle permission request - trigger permission dialog, then open system settings
  const handleRequestPermission = useCallback(async (permission: string) => {
    // Trigger permission request so app appears in System Settings list
    if (permission.toLowerCase() === "microphone") {
      await requestMicrophonePermission();
    } else if (permission.toLowerCase() === "accessibility") {
      await requestAccessibilityPermission();
    }
    // Open the corresponding Settings page
    openPermissionSettings(permission);
  }, []);

  // Computed status values using shared utilities
  const statusClass = getStatusClass(state as RecordingState, error);
  const statusText = getStatusText({ state: state as RecordingState, error, hotkey }, t);
  const statusIcon = getStatusIcon(state as RecordingState, error);

  // History is the home page; keep the History tab active on `/` too.
  const isHome = location.pathname === "/";

  return (
    <div className="layout">
      {/* Header - Textual style */}
      <header className="header">
        <span className="header-title">{t("common.appTitle")}</span>
        {error && <span className="header-error">{error}</span>}
        <span className="header-time">{currentTime}</span>
      </header>

      {/* Status Bar */}
      <div className={`status-bar ${statusClass}`}>
        <span>
          {statusIcon} {statusText}
        </span>
      </div>

      {/* Permission Banner */}
      <PermissionBanner
        permissions={permissions}
        onRequestPermission={handleRequestPermission}
      />

      {/* Tabs - TUI style */}
      <nav className="tabs">
        {navKeys.map(({ path, labelKey }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `tab ${isActive || (isHome && path === "/history") ? "active" : ""}`
            }
          >
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      {/* Main Content */}
      <main className="main-content">
        <Outlet />
      </main>

      {/* Spectrum Visualizer */}
      <SpectrumVisualizer mode={error ? "error" : state} useGradient={useGradient} />

      {/* Footer - Generated from shortcuts registry (OCP) */}
      <footer className="footer">
        {footerShortcuts.map((shortcut) => (
          <span key={shortcut.key}>
            <span className="footer-key">{shortcut.keyLabel}</span> {t(shortcut.labelKey)}
          </span>
        ))}
      </footer>
    </div>
  );
}

export default Layout;
