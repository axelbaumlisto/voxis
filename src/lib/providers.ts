import { LlmModel } from "./commands";

/**
 * Parse models from text format (one per line: id:name or just id).
 */
export function parseModelsFromText(text: string): LlmModel[] {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.map((line) => {
    const [id, ...nameParts] = line.split(":");
    const modelName = nameParts.join(":").trim() || id.trim();
    return { id: id.trim(), name: modelName };
  });
}

/**
 * Convert models array to text format for editing.
 */
export function modelsToText(models: LlmModel[]): string {
  return models
    .map((m) => (m.id === m.name ? m.id : `${m.id}:${m.name}`))
    .join("\n");
}

/**
 * Generate a URL-safe ID from a provider name.
 */
export function generateProviderId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Check if a provider ID already exists in the list.
 */
export function isDuplicateProviderId(id: string, existingIds: string[]): boolean {
  return existingIds.includes(id);
}
