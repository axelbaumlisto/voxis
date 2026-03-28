import OptionDropdown, { DropdownOption } from "./OptionDropdown";

interface ModelOption {
  id: string;
  name: string;
}

interface ModelDropdownProps {
  models: ModelOption[];
  selectedId: string;
  onChange: (modelId: string) => void;
}

/**
 * Dropdown for selecting an LLM model.
 * DRY: Wraps OptionDropdown with model-specific mapping.
 */
function ModelDropdown({ models, selectedId, onChange }: ModelDropdownProps) {
  // Convert ModelOption to DropdownOption
  const options: DropdownOption[] = models.map((m) => ({
    id: m.id,
    label: m.name,
  }));

  return (
    <OptionDropdown
      options={options}
      selectedId={selectedId}
      onChange={onChange}
      showMissingSelection={true}
    />
  );
}

export default ModelDropdown;
