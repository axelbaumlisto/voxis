/**
 * Configuration utilities.
 * SRP: Centralized config value access.
 */

import { AppConfig } from "./commands";

/**
 * Get value from config using dot notation path.
 * @example getConfigValue(config, "llm.model") // returns config.llm.model
 */
export function getConfigValue(config: AppConfig, path: string): unknown {
  const parts = path.split(".");
  if (parts.length === 1) {
    return config[path as keyof AppConfig];
  }
  const [parent, child] = parts;
  const parentObj = config[parent as keyof AppConfig];
  if (typeof parentObj === "object" && parentObj !== null) {
    return (parentObj as Record<string, unknown>)[child];
  }
  return undefined;
}
