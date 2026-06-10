// src/theme-engine/renderers/types.ts
/**
 * Shared renderer contract.
 *
 * Every concrete renderer (bars, ring, pill, …) implements this interface.
 * Themes that provide their own renderer must also satisfy this contract.
 *
 * SRP: one file for the contract; concrete renderers keep their own config types.
 */
import type { ThemeState } from "../contract";

export interface Renderer {
  /** Called on every spectrum event (i.e. every frame for ring). */
  update(state: ThemeState): void;
  /** Clean up DOM, cancel RAF loops, remove injected styles. */
  destroy(): void;
}
