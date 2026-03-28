import type { LlmModel } from "./commands";

export type ValidationError = string;

export interface ProviderFormData {
  name: string;
  apiUrl: string;
  models: LlmModel[];
}

/**
 * Validates that a string is a valid HTTP/HTTPS URL.
 */
export function validateProviderUrl(url: string): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Validates provider form fields and returns a list of validation errors.
 */
export function validateProviderForm(data: ProviderFormData): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!data.name?.trim()) {
    errors.push("Name is required");
  }

  if (!data.apiUrl?.trim()) {
    errors.push("API URL is required");
  } else if (!validateProviderUrl(data.apiUrl)) {
    errors.push("API URL must be a valid HTTP/HTTPS URL");
  }

  if (!data.models?.length) {
    errors.push("At least one model is required");
  }

  return errors;
}
