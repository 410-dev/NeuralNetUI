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

export function reasoningEffort(model: ModelConfig, preset?: ReasoningPreset) {
  if (!model.reasoningSupported || !preset?.effort) return undefined;
  if (model.reasoningEfforts?.length && !model.reasoningEfforts.includes(preset.effort)) return undefined;
  return preset.effort;
}
