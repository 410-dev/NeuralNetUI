import type { ModelConfig } from "./types";

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function objectValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * OpenAI's standard model object does not guarantee a context-window field,
 * but compatible servers commonly advertise one under one of these names.
 * Prefer the smallest advertised positive limit because it is the safest
 * operational maximum (for example, a loaded context can be below native).
 */
export function inferApiContextWindowTokens(record: Record<string, unknown>): number | undefined {
  const capabilities = objectValue(record, "capabilities");
  const limits = objectValue(record, "limits");
  const candidates = [
    record.context_window_tokens,
    record.context_window,
    record.context_length,
    record.max_context_length,
    record.max_model_len,
    record.max_sequence_length,
    record.max_seq_len,
    record.n_ctx,
    record.native_context_length,
    capabilities?.context_window_tokens,
    capabilities?.context_window,
    capabilities?.context_length,
    limits?.context_window_tokens,
    limits?.context_window,
    limits?.context_length,
  ].map(positiveInteger).filter((value): value is number => value !== undefined);
  return candidates.length ? Math.min(...candidates) : undefined;
}

export function baseModelForAlias(model: ModelConfig | undefined, models: ModelConfig[]): ModelConfig | undefined {
  if (!model?.isAlias) return undefined;
  return models.find((candidate) => !candidate.isAlias && (candidate.sourceModel === model.sourceModel || candidate.id === model.sourceModel));
}

export function advertisedContextWindowTokens(model: ModelConfig | undefined, models: ModelConfig[] = []): number | undefined {
  const base = baseModelForAlias(model, models);
  return positiveInteger(base?.apiContextWindowTokens ?? model?.apiContextWindowTokens);
}

export function effectiveContextWindowTokens(model?: ModelConfig, models: ModelConfig[] = []): number | undefined {
  if (!model) return undefined;
  const configured = positiveInteger(model.contextWindowTokens);
  const base = baseModelForAlias(model, models);
  const advertised = positiveInteger(base?.apiContextWindowTokens ?? model.apiContextWindowTokens);
  if (model.isAlias && base && !configured) return effectiveContextWindowTokens(base, models);
  if (configured && advertised) return Math.min(configured, advertised);
  return configured || advertised;
}
