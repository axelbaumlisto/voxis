import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SECTION_KEY_MAP } from "../../lib/settingsRegistry";

interface SectionProps {
  /** Display title; used as-is when no i18n key resolves. */
  title: string;
  /** Raw section string used to look up the i18n key (SECTION_KEY_MAP). */
  sectionKey?: string;
  children: ReactNode;
}

function Section({ title, sectionKey, children }: SectionProps) {
  const { t } = useTranslation();
  const i18nKey = sectionKey ? SECTION_KEY_MAP[sectionKey] : undefined;
  const heading = i18nKey ? t(i18nKey) : title;
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{heading}</h3>
      <div className="settings-section-content">{children}</div>
    </div>
  );
}

export default Section;
