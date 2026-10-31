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
