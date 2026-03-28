import { LlmProvider } from "./commands";
import { validateProviderUrl, validateProviderForm } from "./providerValidation";

/**
 * Backward-compatible alias for provider URL validation.
 */
export function isValidApiUrl(url: string): boolean {
  return validateProviderUrl(url);
}

/**
 * Backward-compatible wrapper for provider validation with snake_case fields.
 */
export function validateProvider(provider: Partial<LlmProvider>): string[] {
  return validateProviderForm({
    name: provider.name ?? "",
    apiUrl: provider.api_url ?? "",
    models: provider.models ?? [],
  });
}
