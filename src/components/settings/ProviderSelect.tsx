import { useState } from "react";
import { useProviderSelection } from "../../hooks/useProviderSelection";
import { LlmProvider } from "../../lib/commands";
import { validateProviderUrl } from "../../lib/providerValidation";
import ProviderModal from "./ProviderModal";
import ProviderActions from "./ProviderActions";
import ProviderDropdown from "./ProviderDropdown";
import ModelDropdown from "./ModelDropdown";

interface ProviderSelectProps {
  providerId: string;
  modelId: string;
  apiUrl: string;
  onProviderChange: (providerId: string, apiUrl: string, defaultModel: string) => void;
  onModelChange: (modelId: string) => void;
}

/**
 * Provider and model selection component.
 * SRP: Coordinates subcomponents (ProviderDropdown, ModelDropdown, ProviderActions).
 */
function ProviderSelect({
  providerId,
  modelId,
  apiUrl,
  onProviderChange,
  onModelChange,
}: ProviderSelectProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LlmProvider | null>(null);

  const {
    providers,
    loading,
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
      <div className="settings-field">
        <div className="settings-field-header">
          <label className="settings-field-label">LLM Provider</label>
        </div>
        <div className="provider-select-wrapper">
          <ProviderDropdown
            providers={providers}
            selectedId={providerId}
            onChange={handleProviderChange}
          />
          <ProviderActions
            currentProvider={currentProvider}
            onAdd={() => setShowAddModal(true)}
            onEdit={() => currentProvider && setEditingProvider(currentProvider)}
            onRemove={() => currentProvider && handleRemoveProvider(currentProvider.id)}
          />
        </div>
      </div>

      {/* Model Select */}
      <div className="settings-field">
        <div className="settings-field-header">
          <label className="settings-field-label">LLM Model</label>
        </div>
        <ModelDropdown
          models={models}
          selectedId={modelId}
          onChange={onModelChange}
        />
      </div>

      {/* API URL (readonly display) */}
      <div className="settings-field">
        <div className="settings-field-header">
          <label className="settings-field-label">API URL</label>
          <span className="settings-field-description">
            Automatically set by provider
          </span>
        </div>
        <input
          type="text"
          className="settings-field-input"
          value={apiUrl}
          readOnly
          aria-invalid={!apiUrlIsValid}
          style={{ opacity: 0.7, cursor: "default" }}
        />
      </div>

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
