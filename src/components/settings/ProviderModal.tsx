import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { LlmProvider } from "../../lib/commands";
import { useProviderForm, ProviderFormMode } from "../../hooks/useProviderForm";
import ProviderFormBase from "./ProviderFormBase";

interface ProviderModalProps {
  mode: ProviderFormMode;
  provider?: LlmProvider;
  onClose: () => void;
  onSave: (provider: Omit<LlmProvider, "builtin">) => Promise<void>;
  existingIds: string[];
}

/**
 * Modal for adding/editing LLM providers.
 * SRP: UI rendering only - form logic extracted to useProviderForm hook.
 */
function ProviderModal({
  mode,
  provider,
  onClose,
  onSave,
  existingIds,
}: ProviderModalProps) {
  const {
    name,
    setName,
    apiUrl,
    setApiUrl,
    modelsText,
    setModelsText,
    defaultModel,
    setDefaultModel,
    error,
    saving,
    models,
    handleSubmit,
  } = useProviderForm({ mode, provider, existingIds, onSave, onClose });

  const { t } = useTranslation();
  const titleId = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  // Focus trap: focus the first focusable field on open, restore focus to the
  // element that triggered the modal on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Prefer the first form field; fall back to any focusable element.
    const first =
      contentRef.current?.querySelector<HTMLElement>(
        "input:not([readonly]), select, textarea"
      ) ??
      contentRef.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Esc closes the MODAL (not the app). stopPropagation prevents the keydown
  // from bubbling to the global Esc shortcut (coordinates with P7).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  const title = mode === "add" ? t("settings.addCustomProvider") : t("settings.editProviderTitle");
  const submitText = mode === "add" ? t("settings.addProviderBtn") : t("settings.saveChanges");
  const savingText = mode === "add" ? t("common.adding") : t("common.saving");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={contentRef}
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            x
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="modal-error">{error}</div>}

          <ProviderFormBase
            mode={mode}
            providerId={provider?.id}
            name={name}
            apiUrl={apiUrl}
            modelsText={modelsText}
            defaultModel={defaultModel}
            models={models}
            onNameChange={setName}
            onApiUrlChange={setApiUrl}
            onModelsTextChange={setModelsText}
            onDefaultModelChange={setDefaultModel}
          />
        </div>

        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="primary" onClick={handleSubmit} disabled={saving}>
            {saving ? savingText : submitText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProviderModal;
