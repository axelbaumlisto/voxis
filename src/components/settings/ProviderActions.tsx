import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <>
      <button
        className="provider-action-btn"
        onClick={onAdd}
        title={t("settings.addProvider")}
        aria-label={t("settings.addProvider")}
      >
        +
      </button>
      {currentProvider && !currentProvider.builtin && (
        <>
          <button
            className="provider-action-btn provider-edit-btn"
            onClick={onEdit}
            title={t("settings.editProvider")}
            aria-label={t("settings.editProvider")}
          >
            &#9998;
          </button>
          <button
            className="provider-action-btn provider-delete-btn"
            onClick={onRemove}
            title={t("settings.removeProvider")}
            aria-label={t("settings.removeProvider")}
          >
            x
          </button>
        </>
      )}
    </>
  );
}

export default ProviderActions;
