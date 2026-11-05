import type { ConnectionDriver, ModelConfig, ReasoningPreset } from "./types.ts";
import { applyPreferredOrder } from "./ordered-list.ts";

const supportedOptions = new Set(["off", "none", "on", "minimal", "low", "medium", "high", "xhigh", "max"]);
export const isReasoningToggle = (value: string) => ["off", "none", "on"].includes(value);
export function reasoningOptionName(value: string) {
  return value === "off" || value === "none" ? "Fast" : value === "on" ? "Thinking" : value === "xhigh" ? "Extra High" : value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** Native options are authoritative. Family fallbacks apply only without metadata. */
export function inferReasoning(record: Record<string, unknown>, id: string, driver: ConnectionDriver) {
  const capabilities = record.capabilities && typeof record.capabilities === "object" ? record.capabilities as Record<string, unknown> : {};
  const reasoning = capabilities.reasoning && typeof capabilities.reasoning === "object" ? capabilities.reasoning as Record<string, unknown> : {};
  const advertised = reasoning.allowed_options ?? record.reasoning_efforts ?? record.supported_reasoning_efforts ?? capabilities.reasoning_efforts;
  const disabled = record.reasoning_supported === false || capabilities.reasoning === false;
  let options: string[] = [];
  if (!disabled) {
    if (Array.isArray(advertised)) options = advertised.filter((v): v is string => typeof v === "string" && supportedOptions.has(v));
    else if (/qwen[ -]?3\.8/i.test(id)) options = ["off", "low", "medium", "xhigh", "on"];
    else if (/(gemma[ -]?4|qwen[ -]?3(?:\.\d+)?)/i.test(id)) options = ["off", "on"];
    else if (driver !== "lmstudio" && /(?:^|\/)(?:o[134](?:-|$)|gpt-5)/i.test(id)) options = ["low", "medium", "high"];
  }
  return { reasoningSupported: options.length > 0, reasoningEfforts: [...new Set(options)] };
}

/** Values tried through the API when a model is forced into API mode without advertised options. */
export const FORCED_REASONING_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Whether an account sees a template: its own, a global one, or one with no owner. */
export function presetVisibleTo(preset: ReasoningPreset, userId: string) {
  return preset.kind === "builtin" || preset.global === true || !preset.ownerId || preset.ownerId === userId;
}

/**
 * Keeps the advertised options and the templates in their saved order. Reasoning levels are never
 * generated from the server's metadata: a model offers only the templates an administrator (or the
 * owner of a custom model) wrote, and without one it runs at its own default.
 */
export function normalizeReasoning(model: ModelConfig): ModelConfig {
  // Forced API mode stands in for missing metadata; it is dropped once the server advertises options.
  if (model.reasoningForceApi) {
    const advertised = model.reasoningEfforts?.length && model.reasoningEfforts.join() !== FORCED_REASONING_EFFORTS.join();
    model = advertised ? { ...model, reasoningForceApi: undefined } : { ...model, reasoningSupported: true, reasoningEfforts: FORCED_REASONING_EFFORTS };
  }
  const options = [...new Set(model.reasoningEfforts || [])].filter(v => supportedOptions.has(v));
  const templates = model.reasoningPresets.filter(p => p.kind === "custom");
  return { ...model, reasoningEfforts: options, reasoningPresets: applyPreferredOrder(templates, model.reasoningPresets.map(p => p.id)) };
}

export function inheritReasoning(alias: ModelConfig, base?: ModelConfig): ModelConfig {
  return normalizeReasoning({ ...alias, reasoningSupported: base?.reasoningSupported ?? false, reasoningEfforts: base?.reasoningEfforts || [], reasoningForceApi: base?.reasoningForceApi });
}

/** The presets a chat offers: the templates only, never a generated level. */
export function offeredPresets(_model: ModelConfig, presets = _model.reasoningPresets) {
  return presets.filter(p => p.kind === "custom");
}
