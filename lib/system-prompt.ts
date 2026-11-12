import type { ModelConfig, ReasoningPreset } from "./types.ts";

/** Per-account system prompt replacements: model id, then reasoning preset id (or DEFAULT_PRESET_KEY). */
export type SystemPromptOverrides = Record<string, Record<string, string>>;

// Distinct from any preset id, including the built-in level some servers name "default".
export const DEFAULT_PRESET_KEY = "__none__";
export const MAX_SYSTEM_PROMPT_OVERRIDE_LENGTH = 100_000;

/** The system prompt a model sends with a reasoning preset applied: the model's prompt and a template's own. */
export function composeSystemPrompt(model: Pick<ModelConfig, "systemPrompt">, preset?: Pick<ReasoningPreset, "kind" | "systemPrompt" | "systemPromptMode">) {
  const modelPrompt = model.systemPrompt?.trim() || "";
  const presetPrompt = preset?.kind === "custom" ? preset.systemPrompt?.trim() || "" : "";
  if (!presetPrompt) return modelPrompt;
  if (preset?.systemPromptMode === "replace") return presetPrompt;
  return (preset?.systemPromptMode === "prepend" ? [presetPrompt, modelPrompt] : [modelPrompt, presetPrompt]).filter(Boolean).join("\n\n");
}

/** Anyone may rewrite an alias's prompt for themselves; a served model only once an administrator allows it. */
export function systemPromptEditable(model: Pick<ModelConfig, "isAlias" | "systemPromptEditable">) {
  return model.isAlias || model.systemPromptEditable === true;
}

/** Reads a saved preference value defensively: only string prompts under string keys survive. */
export function readSystemPromptOverrides(value: unknown): SystemPromptOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: SystemPromptOverrides = {};
  for (const [modelId, presets] of Object.entries(value as Record<string, unknown>)) {
    if (!presets || typeof presets !== "object" || Array.isArray(presets)) continue;
    const kept = Object.fromEntries(Object.entries(presets as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    if (Object.keys(kept).length) result[modelId] = kept;
  }
  return result;
}

/** The account's replacement for this model and preset, if it saved one. */
export function systemPromptOverride(overrides: SystemPromptOverrides, modelId: string, presetId?: string) {
  return overrides[modelId]?.[presetId || DEFAULT_PRESET_KEY];
}

/** Sets or, with `null`, removes one replacement, dropping a model entry that becomes empty. */
export function withSystemPromptOverride(overrides: SystemPromptOverrides, modelId: string, presetId: string | undefined, prompt: string | null): SystemPromptOverrides {
  const key = presetId || DEFAULT_PRESET_KEY;
  const presets = { ...(overrides[modelId] || {}) };
  if (prompt === null) delete presets[key]; else presets[key] = prompt;
  const next = { ...overrides };
  if (Object.keys(presets).length) next[modelId] = presets; else delete next[modelId];
  return next;
}

/** Whether an account may layer its own prompts over a model's: where the model allows it, and always for administrators. */
export function canPersonalizeSystemPrompt(model: Pick<ModelConfig, "isAlias" | "systemPromptEditable">, role?: string) {
  return systemPromptEditable(model) || role === "admin" || role === "superadmin";
}

/**
 * The account's own prompt per model (Settings > Models). Accounts that saved prompts before these existed had
 * per-preset replacements; the one saved without a preset is the closest equivalent and is read once from there.
 */
export function readModelSystemPrompts(preferences: { modelSystemPrompts?: unknown; systemPromptOverrides?: unknown } | undefined): Record<string, string> {
  const raw = preferences?.modelSystemPrompts;
  if (raw && typeof raw === "object" && !Array.isArray(raw))
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "" && entry[1].length <= MAX_SYSTEM_PROMPT_OVERRIDE_LENGTH));
  const legacy = readSystemPromptOverrides(preferences?.systemPromptOverrides);
  return Object.fromEntries(Object.entries(legacy).flatMap(([modelId, presets]) => presets[DEFAULT_PRESET_KEY]?.trim() ? [[modelId, presets[DEFAULT_PRESET_KEY]]] : []));
}

/**
 * The prompt a chat sends, most specific first: this chat's own prompt for the model and preset, then the
 * account's prompt for the model in place of the server default, with the preset's template applied.
 * `selectedId` is the model the person picked (an alias, not its base).
 */
export function resolveSystemPrompt(input: { model: Pick<ModelConfig, "systemPrompt">; selectedId: string; preset?: Pick<ReasoningPreset, "id" | "kind" | "systemPrompt" | "systemPromptMode">; allowed: boolean; personal?: string; session?: SystemPromptOverrides }) {
  if (input.allowed) {
    const session = input.session ? systemPromptOverride(input.session, input.selectedId, input.preset?.id) : undefined;
    if (session !== undefined) return session.trim();
  }
  const base = input.allowed && input.personal?.trim() ? input.personal : input.model.systemPrompt;
  return composeSystemPrompt({ systemPrompt: base }, input.preset);
}
