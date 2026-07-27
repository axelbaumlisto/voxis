import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import FieldWrapper from "./FieldWrapper";
import {
  getCrashDiagnostics,
  type CrashDiagnosticsReport,
} from "../../lib/commands";

export interface CrashDiagnosticsStatusProps {
  label: string;
  description?: string;
}

export default function CrashDiagnosticsStatus({
  label,
  description,
}: CrashDiagnosticsStatusProps) {
  const { t } = useTranslation();
  const [report, setReport] = useState<CrashDiagnosticsReport | null>(null);

  useEffect(() => {
    let alive = true;
    getCrashDiagnostics()
      .then((next) => {
        if (alive) setReport(next);
      })
      .catch(() => {
        // Settings should not become noisy or fail to render if diagnostics
        // evidence cannot be queried. Export Diagnostics still carries errors.
        if (alive) setReport(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!report?.settings_notice) {
    return null;
  }

  return (
    <FieldWrapper label={label} description={description}>
      <div
        data-testid="crash-diagnostics-status"
        role="status"
        style={{
          padding: "8px 12px",
          border: "1px solid var(--warning, #d99a00)",
          borderRadius: 4,
          background: "color-mix(in srgb, var(--warning, #d99a00) 10%, transparent)",
          fontSize: "0.85em",
          lineHeight: 1.4,
          wordBreak: "break-word",
        }}
      >
        <strong>{t("settings.crashDiagnosticsNoticeTitle")}</strong>
        <br />
        {report.settings_notice}
      </div>
    </FieldWrapper>
  );
}
