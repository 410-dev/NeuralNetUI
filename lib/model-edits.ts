import type { ModelConfig, ReasoningPreset } from "./types";
import { applyPreferredOrder } from "./ordered-list.ts";

export function mergeModelPresets(existing: ModelConfig, candidate: ModelConfig | undefined, userId: string, admin: boolean): ModelConfig {
  if (!candidate) return existing;
  const protectedPresets = existing.reasoningPresets.filter(p => p.kind === "builtin" ? !admin : Boolean(p.ownerId && p.ownerId !== userId));
  const protectedIds = new Set(protectedPresets.map(p => p.id));
  const editable = candidate.reasoningPresets.filter(p => !protectedIds.has(p.id) && (p.kind === "builtin" ? admin : !p.ownerId || p.ownerId === userId))
    .map(p => p.kind === "custom" ? { ...p, ownerId: userId } : p);
  return { ...(admin ? candidate : existing), reasoningPresets: applyPreferredOrder([...editable, ...protectedPresets], (admin ? candidate : existing).reasoningPresets.map(p => p.id)) };
}

/** The value a preset sends as-is. A template's typed value is trusted verbatim; a built-in must be advertised. */
export function presetEffortValue(model: ModelConfig, preset?: ReasoningPreset) {
  const effort = preset?.effort?.trim();
  if (!model.reasoningSupported || !effort) return undefined;
  if (preset!.kind === "custom") return effort;
  return model.reasoningEfforts?.includes(effort) ? effort : undefined;
}

export function reasoningEffort(model: ModelConfig, preset?: ReasoningPreset) {
  const effort = presetEffortValue(model, preset);
  if (!effort) return undefined;
  if (preset!.kind === "custom") return effort;
  // LM Studio advertises off/on natively; Chat Completions accepts OpenAI values.
  return effort === "off" ? "none" : effort === "on" ? "medium" : effort;
}
