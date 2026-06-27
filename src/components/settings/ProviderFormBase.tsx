import type { ProviderFormMode } from "../../hooks/useProviderForm";
import InputField from "./InputField";
import SelectField from "./SelectField";
import TextAreaField from "./TextAreaField";

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
      <InputField
        label="Name"
        value={name}
        onChange={onNameChange}
        placeholder="e.g., My Provider"
      />

      {mode === "edit" && (
        <InputField
          label="ID"
          value={providerId ?? ""}
          onChange={() => {}}
          readonly
        />
      )}

      <InputField
        label="API URL"
        value={apiUrl}
        onChange={onApiUrlChange}
        placeholder="https://api.example.com/v1/chat/completions"
      />

      <TextAreaField
        label="Models"
        description="One per line: model-id:Display Name"
        value={modelsText}
        onChange={onModelsTextChange}
        placeholder={"gpt-4:GPT-4\ngpt-3.5-turbo:GPT-3.5 Turbo"}
        rows={4}
      />

      {models.length > 0 && (
        <SelectField
          label="Default Model"
          value={defaultModel || models[0]?.id}
          onChange={onDefaultModelChange}
          options={models.map((m) => ({ value: m.id, label: m.name }))}
        />
      )}
    </>
  );
}

export default ProviderFormBase;
