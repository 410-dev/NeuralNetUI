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
    else if (driver === "openai" && /(?:^|\/)(?:o[134](?:-|$)|gpt-5)/i.test(id)) options = ["low", "medium", "high"];
  }
  return { reasoningSupported: options.length > 0, reasoningEfforts: [...new Set(options)] };
}

/** Preserve custom templates and the user's ordering while rebuilding valid built-ins. */
export function normalizeReasoning(model: ModelConfig): ModelConfig {
  const options = [...new Set(model.reasoningEfforts || [])].filter(v => supportedOptions.has(v));
  const hasEffort = options.some(v => !isReasoningToggle(v));
  const choices = (model.reasoningSupported ? options : []).filter(v => !(hasEffort && v === "on") && !(v === "none" && options.includes("off")));
  choices.sort((a, b) => Number(b === "off" || b === "none") - Number(a === "off" || a === "none"));
  const custom = model.reasoningPresets.filter(p => p.kind === "custom");
  const usedIds = new Set(custom.map(p => p.id));
  const builtin: ReasoningPreset[] = (choices.length ? choices : [""]).map(effort => {
    const previous = model.reasoningPresets.find(p => p.kind === "builtin" && (p.effort || "") === effort);
    let id = previous?.id || effort || "default";
    while (usedIds.has(id)) id = `builtin-${id}`;
    usedIds.add(id);
    return { id, name: effort ? reasoningOptionName(effort) : "Default", kind: "builtin", ...(effort ? { effort } : {}) };
  });
  return { ...model, reasoningEfforts: options, reasoningPresets: applyPreferredOrder([...builtin, ...custom], model.reasoningPresets.map(p => p.id)) };
}

export function inheritReasoning(alias: ModelConfig, base?: ModelConfig): ModelConfig {
  return normalizeReasoning({ ...alias, reasoningSupported: base?.reasoningSupported ?? false, reasoningEfforts: base?.reasoningEfforts || [] });
}
