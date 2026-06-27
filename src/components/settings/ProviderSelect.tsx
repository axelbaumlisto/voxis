import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProviderSelection } from "../../hooks/useProviderSelection";
import { LlmProvider } from "../../lib/commands";
import { validateProviderUrl } from "../../lib/providerValidation";
import ProviderModal from "./ProviderModal";
import ProviderActions from "./ProviderActions";
import OptionDropdown from "./OptionDropdown";
import FieldWrapper from "./FieldWrapper";
import InputField from "./InputField";

interface ProviderSelectProps {
  providerId: string;
  modelId: string;
  apiUrl: string;
  onProviderChange: (providerId: string, apiUrl: string, defaultModel: string) => void;
  onModelChange: (modelId: string) => void;
}

/**
 * Provider and model selection component.
 * SRP: Coordinates subcomponents (OptionDropdown, ProviderActions).
 */
function ProviderSelect({
  providerId,
  modelId,
  apiUrl,
  onProviderChange,
  onModelChange,
}: ProviderSelectProps) {
  const { t } = useTranslation();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LlmProvider | null>(null);

  const {
    providers,
    loading,
    error,
    currentProvider,
    models,
    handleProviderChange,
    handleRemoveProvider,
    handleAddProvider,
    handleUpdateProvider,
  } = useProviderSelection(providerId, modelId, onProviderChange, onModelChange);

  const onAddProvider = async (provider: Omit<LlmProvider, "builtin">) => {
    await handleAddProvider(provider);
    setShowAddModal(false);
  };

  const onUpdateProvider = async (provider: Omit<LlmProvider, "builtin">) => {
    await handleUpdateProvider(provider);
    setEditingProvider(null);
  };

  const apiUrlIsValid = !apiUrl || validateProviderUrl(apiUrl);

  if (loading) {
    return (
      <div className="settings-field">
        <label className="settings-field-label">Loading providers...</label>
      </div>
    );
  }

  return (
    <>
      {/* Provider Select */}
      <FieldWrapper label="LLM Provider">
        <div className="provider-select-wrapper">
          <OptionDropdown
            options={providers.map((p) => ({
              id: p.id,
              label: p.name,
              suffix: p.builtin ? undefined : "(custom)",
            }))}
            selectedId={providerId}
            onChange={handleProviderChange}
            showMissingSelection={false}
            ariaLabel="LLM Provider"
          />
          <ProviderActions
            currentProvider={currentProvider}
            onAdd={() => setShowAddModal(true)}
            onEdit={() => currentProvider && setEditingProvider(currentProvider)}
            onRemove={() => currentProvider && handleRemoveProvider(currentProvider.id)}
          />
        </div>
        {error && (
          <p
            className="settings-field-error"
            role="alert"
            data-testid="provider-error"
            style={{ color: "var(--error)" }}
          >
            {t("settings.removeProviderFailed")}
          </p>
        )}
      </FieldWrapper>

      {/* Model Select */}
      <FieldWrapper label="LLM Model">
        <OptionDropdown
          options={models.map((m) => ({ id: m.id, label: m.name }))}
          selectedId={modelId}
          onChange={onModelChange}
          ariaLabel="LLM Model"
        />
      </FieldWrapper>

      {/* API URL (readonly display) */}
      <InputField
        label="API URL"
        description="Automatically set by provider"
        value={apiUrl}
        onChange={() => {}}
        readonly
        ariaInvalid={!apiUrlIsValid}
      />

      {/* Modals */}
      {showAddModal && (
        <ProviderModal
          mode="add"
          onClose={() => setShowAddModal(false)}
          onSave={onAddProvider}
          existingIds={providers.map((p) => p.id)}
        />
      )}
      {editingProvider && (
        <ProviderModal
          mode="edit"
          provider={editingProvider}
          onClose={() => setEditingProvider(null)}
          onSave={onUpdateProvider}
          existingIds={providers.map((p) => p.id)}
        />
      )}
    </>
  );
}

export default ProviderSelect;
