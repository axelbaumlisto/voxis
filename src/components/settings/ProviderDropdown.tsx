import { LlmProvider } from "../../lib/commands";
import OptionDropdown, { DropdownOption } from "./OptionDropdown";

interface ProviderDropdownProps {
  providers: LlmProvider[];
  selectedId: string;
  onChange: (providerId: string) => void;
}

/**
 * Dropdown for selecting an LLM provider.
 * DRY: Wraps OptionDropdown with provider-specific mapping.
 */
function ProviderDropdown({ providers, selectedId, onChange }: ProviderDropdownProps) {
  // Convert LlmProvider to DropdownOption
  const options: DropdownOption[] = providers.map((p) => ({
    id: p.id,
    label: p.name,
    suffix: p.builtin ? undefined : "(custom)",
  }));

  return (
    <OptionDropdown
      options={options}
      selectedId={selectedId}
      onChange={onChange}
      showMissingSelection={false}
    />
  );
}

export default ProviderDropdown;
