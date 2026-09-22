import { inheritReasoning } from "./reasoning-capabilities.ts";
import type { ModelConfig } from "./types.ts";

/** Finds either a user's explicit base model or the alias author's recommended base model. */
export function aliasBaseModel(alias: ModelConfig | undefined, models: ModelConfig[], baseModelId?: string): ModelConfig | undefined {
  if (!alias?.isAlias) return undefined;
  const chosen = baseModelId ? models.find(model => !model.isAlias && model.id === baseModelId) : undefined;
  return chosen || models.find(model => !model.isAlias && (model.id === alias.sourceModel || model.sourceModel === alias.sourceModel));
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
