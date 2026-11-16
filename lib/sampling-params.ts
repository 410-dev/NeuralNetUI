/**
 * Inference (sampling) parameters a model request can carry. Every field is optional: a missing value is never
 * sent, so the model server applies its own default.
 */
export const SAMPLING_KEYS = ["topK", "repeatPenalty", "presencePenalty", "topP", "minP"] as const;
export type SamplingKey = typeof SAMPLING_KEYS[number];
export type SamplingParams = Partial<Record<SamplingKey, number>>;

export const SAMPLING_LIMITS: Record<SamplingKey, { min: number; max: number; step: number; integer?: boolean }> = {
  topK: { min: 0, max: 1000, step: 1, integer: true },
  repeatPenalty: { min: 0, max: 5, step: 0.01 },
  presencePenalty: { min: -2, max: 2, step: 0.01 },
  topP: { min: 0, max: 1, step: 0.01 },
  minP: { min: 0, max: 1, step: 0.01 },
};

/** Field names on OpenAI-compatible chat requests, as LM Studio, llama.cpp and vLLM read them. */
export const SAMPLING_API_FIELDS: Record<SamplingKey, string> = { topK: "top_k", repeatPenalty: "repeat_penalty", presencePenalty: "presence_penalty", topP: "top_p", minP: "min_p" };

/** A personal layer, kept in an account's preferences: per model, then per reasoning template of that model. */
export type PersonalSampling = Record<string, { base?: SamplingParams; presets?: Record<string, SamplingParams> }>;

function samplingValue(key: SamplingKey, value: unknown): number | undefined {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  const { min, max, integer } = SAMPLING_LIMITS[key];
  if (number < min || number > max) return undefined;
  return integer ? Math.round(number) : Math.round(number * 10_000) / 10_000;
}

/** Keeps the in-range numbers only; an object with nothing left becomes undefined. */
export function normalizeSamplingParams(value: unknown): SamplingParams | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>; const params: SamplingParams = {};
  for (const key of SAMPLING_KEYS) { const number = samplingValue(key, record[key]); if (number !== undefined) params[key] = number; }
  return Object.keys(params).length ? params : undefined;
}

export function readPersonalSampling(value: unknown): PersonalSampling {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: PersonalSampling = {};
  for (const [modelId, raw] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
    if (!modelId || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as { base?: unknown; presets?: unknown };
    const base = normalizeSamplingParams(entry.base);
    const presets: Record<string, SamplingParams> = {};
    if (entry.presets && typeof entry.presets === "object" && !Array.isArray(entry.presets)) for (const [presetId, params] of Object.entries(entry.presets as Record<string, unknown>).slice(0, 200)) { const normalized = normalizeSamplingParams(params); if (presetId && normalized) presets[presetId] = normalized; }
    if (base || Object.keys(presets).length) result[modelId] = { ...(base ? { base } : {}), ...(Object.keys(presets).length ? { presets } : {}) };
  }
  return result;
}

/**
 * Later layers win field by field: the served model, then an alias's own values, then the reasoning template,
 * then — only where the administrator lets accounts change them — the account's values for the model and for
 * the template.
 */
export function resolveSampling(input: { served?: { samplingParams?: SamplingParams }; alias?: { samplingParams?: SamplingParams }; preset?: { id: string; samplingParams?: SamplingParams }; modelId: string; personal?: PersonalSampling; userEditable?: boolean }): SamplingParams {
  const layers: Array<SamplingParams | undefined> = [input.served?.samplingParams, input.alias?.samplingParams, input.preset?.samplingParams];
  if (input.userEditable) {
    const own = input.personal?.[input.modelId];
    layers.push(own?.base, input.preset ? own?.presets?.[input.preset.id] : undefined);
  }
  const result: SamplingParams = {};
  for (const layer of layers) { const normalized = normalizeSamplingParams(layer); if (normalized) Object.assign(result, normalized); }
  return result;
}

export function samplingRequestFields(params: SamplingParams): Record<string, number> {
  return Object.fromEntries(SAMPLING_KEYS.filter(key => params[key] !== undefined).map(key => [SAMPLING_API_FIELDS[key], params[key]!]));
}

/** LM Studio SDK prediction options for the same values. */
export function samplingSdkConfig(params: SamplingParams) {
  return {
    ...(params.topK !== undefined ? { topKSampling: params.topK } : {}),
    ...(params.topP !== undefined ? { topPSampling: params.topP } : {}),
    ...(params.minP !== undefined ? { minPSampling: params.minP } : {}),
    ...(params.repeatPenalty !== undefined ? { repeatPenalty: params.repeatPenalty } : {}),
    ...(params.presencePenalty !== undefined ? { presencePenalty: params.presencePenalty } : {}),
  };
}

/**
 * Reads a server's defaults from either shape it reports them in: llama.cpp `/props` settings (`top_k`, ...) or
 * an LM Studio prediction config (`topKSampling`, ...), where `false` means the filter or penalty is off.
 */
export function samplingFromServer(value: unknown): SamplingParams | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const off = (raw: unknown, disabled: number) => raw === false ? disabled : raw;
  return normalizeSamplingParams({
    topK: record.top_k ?? record.topKSampling,
    topP: record.top_p ?? record.topPSampling,
    minP: record.min_p ?? off(record.minPSampling, 0),
    repeatPenalty: record.repeat_penalty ?? off(record.repeatPenalty, 1),
    presencePenalty: record.presence_penalty ?? off(record.presencePenalty, 0),
  });
}

/**
 * After a model refresh, a value still equal to the previously reported default (or never set) follows the new
 * default; a value someone changed is kept. When nothing could be read, the values stay as they were.
 */
export function refreshSamplingDefaults(current: SamplingParams | undefined, previousDefaults: SamplingParams | undefined, nextDefaults: SamplingParams | undefined): SamplingParams | undefined {
  if (!nextDefaults) return normalizeSamplingParams(current);
  const result: SamplingParams = { ...normalizeSamplingParams(current) };
  for (const key of SAMPLING_KEYS) {
    const value = result[key];
    if ((value === undefined || value === previousDefaults?.[key]) && nextDefaults[key] !== undefined) result[key] = nextDefaults[key];
  }
  return normalizeSamplingParams(result);
}
