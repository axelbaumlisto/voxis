import type { ProviderFormMode } from "../../hooks/useProviderForm";

interface ProviderModelOption {
  id: string;
  name: string;
}

interface ProviderFormBaseProps {
  mode: ProviderFormMode;
  providerId?: string;
  name: string;
  apiUrl: string;
  modelsText: string;
  defaultModel: string;
  models: ProviderModelOption[];
  onNameChange: (value: string) => void;
  onApiUrlChange: (value: string) => void;
  onModelsTextChange: (value: string) => void;
  onDefaultModelChange: (value: string) => void;
}

/**
 * Shared provider form fields used by add/edit flows.
 */
function ProviderFormBase({
  mode,
  providerId,
  name,
  apiUrl,
  modelsText,
  defaultModel,
  models,
  onNameChange,
  onApiUrlChange,
  onModelsTextChange,
  onDefaultModelChange,
}: ProviderFormBaseProps) {
  return (
    <>
      <div className="settings-field">
        <label className="settings-field-label">Name</label>
        <input
          type="text"
          className="settings-field-input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g., My Provider"
        />
      </div>

      {mode === "edit" && (
        <div className="settings-field">
          <label className="settings-field-label">ID</label>
          <input
            type="text"
            className="settings-field-input"
            value={providerId ?? ""}
            readOnly
            style={{ opacity: 0.7, cursor: "default" }}
          />
        </div>
      )}

      <div className="settings-field">
        <label className="settings-field-label">API URL</label>
        <input
          type="text"
          className="settings-field-input"
          value={apiUrl}
          onChange={(e) => onApiUrlChange(e.target.value)}
          placeholder="https://api.example.com/v1/chat/completions"
        />
      </div>

      <div className="settings-field">
        <div className="settings-field-header">
          <label className="settings-field-label">Models</label>
          <span className="settings-field-description">
            One per line: model-id:Display Name
          </span>
        </div>
        <textarea
          className="settings-field-input settings-textarea"
          value={modelsText}
          onChange={(e) => onModelsTextChange(e.target.value)}
          placeholder="gpt-4:GPT-4
gpt-3.5-turbo:GPT-3.5 Turbo"
          rows={4}
        />
      </div>

      {models.length > 0 && (
        <div className="settings-field">
          <label className="settings-field-label">Default Model</label>
          <select
            className="settings-field-input"
            value={defaultModel || models[0]?.id}
            onChange={(e) => onDefaultModelChange(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

export default ProviderFormBase;
