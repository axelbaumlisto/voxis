import { LlmProvider } from "../../lib/commands";

interface ProviderActionsProps {
  currentProvider: LlmProvider | undefined;
  onAdd: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

/**
 * Action buttons for provider management.
 * SRP: Extracts provider action buttons from ProviderSelect.
 */
function ProviderActions({
  currentProvider,
  onAdd,
  onEdit,
  onRemove,
}: ProviderActionsProps) {
  return (
    <>
      <button
        className="provider-action-btn"
        onClick={onAdd}
        title="Add custom provider"
      >
        +
      </button>
      {currentProvider && !currentProvider.builtin && (
        <>
          <button
            className="provider-action-btn provider-edit-btn"
            onClick={onEdit}
            title="Edit provider"
          >
            &#9998;
          </button>
          <button
            className="provider-action-btn provider-delete-btn"
            onClick={onRemove}
            title="Remove provider"
          >
            x
          </button>
        </>
      )}
    </>
  );
}

export default ProviderActions;
