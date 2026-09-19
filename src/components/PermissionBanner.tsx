import { useTranslation } from "react-i18next";
import { PermissionInfo, SecureInputStatus, restartApp } from "../lib/commands";
import "../styles/permission-banner.css";

interface PermissionBannerProps {
  permissions: PermissionInfo[];
  onRequestPermission: (permission: string) => void;
  /** D3: Secure Event Input state; `null`/off renders nothing extra. */
  secureInput?: SecureInputStatus | null;
}

// Permissions that require app restart to take effect on macOS
const RESTART_REQUIRED_PERMISSIONS = ["Input Monitoring", "Accessibility"];

/**
 * Shows individual banners for each missing permission.
 * Each banner opens the corresponding System Settings page.
 * Permissions requiring restart show a restart button.
 */
function PermissionBanner({
  permissions,
  onRequestPermission,
  secureInput = null,
}: PermissionBannerProps) {
  const { t } = useTranslation();
  const missing = (permissions ?? []).filter((p) => p.status !== "granted");
  const secureInputOn = secureInput?.enabled === true;

  if (missing.length === 0 && !secureInputOn) {
    return null;
  }

  const handleRestart = async () => {
    await restartApp();
  };

  return (
    <div className="permission-banners">
      {secureInputOn && (
        // D3: not a permission — a transient session state some other app
        // holds. No button: nothing Voxis can do about it, the text says who.
        <div className="permission-banner" data-testid="secure-input-banner">
          <span className="permission-banner-icon">[!]</span>
          <span className="permission-banner-text">
            <strong>{t("permissions.secureInputTitle")}</strong>
            <span className="permission-banner-desc">
              {" — "}
              {secureInput?.holder_pid !== null && secureInput?.holder_pid !== undefined
                ? t("permissions.secureInputHolder", { name: secureInput.holder_name ?? "?", pid: secureInput.holder_pid })
                : t("permissions.secureInputHolderUnknown")}
              {"; "}
              {t("permissions.secureInputDesc")}
            </span>
          </span>
        </div>
      )}
      {missing.map((perm) => {
        const needsRestart = RESTART_REQUIRED_PERMISSIONS.includes(perm.name);

        return (
          <div key={perm.name} className="permission-banner">
            <span className="permission-banner-icon">[!]</span>
            <span className="permission-banner-text">
              <strong>{perm.name}</strong>
              {perm.description && (
                <span className="permission-banner-desc"> — {perm.description}</span>
              )}
            </span>
            <div className="permission-banner-actions">
              <button
                className="permission-banner-action"
                onClick={() => onRequestPermission(perm.name)}
                type="button"
              >
                {t("permissions.openSettings")}
              </button>
              {needsRestart && (
                <button
                  className="permission-banner-action permission-banner-restart-btn"
                  onClick={handleRestart}
                  type="button"
                >
                  {t("permissions.restart")}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default PermissionBanner;
