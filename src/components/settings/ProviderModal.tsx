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
  const title = mode === "add" ? t("settings.addCustomProvider") : t("settings.editProviderTitle");
  const submitText = mode === "add" ? t("settings.addProviderBtn") : t("settings.saveChanges");
  const savingText = mode === "add" ? t("common.adding") : t("common.saving");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>
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
