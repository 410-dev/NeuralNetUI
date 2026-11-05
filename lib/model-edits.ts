import type { ModelConfig, ReasoningPreset } from "./types";
import { applyPreferredOrder } from "./ordered-list.ts";

/**
 * Applies one account's preset edits. A global template belongs to the administrators: any of them
 * may edit it (it keeps its author), and nobody else can change, remove or create one. Private
 * templates stay with their owner.
 */
export function mergeModelPresets(existing: ModelConfig, candidate: ModelConfig | undefined, userId: string, admin: boolean): ModelConfig {
  if (!candidate) return existing;
  const ownedByOther = (p: ReasoningPreset) => Boolean(p.ownerId && p.ownerId !== userId);
  const protectedPresets = existing.reasoningPresets.filter(p => p.kind === "builtin" ? !admin : p.global ? !admin : ownedByOther(p));
  const protectedIds = new Set(protectedPresets.map(p => p.id));
  const editable = candidate.reasoningPresets.filter(p => !protectedIds.has(p.id) && (p.kind === "builtin" ? admin : admin && existing.reasoningPresets.some(e => e.id === p.id && e.global) || !ownedByOther(p)))
    .map(p => {
      if (p.kind !== "custom") return p;
      const previous = existing.reasoningPresets.find(e => e.id === p.id);
      // An administrator editing another administrator's global template leaves its author in place.
      const ownerId = admin && previous?.global ? previous.ownerId || userId : userId;
      return { ...p, ownerId, global: admin && p.global === true ? true : undefined };
    });
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
