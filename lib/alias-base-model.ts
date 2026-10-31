import { inheritReasoning } from "./reasoning-capabilities.ts";
import type { ModelConfig } from "./types.ts";

/** Finds either a user's explicit base model or the alias author's recommended base model. */
export function aliasBaseModel(alias: ModelConfig | undefined, models: ModelConfig[], baseModelId?: string): ModelConfig | undefined {
  if (!alias?.isAlias) return undefined;
  const chosen = baseModelId ? models.find(model => !model.isAlias && model.id === baseModelId) : undefined;
  return chosen || models.find(model => !model.isAlias && (model.id === alias.sourceModel || model.sourceModel === alias.sourceModel));
}

/**
 * The base an alias runs on while its preferred base is unavailable: the next available base after the preferred
 * one in the configured order, wrapping around, or the first available one when the preferred base is unknown.
 */
export function aliasFallbackBase<T extends Pick<ModelConfig, "id">>(preferred: T | undefined, ordered: T[], available: T[]): T | undefined {
  if (preferred && available.some(model => model.id === preferred.id)) return preferred;
  const start = preferred ? ordered.findIndex(model => model.id === preferred.id) : -1;
  if (start < 0) return available[0];
  const rotated = [...ordered.slice(start + 1), ...ordered.slice(0, start)];
  return rotated.find(model => available.some(candidate => candidate.id === model.id)) || available[0];
}

/** Applies a runtime base without mutating the alias's persisted recommendation or owned prompts. */
export function aliasWithBaseModel(alias: ModelConfig, base: ModelConfig): ModelConfig {
  return inheritReasoning({
    ...alias,
    sourceModel: base.sourceModel,
    connectionId: base.connectionId,
    apiContextWindowTokens: undefined,
  }, base);
}
